import { createHash } from "node:crypto";
import { RegExpParser } from "@eslint-community/regexpp";
import { checkSync } from "recheck";
import { getLengthRange } from "regexp-ast-analysis";
import { z } from "zod";
import { allowedRuleIds, builtinPatterns, preset } from "./rules.js";
import { storageText } from "./storage-text.js";

const literalText = z
  .string()
  .refine(
    (value) => storageText(value) === value,
    "Use valid Unicode text without NUL characters.",
  );

const commonFields = {
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
  replacement: literalText.min(1).max(256).optional(),
  enabled: z.boolean().default(true),
};

const regexParser = new RegExpParser();
type Safety = "safe" | "unsafe" | "unknown";
const validatedExpressions = new Map<string, Exclude<Safety, "unknown">>();
const incompleteAnalysis =
  "The safety check could not finish. Retry or simplify this pattern.";
function safeExpression(regex: RegExp): Safety {
  const identity = regex.toString();
  const cached = validatedExpressions.get(identity);
  if (cached !== undefined) return cached;
  const ast = regexParser.parseLiteral(regex.toString());
  if (getLengthRange(ast.pattern.alternatives, ast.flags).min === 0)
    return "unsafe";
  // Reject uncertain analyses as well as known attacks. Bound the checker before
  // secretlint ever evaluates a saved expression against transcript contents.
  let result: ReturnType<typeof checkSync>;
  try {
    result = checkSync(regex.source, regex.flags, {
      timeout: 5000,
      maxNFASize: 1000,
      // This selects the algorithm; it is not a safety or repetition limit.
      // A UUID uses 32 bounded repetitions and should stay on the automaton path.
      maxRepeatCount: 64,
    });
  } catch {
    return "unknown";
  }
  // A timeout is a transient inability to classify, not a lasting unsafe verdict.
  if (result.status === "unknown") return "unknown";
  const safety = result.status === "safe" ? "safe" : "unsafe";
  if (validatedExpressions.size >= 256) {
    const oldest = validatedExpressions.keys().next().value;
    if (oldest !== undefined) validatedExpressions.delete(oldest);
  }
  validatedExpressions.set(identity, safety);
  return safety;
}

/**
 * The safety verdict for a candidate regular expression, reusing the exact ReDoS and
 * empty-match analysis that guards saved redaction patterns (§5.3). `invalid` when the source
 * and flags do not compile. The tool/command policy (ADR 0080) runs every user-supplied
 * command regex through this before saving, so one implementation decides pattern safety for
 * both features. `safe` is the only verdict a caller should accept.
 */
export type ExpressionSafety = "safe" | "unsafe" | "unknown" | "invalid";
export function analyzeExpressionSafety(
  source: string,
  flags = "",
): ExpressionSafety {
  let regex: RegExp;
  try {
    regex = new RegExp(source, flags);
  } catch {
    return "invalid";
  }
  return safeExpression(regex);
}

/**
 * The structural definition of a policy without the backtracking analysis. Stored rows
 * were analysed when an admin saved them and the shipped patterns are verified by the
 * unit suite, so reads (session creation, rescans) never pay for `recheck` again.
 */
export const policyDefinitionShapeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...commonFields,
    kind: z.literal("REGEX"),
    pattern: literalText.min(1).max(1024),
    flags: z
      .string()
      .regex(/^[gimsu]*$/)
      .default("g"),
  }),
  z.strictObject({
    ...commonFields,
    kind: z.literal("SECRETLINT_RULE"),
    ruleId: z.enum(allowedRuleIds),
    // Scanner-specific allow patterns can only suppress that selected rule; the
    // rest of the shipped scanners still run. No executable or dynamic imports.
    options: z
      .strictObject({
        allows: z.array(literalText.min(1).max(1024)).max(50).optional(),
      })
      .default({}),
  }),
]);
/** The policy kinds, read from the definition so admin schemas and the dashboard list one set. */
export const policyKindSchema = z.enum(
  policyDefinitionShapeSchema.options.map((option) => option.shape.kind.value),
);
/** Definition plus the bounded backtracking analysis; use it wherever a pattern is saved. */
export const policyDefinitionSchema = policyDefinitionShapeSchema.superRefine(
  (policy, context) => {
    if (policy.kind === "REGEX") {
      try {
        const regex = new RegExp(policy.pattern, policy.flags);
        const safety = safeExpression(regex);
        if (safety !== "safe")
          context.addIssue({
            code: "custom",
            path: ["pattern"],
            message:
              safety === "unknown"
                ? incompleteAnalysis
                : "Use a pattern that cannot match empty text or cause excessive backtracking.",
          });
      } catch {
        context.addIssue({
          code: "custom",
          path: ["pattern"],
          message: "Enter a valid regular expression and flags.",
        });
      }
    } else {
      for (const allow of policy.options.allows ?? []) {
        // secretlint accepts /source/flags or a literal substring. Validate regex
        // forms using the same bounded/backtracking check as policy patterns.
        if (allow.startsWith("/")) {
          const separator = allow.lastIndexOf("/");
          try {
            if (separator < 1) throw new Error("Invalid allow expression");
            const safety = safeExpression(
              new RegExp(allow.slice(1, separator), allow.slice(separator + 1)),
            );
            if (safety !== "safe")
              context.addIssue({
                code: "custom",
                path: ["options", "allows"],
                message:
                  safety === "unknown"
                    ? incompleteAnalysis
                    : "Use valid allow patterns without excessive backtracking.",
              });
          } catch {
            context.addIssue({
              code: "custom",
              path: ["options", "allows"],
              message:
                "Use valid allow patterns without excessive backtracking.",
            });
          }
        }
      }
    }
  },
);

export type PolicyDefinition = z.output<typeof policyDefinitionSchema>;
export type RedactionPolicy = PolicyDefinition & {
  id: string;
  builtin: boolean;
};

export const builtinPolicies: RedactionPolicy[] = [
  {
    id: "builtin-preset",
    name: "secretlint",
    kind: "SECRETLINT_RULE",
    ruleId: preset.meta.id,
    options: {},
    enabled: true,
    builtin: true,
  },
  ...builtinPatterns.map(({ name, pattern }) => ({
    id: `builtin-${name}`,
    name,
    kind: "REGEX" as const,
    pattern,
    flags: "gi",
    enabled: true,
    builtin: true,
  })),
];

export function composePolicies(
  rows: readonly RedactionPolicy[],
): RedactionPolicy[] {
  const policies = new Map(
    builtinPolicies.map((policy) => [policy.name, policy]),
  );
  for (const row of rows) {
    const { id, builtin, ...definition } = row;
    policies.set(row.name, {
      ...policyDefinitionShapeSchema.parse(definition),
      id,
      builtin,
    });
  }
  return [...policies.values()].filter((policy) => policy.enabled);
}

/**
 * The identity of a composed policy set. Rows that compose to the same enabled
 * definitions (ids, names, kinds, patterns, options, replacements) hash alike in any row
 * order, so one compiled engine serves every transaction that sees those rows and a
 * changed, added, disabled or deleted row selects a different engine.
 */
export function policyFingerprint(rows: readonly RedactionPolicy[]): string {
  const composed = composePolicies(rows).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  return createHash("sha256").update(JSON.stringify(composed)).digest("hex");
}
