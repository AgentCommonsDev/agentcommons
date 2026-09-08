import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "./api/client";

export function useAuthConfig() {
  return useQuery({
    queryKey: ["auth-config"],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/auth/config", { signal })),
    retry: false,
  });
}
