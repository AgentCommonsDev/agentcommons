import { writeFile } from "node:fs/promises";
import openapiTS, { astToString } from "openapi-typescript";
import ts from "typescript";
const ast = await openapiTS(
  new URL("../../api/openapi.json", import.meta.url),
  {
    inject:
      'import type { JsonValue } from "@agentcommons/core/schemas/common";',
    transform(_schema, context) {
      if (
        context.path === "#/components/schemas/JsonValue" ||
        context.path === "#/components/schemas/JsonValueInput"
      )
        return ts.factory.createTypeReferenceNode("JsonValue");
    },
  },
);
await writeFile(
  new URL("../src/lib/api/generated.ts", import.meta.url),
  `// Generated from the server OpenAPI contract. Do not edit.\n${astToString(ast)}`,
);
