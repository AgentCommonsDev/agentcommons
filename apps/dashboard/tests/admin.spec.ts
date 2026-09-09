import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import {
  hookManifestSchema,
  ingestEnvelopeSchema,
  rawOutputSchema,
} from "@agentcommons/core/schemas";
import {
  builtinDashboardId,
  builtinDashboardIds,
  dashboardSchema,
} from "@agentcommons/core/schemas/dashboards";
import { standardDashboardVariables } from "@agentcommons/core/dashboards";
import { copy } from "../src/copy";
import { paths } from "../src/lib/routes";
import { workspaceOrigin } from "../playwright.shared";
import {
  accessible,
  applyFilters,
  closeDialog,
  collectErrors,
  confirm,
  fixture,
  rowAction,
  signInAsMember,
  signInAsOwner,
  tableRow,
  test,
} from "./browser-test";
import { parseCsv } from "./csv";
import { waitForSession } from "./trace-controls";

const fields = copy.app.fields;
const exportCsv = async (page: Page, scope = page.locator("body")) => {
  const downloaded = page.waitForEvent("download");
  await scope
    .getByRole("button", { name: copy.app.common.export, exact: true })
    .click();
  return parseCsv(await readFile(await (await downloaded).path(), "utf8"));
};
/** The column chooser adds a column; stacked phone rows label cells instead of headers. */
async function showColumn(page: Page, label: string) {
  await page
    .getByRole("button", { name: copy.app.common.columns, exact: true })
    .first()
    .click();
  const item = page
    .getByRole("menu")
    .getByRole("menuitemcheckbox", { name: label, exact: true });
  await expect(item).toHaveAttribute("aria-checked", "false");
  await item.click();
  await expect(item).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(`td[data-label="${label}"]`).first()).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

// @req R-ORG-02 @req R-DASH-05 @req R-DASH-21 @req R-WEB-02
test("People: an admin adds an email, copies its setup link, changes the role, suspends, restores and removes the member", async ({
  page,
  context,
}, info) => {
  const email = `browser-${info.project.name}-${String(Date.now())}@example.com`;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(paths.admin.users);
  const table = page.getByTestId("admin-users-table");
  await expect(tableRow(table, /browser-primary@example.com/)).toBeVisible();
  await page.getByTestId("admin-add-people").click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel(copy.admin.users.emails, { exact: true }).fill(email);
  await accessible(page);
  await dialog
    .getByRole("button", { name: copy.admin.users.addSubmit, exact: true })
    .click();
  // The copy button inside the list carries its own live region.
  const results = dialog
    .getByRole("status")
    .filter({ hasText: copy.admin.users.results });
  await expect(results).toContainText(email);
  await expect(results).toContainText(copy.admin.users.added);
  await results
    .getByRole("button", { name: copy.admin.users.setupLink, exact: true })
    .click();
  const setupUrl = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(setupUrl).origin).toBe(workspaceOrigin);
  // Better Auth's reset link redirects to the setup page with the token.
  expect(new URL(setupUrl).pathname).toMatch(/^\/auth\/reset-password\/./);
  await dialog
    .getByRole("button", { name: copy.app.common.done, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const row = tableRow(table, email);
  await expect(row).toBeVisible();
  const role = row.getByRole("combobox", {
    name: copy.admin.users.roleSelect(email),
    exact: true,
  });
  await expect(role).toHaveValue("member");
  await role.selectOption("admin");
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(copy.admin.users.roleTitle);
  await confirm(
    page,
    copy.app.common.save,
    "Grant browser verification administration",
  );
  await expect(role).toHaveValue("admin");
  await (await rowAction(row, copy.admin.users.setup)).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(copy.admin.users.setup);
  await expect(dialog.locator("pre")).toContainText(
    `${workspaceOrigin}/auth/reset-password/`,
  );
  await closeDialog(page);
  await (await rowAction(row, copy.admin.users.suspend)).click();
  await accessible(page);
  await confirm(
    page,
    copy.admin.users.suspend,
    "Suspend browser verification access",
  );
  await expect(row).toContainText(copy.admin.users.suspended);
  await (await rowAction(row, copy.admin.users.restore)).click();
  await confirm(
    page,
    copy.admin.users.restore,
    "Restore browser verification access",
  );
  await expect(row).toContainText(copy.admin.users.active);
  // Any row opens its complete record, including columns hidden from the summary.
  await row.locator("td").first().click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(copy.app.common.details);
  await expect(dialog.getByText(fields.user_id, { exact: true })).toBeVisible();
  await expect(dialog).toContainText(email);
  await closeDialog(page);
  await applyFilters(page, copy.app.common.filters, async (scope) => {
    await scope
      .getByRole("textbox", { name: copy.admin.users.filterEmail, exact: true })
      .fill(email);
  });
  await expect(table.locator("tbody tr")).toHaveCount(1);
  const csv = await exportCsv(page);
  expect(csv.rows).toHaveLength(1);
  expect(csv.fields).toEqual([
    fields.email,
    fields.name,
    fields.role,
    copy.admin.users.filterStatus,
    copy.admin.users.addedAt,
    fields.user_id,
  ]);
  await (await rowAction(row, copy.admin.users.remove)).click();
  await confirm(
    page,
    copy.app.common.remove,
    "Remove browser verification membership",
  );
  await expect(row).toHaveCount(0);
  await expect(
    page.getByText(copy.admin.users.empty, { exact: true }),
  ).toBeVisible();
});

// @req R-DASH-05 @req R-ORG-04 @req R-DASH-21
test("All keys: filters narrow the list and revoking a key requires a reason and lands in the audit log", async ({
  page,
}, info) => {
  const name = `Browser revoke ${info.project.name} ${String(Date.now())}`;
  const created = await page.request.post("/api/v1/me/keys", {
    headers: { origin: workspaceOrigin },
    data: { name, permissions: { sessions: ["read"] } },
  });
  expect(created.status(), await created.text()).toBe(200);
  await page.goto(paths.admin.keys);
  const table = page.getByTestId("admin-keys-table");
  const row = tableRow(table, name);
  await expect(row).toBeVisible();
  // All keys uses the member Keys page's words for the same key.
  await expect(row).toContainText(copy.keys.permissions.read);
  await expect(row).toContainText(copy.keys.list.active);
  await applyFilters(page, copy.app.common.filters, async (scope) => {
    await scope
      .getByRole("combobox", { name: copy.admin.keys.state, exact: true })
      .selectOption("revoked");
  });
  await expect(row).toHaveCount(0);
  await applyFilters(page, copy.app.common.filters, async (scope) => {
    await scope
      .getByRole("combobox", { name: copy.admin.keys.state, exact: true })
      .selectOption("enabled");
  });
  await expect(row).toBeVisible();
  await showColumn(page, fields.prefix);
  await expect(row.locator(`td[data-label="${fields.prefix}"]`)).toContainText(
    /^ac_/,
  );
  await (await rowAction(row, copy.admin.keys.revoke)).click();
  await expect(page.getByRole("dialog")).toContainText(
    copy.admin.keys.revokeTitle,
  );
  await accessible(page);
  await confirm(
    page,
    copy.admin.keys.revoke,
    "Browser verification key retired",
  );
  await expect(row).toHaveCount(0);
  await applyFilters(page, copy.app.common.filters, async (scope) => {
    await scope
      .getByRole("combobox", { name: copy.admin.keys.state, exact: true })
      .selectOption("revoked");
  });
  await expect(row).toContainText(copy.keys.list.revoked);
  await expect(await rowAction(row, copy.admin.keys.revoke)).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await page.goto(paths.admin.audit);
  await page.getByRole("button", { name: copy.admin.audit.filters }).click();
  await page
    .getByRole("textbox", { name: fields.action, exact: true })
    .fill("keys.revoke");
  await page
    .getByRole("button", { name: copy.app.common.apply, exact: true })
    .click();
  await expect(
    tableRow(page.getByTestId("admin-audit-table"), "keys.revoke").first(),
  ).toBeVisible();
});

// @req R-DASH-05 @req R-DASH-21 @req R-WEB-02
test("Audit: filters apply, a row opens the JSON record and the CSV export carries every column", async ({
  page,
}) => {
  await page.goto(paths.admin.audit);
  const table = page.getByTestId("admin-audit-table");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  const filters = page.getByRole("button", { name: copy.admin.audit.filters });
  await expect(filters).toHaveAttribute("aria-expanded", "false");
  await filters.click();
  await page
    .getByRole("textbox", { name: fields.action, exact: true })
    .fill("ingest");
  await page
    .getByRole("button", { name: copy.app.common.apply, exact: true })
    .click();
  await expect(filters).toContainText(copy.admin.audit.activeFilters(1));
  await expect(table.locator("tbody tr").first()).toBeVisible();
  const actions = await table
    .locator(`td[data-label="${fields.action}"]`)
    .allInnerTexts();
  expect(actions.length).toBeGreaterThan(0);
  expect(actions.every((action) => action.trim() === "ingest")).toBe(true);
  await showColumn(page, fields.ip);
  await table.locator("tbody tr").first().locator("td").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(copy.admin.audit.record);
  await expect(dialog).toContainText("ingest");
  await expect(
    dialog.getByText(copy.admin.audit.detail, { exact: true }),
  ).toBeVisible();
  const detail = dialog.locator("pre");
  if ((await detail.count()) > 0) {
    const detailText = await detail.first().innerText();
    expect(z.json().safeParse(JSON.parse(detailText) as unknown).success).toBe(
      true,
    );
    await expect(
      dialog.getByRole("button", {
        name: copy.admin.audit.copyJson,
        exact: true,
      }),
    ).toBeVisible();
  } else await expect(dialog).toContainText(copy.admin.audit.noDetail);
  await accessible(page);
  await closeDialog(page);
  const csv = await exportCsv(page);
  expect(csv.fields).toEqual([
    fields.ts,
    fields.action,
    copy.admin.audit.user,
    fields.status_code,
    fields.duration_ms,
    fields.transport,
    fields.api_key_id,
    fields.installation_id,
    fields.auth_method,
    fields.ip,
    fields.user_agent,
    fields.request_id,
    fields.resource_type,
    fields.resource_ids,
    copy.admin.audit.detail,
  ]);
  expect(csv.rows.length).toBeGreaterThan(0);
  expect(csv.rows.every((rowData) => rowData[fields.action] === "ingest")).toBe(
    true,
  );
  await page
    .getByRole("button", { name: copy.app.common.clear, exact: true })
    .click();
  await expect(filters).not.toContainText(copy.admin.audit.activeFilters(1));
});

// @req R-DASH-05 @req R-DASH-01 @req R-WEB-02
test("Moderation: make private, make visible and purge each confirm with a reason on a real session", async ({
  page,
  request,
}, info) => {
  const state = await signInAsOwner(page.context());
  const textLine = `Browser moderation ${info.project.name} ${String(Date.now())}`;
  const envelope = ingestEnvelopeSchema.parse({
    ...state.liveEnvelope,
    harnessSessionId: randomUUID(),
    batchId: randomUUID(),
    sentAt: new Date().toISOString(),
    sourcePos: 0,
    records: [
      {
        pos: 0,
        sourceVersion: 0,
        key: randomUUID(),
        line: JSON.stringify({
          type: "user",
          uuid: randomUUID(),
          timestamp: new Date().toISOString(),
          message: { content: [{ type: "text", text: textLine }] },
        }),
      },
    ],
    cursor: "1:0",
  });
  const accepted = await request.post("/api/v1/ingest", {
    headers: { authorization: `Bearer ${state.ingestKey}` },
    data: envelope,
  });
  expect(accepted.status()).toBe(202);
  const sessionId = z
    .object({ sessionId: z.uuid() })
    .parse(await accepted.json()).sessionId;
  await waitForSession(request, sessionId, state.ingestKey);
  await page.goto(paths.admin.moderation);
  const table = page.getByTestId("admin-moderation-table");
  await applyFilters(page, copy.app.common.filters, async (scope) => {
    await scope
      .getByRole("textbox", { name: copy.admin.moderation.user, exact: true })
      .fill(state.ownerEmail);
  });
  const row = tableRow(table, textLine);
  await expect(row).toBeVisible();
  await expect(row).toContainText(copy.app.statuses.PUBLIC);
  await expect(
    await rowAction(row, copy.admin.moderation.visible),
  ).toHaveAttribute("aria-disabled", "true");
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: copy.admin.moderation.private, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    copy.admin.moderation.privateTitle,
  );
  await accessible(page);
  await confirm(
    page,
    copy.admin.moderation.private,
    "Hide browser verification content",
  );
  await expect(row).toContainText(copy.app.statuses.PRIVATE);
  await expect(
    await rowAction(row, copy.admin.moderation.private),
  ).toHaveAttribute("aria-disabled", "true");
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: copy.admin.moderation.visible, exact: true })
    .click();
  await confirm(
    page,
    copy.admin.moderation.visible,
    "Restore browser verification content",
  );
  await expect(row).toContainText(copy.app.statuses.PUBLIC);
  await showColumn(page, fields.session_id);
  await (await rowAction(row, copy.admin.moderation.purge)).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(copy.admin.moderation.purgeTitle);
  await expect(dialog.getByRole("alert")).toHaveText(
    copy.admin.moderation.purgeWarning,
  );
  await accessible(page);
  await confirm(
    page,
    copy.admin.moderation.purge,
    "Purge disposable browser verification content",
  );
  await expect(row).toHaveCount(0);
  // Purge keeps the identity skeleton (spec §9.5): the row stays, its content is gone.
  const tombstone = tableRow(table, sessionId);
  await expect(tombstone).toContainText(copy.admin.moderation.untitled);
  await expect(tombstone).not.toContainText(textLine);
  const raw = await request.get(`/api/v1/sessions/${sessionId}/raw`, {
    headers: { authorization: `Bearer ${state.ingestKey}` },
  });
  expect(raw.status()).toBe(200);
  expect(rawOutputSchema.parse(await raw.json())).toEqual({
    items: [],
    cursor: null,
  });
});

// @req R-DASH-05 @req R-DASH-01 @req R-WEB-02
test("Redaction: a regex policy previews live, scans text on the server, toggles, rescans with progress and is deleted", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const text = copy.admin.redaction;
  const name = `browser-rule-${info.project.name}-${String(Date.now())}`;
  const secret = "BROWSER_REDACT_12345";
  const presetOn = z
    .object({
      items: z.array(
        z.object({ rule_id: z.string().nullable(), enabled: z.boolean() }),
      ),
    })
    .parse(
      await (
        await page.request.get(
          "/api/v1/admin/redaction/policies?filters[kind]=SECRETLINT_RULE&filters[enabled]=true&limit=100&format=json",
        )
      ).json(),
    )
    .items.some(
      (item) => item.rule_id === "@secretlint/secretlint-rule-preset-recommend",
    );
  await page.goto(paths.admin.redaction);
  const table = page.getByTestId("admin-redaction-table");
  const builtin = tableRow(table, text.builtin).first();
  await expect(builtin).toBeVisible();
  await expect(await rowAction(builtin, text.delete)).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await page.getByTestId("admin-redaction-add").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(text.name, { exact: true }).fill(name);
  await dialog
    .getByLabel(text.pattern, { exact: true })
    .fill("BROWSER_REDACT_[0-9]+");
  await dialog
    .getByLabel(text.preview, { exact: true })
    .fill(`Keep the context. ${secret}`);
  const previewStatus = dialog.locator("p[role='status']");
  await expect(previewStatus).toHaveText(text.previewMatches(1));
  await expect(dialog.locator("pre")).toHaveText(
    `Keep the context. [REDACTED:${name}]`,
  );
  await dialog.getByLabel(text.flags, { exact: true }).fill("x");
  await expect(previewStatus).toHaveText(text.previewInvalid);
  await dialog.getByLabel(text.flags, { exact: true }).fill("g");
  await dialog
    .getByRole("button", { name: text.advanced, exact: true })
    .click();
  const rule = dialog.getByRole("combobox", { name: text.rule, exact: true });
  await expect(rule).toBeVisible();
  const options = await rule.locator("option").allInnerTexts();
  expect(options.length).toBeGreaterThan(1);
  expect(options.some((option) => option.includes(text.includedByPreset))).toBe(
    presetOn,
  );
  await expect(dialog.locator(`a[title="${text.ruleDocs}"]`)).toBeVisible();
  await dialog
    .getByRole("button", { name: text.regexInstead, exact: true })
    .click();
  await expect(dialog.getByLabel(text.pattern, { exact: true })).toHaveValue(
    "BROWSER_REDACT_[0-9]+",
  );
  await accessible(page);
  await dialog
    .getByRole("button", { name: copy.app.common.save, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const row = tableRow(table, name);
  await expect(row).toBeVisible();
  await expect(row).toContainText(text.custom);
  await page
    .getByLabel(text.testText, { exact: true })
    .fill(`Keep the context. ${secret}`);
  await page.getByRole("button", { name: text.run, exact: true }).click();
  const result = page.locator("pre").filter({ hasText: "Keep the context." });
  await expect(result).toBeVisible();
  await expect(result).not.toContainText(secret);
  await expect(
    page.getByText(text.matches, { exact: true }).locator(".."),
  ).toContainText(name);
  const toggle = row.getByRole("switch", {
    name: text.toggle(name),
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(page.getByRole("dialog")).toContainText(text.disableTitle);
  await confirm(page, text.disable, null);
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await confirm(page, text.enable, null);
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: text.rescan, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(text.rescanTitle);
  await confirm(page, text.rescan, "Verify durable browser rescan progress");
  await expect(page).toHaveURL(/[?&]job=/);
  const progress = page.getByRole("status").filter({ hasText: text.progress });
  await expect(progress).toBeVisible();
  await expect(progress).toContainText(text.processed);
  await expect(progress).toContainText(copy.app.statuses.completed, {
    timeout: 120_000,
  });
  await expect(progress.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    /\d+/,
  );
  await progress
    .getByRole("button", { name: text.dismiss, exact: true })
    .click();
  await expect(page).not.toHaveURL(/[?&]job=/);
  await expect(progress).toHaveCount(0);
  await (await rowAction(row, text.delete)).click();
  await confirm(
    page,
    copy.app.common.delete,
    "Remove the browser verification rule",
  );
  await expect(row).toHaveCount(0);
});

// @req R-DASH-13 @req R-DASH-14 @req R-DASH-05 @req R-EMB-01 @req R-WEB-02
test("Status: the health chart follows the metric and date filters, snapshots show live totals and installations toggle MCP tools with a reason", async ({
  page,
}) => {
  const text = copy.admin.status;
  const words = copy.admin.installations;
  await page.goto(paths.admin.status);
  const health = page.getByTestId("admin-status-health");
  await health
    .getByRole("combobox", { name: text.metric, exact: true })
    .selectOption("sessions");
  await expect(
    health.getByRole("img", { name: text.metrics.sessions, exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(health.locator("canvas")).toBeVisible();
  await health
    .getByRole("button", { name: text.showTable, exact: true })
    .click();
  const observations = health.getByRole("table", {
    name: text.observations,
    exact: true,
  });
  await expect(observations.locator("tbody tr").first()).toBeVisible();
  const csv = await exportCsv(page, health);
  expect(csv.fields).toEqual(Object.values(text.dimensions));
  expect(csv.rows.length).toBeGreaterThan(0);
  const metrics = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/admin/metrics/health") &&
      response.url().includes(encodeURIComponent("2020-01-01T00:00:00.000Z")),
  );
  await applyFilters(page, text.range, async (scope) => {
    await scope.getByLabel(text.from, { exact: true }).fill("2020-01-01");
    await scope.getByLabel(text.to, { exact: true }).fill("2020-02-01");
  });
  expect((await metrics).ok()).toBe(true);
  await expect(
    health.getByText(text.chartEmpty, { exact: true }),
  ).toBeVisible();
  // Phones summarize the applied range next to the filter button; wide screens keep the inputs.
  if ((page.viewportSize()?.width ?? 1440) < 640)
    await expect(
      page.getByText(text.rangeSummary("2020-01-01", "2020-02-01"), {
        exact: true,
      }),
    ).toBeVisible();
  else
    await expect(page.getByLabel(text.from, { exact: true })).toHaveValue(
      "2020-01-01",
    );
  const snapshot = page.getByTestId("admin-status-snapshot");
  for (const label of [
    text.queue,
    text.failed,
    text.backlog,
    text.tokens,
    text.cost,
  ])
    await expect(snapshot.getByText(label, { exact: true })).toBeVisible();
  const table = page.getByTestId("admin-installations-table");
  const row = tableRow(table, "browser-workstation").first();
  await expect(row).toContainText(words.toolsEnabled);
  await (await rowAction(row, words.disable)).click();
  await expect(page.getByRole("dialog")).toContainText(
    words.disableDescription("browser-workstation"),
  );
  await accessible(page);
  await confirm(page, words.disable, "Compare agents without tools");
  await expect(row).toContainText(words.toolsDisabled);
  // The date range bar above carries its own label, so "Filters" is the installations bar.
  await applyFilters(page, copy.app.common.filters, async (scope) => {
    await scope
      .getByRole("combobox", { name: words.tools, exact: true })
      .selectOption("off");
  });
  await expect(row).toBeVisible();
  await (await rowAction(row, words.enable)).click();
  await confirm(page, words.enable, "Enable tools again after the comparison");
  // Re-enabled, the machine leaves the "disabled" filter; clearing it shows it again.
  await expect(row).toHaveCount(0);
  await applyFilters(page, copy.app.common.filters, async (scope) => {
    await scope
      .getByRole("combobox", { name: words.tools, exact: true })
      .selectOption("");
  });
  await expect(row).toContainText(words.toolsEnabled);
});

// @req R-DASH-31
test("Status: installations are marked current or update pending against the hook the instance serves", async ({
  page,
  request,
  isMobile,
}, info) => {
  const words = copy.admin.installations;
  const state = await fixture();
  const served = await request.get("/hook/manifest.json");
  expect(served.ok(), await served.text()).toBe(true);
  const manifest = hookManifestSchema.parse(await served.json());
  // An upload reporting the served digests: this machine already runs the current hook.
  const hostname = `hook-current-${info.project.name}`;
  const accepted = await request.post("/api/v1/ingest", {
    headers: { authorization: `Bearer ${state.ingestKey}` },
    data: ingestEnvelopeSchema.parse({
      ...state.liveEnvelope,
      hook: {
        sha256: manifest.sha256,
        extensionSha256: manifest.extensionSha256,
      },
      harnessSessionId: randomUUID(),
      installationId: randomUUID(),
      batchId: randomUUID(),
      sentAt: new Date().toISOString(),
      context: {
        ...state.liveEnvelope.context,
        installation: { ...state.liveEnvelope.context.installation, hostname },
      },
    }),
  });
  expect(accepted.status(), await accepted.text()).toBe(202);
  await waitForSession(
    request,
    z.object({ sessionId: z.uuid() }).parse(await accepted.json()).sessionId,
    state.ingestKey,
  );
  await page.goto(paths.admin.status);
  const table = page.getByTestId("admin-installations-table");
  const current = tableRow(table, hostname);
  await expect(current).toContainText(words.hookCurrent);
  await expect(current).toContainText(manifest.sha256.slice(0, 8));
  await expect(current).not.toContainText(words.hookPending);
  // The seeded workstation reports whatever digest the fixture uploaded; the badge follows the manifest.
  const seeded = state.liveEnvelope.hook.sha256;
  const pending = seeded !== manifest.sha256;
  const workstation = tableRow(table, "browser-workstation").first();
  await expect(workstation).toContainText(
    pending ? words.hookPending : words.hookCurrent,
  );
  await expect(workstation).toContainText(seeded.slice(0, 8));
  if (pending && !isMobile) {
    await workstation.getByText(words.hookPending, { exact: true }).hover();
    await expect(page.getByRole("tooltip")).toContainText(
      words.hookPendingHint,
    );
  }
  await accessible(page);
});

// @req R-DASH-29 @req R-EMB-06 @req R-ORG-11 @req R-DASH-25
test("Settings: embeddings confirm before switching, sign-in domains explain their state and the default dashboard round-trips", async ({
  page,
}) => {
  const created = dashboardSchema.parse(
    await (
      await page.request.post("/api/v1/dashboards", {
        headers: { origin: workspaceOrigin },
        data: {
          name: `Default candidate ${String(Date.now())}`,
          description: "",
          definition: {
            version: 2,
            variables: [...standardDashboardVariables],
            tiles: [
              {
                id: "note",
                type: "text",
                title: "Note",
                layout: { x: 0, y: 0, w: 12, h: 2 },
                markdown: "Default candidate",
              },
            ],
          },
        },
      })
    ).json(),
  );
  try {
    await page.goto(paths.admin.settings);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      copy.settings.title,
    );
    await expect(
      page.getByText(copy.settings.general.slug, { exact: true }),
    ).toBeVisible();
    const embeddings = page.getByTestId("settings-embeddings");
    const toggle = embeddings.getByRole("switch", {
      name: copy.settings.embeddings.toggle,
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(
      embeddings.getByText(copy.settings.embeddings.fake, { exact: true }),
    ).toBeVisible();
    await toggle.click();
    await expect(page.getByRole("dialog")).toContainText(
      copy.settings.embeddings.disableTitle,
    );
    await accessible(page);
    await confirm(
      page,
      copy.settings.embeddings.disable,
      "Pause embeddings during browser verification",
    );
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(embeddings).toContainText(
      copy.settings.embeddings.disabledHint,
    );
    expect(
      z
        .object({ enabled: z.boolean() })
        .parse(
          await (
            await page.request.get("/api/v1/organization/embeddings")
          ).json(),
        ).enabled,
    ).toBe(false);
    await toggle.click();
    await confirm(
      page,
      copy.settings.embeddings.enable,
      "Resume embeddings after browser verification",
    );
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    const domains = page.getByTestId("settings-domains");
    await expect(
      domains.getByText(copy.settings.domains.disabled, { exact: true }),
    ).toBeVisible();
    await expect(
      domains.getByLabel(copy.settings.domains.domain, { exact: true }),
    ).toBeDisabled();
    await expect(
      domains.getByText(copy.settings.domains.empty, { exact: true }),
    ).toBeVisible();
    const card = page.getByTestId("settings-default-dashboard");
    const select = card.getByRole("combobox", {
      name: copy.settings.dashboard.select,
      exact: true,
    });
    await expect(select).toHaveValue(builtinDashboardId);
    await expect(
      select.locator(`option[value="${builtinDashboardId}"]`),
    ).toHaveText(`Team overview (${copy.settings.dashboard.builtin})`);
    // Team activity is built in but cannot be the Home default, so the picker never offers it.
    await expect(
      select.locator(`option[value="${builtinDashboardIds.teamActivity}"]`),
    ).toHaveCount(0);
    const save = card.getByRole("button", {
      name: copy.app.common.save,
      exact: true,
    });
    await expect(save).toBeDisabled();
    await select.selectOption(created.id);
    await expect(card).toContainText(copy.settings.dashboard.tiles(1));
    await save.click();
    await expect(
      card.getByText(copy.settings.dashboard.saved, { exact: true }),
    ).toBeVisible();
    expect(
      z
        .object({ default_id: z.string() })
        .parse(await (await page.request.get("/api/v1/dashboards")).json())
        .default_id,
    ).toBe(created.id);
    await page.goto(paths.home);
    await expect(page.getByTestId("dashboard-picker")).toHaveText(created.name);
    await page.goto(paths.admin.settings);
    await select.selectOption(builtinDashboardId);
    await save.click();
    await expect(
      card.getByText(copy.settings.dashboard.saved, { exact: true }),
    ).toBeVisible();
    await page.goto(paths.home);
    await expect(page.getByTestId("dashboard-picker")).toHaveText(
      "Team overview",
    );
  } finally {
    await page.request.delete(`/api/v1/dashboards/${created.id}`, {
      headers: { origin: workspaceOrigin },
      data: {},
    });
  }
});

// @req R-DASH-27 @req R-SAAS-07 @req R-ARCH-08
test("Billing and new organizations show the hosted-only state on a customer instance", async ({
  page,
}) => {
  await page.goto(paths.billing);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    copy.billing.title,
  );
  await expect(
    page.getByText(copy.saas.unavailable, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: copy.billing.upgrade }),
  ).toHaveCount(0);
  await page.goto(paths.organizationsNew);
  await expect(
    page.getByText(copy.saas.unavailable, { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("onboarding-organization-name")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: copy.app.navigation.backHome, exact: true }),
  ).toHaveAttribute("href", paths.home);
});

// @req R-ORG-10 @req R-ORG-08 @req R-DASH-07
test("a member opening an admin route sees the access message and the page makes no admin requests", async ({
  page,
  context,
}) => {
  await signInAsMember(context);
  const forbidden: string[] = [];
  const errors = collectErrors(page);
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/v1/admin/"))
      forbidden.push(request.url());
  });
  for (const path of Object.values(paths.admin)) {
    await page.goto(path);
    await expect(
      page.getByText(copy.app.navigation.adminRequired, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(copy.app.navigation.adminRequiredHint, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByTestId("admin-add-people")).toHaveCount(0);
    await expect(
      page.getByRole("link", {
        name: copy.app.navigation.backHome,
        exact: true,
      }),
    ).toHaveAttribute("href", paths.home);
  }
  await accessible(page);
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});
