import { useCallback, useMemo } from "react";
import {
  useNavigate,
  useRouterState,
  type NavigateOptions,
} from "@tanstack/react-router";
import { paths } from "../../lib/routes";
import {
  ownedSearchKeys,
  parseSearchState,
  serializeSearchState,
  type SearchState,
} from "./search-state";

/** The page whose URL carries the search: Sessions by default, or a page embedding the list. */
export type SearchTarget = Pick<NavigateOptions, "to" | "params">;
const sessionsTarget: SearchTarget = { to: paths.sessions };

/**
 * Page state lives in the URL; every change is a navigation so links stay shareable.
 * Parameters the search does not own (a dashboard's time range, say) are kept as they are.
 */
export function useSearchState(target: SearchTarget = sessionsTarget) {
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
      const retained = Object.fromEntries(
        Object.entries(search as Record<string, unknown>).filter(
          ([key]) => !ownedSearchKeys.has(key),
        ),
      );
      void navigate({
        ...target,
        search: { ...retained, ...serializeSearchState(next) },
        replace: options.replace ?? false,
      });
    },
    [navigate, search, state, target],
  );
  return { state, update };
}
