import { waitForSession } from "./trace-controls";
import { test } from "./browser-test";
import { selectOrganization } from "./organization-controls";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  getOutputSchema,
  ingestEnvelopeSchema,
  ingestOutputSchema,
} from "@agentcommons/core/schemas";
import { copy } from "../src/copy";

const stateSchema = z.object({
  organizationId: z.string(),
  ingestKey: z.string(),
  liveEnvelope: ingestEnvelopeSchema,
  storageState: z.object({
    cookies: z.array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
        path: z.string(),
        httpOnly: z.boolean(),
        secure: z.boolean(),
        sameSite: z.enum(["Strict", "Lax", "None"]),
      }),
    ),
  }),
});

// @req R-DASH-19 @req R-DASH-20 @req R-WEB-02
for (const theme of ["light", "dark"] as const)
  test(`recorded subagent messages and Git references work in ${theme}`, async ({
    page,
    context,
  }, testInfo) => {
    const fixture = stateSchema.parse(
      JSON.parse(
        await readFile(
          process.env.DASHBOARD_BROWSER_STATE ??
            "/tmp/agentcommons-dashboard-browser-state.json",
          "utf8",
        ),
      ),
    );
    await context.addCookies(fixture.storageState.cookies);
    const input = testInfo.project.use.hasTouch ? "tap" : "click";
    const rootNative = randomUUID();
    const parent = {
      ...fixture.liveEnvelope,
      harnessSessionId: rootNative,
      batchId: randomUUID(),
      installationId: randomUUID(),
      records: fixture.liveEnvelope.records.slice(0, 3),
      sourcePos: 2,
      cursor: "navigation-parent",
      context: {
        ...fixture.liveEnvelope.context,
        git: {
          root: "/repo",
          remoteUrl: "git@github.com:rek7/agentcommons.git",
          branch: "fix/tree-navigation",
          head: "abc123",
        },
      },
    };
    const ingest = async (envelope: unknown) => {
      const response = await context.request.post("/api/v1/ingest", {
        headers: {
          Authorization: `Bearer ${fixture.ingestKey}`,
          Origin: "http://localhost:3000",
        },
        data: ingestEnvelopeSchema.parse(envelope),
      });
      expect(response.status(), await response.text()).toBe(202);
      return ingestOutputSchema.parse(await response.json()).sessionId;
    };
    const parentId = await ingest(parent);
    const childRecords = [
      {
        type: "user",
        uuid: randomUUID(),
        message: {
          content: "Inspect the subagent's own upload implementation.",
        },
      },
      {
        type: "assistant",
        uuid: randomUUID(),
        message: {
          content: [
            { type: "text", text: "I will inspect the child session's file." },
            {
              type: "tool_use",
              id: "child-read",
              name: "Read",
              input: { file_path: "/repo/child.ts" },
            },
          ],
        },
      },
      {
        type: "user",
        uuid: randomUUID(),
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "child-read",
              content:
                "Child tool result with recorded content.\n".repeat(200) +
                "END OF CHILD RESULT",
            },
          ],
        },
      },
    ].map((record) => ({
      ...record,
      sessionId: rootNative,
      agentId: "review-child",
      agentType: "Explore",
      isSidechain: true,
      timestamp: new Date().toISOString(),
    }));
    const childId = await ingest({
      ...parent,
      harnessSessionId: `${rootNative}:agent-review-child`,
      batchId: randomUUID(),
      cursor: "navigation-child",
      records: childRecords.map((record, pos) => ({
        pos,
        key: record.uuid,
        sourceVersion: 0,
        line: JSON.stringify(record),
      })),
    });
    const childUrl = `/api/v1/sessions/${childId}`;
    const headers = { Authorization: `Bearer ${fixture.ingestKey}` };
    await waitForSession(context.request, parentId, fixture.ingestKey);
    await waitForSession(context.request, childId, fixture.ingestKey);
    const childResponse = await context.request.get(childUrl, { headers });
    const child = getOutputSchema.parse(await childResponse.json());
    expect(child.header).toMatchObject({
      parent_session_id: parentId,
      parent_relation: "SUBAGENT",
    });
    const result = child.messages.find(
      (message) => message.kind === "TOOL_RESULT",
    );
    expect(result?.content).toContain("Child tool result");

    await page.goto("/home");
    await selectOrganization(page, fixture.organizationId);
    await page.goto(`/s/${parentId}`);
    const toggle = page.getByRole("button", {
      name: theme === "light" ? copy.theme.light : copy.theme.dark,
      exact: true,
    });
    if (await toggle.count()) await toggle[input]();
    const git = page.getByRole("definition").filter({ hasText: "abc123" });
    await expect(
      page
        .locator(".session-git")
        .getByRole("link", { name: "fix/tree-navigation", exact: true }),
    ).toHaveAttribute(
      "href",
      "https://github.com/rek7/agentcommons/tree/fix%2Ftree-navigation",
    );
    await expect(
      page
        .locator(".session-git")
        .getByRole("link", { name: "abc123", exact: true })
        .first(),
    ).toHaveAttribute(
      "href",
      "https://github.com/rek7/agentcommons/commit/abc123",
    );
    expect(await git.count()).toBeGreaterThan(0);
    await page
      .getByRole("tab", { name: copy.workspace.detail.tree, exact: true })
      [input]();
    const card = page.locator(
      `[data-session-id="${childId}"] > .agent-session-card`,
    );
    await expect(card).toContainText(copy.workspace.statuses.SUBAGENT);
    await card.locator(".agent-session-heading button")[input]();
    await card
      .getByRole("button", {
        name: copy.workspace.detail.treeMessages,
        exact: true,
      })
      [input]();
    const user = card
      .locator(".agent-message-node")
      .filter({ hasText: "Inspect the subagent's own upload implementation." })
      .first();
    await user.locator(".agent-message-heading button").first()[input]();
    await expect(user.locator(".agent-message-content")).toContainText(
      "Inspect the subagent's own upload implementation.",
    );
    const toolResult = card.locator(
      `.agent-message-node[data-message-seq="${String(result?.seq)}"]`,
    );
    await expect(toolResult.locator("xpath=../..")).toHaveClass(
      /agent-message-node/,
    );
    await toolResult.locator(".agent-message-heading button").first()[input]();
    await expect(toolResult.locator(".agent-message-content")).toContainText(
      "Child tool result with recorded content.",
    );
    const next = card.getByRole("button", {
      name: copy.workspace.detail.next,
      exact: true,
    });
    let pages = 0;
    while ((await next.count()) && (await next.isEnabled())) {
      await next[input]();
      await expect(card.locator(".agent-session-messages")).toBeVisible();
      pages++;
      if (pages > 5) throw new Error("Unexpected unbounded message pagination");
    }
    expect(pages).toBeGreaterThan(0);
    const last = card.locator(
      `.agent-message-node[data-message-seq="${String(result?.seq)}"]`,
    );
    const button = last.locator(".agent-message-heading button").first();
    if ((await button.getAttribute("aria-expanded")) === "false")
      await button[input]();
    await expect(last.locator(".agent-message-content")).toContainText(
      "END OF CHILD RESULT",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter(
        (item) => item.impact === "serious" || item.impact === "critical",
      ),
    ).toEqual([]);
    await card.locator(".agent-session-title")[input]();
    await expect(page).toHaveURL(new RegExp(`/s/${childId}$`));
    await expect(page.locator(".session-affiliation")).toContainText(
      copy.workspace.statuses.SUBAGENT,
    );
    await expect(page.locator(".session-affiliation a")).toHaveAttribute(
      "href",
      `/s/${parentId}`,
    );
  });
