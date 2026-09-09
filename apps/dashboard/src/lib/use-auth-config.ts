import { useQuery } from "@tanstack/react-query";
import { authConfigQuery } from "./api/queries";
import type { AuthConfig } from "./types";

export function useAuthConfig() {
  return useQuery(authConfigQuery);
}
/** Whether the instance advertises a feature; false until the configuration loads. */
export function useFeature(feature: AuthConfig["features"][number]): boolean {
  return useAuthConfig().data?.features.includes(feature) ?? false;
}
