import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { JsonValue } from "@agentcommons/core";
import { ServiceError } from "./context.js";

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export class CursorCodec {
  constructor(private readonly secret: string) {}

  encode(binding: JsonValue, position: JsonValue): string {
    const payload = Buffer.from(
      JSON.stringify({ version: 1, position }),
    ).toString("base64url");
    const signature = this.sign(binding, payload).toString("base64url");
    return `${payload}.${signature}`;
  }

  decode<T extends z.ZodType>(
    cursor: string,
    binding: JsonValue,
    schema: T,
  ): z.output<T> {
    try {
      if (cursor.length > 16_384) throw new Error("large cursor");
      const parts = cursor.split(".");
      const [payload, signature] = parts;
      if (!payload || !signature || parts.length !== 2)
        throw new Error("bad cursor");
      const received = Buffer.from(signature, "base64url");
      const expected = this.sign(binding, payload);
      if (
        received.length !== expected.length ||
        !timingSafeEqual(received, expected)
      )
        throw new Error("mismatched cursor");
      const envelope = z
        .strictObject({ version: z.literal(1), position: z.unknown() })
        .parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
      return schema.parse(envelope.position);
    } catch {
      throw new ServiceError(
        400,
        "INVALID_CURSOR",
        "This cursor does not match the organization or query. Start from the first page.",
      );
    }
  }

  private sign(binding: JsonValue, payload: string): Buffer {
    return createHmac("sha256", this.secret)
      .update(canonical(binding))
      .update("\0")
      .update(payload)
      .digest();
  }
}
