import {
  creator as preset,
  rules as presetRules,
} from "@secretlint/secretlint-rule-preset-recommend";
import { creator as pattern } from "@secretlint/secretlint-rule-pattern";
import type { lintSource } from "@secretlint/core";

// Scanner choices are fixed by the installed preset. In-band suppression is never
// enabled: transcript authors must not be able to disable server redaction.
type Rule = Parameters<
  typeof lintSource
>[0]["options"]["config"]["rules"][number]["rule"];
// secretlint 10.2.2 labels its comments filter as a scanner. Exclude the exact
// id so transcript authors cannot suppress this or any other configured rule.
const scannerRules: Exclude<Rule, { rules: unknown }>[] = presetRules.filter(
  (rule) =>
    rule.meta.type === "scanner" &&
    rule.meta.id !== "@secretlint/secretlint-rule-filter-comments",
);
export const preinstalledRules: Map<string, Rule> = new Map<string, Rule>([
  [preset.meta.id, preset] as const,
  ...scannerRules.map((rule) => [rule.meta.id, rule] as const),
]);
export const allowedRuleIds = [...preinstalledRules.keys()];
export { preset, pattern };

export const builtinPatterns = [
  { name: "anthropic", pattern: "\\bsk-ant-[A-Za-z0-9_-]{20,}\\b" },
  { name: "openai", pattern: "\\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\\b" },
  {
    name: "jwt",
    pattern:
      "(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])",
  },
  {
    name: "connection-string",
    pattern:
      "\\b(?:postgres(?:ql)?|mysql|mongodb(?:\\+srv)?|redis|amqps?|https?|ssh)://[^\\s/:@]+:[^\\s/@]+@[^\\s]+",
  },
  {
    name: "token",
    pattern:
      "\\b(?:api[_-]?key|access[_-]?token|token|secret|password)[\"']?\\s*[:=]\\s*[\"']?[A-Za-z0-9_./+=-]{12,}",
  },
  { name: "agentcommons", pattern: "\\bac_[A-Za-z0-9_-]{20,}\\b" },
] as const;
