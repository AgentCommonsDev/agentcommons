import Fastify from "fastify";
import swagger from "@fastify/swagger";
import { serializerCompiler } from "fastify-type-provider-zod";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { assertRouteContract } from "./app.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerPublicApiRoutes } from "./routes/public.js";
import {
  apiDefinition,
  openApiTransform,
  openApiTransformObject,
} from "./routes/openapi.js";
import { queryValidatorCompiler } from "./routes/query.js";

export async function generateOpenApi() {
  const app = Fastify({ exposeHeadRoutes: false });
  app.setValidatorCompiler(queryValidatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook("onRoute", assertRouteContract);
  await app.register(swagger, {
    openapi: apiDefinition(),
    transform: openApiTransform,
    transformObject: openApiTransformObject,
  });
  registerApiRoutes(app, undefined, { embeddings: true });
  registerPublicApiRoutes(app);
  try {
    await app.ready();
    return app.swagger();
  } finally {
    await app.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const output = `${JSON.stringify(await generateOpenApi(), null, 2)}\n`;
  const file = new URL("../openapi.json", import.meta.url);
  if (process.argv.includes("--check")) {
    if ((await readFile(file, "utf8")) !== output)
      throw new Error(
        "OpenAPI changed. Run pnpm openapi:generate and review the generated contract.",
      );
  } else await writeFile(file, output);
}
