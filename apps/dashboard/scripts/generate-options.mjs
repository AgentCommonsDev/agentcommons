import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
const spec = JSON.parse(
  await readFile(new URL("../../api/openapi.json", import.meta.url), "utf8"),
);
const strings = z.array(z.string()).min(1);
const policy =
  spec.paths["/api/v1/admin/redaction/policies"].post.requestBody.content[
    "application/json"
  ].schema;
const search =
  spec.paths["/api/v1/search"].post.requestBody.content["application/json"]
    .schema;
const options = {
  redactionRuleIds: strings.parse(
    policy.oneOf.find((variant) => variant.properties.ruleId).properties.ruleId
      .enum,
  ),
  searchFilterKeys: strings.parse(
    Object.keys(search.properties.filters.properties).filter(
      (key) => key !== "where",
    ),
  ),
};
for (const [name, path] of Object.entries({
  sessionSortKeys: "/api/v1/sessions",
  keySortKeys: "/api/v1/me/keys",
  memberSortKeys: "/api/v1/admin/users",
  auditSortKeys: "/api/v1/admin/audit",
  policySortKeys: "/api/v1/admin/redaction/policies",
  metricSortKeys: "/api/v1/admin/metrics/{group}",
})) {
  options[name] = strings.parse(
    spec.paths[path].get.parameters.find(
      (parameter) => parameter.name === "sort",
    ).schema.enum,
  );
}
await writeFile(
  new URL("../src/lib/api/options.ts", import.meta.url),
  `// Generated from the server OpenAPI contract. Do not edit.\n${Object.entries(
    options,
  )
    .map(
      ([name, values]) =>
        `export const ${name} = ${JSON.stringify(values)} as const;`,
    )
    .join("\n")}\n`,
);
