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

/**
 * An optional quote, possibly JSON-escaped. A command inside a JSON string (Codex tool
 * arguments) escapes its quotes, so patterns step over `\"` around a value but never consume
 * a backslash before a closing quote: the redacted arguments must stay valid JSON for the
 * projection to parse them.
 */
const quote = String.raw`\\?["']?`;

export const builtinPatterns = [
  { name: "anthropic", pattern: "\\bsk-ant-[A-Za-z0-9_-]{20,}\\b" },
  { name: "openai", pattern: "\\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\\b" },
  {
    name: "jwt",
    pattern:
      "(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])",
  },
  {
    // Any scheme, since a password in a URL is a secret whatever the driver (`rediss`,
    // `postgresql+psycopg2`), and the user may be empty (`redis://:password@host`).
    name: "connection-string",
    pattern: String.raw`(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,31}://[^\s/:@]*:[^\s/@]+@[^\s"'\\]+`,
  },
  {
    // The secret word may end a longer name (`DB_PASSWORD`, `client_secret`, `clientSecret`,
    // `aws_secret_access_key`, `_authToken`); the match starts at the word, so the name's
    // head stays readable. A value may contain JSON-escaped slashes (`\/`).
    name: "token",
    pattern: String.raw`(?:(?:api|access|account)[_-]?key|token|secret|password|passwd)(?:[_-]?key)?${quote}\s*(?:=>|[:=])\s*${quote}(?:[A-Za-z0-9_./+=!@#$%^&*~-]|\\/){12,}`,
  },
  {
    name: "authorization",
    pattern: String.raw`\b(?:authorization${quote}\s*[:=]\s*${quote}(?:bearer|basic|token)|bearer)\s+[A-Za-z0-9._~+/=-]{16,}`,
  },
  {
    name: "aws-access-key-id",
    pattern:
      "\\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\\b",
  },
  { name: "stripe-webhook", pattern: "\\bwhsec_[A-Za-z0-9]{24,}\\b" },
  {
    // Until secretlint's AWS rule was patched, its range was the secret's length from the
    // start of the key name, so text stored then keeps the secret's tail right after the
    // marker, or the whole 40-character secret after the separator when the name and padding
    // filled the range. A rescan replaces the marker with what it left.
    name: "aws-residue",
    pattern: String.raw`\[REDACTED:aws\](?:[A-Za-z0-9/+=]{1,40}|[ \t:=>"']+[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=]))`,
  },
  { name: "agentcommons", pattern: "\\bac_[A-Za-z0-9_-]{20,}\\b" },
] as const;

/**
 * File names whose tool output is masked before redaction (R-RED-05), matched against the
 * path's last segment: dotenv files, private keys, SSH identities, credential stores and
 * package-manager auth files.
 */
export const SENSITIVE_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env/,
  /\.pem$/,
  /\.key$/,
  /^id_rsa/,
  /^credentials/,
  /^\.npmrc$/,
  /^\.netrc$/,
];
