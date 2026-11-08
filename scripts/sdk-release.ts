import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "smol-toml";
import { z } from "zod";

/** Both registries receive the same stable SDK version from an explicit release tag. */
export function sdkReleaseVersion(
  tag: string,
  npmVersion: string,
  pythonVersion: string,
): string {
  const match = /^sdk-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(
    tag,
  );
  const version = match?.[1];
  if (!version || version !== npmVersion || version !== pythonVersion)
    throw new Error("Use sdk-vX.Y.Z matching both SDK package versions.");
  return version;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const npm = z
    .object({
      name: z.literal("@agentcommons/sdk"),
      version: z.string(),
      private: z.literal(false).optional(),
      publishConfig: z.object({
        access: z.literal("public"),
        registry: z.literal("https://registry.npmjs.org/"),
      }),
    })
    .parse(
      JSON.parse(
        readFileSync(
          new URL("../packages/sdk/package.json", import.meta.url),
          "utf8",
        ),
      ),
    );
  const python = z
    .object({
      project: z.object({
        name: z.literal("agentcommons"),
        version: z.string(),
      }),
    })
    .parse(
      parse(
        readFileSync(
          new URL("../packages/sdk-python/pyproject.toml", import.meta.url),
          "utf8",
        ),
      ),
    );
  console.log(
    sdkReleaseVersion(
      process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "",
      npm.version,
      python.project.version,
    ),
  );
}
