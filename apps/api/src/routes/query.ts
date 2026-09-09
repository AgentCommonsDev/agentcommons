import { z } from "zod";
import { validatorCompiler } from "fastify-type-provider-zod";
import type { FastifySchemaCompiler } from "fastify";

type Coercer = (value: unknown) => unknown;
const identity: Coercer = (value) => value;
const shapeSchema = z.looseObject({
  type: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  items: z.unknown().optional(),
  anyOf: z.array(z.unknown()).optional(),
});
const typedSchema = z.looseObject({ type: z.string().optional() });

/** Build the coercion for one JSON schema once; requests then only walk their values. */
function compile(schema: unknown): Coercer {
  const shape = shapeSchema.safeParse(schema);
  if (!shape.success) return identity;
  const { type } = shape.data;
  const alternatives = shape.data.anyOf?.flatMap((item) => {
    const typed = typedSchema.safeParse(item);
    return typed.success
      ? [{ type: typed.data.type, coerce: compile(item) }]
      : [];
  });
  const objectLike =
    type === "object" || alternatives?.some((item) => item.type === "object");
  const items = type === "array" ? compile(shape.data.items) : identity;
  const properties =
    type === "object"
      ? new Map(
          Object.entries(shape.data.properties ?? {}).map(([key, property]) => [
            key,
            compile(property),
          ]),
        )
      : null;
  const coerce: Coercer = (value) => {
    if (typeof value === "string" && objectLike) {
      try {
        return coerce(JSON.parse(value));
      } catch {
        return value;
      }
    }
    if (alternatives) {
      const kind =
        value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      const branch = alternatives.find((item) => item.type === kind);
      if (branch) return branch.coerce(value);
    }
    if (type === "integer" || type === "number")
      return typeof value === "string" &&
        value.trim() !== "" &&
        Number.isFinite(Number(value))
        ? Number(value)
        : value;
    if (type === "boolean")
      return value === "true" ? true : value === "false" ? false : value;
    if (type === "array")
      return (Array.isArray(value) ? value : [value]).map(items);
    if (
      properties &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    )
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          (properties.get(key) ?? identity)(item),
        ]),
      );
    return value;
  };
  return coerce;
}
/** HTTP query encoding changes scalar representation; service schemas remain canonical. */
export const queryValidatorCompiler: FastifySchemaCompiler<z.ZodType> = (
  configuration,
) => {
  const validate = validatorCompiler(configuration);
  if (configuration.httpPart !== "querystring") return validate;
  const coerce = compile(
    z.toJSONSchema(configuration.schema, {
      io: "input",
      unrepresentable: "any",
    }),
  );
  return (value) => validate(coerce(value));
};
