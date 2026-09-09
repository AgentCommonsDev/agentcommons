import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";
import {
  ingestEnvelopeSchema,
  ingestOutputSchema,
  sessionsOutputSchema,
} from "@agentcommons/core/schemas";
import { copy } from "../src/copy";
import { fieldLabel } from "../src/lib/display";
import { paths } from "../src/lib/routes";
import { workspaceOrigin } from "../playwright.shared";
import {
  accessible,
  collectErrors,
  fixture,
  setTheme,
  settled,
  signInAsOwner,
  test,
} from "./browser-test";
import { parseCsv } from "./csv";

/** Derived from the shared fixture so this file follows its shape without a separate export. */
type WorkspaceState = Awaited<ReturnType<typeof fixture>>;
const labels = copy.sessions;
const fields = copy.app.fields;
const statuses: Record<string, string> = copy.app.statuses;
const rootTitle = "Dashboard verification";
const childTitle =
  "Subagent task: read /repo/src/upload.ts and report its exports.";
const seededRepo = "github.com/rek7/agentcommons";
/** Phones stack every table row, which hides the sortable header cells. */
const wideLayout = (page: Page) => (page.viewportSize()?.width ?? 1440) >= 640;
const userRecord = (pos: number, text: string) => ({
  pos,
  sourceVersion: 0,
  key: randomUUID(),
  line: JSON.stringify({
    type: "user",
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: { content: [{ type: "text", text }] },
  }),
});
/** A new session from the seeded envelope; `records` carry contiguous positions from 0. */
function freshEnvelope(
  data: WorkspaceState,
  records: readonly unknown[],
  harnessSessionId = randomUUID(),
) {
  return {
    ...data.liveEnvelope,
    harnessSessionId,
    batchId: randomUUID(),
    sentAt: new Date().toISOString(),
    sourcePos: records.length - 1,
    records,
    cursor: `${String(records.length)}:0`,
  };
}
async function ingest(
  request: APIRequestContext,
  data: WorkspaceState,
  envelope: unknown,
) {
  const response = await request.post("/api/v1/ingest", {
    headers: { authorization: `Bearer ${data.ingestKey}` },
    data: ingestEnvelopeSchema.parse(envelope),
  });
  expect(response.status(), await response.text()).toBe(202);
  return ingestOutputSchema.parse(await response.json()).sessionId;
}
/** The fields the page assertions read; unknown header keys stay so labels can be checked. */
const readOutputSchema = z.looseObject({
  header: z.looseObject({
    status: z.string(),
    user_email: z.string(),
    model: z.string().nullable(),
    started_at: z.string(),
    start_commit: z.string().nullable(),
    installation_hostname: z.string(),
    message_count: z.number(),
    tool_call_count: z.number(),
  }),
  messages: z.array(
    z.looseObject({
      seq: z.number(),
      kind: z.string(),
      role: z.string(),
      tool_name: z.string().nullable(),
    }),
  ),
});
async function sessionRead(page: Page, id: string) {
  const response = await page.request.get(`/api/v1/sessions/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  const json: unknown = await response.json();
  // Key order comes from the raw response; the page renders the same order.
  const headerKeys = Object.keys(
    z.object({ header: z.record(z.string(), z.unknown()) }).parse(json).header,
  );
  return { ...readOutputSchema.parse(json), headerKeys };
}
/** Publication is asynchronous; poll with the signed-in cookie so no reuse edge is recorded. */
async function waitForPublished(page: Page, id: string) {
  await expect
    .poll(
      async () => (await page.request.get(`/api/v1/sessions/${id}`)).status(),
      { timeout: 60_000 },
    )
    .toBe(200);
}
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
async function rootCount(page: Page) {
  const response = await page.request.get(
    "/api/v1/sessions?roots_only=true&limit=100",
  );
  expect(response.ok(), await response.text()).toBe(true);
  const parsed = sessionsOutputSchema.parse(await response.json());
  expect(parsed.cursor).toBeNull();
  return parsed.items.length;
}
const message = (page: Page, seq: number) =>
  page.getByTestId(`session-message-${String(seq)}`);
const switchNamed = (page: Page, name: string) =>
  page.getByRole("switch", { name, exact: true });
const rows = (page: Page) =>
  page.getByTestId("sessions-table").locator("tbody tr");

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

// @req R-DASH-11 @req R-DASH-21 @req R-DASH-30 @req R-DASH-17 @req R-WEB-02
test("the list shows root sessions only, toggles subagent runs, sorts on the server and exports every column", async ({
  page,
}) => {
  const data = await fixture();
  const errors = collectErrors(page);
  await page.goto(paths.sessions);
  const list = page.getByRole("table", { name: labels.list.label });
  await expect(list).toBeVisible();
  await settled(page);
  const roots = await rootCount(page);
  const next = page.getByRole("button", {
    name: copy.app.common.next,
    exact: true,
  });
  const previous = page.getByRole("button", {
    name: copy.app.common.previous,
    exact: true,
  });
  const firstPage = await rows(page).count();
  expect(firstPage).toBe(Math.min(50, roots));
  await expect(list).not.toContainText(childTitle);
  await expect(next).toBeEnabled();
  await next.click();
  await settled(page);
  await expect(previous).toBeEnabled();
  await expect(list).not.toContainText(childTitle);
  expect(firstPage + (await rows(page).count())).toBe(roots);
  await expect(page).not.toHaveURL(/subagents/);
  await previous.click();
  await settled(page);

  // Subagent runs belong inside their parent's page: no row, no toggle, and the
  // retired URL flag changes nothing.
  await page.goto(`${paths.sessions}?subagents=true`);
  await expect(list).toBeVisible();
  await settled(page);
  await expect(list).not.toContainText(childTitle);
  expect(await rows(page).count()).toBe(firstPage);
  await expect(page.getByRole("switch")).toHaveCount(0);

  await page
    .getByRole("button", { name: copy.app.common.columns, exact: true })
    .click();
  const menu = page.getByRole("menu");
  await menu
    .getByRole("menuitemcheckbox", {
      name: labels.list.subagentCount,
      exact: true,
    })
    .click();
  // User is shown by default and Subagents is not; the chooser flips both.
  await menu
    .getByRole("menuitemcheckbox", { name: fields.user_email, exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  if (wideLayout(page)) {
    await expect(
      page.getByRole("columnheader", {
        name: labels.list.subagentCount,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: fields.user_email, exact: true }),
    ).toHaveCount(0);
    const started = page.getByRole("columnheader", {
      name: fields.started_at,
      exact: true,
    });
    await expect(started).toHaveAttribute("aria-sort", "descending");
    const sorted = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/v1/sessions" &&
        url.searchParams.get("sort") === "started_at" &&
        url.searchParams.get("order") === "asc"
      );
    });
    await started.getByRole("button").click();
    expect((await sorted).ok()).toBe(true);
    await expect(started).toHaveAttribute("aria-sort", "ascending");
    await settled(page);
    await expect(rows(page).first()).toContainText(rootTitle);
  }

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: copy.app.common.export, exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(labels.list.csvName);
  const csv = await readFile(await download.path(), "utf8");
  const exported = parseCsv(csv);
  expect(exported.fields).toEqual([
    fields.title,
    fields.harness,
    fields.model,
    labels.list.repoBranch,
    fields.user_email,
    fields.installation_hostname,
    fields.started_at,
    labels.list.duration,
    fields.message_count,
    fields.tool_call_count,
    fields.observed_commit_count,
    fields.reuse_count,
    fields.status,
    labels.list.subagentCount,
  ]);
  expect(exported.rows).toHaveLength(roots);
  expect(csv).not.toContain(childTitle);
  expect(csv).toContain(seededRepo);

  // One root with its derived counts, independent of the viewport's sort controls.
  await page.goto(`${paths.sessions}?session_id=${data.sessionId}`);
  await settled(page);
  await expect(rows(page)).toHaveCount(1);
  const root = rows(page).first();
  await expect(root).toContainText(rootTitle);
  // Earlier suites may have read this session with a key; the API holds the current count.
  const read = await sessionRead(page, data.sessionId);
  await expect(
    root.locator(`td[data-label="${fields.reuse_count}"]`),
  ).toHaveText(String(read.header.reuse_count));
  // Column choices persist across navigation, so Subagents is still shown here.
  await expect(
    root.locator(`td[data-label="${labels.list.subagentCount}"]`),
  ).toHaveText("1");
  const rootStatus = read.header.status;
  await expect(root.locator(`td[data-label="${fields.status}"]`)).toHaveText(
    rootStatus === "ACTIVE"
      ? labels.detail.live.badge
      : (statuses[rootStatus] ?? rootStatus),
  );
  await root.getByRole("link", { name: new RegExp(rootTitle) }).click();
  await expect(page).toHaveURL(new RegExp(`${paths.session(data.sessionId)}$`));
  await expect(page.getByTestId("session-header")).toContainText(rootTitle);
  expect(errors).toEqual([]);
});

// @req R-DASH-01 @req R-DASH-11
test("quick filters and structured conditions live in the URL and remove as chips", async ({
  page,
}) => {
  await page.goto(paths.sessions);
  await expect(
    page.getByRole("table", { name: labels.list.label }),
  ).toBeVisible();
  await settled(page);
  const before = await rows(page).count();
  expect(before).toBeGreaterThan(1);
  const openFilter = async () => {
    await page.getByTestId("sessions-add-filter").click();
    const popover = page.getByRole("dialog", { name: labels.filters.title });
    await expect(popover).toBeVisible();
    return popover;
  };
  let popover = await openFilter();
  await popover
    .getByLabel(labels.filters.field, { exact: true })
    .selectOption("repo_name");
  await expect(
    popover.getByLabel(labels.filters.operator, { exact: true }),
  ).toHaveValue("eq");
  await popover
    .getByLabel(labels.filters.value, { exact: true })
    .fill("github.com/absent/browser-repo");
  await popover
    .getByRole("button", { name: labels.filters.apply, exact: true })
    .click();
  await expect(popover).toHaveCount(0);
  await expect(page).toHaveURL(/repo_name/);
  expect(decodeURIComponent(page.url())).toContain(
    "github.com/absent/browser-repo",
  );
  await expect(
    page.getByText(labels.list.noMatch, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(labels.list.noMatchHint, { exact: true }),
  ).toBeVisible();
  const chips = page.getByLabel(labels.filters.label, { exact: true });
  await expect(chips).toContainText(
    `${labels.filters.fields.repo_name} ${labels.filters.operators.eq} github.com/absent/browser-repo`,
  );
  await chips
    .getByRole("button", { name: labels.filters.remove, exact: true })
    .click();
  await expect(page).not.toHaveURL(/repo_name/);
  await settled(page);
  await expect(rows(page)).toHaveCount(before);

  popover = await openFilter();
  await popover
    .getByLabel(labels.filters.field, { exact: true })
    .selectOption("tool_name");
  await popover
    .getByLabel(labels.filters.operator, { exact: true })
    .selectOption("contains");
  await popover.getByLabel(labels.filters.value, { exact: true }).fill("Rea");
  await popover
    .getByRole("button", { name: labels.filters.apply, exact: true })
    .click();
  await expect(page).toHaveURL(/where=/);
  expect(decodeURIComponent(page.url())).toContain('"field":"tool_name"');
  await expect(chips).toContainText(
    `${labels.filters.fields.tool_name} ${labels.filters.operators.contains} Rea`,
  );
  await settled(page);
  // Only sessions that called Read match: the seeded root and copies other tests made of it.
  const matching = await rows(page).count();
  expect(matching).toBeGreaterThan(0);
  expect(matching).toBeLessThan(before);
  await expect(rows(page).filter({ hasNotText: rootTitle })).toHaveCount(0);
  // Structured conditions stay in the URL across a reload, so the link is shareable.
  await page.reload();
  await settled(page);
  await expect(rows(page)).toHaveCount(matching);
  await chips
    .getByRole("button", { name: labels.filters.clearAll, exact: true })
    .click();
  await expect(page).not.toHaveURL(/where=/);
  await expect(chips).toHaveCount(0);
  await settled(page);
  await expect(rows(page)).toHaveCount(before);
});

// @req R-DASH-01 @req R-DASH-03 @req R-DASH-10 @req R-DASH-30
test("search words open the Messages view with highlighted hits, paging and deep links", async ({
  page,
}) => {
  const data = await fixture();
  await page.goto(paths.sessions);
  await settled(page);
  await page.getByTestId("sessions-search").fill("pagination");
  await page
    .getByRole("button", { name: labels.search.submit, exact: true })
    .click();
  await expect(page).toHaveURL(/q=pagination/);
  await expect(page.getByTestId("sessions-view-messages")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const results = page.getByLabel(labels.results.label, { exact: true });
  await expect(results).toBeVisible();
  await expect(results.locator("mark").first()).toHaveText(/pagination/i);
  await expect(
    results.getByText(labels.results.hit, { exact: true }).first(),
  ).toBeVisible();
  const firstTitle = results
    .getByRole("article")
    .first()
    .getByRole("link")
    .first();
  const initial = await firstTitle.innerText();
  const next = results.getByRole("button", {
    name: labels.results.next,
    exact: true,
  });
  const previous = results.getByRole("button", {
    name: labels.results.previous,
    exact: true,
  });
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(firstTitle).not.toHaveText(initial);
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(firstTitle).toHaveText(initial);

  // The Sessions view keeps the words and offers the way back to the hits.
  await page.getByTestId("sessions-view-sessions").click();
  await expect(page).toHaveURL(/view=sessions/);
  await expect(
    page.getByText(labels.views.wordsHint, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: labels.views.showMessages, exact: true })
    .click();
  await expect(page).toHaveURL(/view=messages/);

  const link = results
    .getByRole("link", { name: `${labels.results.open} 0`, exact: true })
    .first();
  await expect(link).toHaveAttribute(
    "href",
    /\/app\/sessions\/[0-9a-f-]{36}#0$/,
  );
  const target = await link.getAttribute("href");
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${target ?? ""}$`));
  await expect(message(page, 0)).toHaveClass(/border-accent/);
  await expect(message(page, 0)).toContainText("pagination");
  await page.reload();
  await expect(message(page, 0)).toHaveClass(/border-accent/);
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(/q=pagination/);
  await page
    .getByRole("button", { name: labels.search.clear, exact: true })
    .click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.getByTestId("sessions-view-sessions")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // A hit inside a subagent run opens the root session with that run selected;
  // the child has no page of its own in the list.
  await page.getByTestId("sessions-search").fill("module");
  await page
    .getByRole("button", { name: labels.search.submit, exact: true })
    .click();
  const nested = results
    .getByRole("article")
    .filter({ hasText: childTitle })
    .first();
  await expect(nested).toBeVisible();
  await expect(nested).toContainText(copy.app.statuses.SUBAGENT);
  await expect(nested).toContainText("Explore");
  await expect(
    nested.getByRole("link", { name: childTitle, exact: true }),
  ).toHaveAttribute(
    "href",
    paths.session(data.sessionId, undefined, data.childSessionId),
  );
  const nestedHit = nested
    .getByRole("link", { name: new RegExp(`^${labels.results.open} `) })
    .first();
  const nestedHref = await nestedHit.getAttribute("href");
  expect(nestedHref).toMatch(
    new RegExp(
      `^${escapeRegExp(paths.session(data.sessionId, undefined, data.childSessionId))}#\\d+$`,
    ),
  );
  await nestedHit.click();
  await expect(page).toHaveURL(
    new RegExp(`${escapeRegExp(nestedHref ?? "")}$`),
  );
  await expect(page.getByTestId("session-header")).toContainText(rootTitle);
});

// @req R-DASH-10 @req R-DASH-20 @req R-DASH-12 @req R-DASH-01
test("the session page shows every header field, transcript controls, files and raw records", async ({
  page,
}) => {
  const data = await fixture();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const output = await sessionRead(page, data.sessionId);
  const thinking = output.messages.find((item) => item.kind === "THINKING");
  const toolUse = output.messages.find((item) => item.kind === "TOOL_USE");
  const toolResult = output.messages.find(
    (item) => item.kind === "TOOL_RESULT",
  );
  const text = output.messages.find(
    (item) => item.role === "ASSISTANT" && item.kind === "TEXT",
  );
  if (!thinking || !toolUse || !toolResult || !text)
    throw new Error("The seeded session lost a message kind.");
  await page.goto(paths.session(data.sessionId));
  const header = page.getByTestId("session-header");
  await expect(header.getByRole("heading", { level: 1 })).toContainText(
    rootTitle,
  );
  await expect(header).toContainText(copy.app.harnesses.CLAUDE_CODE);
  await expect(header).toContainText(output.header.user_email);
  // The meta strip is a definition list: one labelled fact per term, in a fixed order.
  await expect(header.locator("dl dt")).toHaveText([
    fields.harness,
    ...(output.header.model === null ? [] : [fields.model]),
    fields.user_email,
    fields.repo_name,
    fields.started_at,
  ]);
  if (output.header.model !== null)
    await expect(header).toContainText(output.header.model);
  await expect(header.locator("time")).toHaveAttribute(
    "datetime",
    output.header.started_at,
  );
  const follow = switchNamed(page, labels.detail.transcript.followLatest);
  if (output.header.status === "ACTIVE") {
    await expect(header.getByTestId("session-live")).toHaveText(
      labels.detail.live.badge,
    );
    await expect(header.getByTestId("session-stream")).toContainText(
      labels.detail.live.streaming,
      { timeout: 20_000 },
    );
    await expect(follow).toHaveAttribute("aria-checked", "true");
  } else {
    await expect(header).toContainText(
      statuses[output.header.status] ?? output.header.status,
    );
    await expect(header.getByTestId("session-live")).toHaveCount(0);
    await expect(follow).toHaveCount(0);
  }
  await expect(
    header.getByRole("link", { name: seededRepo, exact: true }),
  ).toHaveAttribute("href", `https://${seededRepo}`);
  await expect(
    header.getByRole("link", { name: "browser-verification", exact: true }),
  ).toHaveAttribute("href", `https://${seededRepo}/tree/browser-verification`);
  // Stat values and labels sit in sibling spans, so the text has no space between them.
  await expect(header).toContainText(
    new RegExp(
      `${String(output.header.message_count)}\\s*${labels.detail.messages}`,
    ),
  );
  await expect(header).toContainText(
    new RegExp(
      `${String(output.header.tool_call_count)}\\s*${labels.detail.toolCalls}`,
    ),
  );
  await expect(header).toContainText(
    new RegExp(`1\\s*${labels.detail.subagentRuns}`),
  );

  await header
    .getByRole("button", { name: labels.detail.details, exact: true })
    .click();
  const details = page.locator("#session-details");
  await expect(details).toBeVisible();
  await expect(details.locator("dt")).toHaveText(
    output.headerKeys.map((key) =>
      key === "parent_relation"
        ? labels.detail.subagents.relation
        : fieldLabel(key),
    ),
  );
  await expect(details).toContainText(output.header.start_commit ?? "abc123");
  await expect(details).toContainText(output.header.installation_hostname);
  const identity = details
    .locator("dl > div")
    .filter({ has: page.getByText(fields.session_id, { exact: true }) });
  await expect(identity).toContainText(data.sessionId);
  await identity
    .getByRole("button", { name: copy.app.common.copy, exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    data.sessionId,
  );
  const children = details
    .locator("dl > div")
    .filter({ has: page.getByText(fields.children, { exact: true }) });
  const childRow = children.getByRole("listitem");
  await expect(childRow).toHaveCount(1);
  await expect(childRow).toContainText(copy.app.statuses.SUBAGENT);
  await expect(childRow).toContainText("Explore");
  await expect(
    childRow.getByRole("link", { name: new RegExp(escapeRegExp(childTitle)) }),
  ).toHaveAttribute("href", paths.session(data.childSessionId));
  // Counts come from the tree the page already loaded, never from the bare reference.
  await expect(childRow).toContainText(
    new RegExp(`\\d+\\s*${labels.detail.subagents.messages}`),
  );
  await header
    .getByRole("button", { name: labels.detail.hideDetails, exact: true })
    .click();
  await expect(details).toHaveCount(0);

  const transcript = page.getByTestId("session-transcript");
  await expect(message(page, 0)).toContainText(rootTitle);
  await expect(message(page, 0)).toContainText(copy.app.statuses.USER);
  await expect(page.getByRole("note").first()).toContainText(
    "captured-browser-model",
  );
  await expect(
    page.getByText(
      `${String(output.messages.length)}${copy.app.common.fractionSeparator}${String(output.header.message_count)} ${labels.detail.transcript.loaded}`,
      { exact: true },
    ),
  ).toBeVisible();

  const thinkingToggle = message(page, thinking.seq).getByRole("button", {
    expanded: false,
  });
  await expect(thinkingToggle).toContainText(labels.detail.transcript.thinking);
  await switchNamed(page, labels.detail.transcript.expandThinking).click();
  await expect(
    message(page, thinking.seq).getByRole("button", { expanded: true }),
  ).toBeVisible();
  await switchNamed(page, labels.detail.transcript.expandThinking).click();
  await expect(thinkingToggle).toBeVisible();

  const call = message(page, toolUse.seq);
  await expect(call).toContainText(toolUse.tool_name ?? "Read");
  await expect(message(page, toolResult.seq)).toHaveCount(0);
  await switchNamed(page, labels.detail.transcript.expandTools).click();
  await expect(call.getByRole("button", { expanded: true })).toBeVisible();
  await expect(call).toContainText("/repo/src/upload.ts");
  await expect(message(page, toolResult.seq)).toContainText(
    "export async function upload(batch)",
  );
  await call.getByRole("button", { expanded: true }).click();
  await expect(call.getByRole("button", { expanded: false })).toBeVisible();
  await expect(message(page, toolResult.seq)).toHaveCount(0);
  await switchNamed(page, labels.detail.transcript.expandTools).click();

  const find = page.getByRole("searchbox", {
    name: labels.detail.transcript.find,
  });
  await find.fill("acknowledges");
  await expect(transcript.getByTestId(/^session-message-\d+$/)).toHaveCount(1);
  await expect(message(page, text.seq)).toBeVisible();
  await find.fill("zzz-not-in-this-transcript");
  await expect(
    page.getByText(labels.detail.transcript.noFindMatch, { exact: true }),
  ).toBeVisible();
  await find.fill("");
  await expect(message(page, 0)).toBeVisible();
  await message(page, 0)
    .getByRole("button", {
      name: labels.detail.transcript.copyLink,
      exact: true,
    })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `${workspaceOrigin}${paths.session(data.sessionId, 0)}`,
  );

  await page.getByTestId("session-tab-files").click();
  const files = page.getByLabel(labels.detail.files.label, { exact: true });
  // Paths are stored relative to the observed git root.
  await expect(files).toContainText("src/upload.ts");
  await expect(
    files.getByRole("heading", {
      level: 3,
      name: labels.detail.files.operationsLabel.read,
    }),
  ).toBeVisible();
  await expect(files).toContainText(labels.detail.files.commitsEmpty);

  await page.getByTestId("session-tab-raw").click();
  const raw = page.getByLabel(labels.detail.raw.label, { exact: true });
  await expect(raw).toBeVisible();
  const oversized = raw
    .getByRole("listitem")
    .filter({ hasText: "future_record" })
    .first();
  await expect(oversized).toContainText(labels.detail.raw.fragment);
  await oversized.getByRole("button", { expanded: false }).click();
  await expect(oversized).toContainText(fields.raw_record_id);
  await expect(oversized).toContainText(fields.ingest_batch_id);
  const downloaded = page.waitForEvent("download");
  await oversized
    .getByRole("button", { name: labels.detail.raw.download, exact: true })
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(
    new RegExp(`^${labels.detail.raw.filePrefix}[0-9a-f-]{36}\\.json$`),
  );
  const content: unknown = JSON.parse(
    await readFile(await download.path(), "utf8"),
  );
  expect(z.object({ text: z.string() }).parse(content).text).toBe(
    "Long raw record browser verification. ".repeat(4000),
  );
  await page.getByTestId("session-tab-transcript").click();
  await expect(message(page, 0)).toBeVisible();
});

// @req R-DASH-30 @req R-DASH-19 @req R-DASH-02 @req R-DASH-10
test("subagent runs load their messages inline and the child page links to its root", async ({
  page,
}) => {
  const data = await fixture();
  await page.goto(paths.session(data.sessionId));
  const section = page.getByRole("region", {
    name: labels.detail.subagents.title,
  });
  await expect(section.getByRole("heading", { level: 2 })).toContainText(
    labels.detail.subagents.title,
  );
  await expect(section.getByRole("heading", { level: 2 })).toContainText("1");
  const block = section.getByTestId(`session-subagent-${data.childSessionId}`);
  await expect(block).toContainText(copy.app.statuses.SUBAGENT);
  await expect(block).toContainText("Explore");
  await expect(block).toContainText(childTitle);
  await expect(block).toContainText(copy.app.harnesses.CLAUDE_CODE);
  await expect(block).not.toContainText("The module exports one function");
  const toggle = block.getByRole("button", { expanded: false });
  await toggle.click();
  await expect(block.getByRole("button", { expanded: true })).toBeVisible();
  await expect(block).toContainText(
    "The module exports one function: upload(batch).",
  );
  // Inline child messages never take the page-level ids, so deep links stay unambiguous.
  await expect(block.getByTestId(/^session-message-\d+$/)).toHaveCount(0);
  await expect(block).not.toContainText("return persist(batch)");
  await switchNamed(page, labels.detail.transcript.expandTools).click();
  await expect(block).toContainText("return persist(batch)");
  await expect(block).not.toContainText(labels.detail.subagents.gap);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await block
    .locator(`a[href="${paths.session(data.childSessionId)}"]`)
    .click();
  await expect(page).toHaveURL(
    new RegExp(`${paths.session(data.childSessionId)}$`),
  );
  const notice = page
    .getByRole("status")
    .filter({ hasText: labels.detail.subagentRun });
  await expect(notice).toContainText(copy.app.statuses.SUBAGENT);
  await expect(notice).toContainText(rootTitle);
  await expect(
    notice.getByRole("link", { name: labels.detail.openRoot, exact: true }),
  ).toHaveAttribute("href", paths.session(data.sessionId));
  const header = page.getByTestId("session-header");
  await expect(header.getByRole("heading", { level: 1 })).toContainText(
    childTitle,
  );
  await expect(header).toContainText("Explore");
  await expect(
    page.getByRole("region", { name: labels.detail.subagents.title }),
  ).toHaveCount(0);
  await header
    .getByRole("button", { name: labels.detail.details, exact: true })
    .click();
  const parentRow = page
    .locator("#session-details dl > div")
    .filter({ has: page.getByText(fields.parent, { exact: true }) })
    .getByRole("listitem");
  await expect(parentRow).toHaveCount(1);
  await expect(
    parentRow.getByRole("link", { name: new RegExp(escapeRegExp(rootTitle)) }),
  ).toHaveAttribute("href", paths.session(data.sessionId));
  await expect(parentRow).toContainText(
    new RegExp(`\\d+\\s*${labels.detail.subagents.messages}`),
  );
  await header
    .getByRole("button", { name: labels.detail.hideDetails, exact: true })
    .click();
  await notice
    .getByRole("link", { name: labels.detail.openRoot, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${paths.session(data.sessionId)}$`));
  await expect(page.getByTestId("session-header")).toContainText(rootTitle);
});

// @req R-DASH-17
test("the Reuse card lists who read this session and what it read", async ({
  page,
}) => {
  const { reuse } = await fixture();
  await page.goto(paths.session(reuse.targetSessionId));
  await expect(
    page.getByRole("heading", { name: labels.detail.reuse.title, exact: true }),
  ).toBeVisible();
  const inbound = page.getByRole("table", {
    name: labels.detail.reuse.by,
    exact: true,
  });
  const sourceLink = inbound.locator(
    `a[href="${paths.session(reuse.sourceSessionId)}"]`,
  );
  await expect(sourceLink).toBeVisible();
  await expect(inbound).toContainText(reuse.userEmail);
  await expect(inbound).toContainText(copy.app.harnesses.CLAUDE_CODE);
  await expect(
    page.getByRole("heading", {
      name: labels.detail.similar.title,
      exact: true,
    }),
  ).toBeVisible();
  const panel = page
    .getByRole("heading", { name: labels.detail.reuse.by, exact: true })
    .locator("xpath=..");
  if (wideLayout(page)) {
    const when = inbound.getByRole("columnheader", {
      name: labels.detail.reuse.when,
      exact: true,
    });
    await expect(when).toHaveAttribute("aria-sort", "descending");
    const sorted = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith("/reuse") &&
        url.searchParams.get("direction") === "by" &&
        url.searchParams.get("order") === "asc"
      );
    });
    await when.getByRole("button").click();
    expect((await sorted).ok()).toBe(true);
    await expect(when).toHaveAttribute("aria-sort", "ascending");
  }
  // A list that fits on one page offers no export; the data leads. The shared
  // CSV path is covered by the sessions list test.
  await expect(
    panel.getByRole("button", { name: copy.app.common.export, exact: true }),
  ).toHaveCount(0);
  // Similarity is its own card, not part of Reuse.
  await expect(
    page.getByText(labels.detail.similar.description, { exact: true }),
  ).toBeVisible();
  await sourceLink.click();
  await expect(page).toHaveURL(
    new RegExp(`${paths.session(reuse.sourceSessionId)}$`),
  );
  const outbound = page.getByRole("table", {
    name: labels.detail.reuse.from,
    exact: true,
  });
  await expect(
    outbound.locator(`a[href="${paths.session(reuse.targetSessionId)}"]`),
  ).toContainText(rootTitle);
  await expect(
    page.getByText(labels.detail.reuse.emptyBy, { exact: true }),
  ).toBeVisible();
});

// @req R-DASH-03 @req R-DASH-06 @req R-DASH-12
test("long transcripts and raw records page in bounded steps and deep links start near the message", async ({
  page,
  request,
}) => {
  const data = await fixture();
  const total = 120;
  // The session has ended, so nothing follows its tail and the first page stays put.
  const id = await ingest(request, data, {
    ...freshEnvelope(
      data,
      Array.from({ length: total }, (_, pos) =>
        userRecord(
          pos,
          `Long transcript message ${String(pos)} ${"context ".repeat(12)}`,
        ),
      ),
    ),
    behavior: "end",
    nativeEvent: "SessionEnd",
  });
  await waitForPublished(page, id);
  await page.goto(paths.session(id));
  const transcript = page.getByTestId("session-transcript");
  const loaded = transcript.getByTestId(/^session-message-\d+$/);
  await expect(message(page, 0)).toBeVisible();
  const header = page.getByTestId("session-header");
  await expect(header).toContainText(statuses.ENDED ?? "ENDED");
  await expect(header.getByTestId("session-live")).toHaveCount(0);
  await expect(
    switchNamed(page, labels.detail.transcript.followLatest),
  ).toHaveCount(0);
  // `get` pages are byte-bounded, so the first page stops well before the last message.
  // The button relabels itself while a page loads, so match both labels.
  const more = page.getByRole("button", {
    name: new RegExp(
      `^(?:${escapeRegExp(labels.detail.transcript.loadMore)}|${escapeRegExp(labels.detail.transcript.loading)})$`,
    ),
  });
  await expect(more).toBeVisible();
  const firstPage = await loaded.count();
  expect(firstPage).toBeGreaterThan(1);
  expect(firstPage).toBeLessThan(total);
  await expect(message(page, total - 1)).toHaveCount(0);
  await expect(
    page.getByText(
      `${String(firstPage)}${copy.app.common.fractionSeparator}${String(total)} ${labels.detail.transcript.loaded}`,
      { exact: true },
    ),
  ).toBeVisible();
  // Bringing the control into view loads the next page; no click is needed, and each
  // step stays one bounded page.
  for (let pages = 1; (await more.count()) > 0; pages++) {
    expect(pages).toBeLessThan(20);
    const before = await loaded.count();
    await more.scrollIntoViewIfNeeded();
    await expect
      .poll(
        async () =>
          (await more.count()) === 0 || (await loaded.count()) > before,
        { timeout: 15_000 },
      )
      .toBe(true);
  }
  await expect(message(page, total - 1)).toBeVisible();
  await expect(loaded).toHaveCount(total);

  await page.getByTestId("session-tab-raw").click();
  const raw = page.getByLabel(labels.detail.raw.label, { exact: true });
  await expect(raw.getByRole("listitem")).toHaveCount(25);
  await expect(raw.getByRole("listitem").first()).toContainText("#0");
  const nextRecords = raw.getByRole("button", {
    name: labels.detail.raw.next,
    exact: true,
  });
  const previousRecords = raw.getByRole("button", {
    name: labels.detail.raw.previous,
    exact: true,
  });
  await expect(previousRecords).toBeDisabled();
  await nextRecords.click();
  await expect(raw.getByRole("listitem").first()).toContainText("#25");
  await expect(raw.getByRole("listitem")).toHaveCount(25);
  await expect(previousRecords).toBeEnabled();
  await previousRecords.click();
  await expect(raw.getByRole("listitem").first()).toContainText("#0");

  await page.goto(paths.session(id, 110));
  await expect(message(page, 110)).toHaveClass(/border-accent/);
  await expect(message(page, 108)).toBeVisible();
  await expect(message(page, 107)).toHaveCount(0);
  await expect(
    page.getByText(`${labels.detail.transcript.startedFrom} 108`, {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("link", {
      name: labels.detail.transcript.showFromStart,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`${paths.session(id)}$`));
  await expect(message(page, 0)).toBeVisible();
  await expect(
    page.getByText(labels.detail.transcript.startedFrom),
  ).toHaveCount(0);
});

// @req R-DASH-04
test("live ingest reaches the transcript over SSE and through the polling fallback", async ({
  page,
  request,
}, info) => {
  const data = await fixture();
  for (const fallback of [false, true]) {
    const harnessSessionId = randomUUID();
    // The prompt, the assistant turn and the tool result; the oversized record stays out.
    const seeded = data.liveEnvelope.records.slice(0, 3);
    const id = await ingest(
      request,
      data,
      freshEnvelope(data, seeded, harnessSessionId),
    );
    await waitForPublished(page, id);
    if (fallback)
      await page.route("**/api/v1/sessions/*/events", (route) =>
        route.abort("connectionfailed"),
      );
    await page.goto(paths.session(id));
    const header = page.getByTestId("session-header");
    await expect(header.getByTestId("session-live")).toHaveText(
      labels.detail.live.badge,
    );
    await expect(header.getByTestId("session-stream")).toContainText(
      fallback ? labels.detail.live.reconnecting : labels.detail.live.streaming,
      { timeout: 20_000 },
    );
    // A live session follows its tail without a click.
    const follow = switchNamed(page, labels.detail.transcript.followLatest);
    await expect(follow).toHaveAttribute("aria-checked", "true");
    const text = `Live browser arrival ${info.project.name} ${fallback ? "polling" : "sse"} ${String(Date.now())}`;
    const pos = seeded.length;
    await ingest(request, data, {
      ...data.liveEnvelope,
      harnessSessionId,
      batchId: randomUUID(),
      sentAt: new Date().toISOString(),
      sourcePos: pos,
      records: [userRecord(pos, text)],
      cursor: `${String(pos + 1)}:0`,
    });
    await expect(page.getByTestId("session-transcript")).toContainText(text, {
      timeout: 20_000,
    });
    await expect(
      page.getByText(labels.detail.transcript.newMessages),
    ).toHaveCount(0);
    await page.unrouteAll();
    // A deep link is a request to read one message, so it does not follow the tail.
    await page.goto(paths.session(id, 0));
    await expect(message(page, 0)).toHaveClass(/border-accent/);
    await expect(follow).toHaveAttribute("aria-checked", "false");
  }
});

// @req R-WEB-02 @req R-DASH-21 @req R-DASH-01
for (const theme of ["dark", "light"] as const)
  test(`the list and the session page fit the viewport without errors in ${theme}`, async ({
    page,
  }) => {
    const data = await fixture();
    await setTheme(page, theme);
    const errors = collectErrors(page);
    await page.goto(paths.sessions);
    await expect(
      page.getByRole("table", { name: labels.list.label }),
    ).toBeVisible();
    await settled(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await accessible(page);
    await page.getByTestId("sessions-add-filter").click();
    await expect(
      page.getByRole("dialog", { name: labels.filters.title }),
    ).toBeVisible();
    await accessible(page);
    await page.keyboard.press("Escape");

    await page.goto(paths.session(data.sessionId));
    await expect(message(page, 0)).toBeVisible();
    await settled(page);
    await page
      .getByTestId("session-header")
      .getByRole("button", { name: labels.detail.details, exact: true })
      .click();
    await expect(page.locator("#session-details")).toBeVisible();
    await switchNamed(page, labels.detail.transcript.expandTools).click();
    await switchNamed(page, labels.detail.transcript.expandThinking).click();
    const block = page.getByTestId(`session-subagent-${data.childSessionId}`);
    await block.getByRole("button", { expanded: false }).click();
    await expect(block).toContainText("The module exports one function");
    await settled(page);
    await accessible(page);
    await page.getByTestId("session-tab-files").click();
    await expect(
      page.getByLabel(labels.detail.files.label, { exact: true }),
    ).toBeVisible();
    await settled(page);
    await accessible(page);
    await page.getByTestId("session-tab-raw").click();
    const raw = page.getByLabel(labels.detail.raw.label, { exact: true });
    await expect(raw).toBeVisible();
    await raw
      .getByRole("listitem")
      .first()
      .getByRole("button", { expanded: false })
      .click();
    await settled(page);
    await accessible(page);
    expect(errors).toEqual([]);
  });
