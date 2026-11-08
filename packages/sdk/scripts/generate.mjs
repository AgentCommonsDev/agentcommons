import { readFile, writeFile } from "node:fs/promises";
import openapiTS, { astToString } from "openapi-typescript";
import ts from "typescript";
import { format } from "prettier";

const ast = await openapiTS(
  new URL("../../../apps/api/openapi.json", import.meta.url),
  {
    inject: 'import type { JsonValue } from "./index.js";',
    transform(_schema, context) {
      if (
        [
          "#/components/schemas/JsonValue",
          "#/components/schemas/JsonValueInput",
        ].includes(context.path)
      )
        return ts.factory.createTypeReferenceNode("JsonValue");
    },
  },
);
const output = await format(
  `// Generated from the server OpenAPI contract. Do not edit.\n${astToString(ast)}`,
  { parser: "typescript" },
);
const file = new URL("../src/generated.ts", import.meta.url);
if (process.argv.includes("--check")) {
  if ((await readFile(file, "utf8")) !== output)
    throw new Error("TypeScript SDK is stale. Run pnpm sdk:generate.");
} else await writeFile(file, output);
