import { queryOptions } from "@tanstack/react-query";
import { api, unwrap } from "./client";

/** The signed-in account and its organization; every caller shares this key. */
export const identityQuery = queryOptions({
  queryKey: ["identity"],
  queryFn: async ({ signal }) =>
    unwrap(await api.GET("/api/v1/me", { signal })),
  retry: false,
});
/** Sign-in methods and feature flags served by the instance. */
export const authConfigQuery = queryOptions({
  queryKey: ["auth-config"],
  queryFn: async ({ signal }) =>
    unwrap(await api.GET("/auth/config", { signal })),
  retry: false,
});
