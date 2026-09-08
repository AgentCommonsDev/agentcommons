import { z } from "zod";
import { createHash } from "node:crypto";
import type {
  JsonValue,
  Normalizer,
  SourceRecord,
} from "../normalizers/types.js";
import type { RedactionStructure } from "./structure.js";
import { sanitizeRecord } from "./sanitize.js";
import type { Redactor, RedactionResult } from "./index.js";

export const identityDigest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
// This namespace is reserved for server-generated identities. Keeping it stable
// prevents rescans from hashing a previous digest when policies match its prefix.
export async function canonicalIdentity(
  value: string,
  redactor: Redactor,
): Promise<RedactionResult<string>> {
  if (/^redacted-[a-f0-9]{64}$/.test(value)) return { value, counts: [] };
  const result = await redactor.text(value);
  return {
    ...result,
    value:
      result.value === value && Buffer.byteLength(value) <= 256
        ? value
        : `redacted-${identityDigest(value)}`,
  };
}

export const redactionContextSchema = z.strictObject({
  toolCalls: z
    .array(
      z.strictObject({
        idHash: z.string().regex(/^[a-f0-9]{64}$/),
        sensitive: z.boolean(),
      }),
    )
    .default([]),
  identities: z
    .array(
      z.strictObject({
        path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
        idHash: z.string().regex(/^[a-f0-9]{64}$/),
        canonicalId: z.string(),
      }),
    )
    .default([]),
});

export class UnpairedToolResultError extends Error {
  constructor(readonly records: { pos: number; key: string | null }[]) {
    super(
      "Tool results are waiting for their input records. Retain them locally and retry after the next accepted batch.",
    );
    this.name = "UnpairedToolResultError";
  }
}

export function sensitiveFile(path: string): boolean {
  const name = path.replaceAll("\\", "/").split("/").at(-1) ?? "";
  return (
    name.startsWith(".env") ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name.startsWith("id_rsa") ||
    name.startsWith("credentials") ||
    name === ".npmrc" ||
    name === ".netrc"
  );
}

function replaceAt(
  value: JsonValue,
  path: readonly (string | number)[],
  replacement: JsonValue,
): void {
  const [key, ...rest] = path;
  if (key === undefined || value === null || typeof value !== "object")
    throw new Error("Invalid adapter result location.");
  if (Array.isArray(value)) {
    if (typeof key !== "number")
      throw new Error("Invalid adapter array location.");
    if (!rest.length) value[key] = replacement;
    else replaceAt(value[key] ?? null, rest, replacement);
  } else {
    if (typeof key !== "string")
      throw new Error("Invalid adapter object location.");
    if (!rest.length) value[key] = replacement;
    else replaceAt(value[key] ?? null, rest, replacement);
  }
}

// All source branches and historical versions participate in pairing. Displayed
// branch selection must never decide which raw output receives protection.
export function maskToolResults(
  normalizer: Normalizer,
  records: readonly SourceRecord[],
  existing: readonly SourceRecord[] = [],
): SourceRecord[] {
  const calls = new Map<string, boolean>();
  const sources = new Map(
    [...existing, ...records].map((record) => [record.id, record]),
  );
  const contexts = new Map(
    records.map((record) => [
      record.id,
      redactionContextSchema.parse(record.redactionContext ?? {}),
    ]),
  );
  for (const record of [...existing, ...records])
    for (const call of record.redactionContext?.toolCalls ?? [])
      calls.set(
        call.idHash,
        (calls.get(call.idHash) ?? false) || call.sensitive,
      );
  for (const use of normalizer.toolUses([...existing, ...records])) {
    if (!use.toolUseId) continue;
    const record = sources.get(use.rawRecordId);
    const stored = record?.redactionContext?.identities.find(
      (identity) => identity.canonicalId === use.toolUseId,
    );
    const idHash = stored?.idHash ?? identityDigest(use.toolUseId);
    const sensitive =
      (calls.get(idHash) ?? false) ||
      (use.files ?? []).some((file) => sensitiveFile(file.path));
    calls.set(idHash, sensitive);
    const context = contexts.get(use.rawRecordId);
    const prior = context?.toolCalls.find((call) => call.idHash === idHash);
    if (prior) prior.sensitive ||= sensitive;
    else context?.toolCalls.push({ idHash, sensitive });
  }
  const deferred: { pos: number; key: string | null }[] = [];
  const result = records.map((record) => {
    const payload = structuredClone(
      z.record(z.string(), z.json()).parse(record.payload),
    );
    for (const source of normalizer.toolResults(record)) {
      const stored = record.redactionContext?.identities.find(
        (identity) => identity.canonicalId === source.toolUseId,
      );
      const idHash = source.toolUseId
        ? (stored?.idHash ?? identityDigest(source.toolUseId))
        : null;
      if (!idHash || !calls.has(idHash)) {
        deferred.push({ pos: Number(record.pos), key: record.key });
        continue;
      }
      if (!calls.get(idHash)) continue;
      for (const location of source.locations)
        replaceAt(payload, location.path, location.replacement);
    }
    return {
      ...record,
      payload,
      redactionContext: redactionContextSchema.parse(
        contexts.get(record.id) ?? {},
      ),
    };
  });
  if (deferred.length)
    throw new UnpairedToolResultError(
      deferred.filter(
        (record, index) =>
          deferred.findIndex(
            (other) => other.pos === record.pos && other.key === record.key,
          ) === index,
      ),
    );
  return result;
}

export async function redactSourceRecord(
  normalizer: Normalizer,
  record: SourceRecord,
  redactor: Redactor,
): Promise<RedactionResult<SourceRecord>> {
  const context = redactionContextSchema.parse(record.redactionContext ?? {});
  context.identities = context.identities.filter(
    (identity) => valueAt(record.payload, identity.path) !== undefined,
  );
  const counts = [];
  const locations = new Map(
    [
      ...normalizer.toolIdentities(record),
      ...normalizer.nativeIdentities(record),
    ].map((location) => [JSON.stringify(location.path), location]),
  );
  for (const location of locations.values()) {
    const stored = context.identities.find(
      (identity) =>
        identity.canonicalId === location.id &&
        JSON.stringify(identity.path) === JSON.stringify(location.path),
    );
    if (stored && stored.canonicalId === `redacted-${stored.idHash}`) continue;
    const redacted = await canonicalIdentity(location.id, redactor);
    counts.push(...redacted.counts);
    const idHash = stored?.idHash ?? identityDigest(location.id);
    const canonicalId =
      redacted.value === location.id ? location.id : `redacted-${idHash}`;
    if (stored) stored.canonicalId = canonicalId;
    else context.identities.push({ path: location.path, idHash, canonicalId });
  }
  const payload = z
    .record(z.string(), z.json())
    .parse(structuredClone(record.payload));
  let structure = normalizer.redactionStructure;
  for (const identity of context.identities) {
    replaceAt(payload, identity.path, identity.canonicalId);
    structure = identityStructure(
      structure,
      identity.path,
      identity.canonicalId,
    );
  }
  const redacted = await redactor.json(payload, structure);
  counts.push(...redacted.counts);
  return {
    value: {
      ...record,
      payload: z.record(z.string(), z.json()).parse(redacted.value),
      redactionContext: context,
    },
    counts,
  };
}

/** Projection identity uses the durable digest so later policy changes cannot
 * split a use/result pair or tree edge across old and newly redacted records. */
export function projectionRecord(record: SourceRecord): SourceRecord {
  if (!record.redactionContext?.identities.length) return record;
  const payload = z
    .record(z.string(), z.json())
    .parse(structuredClone(record.payload));
  for (const identity of record.redactionContext.identities)
    if (valueAt(payload, identity.path) !== undefined)
      replaceAt(payload, identity.path, `redacted-${identity.idHash}`);
  return { ...record, payload };
}
export function projectionIdentity(value: string): string {
  return /^redacted-[a-f0-9]{64}$/.test(value)
    ? value
    : `redacted-${identityDigest(value)}`;
}

function valueAt(value: unknown, path: readonly (string | number)[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = (current as unknown[])[key];
    } else {
      if (
        current === null ||
        typeof current !== "object" ||
        Array.isArray(current)
      )
        return undefined;
      current = (current as Record<string, unknown>)[key];
    }
  }
  return current;
}

export function sanitizeSourceRecord(record: SourceRecord): SourceRecord {
  const payload = z
    .record(z.string(), z.json())
    .parse(sanitizeRecord(z.json().parse(record.payload)));
  const context = redactionContextSchema.parse(record.redactionContext ?? {});
  context.identities = context.identities.filter(
    (identity) => valueAt(payload, identity.path) === identity.canonicalId,
  );
  return { ...record, payload, redactionContext: context };
}

function identityStructure(
  shape: RedactionStructure,
  path: readonly (string | number)[],
  canonicalId: string,
): RedactionStructure {
  const [key, ...rest] = path;
  if (key === undefined)
    return { ...shape, literals: [...(shape.literals ?? []), canonicalId] };
  if (typeof key === "number")
    return {
      ...shape,
      items: identityStructure(shape.items ?? {}, rest, canonicalId),
    };
  return {
    ...shape,
    properties: {
      ...shape.properties,
      [key]: identityStructure(
        shape.properties?.[key] ?? {},
        rest,
        canonicalId,
      ),
    },
  };
}
