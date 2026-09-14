import type {
  CommandPattern,
  ToolCall,
  ToolPolicy,
  ToolPolicyDecision,
  ToolPolicyRule,
} from "../schemas/tool-policy.js";

/**
 * The tool/command policy engine (ADR 0080): a pure function over data. Given a normalized
 * tool call and the organization's policy, it returns the decision the shim enforces and
 * the server records. No I/O, no per-harness branch: harness differences are data on the
 * rules and in the call the adapters normalize.
 *
 * Ordering is first-match-wins, like a firewall: rules are evaluated top to bottom and the
 * first rule that matches decides, so an explicit `allow` exception placed above a broad
 * `deny` whitelists a call. When no rule matches, or the policy is disabled, the call is
 * allowed; a policy only ever restricts.
 */

/** Longest command we scan; commands are bounded so a pattern cannot be made to run long. */
const MAX_COMMAND_SCAN = 16_384;

/** Glob with `*` (any run) and `?` (one char); everything else is a literal. Anchored. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${pattern}$`);
}

function toolMatches(rule: ToolPolicyRule, tool: string): boolean {
  if (rule.tool === "*") return true;
  if (!rule.tool.includes("*") && !rule.tool.includes("?"))
    return rule.tool === tool;
  return globToRegExp(rule.tool).test(tool);
}

/** A single pattern against the (bounded) command text. A bad regex never matches. */
function patternMatches(pattern: CommandPattern, command: string): boolean {
  if (pattern.kind === "substring") return command.includes(pattern.value);
  try {
    return new RegExp(pattern.value).test(command);
  } catch {
    return false;
  }
}

function ruleMatches(rule: ToolPolicyRule, call: ToolCall): boolean {
  if (rule.harnesses.length > 0 && !rule.harnesses.includes(call.harness))
    return false;
  if (!toolMatches(rule, call.tool)) return false;
  if (rule.command_patterns.length === 0) return true;
  const command = call.command;
  if (command === null) return false;
  const scanned =
    command.length > MAX_COMMAND_SCAN
      ? command.slice(0, MAX_COMMAND_SCAN)
      : command;
  return rule.command_patterns.some((pattern) =>
    patternMatches(pattern, scanned),
  );
}

const ALLOW: ToolPolicyDecision = {
  decision: "allow",
  matched_rule_id: null,
  severity: null,
  reason: null,
};

/** The single source of the enforcement decision, used by the shim and the server. */
export function evaluateToolCall(
  call: ToolCall,
  policy: ToolPolicy,
): ToolPolicyDecision {
  if (!policy.enabled) return ALLOW;
  for (const rule of policy.rules) {
    if (!ruleMatches(rule, call)) continue;
    return {
      decision: rule.action,
      matched_rule_id: rule.id,
      severity: rule.severity,
      reason:
        rule.description ??
        (rule.action === "deny"
          ? `Blocked by tool policy rule ${rule.id}.`
          : rule.action === "warn"
            ? `Flagged by tool policy rule ${rule.id}.`
            : null),
    };
  }
  return ALLOW;
}
