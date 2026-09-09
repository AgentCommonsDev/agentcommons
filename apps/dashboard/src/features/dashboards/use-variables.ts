import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DashboardVariable,
  DashboardVariableValue,
} from "@agentcommons/core/schemas/dashboards";
import {
  defaultVariableValue,
  searchFromVariables,
  variablesFromSearch,
  type VariableValues,
} from "./model";

const currentSearch = () =>
  new URLSearchParams(
    typeof window === "undefined" ? "" : window.location.search,
  );

/** Variable values mirrored into the URL query so a dashboard link carries its filters. */
export function useVariableState(variables: readonly DashboardVariable[]) {
  const [values, setValues] = useState<VariableValues>(() =>
    variablesFromSearch(variables, currentSearch()),
  );
  useEffect(() => {
    setValues((prior) => {
      const fromUrl = variablesFromSearch(variables, currentSearch());
      const next: VariableValues = {};
      let changed = false;
      for (const variable of variables) {
        const value =
          prior[variable.name] ??
          fromUrl[variable.name] ??
          defaultVariableValue(variable);
        next[variable.name] = value;
        if (prior[variable.name] === undefined) changed = true;
      }
      if (Object.keys(prior).some((name) => !(name in next))) changed = true;
      return changed ? next : prior;
    });
  }, [variables]);
  const latest = useRef(values);
  latest.current = values;
  const setVariable = useCallback(
    (name: string, value: DashboardVariableValue) => {
      const next = { ...latest.current, [name]: value };
      latest.current = next;
      setValues(next);
      // The router listens to history changes, so this stays outside the state updater.
      if (typeof window !== "undefined") {
        const search = searchFromVariables(
          variables,
          next,
          currentSearch(),
        ).toString();
        const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
        window.history.replaceState(window.history.state, "", url);
      }
    },
    [variables],
  );
  return { values, setVariable };
}
