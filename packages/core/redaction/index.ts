import { lintSource } from "@secretlint/core";
import { secretLintProfiler } from "@secretlint/profiler";
import { z } from "zod";
import { composePolicies, policyFingerprint } from "./policy.js";
import type { RedactionPolicy } from "./policy.js";
import { pattern, preinstalledRules } from "./rules.js";
import type { JsonValue } from "../schemas/common.js";
import { protocolValue, type RedactionStructure } from "./structure.js";
import { storageText } from "./storage-text.js";
export * from "./structure.js";
export * from "./context.js";
export * from "./observations.js";

export * from "./policy.js";
export * from "./sanitize.js";
export * from "./tool-results.js";

type Config = Parameters<typeof lintSource>[0]["options"]["config"];
export type { JsonValue } from "../schemas/common.js";
export interface RedactionCount {
  policyId: string;
  name: string;
  count: number;
}
export interface RedactionResult<T> {
  value: T;
  counts: RedactionCount[];
}
const reportDataSchema = z.looseObject({ PATTERN_NAME: z.string().optional() });
// The library's profiler retains process-wide timing entries. Its supported switch
// disables that overhead for this long-running server without altering scanners.
secretLintProfiler.setEnabled(false);

// Redacting one string is a pure function of the policy set, and transcripts repeat the
// same JSON keys and protocol values (`type`, `userType=external`, versions, branches) on
// every record: 56 % of the scans in a 24-record Claude Code batch repeat an earlier one.
// Each engine keeps a bounded memo of scan results; long values are scanned every time.
const TEXT_MEMO_LIMIT = 8192;
const TEXT_MEMO_MAX_LENGTH = 1024;

export class Redactor {
  private readonly policies: Map<string, RedactionPolicy>;
  private readonly rulePolicies = new Map<string, RedactionPolicy>();
  private readonly config: Config;
  private readonly valuePatterns: Config;
  private readonly replacements: readonly string[];
  private readonly memo = new Map<string, RedactionResult<string>>();

  constructor(rows: readonly RedactionPolicy[] = []) {
    const policies = composePolicies(rows);
    this.policies = new Map(policies.map((policy) => [policy.name, policy]));
    this.replacements = [
      ...new Set(
        policies.map(
          (policy) => policy.replacement ?? `[REDACTED:${policy.name}]`,
        ),
      ),
    ];
    this.config = { rules: [] };
    const patterns = policies
      .filter((policy) => policy.kind === "REGEX")
      .map((policy) => ({
        name: policy.name,
        pattern: new RegExp(policy.pattern, policy.flags).toString(),
      }));
    this.valuePatterns = { rules: [] };
    if (patterns.length) {
      this.valuePatterns.rules.push({
        id: pattern.meta.id,
        rule: pattern,
        options: { patterns },
      });
      this.config.rules.push(...this.valuePatterns.rules);
    }
    const scanners = new Map<string, Config["rules"][number]>();
    for (const policy of policies) {
      if (policy.kind !== "SECRETLINT_RULE") continue;
      const rule = preinstalledRules.get(policy.ruleId);
      if (!rule) throw new Error("Redaction rule is not installed.");
      const selected = "rules" in rule ? rule.rules : [rule];
      for (const scanner of selected) {
        if (scanner.meta.id === "@secretlint/secretlint-rule-filter-comments")
          continue;
        scanners.set(scanner.meta.id, {
          id: scanner.meta.id,
          rule: scanner,
          options: policy.options,
        });
        this.rulePolicies.set(scanner.meta.id, policy);
      }
    }
    this.config.rules.push(...scanners.values());
  }

  async text(value: string, prefix = ""): Promise<RedactionResult<string>> {
    // No pattern may match empty text (policies reject such patterns), and a scanner hit
    // inside the prefix alone falls outside the value, so nothing can be replaced.
    if (value === "") return { value: "", counts: [] };
    const key =
      value.length <= TEXT_MEMO_MAX_LENGTH
        ? `${String(prefix.length)}:${prefix}${value}`
        : null;
    const cached = key === null ? undefined : this.memo.get(key);
    if (cached) return copyResult(cached);
    const result = await this.scan(value, prefix);
    if (key !== null) {
      if (this.memo.size >= TEXT_MEMO_LIMIT) {
        const oldest = this.memo.keys().next().value;
        if (oldest !== undefined) this.memo.delete(oldest);
      }
      this.memo.set(key, copyResult(result));
    }
    return result;
  }

  private async scan(
    value: string,
    prefix: string,
  ): Promise<RedactionResult<string>> {
    const sources = [
      { prefix, config: this.config },
      ...(prefix && this.valuePatterns.rules.length
        ? [{ prefix: "", config: this.valuePatterns }]
        : []),
    ];
    const scans = await Promise.all(
      sources.map(async ({ prefix, config }) => ({
        prefix,
        result: await lintSource({
          source: {
            content: prefix + value,
            filePath: "record.txt",
            contentType: "text",
          },
          options: { config, noPhysicFilePath: true },
        }),
      })),
    );
    const ranges = scans
      .flatMap(({ prefix, result }) =>
        result.messages.map((message) => {
          const data = reportDataSchema.safeParse(message.data);
          const name = data.success ? data.data.PATTERN_NAME : undefined;
          const policy = name
            ? this.policies.get(name)
            : this.rulePolicies.get(message.ruleId);
          return {
            start: Math.max(0, message.range[0] - prefix.length),
            end: message.range[1] - prefix.length,
            policy,
            name:
              name ??
              message.ruleId.replace("@secretlint/secretlint-rule-", ""),
          };
        }),
      )
      .filter((range) => range.end > range.start)
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const merged: typeof ranges = [];
    for (const range of ranges) {
      const previous = merged.at(-1);
      if (previous && range.start < previous.end)
        previous.end = Math.max(previous.end, range.end);
      else merged.push({ ...range });
    }
    // Replacements are exact, validated policy output, not a bracket-pattern
    // exemption. Keep those terminal tokens intact when a scanner matches them
    // again, including matches spanning both a marker and new surrounding text.
    const markers = this.replacements
      .flatMap((marker) => {
        const intervals: { start: number; end: number }[] = [];
        if (!marker) return intervals;
        let start = value.indexOf(marker);
        while (start >= 0) {
          intervals.push({ start, end: start + marker.length });
          start = value.indexOf(marker, start + marker.length);
        }
        return intervals;
      })
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const actionable = merged.flatMap((range) => {
      const pieces: typeof merged = [];
      let start = range.start;
      for (const marker of markers) {
        if (marker.end <= start) continue;
        if (marker.start >= range.end) break;
        if (marker.start > start)
          pieces.push({ ...range, start, end: marker.start });
        start = Math.max(start, marker.end);
        if (start >= range.end) break;
      }
      if (start < range.end) pieces.push({ ...range, start });
      return pieces;
    });
    const counts = new Map<string, RedactionCount>();
    let cursor = 0;
    let output = "";
    for (const range of actionable) {
      output +=
        value.slice(cursor, range.start) +
        (range.policy?.replacement ?? `[REDACTED:${range.name}]`);
      cursor = range.end;
      const policyId = range.policy?.id ?? `builtin-${range.name}`;
      const count = counts.get(policyId);
      if (count) count.count++;
      else counts.set(policyId, { policyId, name: range.name, count: 1 });
    }
    return {
      value: storageText(output + value.slice(cursor)),
      counts: [...counts.values()],
    };
  }

  async json(
    input: unknown,
    structure: RedactionStructure = {},
  ): Promise<RedactionResult<JsonValue>> {
    const value = z.json().parse(input);
    const counts = new Map<string, RedactionCount>();
    const redact = async (text: string, prefix = "") => {
      const result = await this.text(text, prefix);
      for (const count of result.counts) {
        const current = counts.get(count.policyId);
        if (current) current.count += count.count;
        else counts.set(count.policyId, { ...count });
      }
      return result.value;
    };
    const visit = async (
      node: JsonValue,
      shape: RedactionStructure = {},
    ): Promise<JsonValue> => {
      if (typeof node === "string")
        return protocolValue(node, shape) ? node : redact(node);
      if (Array.isArray(node)) {
        const items: JsonValue[] = [];
        for (const item of node) items.push(await visit(item, shape.items));
        return items;
      }
      if (node !== null && typeof node === "object") {
        const output: Record<string, JsonValue> = Object.create(null) as Record<
          string,
          JsonValue
        >;
        for (const [key, child] of Object.entries(node)) {
          const childShape = Object.hasOwn(shape.properties ?? {}, key)
            ? shape.properties?.[key]
            : undefined;
          const base = childShape ? key : await redact(key);
          let target = base;
          let suffix = 1;
          while (Object.hasOwn(output, target))
            target = `${base}#${String(suffix++)}`;
          if (typeof child === "string") {
            output[target] = protocolValue(child, childShape)
              ? child
              : await redact(child, `${key}=`);
          } else output[target] = await visit(child, childShape);
        }
        return output;
      }
      return node;
    };
    return {
      value: await visit(value, structure),
      counts: [...counts.values()],
    };
  }
}

/** Counts are returned as fresh objects so a caller aggregating them never edits the memo. */
function copyResult(result: RedactionResult<string>): RedactionResult<string> {
  return {
    value: result.value,
    counts: result.counts.map((count) => ({ ...count })),
  };
}

/**
 * Compiled engines shared by every policy cache in the process, keyed by organization and
 * the fingerprint of its composed policies (§5.3). A transaction still loads its own policy
 * rows and so always redacts with the rules it can see; only the compiled secretlint
 * configuration and its scan memo are reused, and a changed row fingerprint compiles anew.
 * Least recently used engines leave first once the bound is reached.
 */
export class CompiledRedactors {
  private readonly entries = new Map<string, Redactor>();
  constructor(private readonly limit = 128) {}
  get(organizationId: string, policies: readonly RedactionPolicy[]): Redactor {
    const key = `${organizationId}:${policyFingerprint(policies)}`;
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing;
    }
    const redactor = new Redactor(policies);
    if (this.entries.size >= this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, redactor);
    return redactor;
  }
  get size(): number {
    return this.entries.size;
  }
}
/** The process-wide engine store; caches share it unless a test injects its own. */
const compiledRedactors = new CompiledRedactors();

export class PolicyCache {
  private readonly entries = new Map<
    string,
    { expiresAt: number; redactor: Promise<Redactor> }
  >();
  constructor(
    private readonly load: (
      organizationId: string,
    ) => Promise<RedactionPolicy[]>,
    private readonly now: () => number = Date.now,
    private readonly compiled: CompiledRedactors = compiledRedactors,
  ) {}
  get(organizationId: string): Promise<Redactor> {
    const existing = this.entries.get(organizationId);
    if (existing && existing.expiresAt > this.now()) return existing.redactor;
    const redactor = this.load(organizationId).then((policies) =>
      this.compiled.get(organizationId, policies),
    );
    this.entries.set(organizationId, {
      expiresAt: this.now() + 30_000,
      redactor,
    });
    void redactor.catch(() => {
      if (this.entries.get(organizationId)?.redactor === redactor)
        this.invalidate(organizationId);
    });
    return redactor;
  }
  invalidate(organizationId: string): void {
    this.entries.delete(organizationId);
  }
}
