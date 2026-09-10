// @req R-DASH-40
import { describe, expect, it } from "vitest";
import {
  ageInWords,
  formatDashboard,
  formatDashboardList,
  formatDashboardRender,
} from "./index.js";
import {
  dashboardListOutputSchema,
  dashboardRenderOutputSchema,
  dashboardSchema,
} from "../schemas/dashboards.js";
import {
  dashboardTileTemplates,
  teamOverviewDashboard,
} from "../dashboards/index.js";

const now = new Date("2026-09-10T05:39:12.000Z");
const summary = {
  id: teamOverviewDashboard.id,
  organization_id: "org-a",
  name: "Team overview",
  description: "Captured sessions, search adoption and reuse",
  revision: 0,
  builtin: true,
  is_default: true,
  can_edit: false,
  created_by: null,
  tile_count: teamOverviewDashboard.definition.tiles.length,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};
const saved = {
  ...summary,
  id: "0192a3f0-7c1e-7d1a-9b0e-3f2a1c9d4e55",
  name: "Release | health",
  description: "",
  revision: 3,
  builtin: false,
  is_default: false,
  can_edit: true,
  created_by: { user_id: "u1", email: "person@example.com", name: "Person" },
  tile_count: 2,
  updated_at: "2026-09-09T12:00:00.000Z",
};

describe("dashboard tool text renderings", () => {
  it("lists dashboards one per line with flags and template ids, without definitions or the schema", () => {
    const result = dashboardListOutputSchema.parse({
      items: [summary, saved],
      default_id: summary.id,
      definition_schema: { type: "object", properties: { tiles: {} } },
      templates: dashboardTileTemplates,
    });
    const { text, structuredContent } = formatDashboardList(result);
    const lines = text.split("\n");
    expect(lines[0]).toBe(`2 dashboards | default_id: ${summary.id}`);
    expect(lines[1]).toBe(
      "id | name | tiles | flags | updated_at | description",
    );
    expect(lines[2]).toBe(
      `${summary.id} | Team overview | ${String(summary.tile_count)} | default,built-in | 2026-01-01T00:00:00.000Z | Captured sessions, search adoption and reuse`,
    );
    // Pipes inside a cell are escaped so the row stays parseable.
    expect(lines[3]).toBe(
      `${saved.id} | Release \\| health | 2 | editable | 2026-09-09T12:00:00.000Z | `,
    );
    expect(text).toContain(
      `${String(dashboardTileTemplates.length)} tile templates for dashboard_save (id: title): captured_sessions: `,
    );
    expect(text).toContain("structuredContent.definition_schema");
    expect(text).not.toContain('"sql"');
    expect(text).not.toContain('"properties"');
    expect(text.length).toBeLessThan(4000);
    expect(structuredContent).toBe(result);
  });

  it("renders one dashboard as header facts, variable and tile tables and each tile's SQL once", () => {
    const result = dashboardSchema.parse({
      ...summary,
      definition: teamOverviewDashboard.definition,
    });
    const { text } = formatDashboard(result);
    expect(
      text.startsWith(`id: ${summary.id} | name: Team overview | revision: 0`),
    ).toBe(true);
    expect(text).toContain(
      "builtin: true | is_default: true | can_edit: false",
    );
    expect(text).toContain(
      "created_by: null | created_at: 2026-01-01T00:00:00.000Z",
    );
    expect(text).toContain("name | type | label | default");
    expect(text).toContain("id | type | title | layout | details");
    for (const tile of teamOverviewDashboard.definition.tiles) {
      expect(text).toContain(`${tile.id} | ${tile.type} | `);
      if ("sql" in tile) {
        expect(text.split(`sql ${tile.id}:\n`)).toHaveLength(2);
        expect(text).toContain(tile.sql);
      }
    }
    // Chart options stay in structuredContent: no ECharts keys in the text.
    expect(text).not.toContain('"encode"');
    expect(text).toContain("x0 y0 w");
  });

  it("states the render age in words, the cache status and how to refresh, then each tile's rows", () => {
    const result = dashboardRenderOutputSchema.parse({
      tiles: [
        {
          id: "captured_sessions",
          result: {
            columns: [{ name: "value", type: "UInt64" }],
            rows: [["0"]],
            row_count: 1,
            capped: false,
            truncated_cells: [],
            duration_ms: 12.5,
          },
          error: null,
        },
        {
          id: "top_tools",
          result: null,
          error: { code: "159", message: "The query exceeded its time limit." },
        },
      ],
      variables: {
        time_range: {
          from: "2026-08-12T00:00:00.000Z",
          to: "2026-09-11T00:00:00.000Z",
        },
        repo: [],
        note: "",
      },
      rendered_at: "2026-09-10T05:26:28.223Z",
      cached: true,
    });
    const { text } = formatDashboardRender(result, now);
    expect(text.split("\n").slice(0, 2)).toEqual([
      "2 tiles | rendered_at: 2026-09-10T05:26:28.223Z | cached: true (served from the render cache, rendered 13 minutes ago; pass refresh: true to re-run the tiles)",
      "variables: time_range: 2026-08-12T00:00:00.000Z..2026-09-11T00:00:00.000Z | repo: all | note: (empty)",
    ]);
    expect(text).toContain("tile captured_sessions: 1 row\nvalue (UInt64)\n0");
    expect(text).toContain(
      "tile top_tools: error 159: The query exceeded its time limit.",
    );
    const fresh = formatDashboardRender(
      { ...result, cached: false, rendered_at: now.toISOString() },
      now,
    );
    expect(fresh.text).toContain("cached: false (rendered just now)");
  });

  it("puts ages into words", () => {
    const at = (seconds: number) =>
      ageInWords(new Date(now.getTime() - seconds * 1000).toISOString(), now);
    expect(at(10)).toBe("just now");
    expect(at(60)).toBe("1 minute ago");
    expect(at(13 * 60)).toBe("13 minutes ago");
    expect(at(2 * 3600)).toBe("2 hours ago");
    expect(at(3 * 86400)).toBe("3 days ago");
    // A clock behind rendered_at never reports a negative age.
    expect(at(-30)).toBe("just now");
  });
});
