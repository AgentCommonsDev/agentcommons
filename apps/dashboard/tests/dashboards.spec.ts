import { expect, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import {
  builtinDashboardId,
  dashboardSchema,
  type DashboardDefinition,
  type DashboardTile,
} from "@agentcommons/core/schemas/dashboards";
import {
  dashboardTileTemplates,
  standardDashboardVariables,
} from "@agentcommons/core/dashboards";
import { copy } from "../src/copy";
import { paths } from "../src/lib/routes";
import { workspaceOrigin } from "../playwright.shared";
import {
  accessible,
  activate,
  closeDialog,
  collectErrors,
  confirm,
  signInAsOwner,
  statNumber,
  statValue,
  test,
} from "./browser-test";

const text = copy.dashboards;
const template = (id: string) => {
  const found = dashboardTileTemplates.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown template ${id}`);
  return found;
};
const tile = (page: Page, id: string) =>
  page.getByTestId(`dashboard-tile-${id}`);
const textTile = (id: string, y: number, markdown: string): DashboardTile => ({
  id,
  type: "text",
  title: `Note ${id}`,
  layout: { x: 0, y, w: 12, h: 2 },
  markdown,
});
/** Saves a dashboard the way an agent would, through the REST route. */
async function createDashboard(
  page: Page,
  name: string,
  definition: DashboardDefinition,
  update?: { id: string; revision: number },
) {
  const response = await page.request.post("/api/v1/dashboards", {
    headers: { origin: workspaceOrigin },
    data: { ...update, name, description: "", definition },
  });
  expect(response.status(), await response.text()).toBe(200);
  return dashboardSchema.parse(await response.json());
}
async function deleteDashboard(page: Page, id: string) {
  const response = await page.request.delete(`/api/v1/dashboards/${id}`, {
    headers: { origin: workspaceOrigin },
    data: {},
  });
  expect(response.ok(), await response.text()).toBe(true);
}
const moreActions = (page: Page) =>
  page.getByRole("button", { name: text.header.more, exact: true });
async function pickAction(page: Page, isMobile: boolean, label: string) {
  await activate(moreActions(page), isMobile);
  const item = page
    .getByRole("menu")
    .getByRole("menuitem", { name: label, exact: true });
  await expect(item).toBeVisible();
  await activate(item, isMobile);
}
const pathId = (page: Page) =>
  z.uuid().parse(new URL(page.url()).pathname.split("/").at(-1));
async function top(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected a visible tile.");
  return box;
}

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

// @req R-DASH-16 @req R-DASH-15 @req R-DASH-18 @req R-DASH-25 @req R-WEB-02
test("Home renders the Team overview with its variables bar, stat numbers, chart canvases and table rows", async ({
  page,
  isMobile,
}) => {
  const errors = collectErrors(page);
  await page.goto(paths.home);
  await expect(page.getByTestId("dashboard-picker")).toHaveText(
    /Team overview/,
  );
  await expect(
    page.getByText(text.picker.builtin, { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(text.picker.default, { exact: true }).first(),
  ).toBeVisible();
  const bar = page.getByTestId("variables-bar");
  await expect(
    bar.getByRole("group", { name: "Time range", exact: true }),
  ).toBeVisible();
  await expect(
    bar.getByRole("button", {
      name: text.variables.presets["30d"],
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    bar.getByRole("button", { name: text.variables.all, exact: true }),
  ).toBeVisible();
  const captured = await statNumber(tile(page, "captured_sessions"));
  expect(captured).toBeGreaterThan(1);
  await statNumber(tile(page, "search_sessions"));
  await statNumber(tile(page, "reuse_sessions"));
  await expect(statValue(tile(page, "reuse_rate"))).toHaveText(/%$/);
  for (const id of ["sessions_per_day", "harness_share", "top_tools"])
    await expect(tile(page, id).locator("canvas")).toBeVisible({
      timeout: 20_000,
    });
  for (const id of ["top_repos", "most_reused"])
    await expect(tile(page, id).locator("tbody tr").first()).toBeVisible({
      timeout: 20_000,
    });
  await expect(tile(page, "top_repos")).toContainText(
    "github.com/rek7/agentcommons",
  );
  await expect(
    page.getByText(text.status.rendered, { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(text.status.noSessions, { exact: true }),
  ).toHaveCount(0);
  const first = await top(tile(page, "captured_sessions"));
  const second = await top(tile(page, "search_sessions"));
  if (isMobile) {
    expect(second.y).toBeGreaterThan(first.y + first.height - 1);
    expect(Math.round(first.x)).toBe(Math.round(second.x));
  } else expect(Math.round(first.y)).toBe(Math.round(second.y));
  await accessible(page);
  expect(errors).toEqual([]);
});

// @req R-DASH-25 @req R-DASH-16
test("changing the time range and repository updates the URL, re-renders and survives a reload", async ({
  page,
  isMobile,
}) => {
  await page.goto(paths.home);
  const bar = page.getByTestId("variables-bar");
  const captured = tile(page, "captured_sessions");
  expect(await statNumber(captured)).toBeGreaterThan(0);
  const render = () =>
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/dashboards/render" &&
        response.request().method() === "POST",
    );
  let rendered = render();
  await activate(
    bar.getByRole("button", {
      name: text.variables.presets["7d"],
      exact: true,
    }),
    isMobile,
  );
  expect(
    z
      .object({ variables: z.object({ time_range: z.literal("7d") }) })
      .parse((await rendered).request().postDataJSON()),
  ).toBeTruthy();
  await expect(page).toHaveURL(/[?&]time_range=7d(?:&|$)/);
  await expect(
    bar.getByRole("button", {
      name: text.variables.presets["7d"],
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  // Every seeded session is recent, so the narrower window still counts sessions.
  expect(await statNumber(captured)).toBeGreaterThan(0);
  rendered = render();
  await activate(
    bar.getByRole("button", { name: text.variables.all, exact: true }),
    isMobile,
  );
  const popover = page.getByRole("list", { name: "Repository", exact: true });
  await expect(popover).toBeVisible();
  const option = popover.getByRole("menuitemcheckbox").first();
  const repo = z
    .string()
    .parse(await option.locator("span.truncate").innerText());
  await activate(option, isMobile);
  const body = z
    .object({ variables: z.object({ repo: z.array(z.string()) }) })
    .parse((await rendered).request().postDataJSON());
  expect(body.variables.repo).toEqual([repo]);
  await expect(page).toHaveURL(
    new RegExp(
      `repo=${encodeURIComponent(repo).replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    ),
  );
  await page.keyboard.press("Escape");
  // The trigger names the single selection and carries a count badge.
  const repoTrigger = bar.getByRole("button").filter({ hasText: repo });
  await expect(repoTrigger).toBeVisible();
  await page.reload();
  await expect(
    bar.getByRole("button", {
      name: text.variables.presets["7d"],
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(repoTrigger).toBeVisible();
  expect(await statNumber(captured)).toBeGreaterThan(0);
  rendered = render();
  await activate(
    bar.getByRole("button", { name: text.variables.custom, exact: true }),
    isMobile,
  );
  await bar.getByLabel(text.variables.from, { exact: true }).fill("2020-01-01");
  await bar.getByLabel(text.variables.to, { exact: true }).fill("2020-01-31");
  await rendered;
  await expect(page).toHaveURL(/time_range_from=2020-01-01T00%3A00%3A00Z/);
  await expect(page).toHaveURL(/time_range_to=2020-02-01T00%3A00%3A00Z/);
  expect(await statNumber(captured)).toBe(0);
});

// @req R-DASH-25 @req R-DASH-16 @req R-WEB-02
test("the picker lists every dashboard, marks the default and the built-in stays read-only", async ({
  page,
  isMobile,
}) => {
  const extra = await createDashboard(page, `Picker ${String(Date.now())}`, {
    version: 2,
    variables: [...standardDashboardVariables],
    tiles: [textTile("note", 0, "Picker note")],
  });
  try {
    await page.goto(paths.home);
    // Creating lives once, as the header action; the picker only switches dashboards.
    // Checked before the picker opens, since an open menu hides the rest of the page.
    await expect(
      page.getByRole("link", { name: text.picker.newDashboard, exact: true }),
    ).toHaveAttribute("href", paths.dashboardNew);
    await activate(page.getByTestId("dashboard-picker"), isMobile);
    const menu = page.getByRole("menu");
    const builtin = menu.locator(`[data-dashboard-id="${builtinDashboardId}"]`);
    await expect(builtin).toContainText(text.picker.builtin);
    await expect(builtin).toContainText(text.picker.default);
    await expect(builtin).toContainText(`10 ${text.picker.tiles}`);
    const created = menu.locator(`[data-dashboard-id="${extra.id}"]`);
    await expect(created).toContainText(extra.name);
    await expect(created).not.toContainText(text.picker.default);
    await expect(
      menu.getByRole("menuitem", { name: text.picker.newDashboard }),
    ).toHaveCount(0);
    await activate(created, isMobile);
    await expect(page).toHaveURL(new RegExp(`${paths.dashboard(extra.id)}$`));
    await expect(page.getByTestId("dashboard-picker")).toHaveText(extra.name);
    await expect(
      page.getByText(`${text.header.createdBy} `, { exact: false }),
    ).toBeVisible();
    await expect(tile(page, "note")).toContainText("Picker note");
    await expect(page.getByTestId("variables-bar")).toBeVisible();
    // A built-in cannot be edited, so Duplicate stands where Edit would be.
    await page.goto(paths.dashboard(builtinDashboardId));
    await expect(page.getByTestId("dashboard-edit")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-duplicate")).toHaveAttribute(
      "href",
      `${paths.dashboardNew}?from=${builtinDashboardId}`,
    );
    await page.goto(paths.dashboardEdit(builtinDashboardId));
    await expect(
      page.getByText(text.header.editBuiltin, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: copy.app.common.duplicate, exact: true }),
    ).toHaveAttribute(
      "href",
      `${paths.dashboardNew}?from=${builtinDashboardId}`,
    );
    await accessible(page);
  } finally {
    await deleteDashboard(page, extra.id);
  }
});

// @req R-DASH-25 @req R-WEB-02
test("a member creates a dashboard from Blank with template, text and control tiles, previews SQL in the inspector, saves and reloads it", async ({
  page,
  isMobile,
}, info) => {
  const errors = collectErrors(page);
  const name = `Browser board ${info.project.name} ${String(Date.now())}`;
  await page.goto(paths.dashboardNew);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    text.newPage.title,
  );
  await activate(page.getByTestId("dashboard-start-blank"), isMobile);
  const editor = page.getByTestId("dashboard-editor");
  await expect(editor).toBeVisible();
  await expect(page.getByTestId("dashboard-name")).toHaveValue(
    text.editor.newTitle,
  );
  await expect(
    page.getByText(text.editor.noTiles, { exact: true }),
  ).toBeVisible();
  await page.getByTestId("dashboard-name").fill(name);
  for (const id of ["captured_sessions", "note", "time_range_control"]) {
    await activate(page.getByTestId("tile-add"), isMobile);
    const dialog = page.getByTestId("tile-add-dialog");
    await expect(dialog).toBeVisible();
    await activate(
      dialog.locator(`[data-template="${template(id).title}"]`),
      isMobile,
    );
    await expect(dialog).toHaveCount(0);
    await expect(tile(page, id)).toBeVisible();
  }
  await expect(editor).toHaveAttribute("data-dirty", "true");
  expect(await statNumber(tile(page, "captured_sessions"))).toBeGreaterThan(0);
  const note = template("note").tile;
  if (note.type !== "text")
    throw new Error("Expected the note template to be a text tile.");
  await expect(tile(page, "note")).toContainText(note.markdown);
  await expect(
    tile(page, "time_range_control").getByRole("button", {
      name: text.variables.presets["30d"],
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await activate(
    tile(page, "captured_sessions").getByRole("button", {
      name: text.tiles.edit,
      exact: true,
    }),
    isMobile,
  );
  const inspector = page.getByTestId("tile-inspector");
  await expect(inspector).toBeVisible();
  await expect(inspector.getByTestId("tile-sql")).toHaveValue(
    /SELECT count\(\) AS value FROM sessions/,
  );
  await activate(inspector.getByTestId("tile-preview"), isMobile);
  await expect(
    inspector.getByRole("columnheader", { name: /^value/ }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    inspector.getByText(new RegExp(`1 ${text.inspector.previewRows}`)),
  ).toBeVisible();
  await activate(
    inspector.getByRole("tab", {
      name: text.inspector.tabs.visual,
      exact: true,
    }),
    isMobile,
  );
  await expect(
    inspector.getByRole("combobox", {
      name: text.inspector.valueColumn,
      exact: true,
    }),
  ).toContainText("value");
  await inspector
    .getByLabel(text.inspector.tileTitle, { exact: true })
    .fill("Sessions in range");
  await activate(
    inspector.getByRole("tab", {
      name: text.inspector.tabs.advanced,
      exact: true,
    }),
    isMobile,
  );
  const json = inspector.getByTestId("tile-json");
  await expect(json).toHaveValue(/"title": "Sessions in range"/);
  await expect(
    inspector.getByText(text.inspector.jsonValid, { exact: true }),
  ).toBeVisible();
  await json.fill("{ not json");
  await expect(inspector.getByRole("alert")).toBeVisible();
  await json.fill(
    JSON.stringify({
      id: "captured_sessions",
      type: "stat",
      title: "Sessions in range",
      layout: { x: 0, y: 0, w: 3, h: 2 },
      sql: "SELECT count() AS value FROM sessions",
      unit: "tokens",
    }),
  );
  await expect(
    inspector.getByText(text.inspector.jsonValid, { exact: true }),
  ).toBeVisible();
  await closeDialog(page);
  await expect(inspector).toHaveCount(0);
  await expect(tile(page, "captured_sessions")).toContainText(
    "Sessions in range",
  );
  await activate(page.getByTestId("dashboard-save"), isMobile);
  await expect(page).toHaveURL(/\/app\/dashboards\/[0-9a-f-]{36}$/, {
    timeout: 20_000,
  });
  const id = pathId(page);
  try {
    await expect(page.getByTestId("dashboard-picker")).toHaveText(name);
    await expect(tile(page, "captured_sessions")).toContainText(
      "Sessions in range",
    );
    expect(await statNumber(tile(page, "captured_sessions"))).toBeGreaterThan(
      0,
    );
    await page.reload();
    await expect(page.getByTestId("dashboard-picker")).toHaveText(name);
    await expect(tile(page, "note")).toBeVisible();
    await expect(
      tile(page, "time_range_control").getByRole("button", {
        name: text.variables.presets["30d"],
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    const saved = dashboardSchema.parse(
      await (await page.request.get(`/api/v1/dashboards/${id}`)).json(),
    );
    expect(saved.name).toBe(name);
    expect(saved.definition.tiles.map((entry) => entry.id).sort()).toEqual([
      "captured_sessions",
      "note",
      "time_range_control",
    ]);
    await accessible(page);
    expect(errors).toEqual([]);
  } finally {
    await deleteDashboard(page, id);
  }
});

// @req R-DASH-25
test("saving over a newer server revision shows the conflict alert and reload picks up the server version", async ({
  page,
  isMobile,
}) => {
  const definition: DashboardDefinition = {
    version: 2,
    variables: [...standardDashboardVariables],
    tiles: [textTile("note", 0, "Conflict note")],
  };
  const created = await createDashboard(
    page,
    `Conflict ${String(Date.now())}`,
    definition,
  );
  try {
    await page.goto(paths.dashboardEdit(created.id));
    const nameInput = page.getByTestId("dashboard-name");
    await expect(nameInput).toHaveValue(created.name);
    await nameInput.fill(`${created.name} browser`);
    const server = await createDashboard(
      page,
      `${created.name} server`,
      definition,
      {
        id: created.id,
        revision: created.revision,
      },
    );
    expect(server.revision).toBeGreaterThan(created.revision);
    await activate(page.getByTestId("dashboard-save"), isMobile);
    const alert = page
      .getByRole("status")
      .filter({ hasText: text.editor.conflictTitle });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(text.editor.conflictHint);
    await expect(page).toHaveURL(
      new RegExp(`${paths.dashboardEdit(created.id)}$`),
    );
    await activate(
      alert.getByRole("button", { name: text.editor.reload, exact: true }),
      isMobile,
    );
    await expect(page.getByTestId("dashboard-name")).toHaveValue(server.name);
    await expect(page.getByTestId("dashboard-editor")).toHaveAttribute(
      "data-dirty",
      "false",
    );
  } finally {
    await deleteDashboard(page, created.id);
  }
});

// @req R-DASH-25 @req R-DASH-16
test("an admin duplicates the built-in from its header, saves the copy, sees Home keep Team overview and deletes the copy", async ({
  page,
  isMobile,
}) => {
  await page.goto(paths.home);
  // The built-in offers Duplicate in Edit's place; the More menu does not repeat it.
  await activate(page.getByTestId("dashboard-duplicate"), isMobile);
  await expect(page).toHaveURL(
    new RegExp(`${paths.dashboardNew}\\?from=${builtinDashboardId}$`),
  );
  await expect(page.getByTestId("dashboard-name")).toHaveValue(
    `${text.editor.copyPrefix}Team overview`,
  );
  await expect(page.locator("[data-testid^='dashboard-tile-']")).toHaveCount(
    10,
  );
  await activate(page.getByTestId("dashboard-save"), isMobile);
  await expect(page).toHaveURL(/\/app\/dashboards\/[0-9a-f-]{36}$/, {
    timeout: 20_000,
  });
  const id = pathId(page);
  const picker = page.getByTestId("dashboard-picker");
  await expect(picker).toHaveText(`${text.editor.copyPrefix}Team overview`);
  await expect(page.getByTestId("dashboard-edit")).toHaveAttribute(
    "href",
    paths.dashboardEdit(id),
  );
  await expect(page.getByTestId("dashboard-duplicate")).toHaveCount(0);
  // Saving a copy never changes Home; the Home default is chosen on Settings alone.
  await expect(
    page.getByText(text.picker.default, { exact: true }),
  ).toHaveCount(0);
  await activate(moreActions(page), isMobile);
  const more = page.getByRole("menu");
  await expect(
    more.getByRole("menuitem", { name: copy.app.common.duplicate }),
  ).toHaveAttribute("href", `${paths.dashboardNew}?from=${id}`);
  await expect(more.getByRole("menuitem")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await page.goto(paths.home);
  await expect(picker).toHaveText("Team overview");
  expect(
    z
      .object({ default_id: z.string() })
      .parse(await (await page.request.get("/api/v1/dashboards")).json())
      .default_id,
  ).toBe(builtinDashboardId);
  await page.goto(paths.dashboard(id));
  await expect(picker).toHaveText(`${text.editor.copyPrefix}Team overview`);
  await pickAction(page, isMobile, copy.app.common.delete);
  await expect(page.getByRole("dialog")).toContainText(text.header.deleteTitle);
  await confirm(page, copy.app.common.delete, null);
  await expect(page).toHaveURL(new RegExp(`${paths.home}$`));
  expect((await page.request.get(`/api/v1/dashboards/${id}`)).status()).toBe(
    404,
  );
  await page.goto(paths.dashboard(id));
  await expect(page.getByText(text.notFound, { exact: true })).toBeVisible();
});

// @req R-DASH-25 @req R-WEB-02
test("the dashboard JSON dialog validates imports, exports the definition and the editor refuses an invalid save", async ({
  page,
  isMobile,
}) => {
  await page.goto(paths.dashboardNew);
  await activate(page.getByTestId("dashboard-start-blank"), isMobile);
  await page.getByTestId("dashboard-name").fill("");
  await activate(page.getByTestId("dashboard-save"), isMobile);
  const invalid = page
    .getByRole("alert")
    .filter({ hasText: text.editor.invalidTitle });
  await expect(invalid).toBeVisible();
  await expect(invalid.locator("li")).not.toHaveCount(0);
  await activate(page.getByTestId("dashboard-settings-open"), isMobile);
  const settings = page.getByTestId("dashboard-settings");
  await expect(settings).toBeVisible();
  const json = settings.getByTestId("dashboard-json");
  await expect(json).toHaveValue(/"version": 2/);
  await expect(json).toHaveValue(/"time_range"/);
  await expect(
    settings.getByRole("button", { name: copy.app.common.copy, exact: true }),
  ).toBeVisible();
  const apply = settings.getByRole("button", {
    name: text.settings.applyJson,
    exact: true,
  });
  await expect(apply).toBeDisabled();
  await json.fill("{");
  await activate(apply, isMobile);
  await expect(settings.getByRole("alert")).toBeVisible();
  await json.fill(
    JSON.stringify({
      version: 2,
      variables: [],
      tiles: [
        {
          id: "bad",
          type: "control",
          title: "Bad",
          layout: { x: 0, y: 0, w: 3, h: 1 },
          variable: "missing",
        },
      ],
    }),
  );
  await activate(apply, isMobile);
  await expect(settings.getByRole("alert")).toContainText("declared variable");
  const imported: DashboardDefinition = {
    version: 2,
    variables: [...standardDashboardVariables],
    tiles: [textTile("imported", 0, "Imported through JSON")],
  };
  await json.fill(JSON.stringify(imported, null, 2));
  await activate(apply, isMobile);
  await expect(
    settings.getByRole("status").filter({ hasText: text.settings.jsonApplied }),
  ).toBeVisible();
  await expect(settings.getByRole("alert")).toHaveCount(0);
  await activate(
    settings.getByRole("button", {
      name: text.settings.addVariable,
      exact: true,
    }),
    isMobile,
  );
  await expect(
    settings.getByRole("combobox", {
      name: text.settings.variableType,
      exact: true,
    }),
  ).toHaveCount(3);
  await activate(
    settings
      .getByRole("button", { name: text.settings.removeVariable, exact: true })
      .last(),
    isMobile,
  );
  await expect(
    settings.getByRole("combobox", {
      name: text.settings.variableType,
      exact: true,
    }),
  ).toHaveCount(2);
  await closeDialog(page);
  await expect(settings).toHaveCount(0);
  await expect(tile(page, "imported")).toContainText("Imported through JSON");
  await accessible(page);
  await activate(page.getByTestId("dashboard-cancel"), isMobile);
  await expect(page.getByRole("dialog")).toContainText(
    text.editor.discardTitle,
  );
  await confirm(page, text.editor.discard, null);
  await expect(page).toHaveURL(new RegExp(`${paths.home}$`));
});

// @req R-DASH-25 @req R-WEB-02 @req R-DASH-21
test("on a phone the editor stacks tiles, opens the inspector as a bottom sheet and reorders with move up and down", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Phone layout only");
  const created = await createDashboard(page, `Stacked ${String(Date.now())}`, {
    version: 2,
    variables: [...standardDashboardVariables],
    tiles: [
      textTile("first", 0, "First"),
      textTile("second", 2, "Second"),
      textTile("third", 4, "Third"),
    ],
  });
  try {
    await page.goto(paths.dashboardEdit(created.id));
    await expect(
      page.getByText(text.editor.smallScreen, { exact: true }),
    ).toBeVisible();
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("Expected a viewport.");
    const order = async () => {
      const boxes = await Promise.all(
        ["first", "second", "third"].map(async (id) => ({
          id,
          box: await top(tile(page, id)),
        })),
      );
      for (const { box } of boxes) {
        expect(box.width).toBeGreaterThan(viewport.width * 0.8);
        expect(box.x).toBeGreaterThanOrEqual(0);
      }
      return boxes.sort((a, b) => a.box.y - b.box.y).map((entry) => entry.id);
    };
    expect(await order()).toEqual(["first", "second", "third"]);
    await tile(page, "first")
      .getByRole("button", { name: text.tiles.actions, exact: true })
      .tap();
    await expect(
      page.getByRole("menuitem", { name: text.tiles.moveUp, exact: true }),
    ).toHaveAttribute("aria-disabled", "true");
    await page
      .getByRole("menuitem", { name: text.tiles.moveDown, exact: true })
      .tap();
    expect(await order()).toEqual(["second", "first", "third"]);
    await tile(page, "third")
      .getByRole("button", { name: text.tiles.actions, exact: true })
      .tap();
    await page
      .getByRole("menuitem", { name: text.tiles.moveUp, exact: true })
      .tap();
    expect(await order()).toEqual(["second", "third", "first"]);
    await tile(page, "second")
      .getByRole("button", { name: text.tiles.edit, exact: true })
      .tap();
    const inspector = page.getByTestId("tile-inspector");
    await expect(inspector).toBeVisible();
    const sheet = await top(inspector);
    expect(Math.round(sheet.y + sheet.height)).toBe(viewport.height);
    expect(Math.round(sheet.width)).toBe(viewport.width);
    expect(sheet.height).toBeLessThan(viewport.height);
    await inspector
      .getByLabel(text.inspector.markdown, { exact: true })
      .fill("Second, edited");
    await closeDialog(page);
    await expect(inspector).toHaveCount(0);
    await expect(tile(page, "second")).toContainText("Second, edited");
    await accessible(page);
    await page.getByTestId("dashboard-save").tap();
    await expect(page).toHaveURL(
      new RegExp(`${paths.dashboard(created.id)}$`),
      { timeout: 20_000 },
    );
    const saved = dashboardSchema.parse(
      await (await page.request.get(`/api/v1/dashboards/${created.id}`)).json(),
    );
    expect(
      [...saved.definition.tiles]
        .sort((a, b) => a.layout.y - b.layout.y)
        .map((entry) => entry.id),
    ).toEqual(["second", "third", "first"]);
  } finally {
    await deleteDashboard(page, created.id);
  }
});
