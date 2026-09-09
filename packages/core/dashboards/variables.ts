import {
  dashboardTimePresetSchema,
  type DashboardResolvedVariable,
  type DashboardVariable,
  type DashboardVariableValue,
} from "../schemas/dashboards.js";

/** ClickHouse parameter types exposed by each declared variable. */
export function dashboardParameterTypes(
  variables: readonly DashboardVariable[],
): Record<string, string> {
  const types: Record<string, string> = {};
  for (const variable of variables) {
    if (variable.type === "time_range") {
      types[`${variable.name}_from`] = "DateTime";
      types[`${variable.name}_to`] = "DateTime";
    } else if (variable.type === "text") types[variable.name] = "String";
    else types[variable.name] = "Array(String)";
  }
  return types;
}

const day = 86_400_000;
function startOfUtcDay(value: Date): Date {
  const result = new Date(value);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}
function startOfUtcWeek(value: Date): Date {
  const start = startOfUtcDay(value);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start;
}
export function dashboardTimeRange(
  value: DashboardVariableValue | undefined,
  fallback: DashboardVariable & { type: "time_range" },
  now: Date,
): { from: Date; to: Date } {
  if (typeof value === "object" && !Array.isArray(value))
    return { from: new Date(value.from), to: new Date(value.to) };
  const preset = dashboardTimePresetSchema.safeParse(value);
  const selected = preset.success ? preset.data : fallback.default;
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + day);
  switch (selected) {
    case "24h":
      return { from: new Date(now.getTime() - day), to: now };
    case "7d":
    case "14d":
    case "30d":
    case "90d": {
      const days = Number(selected.slice(0, -1));
      return {
        from: new Date(today.getTime() - (days - 1) * day),
        to: tomorrow,
      };
    }
    case "this_week": {
      const from = startOfUtcWeek(now);
      return { from, to: new Date(from.getTime() + 7 * day) };
    }
    case "last_week": {
      const to = startOfUtcWeek(now);
      return { from: new Date(to.getTime() - 7 * day), to };
    }
    case "this_month": {
      const from = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      return {
        from,
        to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
      };
    }
    case "all":
      return { from: new Date(Date.UTC(2000, 0, 1)), to: tomorrow };
  }
}

/** Resolve declared variables against caller values into typed query parameters. */
export function resolveDashboardVariables(
  variables: readonly DashboardVariable[],
  values: Readonly<Record<string, DashboardVariableValue>>,
  now: Date = new Date(),
): {
  parameters: Record<string, number | string | string[]>;
  resolved: Record<string, DashboardResolvedVariable>;
} {
  const parameters: Record<string, number | string | string[]> = {};
  const resolved: Record<string, DashboardResolvedVariable> = {};
  for (const variable of variables) {
    const value = values[variable.name];
    if (variable.type === "time_range") {
      const range = dashboardTimeRange(value, variable, now);
      // Unix seconds are timezone-agnostic for ClickHouse DateTime parameters.
      parameters[`${variable.name}_from`] = Math.floor(
        range.from.getTime() / 1000,
      );
      parameters[`${variable.name}_to`] = Math.ceil(range.to.getTime() / 1000);
      resolved[variable.name] = {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      };
    } else if (variable.type === "text") {
      const text = typeof value === "string" ? value : variable.default;
      parameters[variable.name] = text;
      resolved[variable.name] = text;
    } else {
      const list = Array.isArray(value) ? value : [];
      parameters[variable.name] = list;
      resolved[variable.name] = list;
    }
  }
  return { parameters, resolved };
}
