import { useCallback, useMemo } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { paths } from "../../lib/routes";
import {
  parseSearchState,
  serializeSearchState,
  type SearchState,
} from "./search-state";

/** Page state lives in the URL; every change is a navigation so links stay shareable. */
export function useSearchState() {
  const search = useRouterState({ select: (state) => state.location.search });
  const state = useMemo(() => parseSearchState(search), [search]);
  const navigate = useNavigate();
  const update = useCallback(
    (
      patch: Partial<SearchState> | ((previous: SearchState) => SearchState),
      options: { replace?: boolean } = {},
    ) => {
      const next =
        typeof patch === "function" ? patch(state) : { ...state, ...patch };
      void navigate({
        to: paths.sessions,
        search: serializeSearchState(next),
        replace: options.replace ?? false,
      });
    },
    [navigate, state],
  );
  return { state, update };
}
