import { useQuery } from "@tanstack/react-query";
import { hookManifestSchema } from "@agentcommons/core/schemas/ingest";

/**
 * The hook bundle this instance serves at `/hook/manifest.json`. Installations report the
 * digest they run on every upload; a different digest means the shim updates itself on
 * its next upload. The manifest is fetched once per page load.
 */
export function useHookManifest() {
  return useQuery({
    queryKey: ["hook-manifest"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/hook/manifest.json", { signal });
      if (!response.ok)
        throw new Error(`Hook manifest: HTTP ${String(response.status)}`);
      return hookManifestSchema.parse(await response.json());
    },
    staleTime: Infinity,
  });
}
