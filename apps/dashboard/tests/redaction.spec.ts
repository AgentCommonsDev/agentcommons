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
  signInAsOwner,
  tableRow,
  test,
} from "./browser-test";
import { waitForSession } from "./trace-controls";

const text = copy.admin.redactionActivity;
const admin = { origin: workspaceOrigin };
const accepted = z.object({ sessionId: z.uuid() });
const created = z.object({ id: z.uuid() });
const job = z.object({ job_id: z.string() });
const progress = z.object({ state: z.string() });

/** One captured session with one user message per line, in order; returns its id once it is readable. */
async function capture(
  request: APIRequestContext,
  state: Awaited<ReturnType<typeof fixture>>,
  lines: readonly string[],
) {
  const envelope = ingestEnvelopeSchema.parse({
    ...state.liveEnvelope,
    harnessSessionId: randomUUID(),
    batchId: randomUUID(),
    sentAt: new Date().toISOString(),
    // The observed position covers the last record of the batch.
    sourcePos: lines.length - 1,
    records: lines.map((line, pos) => ({
      pos,
      sourceVersion: 0,
      key: randomUUID(),
      line: JSON.stringify({
        type: "user",
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
        message: { content: [{ type: "text", text: line }] },
      }),
    })),
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
/** The redacted message of `sessionId` as the session page shows it, once its hit row exists. */
async function messageRedacted(page: Page, sessionId: string, name: string) {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/v1/sessions/${sessionId}`,
        );
        const body = z
          .object({
            messages: z.array(z.object({ content: z.string() })),
          })
          .parse(await response.json());
        return body.messages[0]?.content ?? "";
      },
      { timeout: 60_000 },
    )
    .toContain(`[REDACTED:${name}]`);
}

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

// @req R-RED-09 @req R-RED-10 @req R-DASH-03 @req R-DASH-05 @req R-WEB-02
test("Redaction activity: counts, rescan runs with the sessions they changed, and message links that open the redacted message", async ({
  page,
  request,
}, info) => {
  test.setTimeout(240_000);
  const state = await fixture();
  const stamp = `${info.project.name}${String(Date.now())}`.replace(
    /[^a-z0-9]/gi,
    "",
  );
  const name = `canary-${stamp}`.slice(0, 64);
  // A session stored before the policy exists: only a rescan can redact it.
  const before = await capture(request, state, [
    `Stored earlier with CANARY_${stamp}_ONE inside.`,
  ]);
  const policy = await page.request.post("/api/v1/admin/redaction/policies", {
    headers: admin,
    data: {
      name,
      kind: "REGEX",
      pattern: `CANARY_${stamp}_[A-Z]+`,
      flags: "g",
      enabled: true,
    },
  });
  expect(policy.status(), await policy.text()).toBe(200);
  const policyId = created.parse(await policy.json()).id;
  try {
    const rescan = await page.request.post("/api/v1/admin/redaction/rescan", {
      headers: admin,
      data: { reason: "Browser redaction ledger check" },
    });
    expect(rescan.status(), await rescan.text()).toBe(200);
    const runId = job.parse(await rescan.json()).job_id;
    await expect
      .poll(
        async () =>
          progress.parse(
            await (
              await page.request.get(`/api/v1/admin/redaction/rescan/${runId}`)
            ).json(),
          ).state,
        { timeout: 150_000 },
      )
      .toBe("completed");
    await messageRedacted(page, before, name);
    // A session captured after the policy exists is redacted at capture.
    const after = await capture(request, state, [
      `Captured later with CANARY_${stamp}_TWO inside.`,
    ]);
    await messageRedacted(page, after, name);

    await page.goto(paths.admin.redaction);
    const summary = page.getByTestId("admin-redaction-summary");
    await expect(
      summary.getByRole("heading", { name: text.title, exact: true }),
    ).toBeVisible();
    // The total counts both sessions' redactions (the stat label, not the table header).
    const totalTile = summary
      .getByRole("paragraph")
      .filter({ hasText: new RegExp(`^${text.total}$`) })
      .locator("..");
    await expect(totalTile).toContainText(
      copy.admin.redactionActivity.sessionMany,
    );
    // The policy's row in the per-policy table counts both sessions.
    const policyRow = tableRow(
      page.getByTestId("admin-redaction-by-policy"),
      name,
    );
    await expect(policyRow).toBeVisible();
    await expect(policyRow).toContainText("2");
    // The run row lists one changed session; selecting it lists that session.
    const runs = page.getByTestId("admin-redaction-runs");
    const runRow = runs
      .locator("tbody tr")
      .filter({ hasText: copy.app.statuses.completed })
      .first();
    await expect(runRow).toBeVisible();
    await runRow.click();
    const details = page.getByTestId("admin-redaction-run-sessions");
    await expect(details).toBeVisible();
    const sessionRow = tableRow(details, before);
    await expect(sessionRow).toBeVisible();
    await sessionRow
      .getByRole("button", { name: text.showMessages, exact: true })
      .click();
    const messageLink = sessionRow.getByRole("link", {
      name: text.message(0),
      exact: true,
    });
    await expect(messageLink).toBeVisible();
    await expect(sessionRow).toContainText(name);
    // Recent redactions show the capture-time hit on the later session with its source.
    const hits = page.getByTestId("admin-redaction-hits");
    const captureRow = tableRow(hits, after);
    await expect(captureRow).toBeVisible();
    await expect(captureRow).toContainText(text.sources.capture);
    await expect(
      captureRow.getByRole("link", { name: text.message(0), exact: true }),
    ).toBeVisible();
    // The rescanned session has a message row and a metadata row (title, first prompt).
    await expect(tableRow(hits, before).first()).toContainText(
      text.sources.rescan,
    );
    await expectNoHorizontalOverflow(page);
    await accessible(page);
    // The message link opens the session at the redacted message.
    await messageLink.click();
    await expect(page).toHaveURL(new RegExp(`/app/sessions/${before}#0$`));
    const message = page.locator('[id="0"]');
    await expect(message).toBeVisible();
    await expect(message).toContainText(`[REDACTED:${name}]`);
    await expect(message).not.toContainText(`CANARY_${stamp}`);
    // Admin → Status shows the host updater tile (no report in this fixture).
    await page.goto(paths.admin.status);
    const snapshot = page.getByTestId("admin-status-snapshot");
    await expect(
      snapshot.getByText(copy.admin.status.updater, { exact: true }),
    ).toBeVisible();
    await expect(snapshot).toContainText(copy.admin.status.updaterNone);
  } finally {
    // Leaves the fixture as found: the counters and hits go with the policy.
    const removed = await page.request.delete(
      `/api/v1/admin/redaction/policies/${policyId}`,
      { headers: admin, data: { reason: "Browser redaction ledger cleanup" } },
    );
    expect(removed.status(), await removed.text()).toBe(200);
  }
});

// @req R-RED-11 @req R-DASH-05 @req R-WEB-02
test("Recent redactions: the policy chip and name search narrow the ledger, the URL carries the filters and the list pages", async ({
  page,
  request,
}, info) => {
  test.setTimeout(240_000);
  const state = await fixture();
  const stamp = `${info.project.name}${String(Date.now())}`.replace(
    /[^a-z0-9]/gi,
    "",
  );
  const name = `pager-${stamp}`.slice(0, 64);
  const policy = await page.request.post("/api/v1/admin/redaction/policies", {
    headers: admin,
    data: {
      name,
      kind: "REGEX",
      pattern: `PAGER_${stamp}_[0-9]+`,
      flags: "g",
      enabled: true,
    },
  });
  expect(policy.status(), await policy.text()).toBe(200);
  const policyId = created.parse(await policy.json()).id;
  try {
    // One session with 51 redacted messages: one ledger row each, one more than a page.
    const sessionId = await capture(
      request,
      state,
      Array.from(
        { length: 51 },
        (_, seq) =>
          `Message ${String(seq)} carries PAGER_${stamp}_${String(seq)}.`,
      ),
    );
    await messageRedacted(page, sessionId, name);

    await page.goto(paths.admin.redaction);
    const hits = page.getByTestId("admin-redaction-hits");
    const rows = hits.locator("tbody tr");
    await applyFilters(page, text.filterLabel, async (scope) => {
      await scope
        .getByRole("combobox", { name: text.policy, exact: true })
        .selectOption({ label: name });
      await scope
        .getByRole("searchbox", { name: text.filterQuery, exact: true })
        .fill("PAGER");
    });
    // The filters are the URL, so the filtered ledger is a link.
    await expect(page).toHaveURL(new RegExp(`policy_id=${policyId}`));
    await expect(page).toHaveURL(/q=PAGER/);
    await expect(rows).toHaveCount(50);
    await expect(rows.first()).toContainText(name);
    await expect(rows.first()).toContainText(sessionId);
    const next = hits.getByRole("button", {
      name: copy.app.common.next,
      exact: true,
    });
    const previous = hits.getByRole("button", {
      name: copy.app.common.previous,
      exact: true,
    });
    await expect(next).toBeEnabled();
    await next.click();
    await expect(rows).toHaveCount(1);
    await expect(next).toBeDisabled();
    await expect(previous).toBeEnabled();
    await previous.click();
    await expect(rows).toHaveCount(50);
    // Reopening the link restores the filtered view.
    await page.reload();
    await expect(rows).toHaveCount(50);
    await expect(rows.first()).toContainText(name);
    await expectNoHorizontalOverflow(page);
    // Clearing the filters takes them out of the URL.
    await hits
      .getByRole("button", { name: copy.app.common.clear, exact: true })
      .first()
      .click();
    await expect(page).not.toHaveURL(/policy_id=/);
  } finally {
    const removed = await page.request.delete(
      `/api/v1/admin/redaction/policies/${policyId}`,
      { headers: admin, data: { reason: "Browser redaction paging cleanup" } },
    );
    expect(removed.status(), await removed.text()).toBe(200);
  }
});
