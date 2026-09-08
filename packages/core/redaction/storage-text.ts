import { toUSVString } from "node:util";

/** PostgreSQL text/jsonb require Unicode scalar values and cannot store NUL. */
export function storageText(value: string): string {
  return toUSVString(value).replaceAll("\u0000", "\\u0000");
}
