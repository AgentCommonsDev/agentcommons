import { createHash } from "node:crypto";
import { z } from "zod";
import {
  jsonByteLength,
  utf8ByteLength,
  type JsonValue,
} from "../schemas/common.js";

/** A persisted record is held to 1 MiB of JSON (§6); larger leaves are replaced by omission markers. */
const recordByteLimit = 1024 * 1024;
const omissionMarker = (bytes: number, digest: string) =>
  `[agentcommons: ${String(bytes)} bytes omitted, sha256 ${digest}]`;
/** Same width as a real digest, so a marker's size is known before anything is hashed. */
const digestPlaceholder = "0".repeat(64);
export function omission(value: string): string {
  return omissionMarker(
    utf8ByteLength(value),
    createHash("sha256").update(value).digest("hex"),
  );
}
const base64ImageSchema = z.looseObject({
  type: z.literal("base64"),
  media_type: z.string(),
  data: z.string(),
});
const inlineImageSchema = z.looseObject({
  mimeType: z.string().startsWith("image/"),
  data: z.string(),
});
const imageMarker = (mime: string, data: string) =>
  `[image: ${mime}, ${String(Buffer.from(data, "base64").byteLength)} bytes]`;

// Run after redaction. The hash never fingerprints a pre-redaction secret.
export function sanitizeRecord(
  input: JsonValue,
  limit = recordByteLimit,
): JsonValue {
  const leaves: { bytes: number; replace: () => number }[] = [];
  const holder: { value: JsonValue } = { value: input };
  function visit(value: JsonValue, assign: (value: JsonValue) => void): void {
    if (typeof value === "string") {
      const image = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(
        value,
      );
      if (image) {
        assign(imageMarker(image[1] ?? "unknown", image[2] ?? ""));
        return;
      }
      const bytes = jsonByteLength(value);
      const saved =
        bytes -
        jsonByteLength(
          omissionMarker(utf8ByteLength(value), digestPlaceholder),
        );
      if (saved > 0)
        leaves.push({
          bytes,
          // The digest is computed only for a leaf that is actually replaced.
          replace: () => {
            assign(omission(value));
            return saved;
          },
        });
    } else if (Array.isArray(value)) {
      const children: JsonValue[] = [...value];
      assign(children);
      for (const [index, child] of children.entries())
        visit(child, (replacement) => {
          children[index] = replacement;
        });
    } else if (value !== null && typeof value === "object") {
      const source = base64ImageSchema.safeParse(value);
      const inline = inlineImageSchema.safeParse(value);
      const image = source.success
        ? { mime: source.data.media_type, data: source.data.data }
        : inline.success
          ? { mime: inline.data.mimeType, data: inline.data.data }
          : value.type === "image" && typeof value.data === "string"
            ? {
                mime:
                  typeof value.mimeType === "string"
                    ? value.mimeType
                    : "unknown",
                data: value.data,
              }
            : null;
      if (image) {
        assign(imageMarker(image.mime, image.data));
        return;
      }
      const children: Record<string, JsonValue> = Object.fromEntries(
        Object.entries(value),
      );
      assign(children);
      for (const [key, child] of Object.entries(children))
        visit(child, (replacement) => {
          children[key] = replacement;
        });
    }
  }
  visit(input, (value) => {
    holder.value = value;
  });
  let bytes = jsonByteLength(holder.value);
  for (const leaf of leaves.sort((a, b) => b.bytes - a.bytes)) {
    if (bytes <= limit) break;
    bytes -= leaf.replace();
  }
  if (bytes > limit)
    return { _agentcommons_omitted: omission(JSON.stringify(holder.value)) };
  return holder.value;
}
