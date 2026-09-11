import {
  builtinDashboardIds,
  dashboardDefinitionSchema,
  type DashboardDefinition,
  type DashboardTile,
} from "../schemas/dashboards.js";
import {
  dashboardTileTemplates,
  standardDashboardVariables,
} from "./templates.js";

/** A shipped read-only dashboard: fixed id, organization-visible, never persisted. */
export interface BuiltinDashboard {
  id: string;
  name: string;
  description: string;
  definition: DashboardDefinition;
}

function place(
  id: string,
  layout: DashboardTile["layout"],
  overrides: Partial<Pick<DashboardTile, "title" | "description">> = {},
): DashboardTile {
  const template = dashboardTileTemplates.find((entry) => entry.id === id);
  if (!template) throw new Error(`Unknown dashboard tile template ${id}`);
  return { ...template.tile, ...overrides, layout };
}
const definition = (tiles: DashboardTile[]): DashboardDefinition =>
  dashboardDefinitionSchema.parse({
    version: 2,
    variables: standardDashboardVariables,
    tiles,
  });

/** Adoption and reuse across the team; the Home default until an admin picks another. */
export const teamOverviewDashboard: BuiltinDashboard = {
  id: builtinDashboardIds.teamOverview,
  name: "Team overview",
  description:
    "Captured sessions, search adoption and reuse for the selected time range and repositories. Duplicate it to make your own.",
  definition: definition([
    place("captured_sessions", { x: 0, y: 0, w: 3, h: 2 }),
    place("search_sessions", { x: 3, y: 0, w: 3, h: 2 }),
    place("reuse_sessions", { x: 6, y: 0, w: 3, h: 2 }),
    place("reuse_rate", { x: 9, y: 0, w: 3, h: 2 }),
    place("reuse_trend", { x: 0, y: 2, w: 8, h: 5 }),
    place("harness_share", { x: 8, y: 2, w: 4, h: 5 }),
    place("sessions_per_day", { x: 0, y: 7, w: 8, h: 5 }),
    place("top_repos", { x: 8, y: 7, w: 4, h: 5 }),
    place("most_reused", { x: 0, y: 12, w: 7, h: 6 }),
    place("top_tools", { x: 7, y: 12, w: 5, h: 6 }),
  ]),
};

/** Who is doing what: per-person sessions, messages, tool calls, tokens, repositories and coding tools. */
export const teamActivityDashboard: BuiltinDashboard = {
  id: builtinDashboardIds.teamActivity,
  name: "Team activity",
  description:
    "Who is doing what across coding agents: sessions, messages, tool calls, tokens and repositories per person for the selected time range and repositories.",
  definition: definition([
    place("active_people", { x: 0, y: 0, w: 3, h: 2 }),
    place("captured_sessions", { x: 3, y: 0, w: 3, h: 2 }),
    place("messages_total", { x: 6, y: 0, w: 3, h: 2 }),
    place("tool_calls_total", { x: 9, y: 0, w: 3, h: 2 }),
    place("tokens_per_person", { x: 0, y: 2, w: 6, h: 6 }),
    place("activity_per_person", { x: 6, y: 2, w: 6, h: 6 }),
    place("sessions_per_day_by_person", { x: 0, y: 8, w: 8, h: 5 }),
    place("harness_per_person", { x: 8, y: 8, w: 4, h: 5 }),
    place("repos_per_person", { x: 0, y: 13, w: 6, h: 6 }),
    place("duration_per_person", { x: 6, y: 13, w: 6, h: 6 }),
  ]),
};

/** Every shipped dashboard, in picker order. */
export const builtinDashboards: readonly BuiltinDashboard[] = [
  teamOverviewDashboard,
  teamActivityDashboard,
];
/** The shipped dashboard with this id, if any. */
export function builtinDashboard(id: string): BuiltinDashboard | undefined {
  return builtinDashboards.find((dashboard) => dashboard.id === id);
}
