import assert from "node:assert/strict";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expect, type Page } from "@playwright/test";
import { appCopy } from "../apps/dashboard/src/copy/app.js";
import { sessionsCopy } from "../apps/dashboard/src/copy/sessions.js";
import { paths } from "../apps/dashboard/src/lib/routes.js";
import {
  getOutputSchema,
  type ContentCursor,
  type GetOutput,
} from "../packages/core/schemas/get.js";
import { treeOutputSchema } from "../packages/core/schemas/rest.js";
import { searchOutputSchema } from "../packages/core/schemas/search.js";

/** Real producer children must expose their own file read, not a parent summary, and a
 * Claude Code or Codex subagent must hang from the parent's recorded spawning call. */
// @req R-DASH-19 @req R-DASH-30 @req R-DASH-33 @req R-LNK-01 @req R-LNK-02 @req R-LNK-07 @req R-HRN-01 @req R-HRN-02
export async function verifyNativeTree(input: {
  publicUrl: string;
  apiKey: string;
  client: Client;
  page: Page;
  parentId: string;
  relation: "SUBAGENT" | "FORK";
  /** Whether this harness records the spawning call (`liveHarnesses` data, §5.5). */
  spawningCall: boolean;
  childIds: string[];
  probe: string;
  screenshotPath: string;
}) {
  const headers = { authorization: `Bearer ${input.apiKey}` };
  assert.ok(input.childIds.length > 0, "A native child is required.");
  const nodes: ReturnType<typeof treeOutputSchema.parse>["nodes"] = [];
  let treeCursor: string | null = null;
  for (let index = 0; index < 100; index++) {
    const url = new URL(
      `/api/v1/sessions/${input.parentId}/tree`,
      input.publicUrl,
    );
    url.searchParams.set("limit", "100");
    if (treeCursor) url.searchParams.set("cursor", treeCursor);
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200, "Native tree REST response.");
    const result = treeOutputSchema.parse(await response.json());
    nodes.push(...result.nodes);
    if (!result.cursor) break;
    assert.notEqual(result.cursor, treeCursor, "Tree cursor must advance.");
    treeCursor = result.cursor;
    assert.ok(index < 99, "Native tree exceeded 100 bounded pages.");
  }

  /** Page through a session's `get` responses until one message matches. */
  async function findMessage(
    scope: { publicUrl: string; apiKey: string },
    sessionId: string,
    predicate: (message: GetOutput["messages"][number]) => boolean,
  ) {
    let cursor: ContentCursor | null = null;
    for (let index = 0; index < 100; index++) {
      const url = new URL(`/api/v1/sessions/${sessionId}`, scope.publicUrl);
      if (cursor) url.searchParams.set("cursor", JSON.stringify(cursor));
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${scope.apiKey}` },
      });
      assert.equal(response.status, 200, "Native session REST response.");
      const result = getOutputSchema.parse(await response.json());
      const message = result.messages.find(predicate);
      if (message) return message;
      assert.ok(result.next, "The expected message is missing.");
      cursor = result.next;
    }
    throw new Error("Native get exceeded 100 bounded pages.");
  }
  const evidence = [];
  const touch = await input.page.evaluate(() => navigator.maxTouchPoints > 0);
  const action = touch ? "tap" : "click";
  const transcriptCopy = sessionsCopy.detail.transcript;
  for (const childId of input.childIds) {
    const node = nodes.find((item) => item.session_id === childId);
    assert.ok(node, "The REST tree must include the actual native child.");
    assert.equal(node.parent_session_id, input.parentId);
    assert.equal(node.parent_relation, input.relation);
    assert.equal(node.gap, false);
    // A harness that records which call started a subagent must expose it; pi forks
    // and env-spawned sessions have no such call and must not invent one.
    const spawned = input.relation === "SUBAGENT" && input.spawningCall;
    if (spawned)
      assert.match(
        node.parent_tool_use_id ?? "",
        /^redacted-[a-f0-9]{64}$/,
        "A native subagent must name its spawning tool call.",
      );
    else assert.equal(node.parent_tool_use_id, null);

    async function findRead(
      read: (cursor: ContentCursor | null) => Promise<GetOutput>,
    ) {
      let cursor: ContentCursor | null = null;
      for (let index = 0; index < 100; index++) {
        const result = await read(cursor);
        assert.equal(result.header.session_id, childId);
        assert.equal(result.header.parent_session_id, input.parentId);
        assert.equal(result.header.parent_relation, input.relation);
        const message = result.messages.find(
          (item) =>
            item.session_id === childId &&
            item.kind === "TOOL_RESULT" &&
            item.content.includes(input.probe),
        );
        if (message) return { message, pages: index + 1 };
        assert.ok(result.next, "The child's own file-read result is missing.");
        assert.notDeepEqual(result.next, cursor, "Get cursor must advance.");
        cursor = result.next;
      }
      throw new Error("Native child get exceeded 100 bounded pages.");
    }
    const rest = await findRead(async (cursor) => {
      const url = new URL(`/api/v1/sessions/${childId}`, input.publicUrl);
      if (cursor) url.searchParams.set("cursor", JSON.stringify(cursor));
      const response = await fetch(url, { headers });
      assert.equal(response.status, 200, "Native child REST response.");
      return getOutputSchema.parse(await response.json());
    });
    const mcp = await findRead(async (cursor) => {
      const result = await input.client.callTool({
        name: "get",
        arguments: { session_id: childId, ...(cursor ? { cursor } : {}) },
      });
      assert.notEqual(result.isError, true, "Native child MCP get failed.");
      return getOutputSchema.parse(result.structuredContent);
    });
    assert.equal(mcp.message.message_id, rest.message.message_id);
    const search = { query: input.probe, filters: { session_id: childId } };
    const searchResponse = await fetch(`${input.publicUrl}/api/v1/search`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(search),
    });
    assert.equal(searchResponse.status, 200);
    const mcpSearch = await input.client.callTool({
      name: "search",
      arguments: search,
    });
    assert.notEqual(mcpSearch.isError, true);
    for (const value of [
      await searchResponse.json(),
      mcpSearch.structuredContent,
    ])
      assert.ok(
        searchOutputSchema
          .parse(value)
          .blocks.some((block) => block.session_id === childId),
        "The actual child must be independently searchable.",
      );

    // The root session's page shows the child under the tool call that spawned it, or
    // under "Subagent runs" when no call is recorded; the block expands to the child's
    // own bounded message pages from `get`.
    await input.page.goto(`${input.publicUrl}${paths.session(input.parentId)}`);
    const block = input.page.getByTestId(`session-subagent-${childId}`);
    await expect(block).toBeVisible({ timeout: 30_000 });
    await expect(block).toContainText(appCopy.statuses[input.relation]);
    const expandTools = input.page.getByRole("switch", {
      name: transcriptCopy.expandTools,
      exact: true,
    });
    if ((await expandTools.getAttribute("aria-checked")) !== "true")
      await expandTools[action]();
    if (spawned) {
      const spawningCall = await findMessage(
        input,
        input.parentId,
        (item) =>
          item.kind === "TOOL_USE" &&
          item.tool_use_id === node.parent_tool_use_id,
      );
      // The parent page is byte-paged; load until the spawning call is on screen.
      const call = input.page.getByTestId(
        `session-message-${String(spawningCall.seq)}`,
      );
      // The button relabels itself while a page loads, so match both labels.
      const escape = (value: string) =>
        value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pageMore = input.page
        .getByTestId("session-transcript")
        .locator("..")
        .getByRole("button", {
          name: new RegExp(
            `^(?:${escape(transcriptCopy.loadMore)}|${escape(transcriptCopy.loading)})$`,
          ),
        });
      for (let pages = 1; (await call.count()) === 0; pages++) {
        assert.ok(pages < 100, "Spawning call exceeded 100 browser pages.");
        assert.ok(
          (await pageMore.count()) > 0,
          "The spawning call is not on any transcript page.",
        );
        await expect(pageMore.first()).toBeEnabled();
        await pageMore.first()[action]();
        await expect
          .poll(
            async () =>
              (await pageMore.count()) === 0 || pageMore.first().isEnabled(),
          )
          .toBe(true);
      }
      await expect(
        call.getByTestId(`session-subagent-${childId}`),
      ).toBeVisible();
      await expect(call).toContainText(sessionsCopy.detail.subagents.spawned);
    } else
      await expect(
        input.page
          .getByRole("region", { name: sessionsCopy.detail.subagents.title })
          .getByTestId(`session-subagent-${childId}`),
      ).toBeVisible();
    await block.getByRole("button", { expanded: false })[action]();
    await expect(block.getByRole("button", { expanded: true })).toBeVisible();
    // Strict mode: the summary preview and the output both quote the probe, so
    // read the result's own <pre> rather than any text node.
    const probe = block.locator("pre").filter({ hasText: input.probe });
    const more = block.getByRole("button", {
      name: transcriptCopy.loadMore,
      exact: true,
    });
    let browserPages = 1;
    for (;;) {
      await expect(
        block.getByText(appCopy.common.loading, { exact: true }),
      ).toHaveCount(0, { timeout: 30_000 });
      if ((await probe.count()) > 0) break;
      assert.ok(
        (await more.count()) > 0,
        "Child read was not shown in the subagent block.",
      );
      assert.ok(browserPages < 100, "Child read exceeded 100 browser pages.");
      const response = input.page.waitForResponse(
        (value) =>
          new URL(value.url()).pathname === `/api/v1/sessions/${childId}` &&
          value.request().method() === "GET",
      );
      await more[action]();
      assert.equal((await response).status(), 200);
      browserPages++;
      await expect
        .poll(async () => (await more.count()) === 0 || more.isEnabled())
        .toBe(true);
    }
    await expect(probe.first()).toBeVisible();
    await expect(probe.first()).toContainText(input.probe);
    // Inline child messages never claim the page-level message ids.
    assert.equal(
      await block.getByTestId(/^session-message-\d+$/).count(),
      0,
      "Inline child messages must not carry page-level deep-link ids.",
    );
    assert.equal(
      await input.page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
      "Expanded native child content must fit the mobile viewport.",
    );
    await input.page.screenshot({
      path: input.screenshotPath,
      fullPage: true,
    });
    // The child's own page names its root session.
    await block.locator(`a[href="${paths.session(childId)}"]`)[action]();
    await expect(input.page).toHaveURL(
      new RegExp(`${paths.session(childId)}$`),
    );
    const notice = input.page
      .getByRole("status")
      .filter({ hasText: sessionsCopy.detail.subagentRun });
    await expect(
      notice.getByRole("link", {
        name: sessionsCopy.detail.openRoot,
        exact: true,
      }),
    ).toHaveAttribute("href", paths.session(input.parentId));
    await expect(notice).toContainText(appCopy.statuses[input.relation]);
    evidence.push({
      session_id: childId,
      parent_session_id: input.parentId,
      relation: input.relation,
      parent_tool_use_id: node.parent_tool_use_id,
      result_seq: rest.message.seq,
      rest_pages: rest.pages,
      mcp_pages: mcp.pages,
      browser_pages: browserPages,
    });
  }
  return evidence;
}
