import { z } from "zod";
import { validatorCompiler } from "fastify-type-provider-zod";
import type { FastifySchemaCompiler } from "fastify";

function coerce(value: unknown, schema: unknown): unknown {
  const shape = z
    .looseObject({
      type: z.string().optional(),
      properties: z.record(z.string(), z.unknown()).optional(),
      items: z.unknown().optional(),
      anyOf: z.array(z.unknown()).optional(),
    })
    .safeParse(schema);
  if (!shape.success) return value;
  const alternatives = shape.data.anyOf
    ?.map((item) =>
      z.looseObject({ type: z.string().optional() }).safeParse(item),
    )
    .filter((item) => item.success)
    .map((item) => item.data);
  if (
    typeof value === "string" &&
    (shape.data.type === "object" ||
      alternatives?.some((item) => item.type === "object"))
  ) {
    try {
      return coerce(JSON.parse(value), schema);
    } catch {
      return value;
    }
  }
  if (shape.data.anyOf) {
    const kind =
      value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const branch = alternatives?.find((item) => item.type === kind);
    if (branch) return coerce(value, branch);
  }
  if (shape.data.type === "integer" || shape.data.type === "number")
    return typeof value === "string" &&
      value.trim() !== "" &&
      Number.isFinite(Number(value))
      ? Number(value)
      : value;
  if (shape.data.type === "boolean")
    return value === "true" ? true : value === "false" ? false : value;
  if (shape.data.type === "array")
    return (Array.isArray(value) ? value : [value]).map((item) =>
      coerce(item, shape.data.items),
    );
  if (
    shape.data.type === "object" &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  )
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        coerce(item, shape.data.properties?.[key]),
      ]),
    );
  return value;
}
/** HTTP query encoding changes scalar representation; service schemas remain canonical. */
export const queryValidatorCompiler: FastifySchemaCompiler<z.ZodType> = (
  configuration,
) => {
  const validate = validatorCompiler(configuration);
  if (configuration.httpPart !== "querystring") return validate;
  const schema = z.toJSONSchema(configuration.schema, {
    io: "input",
    unrepresentable: "any",
  });
  return (value) => validate(coerce(value, schema));
};
