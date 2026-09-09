import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { organizationEmbeddingsOutputSchema } from "@agentcommons/core/schemas";
import { copy } from "../src/copy";
import { paths } from "../src/lib/routes";
import { workspaceOrigin, workspaceStatePath } from "../playwright.shared";
import { accessible, confirm, cookieSchema, test } from "./browser-test";

// The fixture provisions one organization purely for embedding control: one indexed
// session, its own owner, and no other spec toggles its setting.
const embeddingStateSchema = z.object({
  embeddings: z.object({
    organizationId: z.string().min(1),
    storageState: z.object({
      cookies: z.array(cookieSchema),
      origins: z.array(z.unknown()),
    }),
  }),
});
const sessionsSchema = z.object({
  items: z.array(z.object({ session_id: z.uuid() })),
});
const text = copy.settings.embeddings;
// The explorer shows each table function as its full signature, e.g. similar_sessions(source=UUID, max_rows=UInt32).
const similarQuery = (sessionId: string) =>
  `SELECT * FROM similar_sessions(source='${sessionId}', max_rows=5)`;
async function setting(page: Page) {
  return organizationEmbeddingsOutputSchema.parse(
    await (await page.request.get("/api/v1/organization/embeddings")).json(),
  );
}
async function typeQuery(page: Page, sql: string) {
  const editor = page.getByTestId("sql-editor").locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(sql);
}

// @req R-EMB-04 @req R-EMB-06
test("Embeddings: SQL, session and settings surfaces follow the organization toggle and explain what is off", async ({
  browser,
  isMobile,
}) => {
  const state = embeddingStateSchema.parse(
    JSON.parse(await readFile(workspaceStatePath, "utf8")),
  );
  const suffix = Array.from({ length: 6 }, (_, index) =>
    randomBytes(12)
      .readUInt16BE(index * 2)
      .toString(16),
  ).join(":");
  const context = await browser.newContext({
    baseURL: workspaceOrigin,
    extraHTTPHeaders: { "x-forwarded-for": `2001:db8:${suffix}` },
  });
  await context.addCookies(state.embeddings.storageState.cookies);
  const page = await context.newPage();
  try {
    const sessionId = sessionsSchema.parse(
      await (await page.request.get("/api/v1/sessions?limit=1")).json(),
    ).items[0]?.session_id;
    if (!sessionId) throw new Error("Expected the embedding control session.");
    expect(await setting(page)).toMatchObject({
      enabled: false,
      available: true,
      effective: false,
    });

    // Off: the SQL page names the capability and who can turn it on, before and after running.
    await page.goto(paths.sql);
    await expect(page.getByTestId("sql-editor")).toBeVisible();
    if (!isMobile)
      await expect(
        page.getByTestId("sql-explorer").getByText(/^similar_sessions\(/),
      ).toHaveCount(0);
    await typeQuery(page, similarQuery(sessionId));
    const status = page.getByTestId("sql-status");
    await expect(status).toContainText(copy.sql.status.unavailable);
    await expect(status).toContainText(
      "similar_sessions needs embeddings, which are not enabled for this organization.",
    );
    await page.getByTestId("sql-run").click();
    await expect(status).toContainText(copy.sql.status.queryError);
    await expect(status).toContainText(
      "similar_sessions needs embeddings, which are turned off for this organization. An organization admin can turn them on under Settings.",
    );
    await accessible(page);

    // Off: the session page has no similarity panel.
    await page.goto(paths.session(sessionId));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: copy.sessions.detail.similar.title,
        exact: true,
      }),
    ).toHaveCount(0);

    // Settings: the toggle is live because a provider exists, and turning it on queues indexing.
    await page.goto(paths.admin.settings);
    const card = page.getByTestId("settings-embeddings");
    const toggle = card.getByRole("switch", { name: text.toggle, exact: true });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle).toBeEnabled();
    await expect(card).toContainText(text.disabledHint);
    await expect(card.getByText(text.fake, { exact: true })).toBeVisible();
    await toggle.click();
    await expect(page.getByRole("dialog")).toContainText(text.enableTitle);
    await confirm(
      page,
      text.enable,
      "Enable embeddings for the browser embedding check",
    );
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(card).toContainText(text.enabledHint);
    await expect
      .poll(async () => (await setting(page)).sessions_pending, {
        timeout: 60_000,
      })
      .toBe(0);
    expect(await setting(page)).toMatchObject({
      enabled: true,
      effective: true,
    });

    // On: discovery lists similar_sessions and the same query runs.
    await page.goto(paths.sql);
    await expect(page.getByTestId("sql-editor")).toBeVisible();
    if (!isMobile)
      await expect(
        page.getByTestId("sql-explorer").getByText(/^similar_sessions\(/),
      ).toBeVisible();
    await typeQuery(page, similarQuery(sessionId));
    await expect(status).toContainText(copy.sql.status.ready);
    await page.getByTestId("sql-run").click();
    await expect(status).toContainText(copy.sql.status.ranIn);

    // On: the session page shows the similarity panel; one indexed session has no neighbours yet.
    await page.goto(paths.session(sessionId));
    await expect(
      page.getByRole("heading", {
        name: copy.sessions.detail.similar.title,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(copy.sessions.detail.similar.empty, { exact: true }),
    ).toBeVisible();
    await accessible(page);
  } finally {
    // Leave the control organization off for the next project run.
    const current = await setting(page);
    if (current.enabled)
      await page.request.patch("/api/v1/organization/embeddings", {
        headers: { origin: workspaceOrigin },
        data: { enabled: false, reason: "Reset the browser embedding check" },
      });
    await context.close();
  }
});
