import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { copy } from "../src/copy";
import { paths } from "../src/lib/routes";
import { fixture, signInAsOwner, test } from "./browser-test";

const labels = copy.sessions.detail;
const childPrompt =
  "Nested subagent task: list the exports of /repo/src/upload.ts.";
const childAnswer = "Nested subagent answer: the module exports upload(batch).";
const readSchema = z.looseObject({
  messages: z.array(
    z.looseObject({
      seq: z.number(),
      kind: z.string(),
      tool_name: z.string().nullable(),
      tool_use_id: z.string().nullable(),
    }),
  ),
});
const treeSchema = z.looseObject({
  nodes: z.array(
    z.looseObject({
      session_id: z.string(),
      parent_session_id: z.string().nullable(),
      parent_tool_use_id: z.string().nullable(),
    }),
  ),
});
async function spawningCall(page: Page, parentId: string, childId: string) {
  const read = await page.request.get(`/api/v1/sessions/${parentId}`);
  expect(read.ok(), await read.text()).toBe(true);
  const tree = await page.request.get(
    `/api/v1/sessions/${parentId}/tree?limit=100`,
  );
  expect(tree.ok(), await tree.text()).toBe(true);
  const child = treeSchema
    .parse(await tree.json())
    .nodes.find((node) => node.session_id === childId);
  if (!child?.parent_tool_use_id)
    throw new Error("The seeded child lost its spawning tool call.");
  expect(child.parent_session_id).toBe(parentId);
  const call = readSchema
    .parse(await read.json())
    .messages.find(
      (message) =>
        message.kind === "TOOL_USE" &&
        message.tool_use_id === child.parent_tool_use_id,
    );
  if (!call) throw new Error("The parent transcript lost its Agent call.");
  expect(call.tool_name).toBe("Agent");
  return call;
}

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

// @req R-DASH-33 @req R-DASH-30 @req R-DASH-19
test("a subagent run nests under the tool call that spawned it and the fallback section disappears", async ({
  page,
}) => {
  const data = await fixture();
  const call = await spawningCall(
    page,
    data.treeSessionId,
    data.treeChildSessionId,
  );
  await page.goto(paths.session(data.treeSessionId));
  const message = page.getByTestId(`session-message-${String(call.seq)}`);
  await expect(message).toContainText("Agent");
  // The run sits under its call whether or not the call itself is expanded.
  const block = message.getByTestId(
    `session-subagent-${data.treeChildSessionId}`,
  );
  await expect(block).toBeVisible();
  await expect(
    message.getByRole("button", { expanded: false }).first(),
  ).toBeVisible();
  await expect(block).toContainText(labels.subagents.spawned);
  await expect(block).toContainText(copy.app.statuses.SUBAGENT);
  await expect(block).toContainText("Explore");
  await expect(block).toContainText(childPrompt);
  // Collapsed by default: the child's messages load only on demand.
  await expect(block).not.toContainText(childAnswer);
  await block.getByRole("button", { expanded: false }).click();
  await expect(block.getByRole("button", { expanded: true })).toBeVisible();
  await expect(block).toContainText(childAnswer);
  // Inline child messages never take the page-level ids, so deep links stay unambiguous.
  await expect(block.getByTestId(/^session-message-\d+$/)).toHaveCount(0);
  // Every child found its call, so the separate list is gone.
  await expect(
    page.getByRole("region", { name: labels.subagents.title }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId(`session-subagent-${data.treeChildSessionId}`),
  ).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // The block still opens the child's own page, which names its root.
  await block
    .locator(`a[href="${paths.session(data.treeChildSessionId)}"]`)
    .click();
  await expect(page).toHaveURL(
    new RegExp(`${paths.session(data.treeChildSessionId)}$`),
  );
  const notice = page
    .getByRole("status")
    .filter({ hasText: labels.subagentRun });
  await expect(
    notice.getByRole("link", { name: labels.openRoot, exact: true }),
  ).toHaveAttribute("href", paths.session(data.treeSessionId));
  await expect(
    page.getByRole("region", { name: labels.subagents.title }),
  ).toHaveCount(0);
});

// @req R-DASH-33 @req R-DASH-30
test("a child without a recorded spawning call stays in the Subagent runs section", async ({
  page,
}) => {
  const data = await fixture();
  const tree = await page.request.get(
    `/api/v1/sessions/${data.sessionId}/tree?limit=100`,
  );
  expect(tree.ok(), await tree.text()).toBe(true);
  const child = treeSchema
    .parse(await tree.json())
    .nodes.find((node) => node.session_id === data.childSessionId);
  expect(child?.parent_tool_use_id).toBeNull();
  await page.goto(paths.session(data.sessionId));
  const section = page.getByRole("region", { name: labels.subagents.title });
  await expect(section).toContainText(labels.subagents.description);
  await expect(
    section.getByTestId(`session-subagent-${data.childSessionId}`),
  ).toBeVisible();
  await expect(
    page
      .getByTestId(/^session-message-\d+$/)
      .getByTestId(`session-subagent-${data.childSessionId}`),
  ).toHaveCount(0);
});

// @req R-DASH-03 @req R-DASH-33 @req R-DASH-30
test("a child deep link opens the nested run on the root page and selects the child's message", async ({
  page,
}) => {
  const data = await fixture();
  // Nested under its Agent call: the run opens on arrival and the linked message is selected.
  await page.goto(
    paths.session(data.treeSessionId, 1, data.treeChildSessionId),
  );
  const block = page
    .getByTestId(/^session-message-\d+$/)
    .getByTestId(`session-subagent-${data.treeChildSessionId}`);
  await expect(block.getByRole("button", { expanded: true })).toBeVisible();
  const selected = block.getByRole("article").filter({ hasText: childAnswer });
  await expect(selected).toHaveClass(/border-accent/);
  await expect(
    block.getByRole("article").filter({ hasText: childPrompt }),
  ).not.toHaveClass(/border-accent/);
  // The root's own messages stay unselected: the hash belongs to the child run.
  await expect(page.getByTestId("session-message-0")).not.toHaveClass(
    /border-accent/,
  );
  await expect(block.getByTestId(/^session-message-\d+$/)).toHaveCount(0);
  // Unmapped runs open the same way from the Subagent runs section.
  await page.goto(paths.session(data.sessionId, 3, data.childSessionId));
  const listed = page
    .getByRole("region", { name: labels.subagents.title })
    .getByTestId(`session-subagent-${data.childSessionId}`);
  await expect(listed.getByRole("button", { expanded: true })).toBeVisible();
  await expect(
    listed
      .getByRole("article")
      .filter({ hasText: "The module exports one function" }),
  ).toHaveClass(/border-accent/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
