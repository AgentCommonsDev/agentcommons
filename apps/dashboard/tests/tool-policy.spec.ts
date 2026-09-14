import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";
import { ingestEnvelopeSchema } from "@agentcommons/core/schemas";
import { copy } from "../src/copy";
import { paths } from "../src/lib/routes";
import { workspaceOrigin } from "../playwright.shared";
import {
  accessible,
  applyFilters,
  expectNoHorizontalOverflow,
  fixture,
  signInAsMember,
  signInAsOwner,
  tableRow,
  test,
} from "./browser-test";
import { waitForSession } from "./trace-controls";

const text = copy.admin.toolPolicy;
const admin = { origin: workspaceOrigin };
const accepted = z.object({ sessionId: z.uuid() });
// Keep every rule field so a restore writes back exactly what it read.
const policySchema = z.object({
  enabled: z.boolean(),
  rules: z.array(z.object({ id: z.string() }).catchall(z.unknown())),
});
const violationList = z.object({
  items: z.array(
    z.object({
      session_id: z.string(),
      decision: z.string(),
      source: z.string(),
      masked_command: z.string().nullable(),
    }),
  ),
});

/** The organization's policy as the admin API returns it, for snapshot and restore. */
async function readPolicy(page: Page) {
  const response = await page.request.get("/api/v1/admin/tool-policy");
  expect(response.status(), await response.text()).toBe(200);
  return policySchema.parse(await response.json());
}
async function writePolicy(
  page: Page,
  body: z.infer<typeof policySchema>,
): Promise<void> {
  const response = await page.request.put("/api/v1/admin/tool-policy", {
    headers: admin,
    data: body,
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** Ingest one session whose only tool call is a Bash command; returns its id once readable. */
async function captureToolCall(
  request: APIRequestContext,
  state: Awaited<ReturnType<typeof fixture>>,
  command: string,
): Promise<string> {
  const now = new Date().toISOString();
  const line = (payload: unknown) => JSON.stringify(payload);
  const envelope = ingestEnvelopeSchema.parse({
    ...state.liveEnvelope,
    harnessSessionId: randomUUID(),
    batchId: randomUUID(),
    sentAt: now,
    sourcePos: 1,
    records: [
      {
        pos: 0,
        sourceVersion: 0,
        key: randomUUID(),
        line: line({
          type: "user",
          uuid: randomUUID(),
          timestamp: now,
          message: { content: [{ type: "text", text: "run it" }] },
        }),
      },
      {
        pos: 1,
        sourceVersion: 0,
        key: randomUUID(),
        line: line({
          type: "assistant",
          uuid: randomUUID(),
          timestamp: now,
          message: {
            content: [
              {
                type: "tool_use",
                id: `call-${randomUUID()}`,
                name: "Bash",
                input: { command },
              },
            ],
          },
        }),
      },
    ],
    cursor: "1:0",
  });
  const response = await request.post("/api/v1/ingest", {
    headers: { authorization: `Bearer ${state.ingestKey}` },
    data: envelope,
  });
  expect(response.status(), await response.text()).toBe(202);
  const sessionId = accepted.parse(await response.json()).sessionId;
  await waitForSession(request, sessionId, state.ingestKey);
  return sessionId;
}

// @req R-POL-13 @req R-POL-14
test("Tool policy: an owner toggles enforcement, adds and removes a rule, restores a preset rule, and an unsafe command regex is rejected inline", async ({
  page,
  context,
}, info) => {
  await signInAsOwner(context);
  const original = await readPolicy(page);
  const stamp = `${info.project.name}${String(Date.now())}`.replace(
    /[^a-z0-9]/gi,
    "",
  );
  const ruleId = `canary-${stamp}`.toLowerCase().slice(0, 64);
  try {
    await page.goto(paths.admin.toolPolicy);
    await expect(
      page.getByRole("heading", { name: text.title, exact: true }),
    ).toBeVisible();
    // Enforcement is off by default: a fresh organization blocks nothing.
    const toggle = page.getByTestId("admin-tool-policy-enabled");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByText(text.enabledHint, { exact: true }),
    ).toBeVisible();

    // Turning enforcement on replaces the whole document; it survives a reload.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.reload();
    const reloaded = page.getByTestId("admin-tool-policy-enabled");
    await expect(reloaded).toHaveAttribute("aria-checked", "true");
    await reloaded.click();
    await expect(reloaded).toHaveAttribute("aria-checked", "false");

    // Add a rule; it appears in the list and persists across a reload.
    await page.getByTestId("admin-tool-policy-add").click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel(text.ruleId, { exact: true }).fill(ruleId);
    await dialog.getByLabel(text.tool, { exact: true }).fill("Bash");
    await dialog
      .getByRole("button", { name: copy.app.common.save, exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const rules = page.getByTestId("admin-tool-policy-rules");
    await expect(tableRow(rules, ruleId)).toBeVisible();
    await page.reload();
    await expect(
      tableRow(page.getByTestId("admin-tool-policy-rules"), ruleId),
    ).toBeVisible();

    // An unsafe command regex is rejected by the server and shown inline in the dialog.
    const target = tableRow(
      page.getByTestId("admin-tool-policy-rules"),
      ruleId,
    );
    await target
      .getByRole("button", { name: copy.app.common.actions, exact: true })
      .click();
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: copy.app.common.edit, exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: text.addPattern, exact: true })
      .click();
    await dialog
      .getByRole("combobox", { name: text.patternKind, exact: true })
      .selectOption("regex");
    await dialog
      .getByRole("textbox", { name: text.patternValue, exact: true })
      .fill("(a+)+$");
    await dialog
      .getByRole("button", { name: copy.app.common.save, exact: true })
      .click();
    // The dialog stays open and shows the server's 400 without losing the draft.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: text.patternValue, exact: true }),
    ).toHaveValue("(a+)+$");
    await dialog
      .getByRole("button", { name: copy.app.common.cancel, exact: true })
      .click();
    await expect(dialog).toHaveCount(0);

    // Remove the canary rule.
    const row = tableRow(page.getByTestId("admin-tool-policy-rules"), ruleId);
    await row
      .getByRole("button", { name: copy.app.common.actions, exact: true })
      .click();
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: text.remove, exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: text.remove, exact: true })
      .click();
    await expect(
      tableRow(page.getByTestId("admin-tool-policy-rules"), ruleId),
    ).toHaveCount(0);

    // Restore a preset rule: remove one, then add it back from the Restore menu.
    const preset = original.rules[0]?.id;
    expect(preset, "the seeded policy ships preset rules").toBeTruthy();
    const presetRow = tableRow(
      page.getByTestId("admin-tool-policy-rules"),
      preset ?? "",
    );
    await presetRow
      .getByRole("button", { name: copy.app.common.actions, exact: true })
      .click();
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: text.remove, exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: text.remove, exact: true })
      .click();
    await expect(
      tableRow(page.getByTestId("admin-tool-policy-rules"), preset ?? ""),
    ).toHaveCount(0);
    await page.getByRole("button", { name: text.restore, exact: true }).click();
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: preset ?? "", exact: true })
      .click();
    await expect(
      tableRow(page.getByTestId("admin-tool-policy-rules"), preset ?? ""),
    ).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await accessible(page);
  } finally {
    // Leave the policy exactly as found, whatever the UI steps left behind.
    await writePolicy(page, original);
  }
});

// @req R-POL-15
test("Tool policy violations: a projected violation lists with its masked preview, and a decision filter narrows the ledger and is carried in the URL", async ({
  page,
  request,
  context,
}, info) => {
  test.setTimeout(240_000);
  await signInAsOwner(context);
  const state = await fixture();
  const stamp = `${info.project.name}${String(Date.now())}`.replace(
    /[^a-z0-9]/gi,
    "",
  );
  // The shipped preset flags rm -rf of a root path (deny); detection runs even while
  // enforcement is off, so a captured session yields a projection violation.
  const sessionId = await captureToolCall(
    request,
    state,
    `rm -rf /home/canary_${stamp}/data`,
  );
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          "/api/v1/admin/tool-policy/violations?format=json&limit=50",
        );
        if (response.status() !== 200) return [] as string[];
        return violationList
          .parse(await response.json())
          .items.filter((row) => row.session_id === sessionId)
          .map((row) => row.decision);
      },
      { timeout: 180_000 },
    )
    .toContain("deny");

  await page.goto(paths.admin.toolPolicy);
  const ledger = page.getByTestId("admin-tool-policy-violations");
  await expect(
    page.getByRole("heading", { name: text.ledgerTitle, exact: true }),
  ).toBeVisible();
  // The raw command is never stored, only a masked preview and a fingerprint.
  await expect(page.getByText(/never stored/i).first()).toBeVisible();
  await expect(ledger).toContainText(text.preview);
  const violationRow = tableRow(ledger, sessionId);
  await expect(violationRow).toBeVisible();
  await expect(violationRow).toContainText(text.actions.deny);
  await expect(violationRow).toContainText(text.sources.projection);

  // The decision filter narrows the ledger and the URL carries it.
  await applyFilters(page, text.filterLabel, async (scope) => {
    await scope
      .getByRole("combobox", { name: text.decision, exact: true })
      .selectOption({ label: text.actions.deny });
  });
  await expect(page).toHaveURL(/decision=deny/);
  await expect(tableRow(ledger, sessionId)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

// @req R-POL-13
test("Tool policy: a member sees the access message and the page makes no admin request", async ({
  page,
  context,
}) => {
  await signInAsMember(context);
  const forbidden: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/v1/admin/"))
      forbidden.push(request.url());
  });
  await page.goto(paths.admin.toolPolicy);
  await expect(
    page.getByText(copy.app.navigation.adminRequired, { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("admin-tool-policy-settings")).toHaveCount(0);
  expect(forbidden).toEqual([]);
});
