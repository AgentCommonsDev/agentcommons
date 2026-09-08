import assert from "node:assert/strict";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expect, type Page } from "@playwright/test";
import { copy } from "../apps/dashboard/src/copy.js";
import {
  getOutputSchema,
  type ContentCursor,
  type GetOutput,
} from "../packages/core/schemas/get.js";
import { treeOutputSchema } from "../packages/core/schemas/rest.js";
import { searchOutputSchema } from "../packages/core/schemas/search.js";

/** Real producer children must expose their own file read, not a parent summary. */
// @req R-DASH-19 @req R-LNK-01 @req R-LNK-02 @req R-HRN-01 @req R-HRN-02
export async function verifyNativeTree(input: {
  publicUrl: string;
  apiKey: string;
  client: Client;
  page: Page;
  parentId: string;
  relation: "SUBAGENT" | "FORK";
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

  const evidence = [];
  const touch = await input.page.evaluate(() => navigator.maxTouchPoints > 0);
  const action = touch ? "tap" : "click";
  for (const childId of input.childIds) {
    const node = nodes.find((item) => item.session_id === childId);
    assert.ok(node, "The REST tree must include the actual native child.");
    assert.equal(node.parent_session_id, input.parentId);
    assert.equal(node.parent_relation, input.relation);
    assert.equal(node.gap, false);

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

    await input.page.goto(`${input.publicUrl}/s/${input.parentId}`);
    await input.page
      .getByRole("tab", { name: copy.workspace.detail.tree, exact: true })
      [action]();
    const card = input.page.locator(
      `[data-session-id="${childId}"] > .agent-session-card`,
    );
    await expect(card).toBeVisible();
    await card.locator(".agent-session-heading button")[action]();
    await card
      .getByRole("button", {
        name: copy.workspace.detail.treeMessages,
        exact: true,
      })
      [action]();
    let browserPages = 0;
    for (; browserPages < 100; browserPages++) {
      await expect(card.locator(".agent-session-messages")).toBeVisible();
      const message = card.locator(
        `.agent-message-node[data-message-seq="${String(rest.message.seq)}"]`,
      );
      if (await message.count()) {
        await message
          .locator(".agent-message-heading button")
          .first()
          [action]();
        if (
          (
            await message.locator(".agent-message-content").innerText()
          ).includes(input.probe)
        )
          break;
      }
      const next = card.getByRole("button", {
        name: copy.workspace.detail.next,
        exact: true,
      });
      await expect(next).toBeEnabled();
      const response = input.page.waitForResponse(
        (value) =>
          new URL(value.url()).pathname === `/api/v1/sessions/${childId}` &&
          value.request().method() === "GET",
      );
      await next[action]();
      assert.equal((await response).status(), 200);
    }
    assert.ok(browserPages < 100, "Child read was not expanded in the tree.");
    await expect(
      card.locator(
        `.agent-message-node[data-message-seq="${String(rest.message.seq)}"] > .agent-message-content`,
      ),
    ).toContainText(input.probe);
    assert.equal(
      await input.page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
      "Expanded native child content must fit the mobile viewport.",
    );
    evidence.push({
      session_id: childId,
      parent_session_id: input.parentId,
      relation: input.relation,
      result_seq: rest.message.seq,
      rest_pages: rest.pages,
      mcp_pages: mcp.pages,
      browser_pages: browserPages + 1,
    });
  }
  await input.page.screenshot({ path: input.screenshotPath, fullPage: true });
  return evidence;
}
