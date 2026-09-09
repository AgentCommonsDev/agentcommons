import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { formatInstallCommand } from "@agentcommons/core/format/install";
import {
  ingestEnvelopeSchema,
  ingestOutputSchema,
  sqlOutputSchema,
} from "@agentcommons/core/schemas";
import { copy } from "../src/copy";
import { paths } from "../src/lib/routes";
import { workspaceOrigin } from "../playwright.shared";
import {
  accessible,
  collectErrors,
  confirm,
  fixture,
  settled,
  signInAsOwner,
  tableRow,
  test,
} from "./browser-test";
import { parseCsv } from "./csv";

const keys = copy.keys;
const install = copy.install;
const apiReference = copy.apiReference;
const sql = copy.sql;
/** The schema explorer sits beside the editor from 1024px and inside a sheet below it. */
const explorerInline = (page: Page) =>
  (page.viewportSize()?.width ?? 1440) >= 1024;
const editorContent = (page: Page) =>
  page.getByTestId("sql-editor").locator(".cm-content");
/** Replace the whole editor document by typing, which also exercises live completion. */
async function typeQuery(page: Page, text: string) {
  const content = editorContent(page);
  await content.click();
  await page.keyboard.press("ControlOrMeta+A");
  await content.pressSequentially(text, { delay: 15 });
  await page.keyboard.press("Escape");
}
async function loadExample(page: Page, label: string) {
  await page
    .getByRole("button", { name: sql.editor.examples, exact: true })
    .click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: new RegExp(label) })
    .click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}
async function runWithKeyboard(page: Page) {
  await editorContent(page).click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("sql-status")).not.toContainText(
    sql.status.running,
  );
}

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

// @req R-DASH-01 @req R-DASH-23 @req R-DASH-21 @req R-WEB-02 @req R-AUTH-05
test("a key is created, shown once with its install command, copied again later, and revoked with a reason", async ({
  page,
  request,
}, info) => {
  const errors = collectErrors(page);
  const name = `Browser key ${info.project.name} ${String(Date.now())}`;
  await page.goto(paths.keys);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(keys.title);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await settled(page);
  await accessible(page);
  await page.getByTestId("keys-create").click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: keys.create.title }),
  ).toBeVisible();
  const submit = dialog.getByRole("button", {
    name: keys.create.submit,
    exact: true,
  });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(keys.create.name, { exact: true }).fill(name);
  const ingest = dialog.getByRole("checkbox", {
    name: keys.permissions.ingest,
    exact: true,
  });
  const read = dialog.getByRole("checkbox", {
    name: keys.permissions.read,
    exact: true,
  });
  await expect(ingest).toHaveAttribute("aria-checked", "true");
  await expect(read).toHaveAttribute("aria-checked", "true");
  await expect(
    dialog.getByRole("checkbox", { name: keys.permissions.admin, exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  await ingest.click();
  await read.click();
  await expect(
    dialog.getByText(keys.permissions.required, { exact: true }),
  ).toBeVisible();
  await expect(submit).toBeDisabled();
  await ingest.click();
  await read.click();
  await expect(submit).toBeEnabled();
  await accessible(page);
  await submit.click();
  await expect(dialog).toHaveCount(0);

  const panel = page.getByTestId("keys-secret");
  await expect(panel).toContainText(keys.secret.title);
  const secret = (await panel.locator("code").first().innerText()).trim();
  expect(secret.length).toBeGreaterThan(20);
  const command = page.getByTestId("install-command");
  await expect(command).toHaveText(
    formatInstallCommand(workspaceOrigin, secret),
  );
  await expect(command).toContainText(workspaceOrigin);
  await expect(command).toContainText(secret);
  const authorized = await request.get("/api/v1/sessions?limit=1", {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(authorized.status()).toBe(200);
  await panel
    .getByRole("button", { name: keys.secret.done, exact: true })
    .click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(secret);

  const row = tableRow(page.getByTestId("keys-table"), name);
  await expect(row).toContainText(keys.list.active);
  await expect(row).toContainText(keys.permissions.ingest);
  await expect(row).toContainText(keys.permissions.read);

  // @req R-AUTH-05: the owner copies the same key again later instead of minting another.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await row
    .getByRole("button", { name: keys.reveal.copy, exact: true })
    .click();
  await expect(
    row.getByRole("button", { name: keys.reveal.copied, exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    secret,
  );
  await expect(page.locator("body")).not.toContainText(secret);
  await row
    .getByRole("button", { name: keys.list.revoke, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(name);
  await confirm(page, keys.revoke.confirm, "Browser verification key retired");
  await settled(page);
  await expect(row).toContainText(keys.list.revoked);
  await expect(
    row.getByRole("button", { name: keys.list.revoke, exact: true }),
  ).toBeDisabled();
  await expect(
    row.getByRole("button", { name: keys.reveal.copy, exact: true }),
  ).toHaveCount(0);
  const revoked = await request.get("/api/v1/sessions?limit=1", {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(revoked.status()).toBe(401);
  await page.reload();
  await settled(page);
  await expect(tableRow(page.getByTestId("keys-table"), name)).toContainText(
    keys.list.revoked,
  );
  await expect(page.locator("body")).not.toContainText(secret);
  expect(errors.filter((entry) => !entry.startsWith("401 "))).toEqual([]);
});

// @req R-DASH-23 @req R-WEB-02
test("the Install page unlocks the installer command once a machine key exists and lists the first capture", async ({
  page,
  request,
}, info) => {
  const data = await fixture();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const machine = `Browser machine ${info.project.name} ${String(Date.now())}`;
  await page.goto(paths.install);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    install.title,
  );
  await expect(page.getByRole("tab")).toHaveCount(0);
  // Before a key exists nothing is offered to copy: the command block is disabled.
  const command = page.getByTestId("install-command");
  const copyCommand = page.getByRole("button", {
    name: install.command.copy,
    exact: true,
  });
  await expect(command).toHaveAttribute("aria-disabled", "true");
  await expect(command).toHaveText(install.command.pending);
  await expect(copyCommand).toBeDisabled();
  await expect(page.locator("body")).not.toContainText("install.sh");
  await page.getByLabel(install.key.machine, { exact: true }).fill(machine);
  await page
    .getByRole("button", { name: install.key.submit, exact: true })
    .click();
  await expect(
    page.getByText(install.key.created, { exact: true }),
  ).toBeVisible();
  const panel = page.getByTestId("keys-secret");
  const secret = (await panel.locator("code").first().innerText()).trim();
  expect(secret.length).toBeGreaterThan(20);
  const expected = formatInstallCommand(workspaceOrigin, secret);
  await expect(command).toHaveText(expected);
  await expect(command).toHaveCount(1);
  await expect(command).not.toHaveAttribute("aria-disabled", "true");
  await expect(copyCommand).toBeEnabled();
  await copyCommand.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    expected,
  );
  await expect(
    page.getByText(install.command.secretHint, { exact: true }),
  ).toBeVisible();
  for (const note of Object.values(install.prepare.notes))
    await expect(page.getByText(note, { exact: true })).toBeVisible();
  // The page reads prepare, run, verify: key, prerequisites, command, first session.
  const steps = page.locator("main ol > li");
  await expect(steps).toHaveCount(4);
  await expect(steps).toContainText([
    install.key.title,
    install.prepare.title,
    install.run.title,
    install.arrivals.title,
  ]);
  await settled(page);
  await accessible(page);

  // The served installer is what the command downloads.
  const installer = await request.get("/install.sh");
  expect(installer.status()).toBe(200);
  expect(await installer.text()).toContain("hook");

  const arrivals = page.getByTestId("install-arrivals");
  await expect(arrivals).toContainText(install.arrivals.polling);
  const title = `Install arrival ${info.project.name} ${String(Date.now())}`;
  const response = await request.post("/api/v1/ingest", {
    headers: { authorization: `Bearer ${secret}` },
    data: ingestEnvelopeSchema.parse({
      ...data.liveEnvelope,
      harnessSessionId: randomUUID(),
      installationId: randomUUID(),
      batchId: randomUUID(),
      sentAt: new Date().toISOString(),
      sourcePos: 0,
      cursor: "1:0",
      records: [
        {
          pos: 0,
          sourceVersion: 0,
          key: randomUUID(),
          line: JSON.stringify({
            type: "user",
            uuid: randomUUID(),
            timestamp: new Date().toISOString(),
            message: { content: [{ type: "text", text: title }] },
          }),
        },
      ],
      context: {
        ...data.liveEnvelope.context,
        installation: {
          ...data.liveEnvelope.context.installation,
          hostname: machine,
        },
      },
    }),
  });
  expect(response.status(), await response.text()).toBe(202);
  const sessionId = ingestOutputSchema.parse(await response.json()).sessionId;
  const arrival = arrivals.getByRole("link").filter({ hasText: title });
  await expect(arrival).toBeVisible({ timeout: 45_000 });
  await expect(arrival).toHaveAttribute("href", paths.session(sessionId));
  await expect(arrival).toContainText(copy.app.harnesses.CLAUDE_CODE);
  await expect(arrivals.getByRole("link").first()).toContainText(title);

  // Dismissing the one-time secret removes it from the page and disables the command again.
  await panel
    .getByRole("button", { name: keys.secret.done, exact: true })
    .click();
  await expect(panel).toHaveCount(0);
  await expect(command).toHaveAttribute("aria-disabled", "true");
  await expect(command).toHaveText(install.command.pending);
  await expect(copyCommand).toBeDisabled();
  await expect(page.locator("body")).not.toContainText(secret);
  await expect(
    page.getByLabel(install.key.machine, { exact: true }),
  ).toHaveValue("");
  await arrival.click();
  await expect(page).toHaveURL(new RegExp(`${paths.session(sessionId)}$`));
  await expect(page.getByTestId("session-header")).toContainText(title);
});

// @req R-DASH-28 @req R-DASH-01
test("the API reference page frames the live Scalar reference inside the app shell", async ({
  page,
}) => {
  const reference = page.waitForResponse((response) =>
    new URL(response.url()).pathname.startsWith("/api/docs"),
  );
  await page.goto(paths.api);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    apiReference.title,
  );
  await expect(
    page.getByRole("navigation", { name: copy.app.navigation.label }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: copy.app.navigation.label })
      .getByRole("link", { name: copy.app.navigation.api, exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(apiReference.auth)).toBeVisible();
  await expect(
    page.getByRole("link", { name: apiReference.openNew, exact: true }),
  ).toHaveAttribute("target", "_blank");
  const response = await reference;
  expect(response.status(), response.url()).toBe(200);
  expect(response.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'self'",
  );
  const frame = page.frameLocator('[data-testid="api-reference-frame"]');
  await expect(frame.locator(".scalar-app").first()).toBeAttached({
    timeout: 45_000,
  });
  await expect(frame.locator("body")).toContainText("AgentCommons API", {
    timeout: 45_000,
  });
  // Scalar renders operations lazily; a request example proves a route was drawn.
  await expect(frame.locator("body")).toContainText("Request Example", {
    timeout: 45_000,
  });
  await expect(page.getByTestId("api-reference-frame")).toHaveAttribute(
    "title",
    apiReference.frameTitle,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

// @req R-DASH-26 @req R-DASH-22 @req R-DASH-01 @req R-WEB-02
test("the SQL editor completes view names while typing and reports guard problems inline", async ({
  page,
}) => {
  await page.goto(paths.sql);
  const content = editorContent(page);
  await expect(content).toBeVisible();
  const status = page.getByTestId("sql-status");
  await expect(status).toContainText(sql.status.ready);
  await expect(page.getByTestId("sql-copy-context")).toBeVisible();
  await content.click();
  await page.keyboard.press("ControlOrMeta+A");
  await content.pressSequentially("SELECT ses", { delay: 40 });
  const completion = page.locator(".cm-tooltip-autocomplete");
  await expect(completion).toBeVisible();
  // Options read "sessions49 columns": label and detail spans with no space between.
  const option = completion
    .getByRole("option")
    .filter({
      has: page.locator(".cm-completionLabel", { hasText: /^sessions$/ }),
    })
    .first();
  await expect(option).toBeVisible();
  await expect(
    completion.getByRole("option", { name: /^session_tools/ }),
  ).toBeVisible();
  await option.click();
  await expect(content).toHaveText(/SELECT sessions/);
  await expect(completion).toHaveCount(0);
  await content.pressSequentially(" FROM nowhere", { delay: 40 });
  await page.keyboard.press("Escape");
  await expect(completion).toHaveCount(0);
  await expect(page.locator(".cm-lintRange-error").first()).toBeAttached();
  await expect(page.locator(".cm-lint-marker-error").first()).toBeAttached();
  await expect(status).toContainText(sql.status.syntaxError);
  await expect(status).toContainText(
    new RegExp(`${sql.status.atLine} 1, ${sql.status.column} \\d+: \\S+`),
  );
  await expect(content).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(content).not.toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await typeQuery(page, "SELECT 1");
  await expect(status).toContainText(sql.status.ready);
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(0);
  await accessible(page);
});

// @req R-DASH-22 @req R-DASH-21 @req R-DASH-01
test("SQL runs with the keyboard, highlights server errors, remembers history, exports CSV and copies a briefing", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(paths.sql);
  const content = editorContent(page);
  await expect(content).toBeVisible();
  const status = page.getByTestId("sql-status");
  const example = sql.examples[2];
  await loadExample(page, example.label);
  await expect(content).toContainText("FROM session_tools");
  await runWithKeyboard(page);
  const results = page.getByTestId("sql-results");
  await expect(results).toBeVisible();
  await expect(status).toContainText(sql.status.ranIn);
  await expect(
    results.getByRole("columnheader", { name: /^tool_name/ }),
  ).toBeVisible();
  await expect(results.locator("tbody tr").first()).toContainText("Read");
  const rows = await results.locator("tbody tr").count();
  expect(rows).toBeGreaterThan(0);
  await expect(results).toContainText(
    `${String(rows)} ${rows === 1 ? sql.results.row : sql.results.rows}`,
  );
  const downloadPromise = page.waitForEvent("download");
  await results
    .getByRole("button", { name: sql.results.csv, exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(sql.results.csvName);
  const exported = parseCsv(await readFile(await download.path(), "utf8"));
  expect(exported.fields).toEqual(["tool_name", "sessions"]);
  expect(exported.rows).toHaveLength(rows);

  // A session id cell links to the session page.
  await loadExample(page, sql.examples[0].label);
  await runWithKeyboard(page);
  const link = results
    .getByRole("link", { name: new RegExp(sql.results.openSession) })
    .first();
  await expect(link).toHaveAttribute(
    "href",
    /^\/app\/sessions\/[0-9a-f-]{36}$/,
  );

  // The server stays the authority: a column the guard cannot know fails on the server.
  await typeQuery(page, "SELECT nope FROM sessions LIMIT 1");
  await expect(status).toContainText(sql.status.ready);
  await runWithKeyboard(page);
  await expect(status).toContainText(sql.status.queryError);
  await expect(page.locator(".cm-serverError").first()).toBeAttached();
  await content.click();
  await page.keyboard.press("End");
  await page.keyboard.type("0");
  await expect(page.locator(".cm-serverError")).toHaveCount(0);
  await expect(status).toContainText(sql.status.ready);

  // History keeps successful runs, newest first; the failed query is not recorded.
  await page
    .getByRole("button", { name: sql.editor.history, exact: true })
    .click();
  const history = page.getByRole("menu");
  await expect(history.getByRole("menuitem").first()).toContainText(
    "SELECT session_id, title, user_email",
  );
  await expect(history).not.toContainText("SELECT nope");
  await expect(history).toContainText("FROM session_tools");
  await history.getByRole("menuitem", { name: /FROM session_tools/ }).click();
  await expect(content).toContainText("FROM session_tools");
  // Running it again moves it to the top, and a fresh page opens on the last run.
  await runWithKeyboard(page);
  await expect(status).toContainText(sql.status.ranIn);
  await page.reload();
  await expect(editorContent(page)).toContainText("FROM session_tools");

  await page.getByTestId("sql-copy-context").getByRole("button").click();
  const briefing = await page.evaluate(() => navigator.clipboard.readText());
  expect(briefing).toContain("### sessions");
  expect(briefing).toContain("### messages");
  expect(briefing).toContain("search_messages(q='words')");
  expect(briefing).toMatch(/SELECT [\s\S]*FROM sessions/);
  const schema = await page.request.get("/api/v1/schema");
  expect(schema.ok()).toBe(true);
  const columns = (
    (await schema.json()) as {
      columns: { view_name: string; column_name: string }[];
    }
  ).columns;
  // The briefing lists every column as "- <name> <Type>: <meaning>" under its view.
  for (const column of columns.filter((item) => item.view_name === "sessions"))
    expect(briefing).toContain(`- ${column.column_name} `);

  const check = await page.request.post("/api/v1/query", {
    headers: { origin: workspaceOrigin },
    data: { sql: sql.examples[2].sql },
  });
  expect(check.ok(), await check.text()).toBe(true);
  expect(sqlOutputSchema.parse(await check.json()).row_count).toBe(rows);
});

// @req R-DASH-22 @req R-WEB-02
test("the schema explorer inserts names into the editor inline or from a sheet", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto(paths.sql);
  const content = editorContent(page);
  await expect(content).toBeVisible();
  await content.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await expect(content).toHaveText("");
  const viewRow = (scope: Page | ReturnType<Page["getByRole"]>) =>
    scope.getByRole("button", {
      name: new RegExp(`^sessions \\d+ ${sql.explorer.columns}$`),
    });
  if (explorerInline(page)) {
    const explorer = page.getByTestId("sql-explorer");
    await expect(explorer).toBeVisible();
    await expect(
      page.getByRole("button", { name: sql.explorer.open, exact: true }),
    ).toBeHidden();
    await viewRow(explorer).click();
    await expect(content).toHaveText("sessions");
    // Views start collapsed; the chevron beside a view reveals its columns.
    const sessionsView = explorer
      .getByRole("listitem")
      .filter({ has: viewRow(page) });
    const toggle = sessionsView.getByRole("button", {
      name: new RegExp(`^(${sql.explorer.expand}|${sql.explorer.collapse})$`),
    });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(
      explorer.getByRole("button", { name: "session_id", exact: false }),
    ).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await explorer
      .getByRole("button", { name: "session_id", exact: false })
      .first()
      .click();
    await expect(content).toHaveText(/sessions\s*session_id/);
    // Search matches view names, column names and descriptions, so the list shrinks.
    const viewRows = explorer.getByRole("button", {
      name: new RegExp(`\\d+ ${sql.explorer.columns}$`),
    });
    const allViews = await viewRows.count();
    expect(allViews).toBeGreaterThan(3);
    await explorer
      .getByRole("searchbox", { name: sql.explorer.search })
      .fill("session_reuse");
    await expect(
      explorer.getByRole("button", { name: /^session_reuse / }),
    ).toBeVisible();
    await expect.poll(() => viewRows.count()).toBeLessThan(allViews);
    await explorer
      .getByRole("searchbox", { name: sql.explorer.search })
      .fill("zzz-none");
    await expect(
      explorer.getByText(sql.explorer.noMatches, { exact: true }),
    ).toBeVisible();
  } else {
    await expect(page.getByTestId("sql-explorer")).toBeHidden();
    await page
      .getByRole("button", { name: sql.explorer.open, exact: true })
      .click();
    const sheet = page.getByRole("dialog", { name: sql.explorer.title });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(sql.explorer.insert);
    await accessible(page);
    await viewRow(sheet).click();
    await expect(sheet).toHaveCount(0);
    await expect(content).toHaveText("sessions");
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await accessible(page);
  expect(errors).toEqual([]);
});
