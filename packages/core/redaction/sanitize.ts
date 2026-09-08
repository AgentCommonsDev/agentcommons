import { createHash } from "node:crypto";
import { z } from "zod";
import { utf8ByteLength } from "../schemas/common.js";

type JsonValue = z.infer<ReturnType<typeof z.json>>;
export const MAX_RECORD_BYTES = 1024 * 1024;
export const byteLength = (value: unknown): number =>
  utf8ByteLength(JSON.stringify(value));

export function omission(value: string): string {
  return `[agentcommons: ${String(utf8ByteLength(value))} bytes omitted, sha256 ${createHash("sha256").update(value).digest("hex")}]`;
}

// Run after redaction. The hash never fingerprints a pre-redaction secret.
export function sanitizeRecord(
  input: JsonValue,
  limit = MAX_RECORD_BYTES,
): JsonValue {
  const leaves: { bytes: number; replace: () => number }[] = [];
  const holder: { value: JsonValue } = { value: input };
  function visit(value: JsonValue, assign: (value: JsonValue) => void): void {
    if (typeof value === "string") {
      const image = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(
        value,
      );
      if (image) {
        assign(
          `[image: ${image[1] ?? "unknown"}, ${String(Buffer.from(image[2] ?? "", "base64").byteLength)} bytes]`,
        );
        return;
      }
      const marker = omission(value);
      const saved = byteLength(value) - byteLength(marker);
      if (saved > 0)
        leaves.push({
          bytes: byteLength(value),
          replace: () => {
            assign(marker);
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
      const source = z
        .looseObject({
          type: z.literal("base64"),
          media_type: z.string(),
          data: z.string(),
        })
        .safeParse(value);
      const inline = z
        .looseObject({
          mimeType: z.string().startsWith("image/"),
          data: z.string(),
        })
        .safeParse(value);
      const image = source.success
        ? { mime: source.data.media_type, data: source.data.data }
        : inline.success
          ? { mime: inline.data.mimeType, data: inline.data.data }
          : null;
      if (image) {
        assign(
          `[image: ${image.mime}, ${String(Buffer.from(image.data, "base64").byteLength)} bytes]`,
        );
        return;
      }
      if (value.type === "image" && typeof value.data === "string") {
        assign(
          `[image: ${typeof value.mimeType === "string" ? value.mimeType : "unknown"}, ${String(Buffer.from(value.data, "base64").byteLength)} bytes]`,
        );
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
  let bytes = byteLength(holder.value);
  for (const leaf of leaves.sort((a, b) => b.bytes - a.bytes)) {
    if (bytes <= limit) break;
    bytes -= leaf.replace();
  }
  if (bytes > limit)
    return { _agentcommons_omitted: omission(JSON.stringify(holder.value)) };
  return holder.value;
}
