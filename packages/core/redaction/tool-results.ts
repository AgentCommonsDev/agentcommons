import { z } from "zod";
import { createHash } from "node:crypto";
import {
  jsonObjectSchema,
  sha256Schema,
  uniqueBy,
  type JsonValue,
} from "../schemas/common.js";
import type {
  NormalizedMessage,
  Normalizer,
  SourceRecord,
} from "../normalizers/types.js";
import type { RedactionStructure } from "./structure.js";
import { SENSITIVE_FILE_PATTERNS } from "./rules.js";
import { sanitizeRecord } from "./sanitize.js";
import type { Redactor, RedactionResult } from "./index.js";

/** Lower-case hex SHA-256 of one string, the digest every stored identity and fingerprint uses. */
export const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
/** The digest a native identity (session, agent or tool-use id) is stored and matched under. */
export const identityDigest = (value: string): string => sha256Hex(value);
// This namespace is reserved for server-generated identities. Keeping it stable
// prevents rescans from hashing a previous digest when policies match its prefix.
const redactedIdentityPattern = /^redacted-[a-f0-9]{64}$/;
/** The projected form of a native identity: `redacted-` plus its SHA-256 digest. */
export const redactedIdentity = (hash: string): string => `redacted-${hash}`;
export const isRedactedIdentity = (value: string): boolean =>
  redactedIdentityPattern.test(value);

// A Redactor is immutable for its policy set, so identical identity strings (session,
// agent and message ids repeat on every record) are scanned once per instance.
const identityMemos = new WeakMap<
  Redactor,
  Map<string, RedactionResult<string>>
>();
const IDENTITY_MEMO_LIMIT = 4096;
export async function canonicalIdentity(
  value: string,
  redactor: Redactor,
): Promise<RedactionResult<string>> {
  if (isRedactedIdentity(value)) return { value, counts: [] };
  let memo = identityMemos.get(redactor);
  if (!memo) {
    memo = new Map();
    identityMemos.set(redactor, memo);
  }
  const cached = memo.get(value);
  if (cached) return { value: cached.value, counts: [...cached.counts] };
  const result = await redactor.text(value);
  const canonical = {
    value:
      result.value === value && Buffer.byteLength(value) <= 256
        ? value
        : redactedIdentity(identityDigest(value)),
    counts: result.counts,
  };
  if (memo.size >= IDENTITY_MEMO_LIMIT) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  memo.set(value, canonical);
  return { value: canonical.value, counts: [...canonical.counts] };
}

export const redactionContextSchema = z.strictObject({
  toolCalls: z
    .array(
      z.strictObject({
        idHash: sha256Schema,
        sensitive: z.boolean(),
      }),
    )
    .default([]),
  identities: z
    .array(
      z.strictObject({
        path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
        idHash: sha256Schema,
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

function sensitiveFile(path: string): boolean {
  const name = path.replaceAll("\\", "/").split("/").at(-1) ?? "";
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(name));
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

/**
 * Mask sensitive tool outputs before redaction. `knownCalls` are the classifications the
 * server already holds for this session (earlier batches); `uses` are the tool calls in
 * `records`, passed in when the caller has already normalized them.
 *
 * All source branches and historical versions participate in pairing. Displayed branch
 * selection must never decide which raw output receives protection.
 */
export function maskToolResults(
  normalizer: Normalizer,
  records: readonly SourceRecord[],
  knownCalls: readonly { idHash: string; sensitive: boolean }[] = [],
  uses: readonly NormalizedMessage[] = normalizer.toolUses(records),
): SourceRecord[] {
  const calls = new Map<string, boolean>();
  const sources = new Map(records.map((record) => [record.id, record]));
  const contexts = new Map(
    records.map((record) => [
      record.id,
      redactionContextSchema.parse(record.redactionContext ?? {}),
    ]),
  );
  for (const call of [
    ...knownCalls,
    ...records.flatMap((record) => record.redactionContext?.toolCalls ?? []),
  ])
    calls.set(call.idHash, (calls.get(call.idHash) ?? false) || call.sensitive);
  for (const use of uses) {
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
    const payload = structuredClone(jsonObjectSchema.parse(record.payload));
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
      uniqueBy(deferred, (record) => JSON.stringify([record.pos, record.key])),
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
    if (stored && stored.canonicalId === redactedIdentity(stored.idHash))
      continue;
    const redacted = await canonicalIdentity(location.id, redactor);
    counts.push(...redacted.counts);
    const idHash = stored?.idHash ?? identityDigest(location.id);
    const canonicalId =
      redacted.value === location.id ? location.id : redactedIdentity(idHash);
    if (stored) stored.canonicalId = canonicalId;
    else context.identities.push({ path: location.path, idHash, canonicalId });
  }
  const payload = jsonObjectSchema.parse(structuredClone(record.payload));
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
      payload: jsonObjectSchema.parse(redacted.value),
      redactionContext: context,
    },
    counts,
  };
}

/** Projection identity uses the durable digest so later policy changes cannot
 * split a use/result pair or tree edge across old and newly redacted records. */
export function projectionRecord(record: SourceRecord): SourceRecord {
  if (!record.redactionContext?.identities.length) return record;
  const payload = jsonObjectSchema.parse(structuredClone(record.payload));
  for (const identity of record.redactionContext.identities)
    if (valueAt(payload, identity.path) !== undefined)
      replaceAt(payload, identity.path, redactedIdentity(identity.idHash));
  return { ...record, payload };
}
export function projectionIdentity(value: string): string {
  return isRedactedIdentity(value)
    ? value
    : redactedIdentity(identityDigest(value));
}

/** The value at a JSON path: numbers index arrays, strings index objects, anything else is undefined. */
export function valueAt(
  value: unknown,
  path: readonly (string | number)[],
): unknown {
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
  const payload = jsonObjectSchema.parse(
    sanitizeRecord(z.json().parse(record.payload)),
  );
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
