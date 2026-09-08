import { z } from "zod";
/** Protocol syntax is data, not free text. Only declared keys and finite literals
 * bypass scanners; unknown keys and every other string still pass through them. */
export interface RedactionStructure {
  properties?: Readonly<Record<string, RedactionStructure>>;
  items?: RedactionStructure;
  literals?: readonly string[];
  format?: "timestamp";
}
export function protocolObject(
  keys: readonly string[],
  properties: Readonly<Record<string, RedactionStructure>> = {},
): RedactionStructure {
  return {
    properties: {
      ...Object.fromEntries(keys.map((key) => [key, {}])),
      ...properties,
    },
  };
}
export const protocolLiterals = (
  ...literals: string[]
): RedactionStructure => ({ literals });
export const protocolArray = (
  items: RedactionStructure,
): RedactionStructure => ({ items });

export const protocolTimestamp: RedactionStructure = { format: "timestamp" };
const timestampSchema = z.iso.datetime({ offset: true });
export function protocolValue(
  value: string,
  structure: RedactionStructure = {},
): boolean {
  return (
    structure.literals?.includes(value) === true ||
    (structure.format === "timestamp" &&
      timestampSchema.safeParse(value).success)
  );
}
