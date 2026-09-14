import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { presetRules } from "@agentcommons/core/policy";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import type { paths } from "../../lib/api/generated";
import { errorMessage } from "../../lib/display";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "../../components/ui/dialog";
import { CheckboxField, Field } from "../../components/ui/field";
import { Alert } from "../../components/ui/feedback";
import { Input, NativeSelect } from "../../components/ui/input";

// The policy document as the client types it. One source: `harnesses` and
// `command_patterns` are required arrays on a read rule and optional on the write body, so a
// read rule is assignable to the replace body, and no z.infer/exactOptional mismatch arises.
type PolicyResponse =
  paths["/api/v1/admin/tool-policy"]["get"]["responses"][200]["content"]["application/json"];
export type ToolPolicyRule = PolicyResponse["rules"][number];
export type ToolPolicyDocument = {
  enabled: boolean;
  rules: ToolPolicyRule[];
};
type Harness = ToolPolicyRule["harnesses"][number];
type Action = ToolPolicyRule["action"];
type Severity = ToolPolicyRule["severity"];
type Pattern = ToolPolicyRule["command_patterns"][number];

const text = copy.admin.toolPolicy;
// Mirror the core enums, whose schema module is not shipped to the browser as values.
const harnesses: readonly Harness[] = [
  "CLAUDE_CODE",
  "CODEX",
  "GEMINI_CLI",
  "PI",
];
const actions: readonly Action[] = ["deny", "warn", "allow"];
const severities: readonly Severity[] = ["low", "medium", "high", "critical"];
const idExpression = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** A shipped preset rule normalized to the client type (no `description: undefined`). */
function normalizePreset(rule: {
  id: string;
  description?: string | undefined;
  harnesses: Harness[];
  tool: string;
  command_patterns: Pattern[];
  action: Action;
  severity: Severity;
}): ToolPolicyRule {
  const { description, ...rest } = rule;
  return description ? { ...rest, description } : rest;
}
/** The preset rules an admin has removed, offered for one-click restore. */
export function missingPresetRules(
  rules: readonly ToolPolicyRule[],
): ToolPolicyRule[] {
  const present = new Set(rules.map((rule) => rule.id));
  return presetRules()
    .filter((rule) => !present.has(rule.id))
    .map(normalizePreset);
}

interface Draft {
  id: string;
  description: string;
  harnesses: Harness[];
  tool: string;
  patterns: Pattern[];
  action: Action;
  severity: Severity;
}
function draftFor(rule: ToolPolicyRule | null): Draft {
  return {
    id: rule?.id ?? "",
    description: rule?.description ?? "",
    harnesses: rule?.harnesses ?? [],
    tool: rule?.tool ?? "*",
    patterns: (rule?.command_patterns ?? []).map((pattern) => ({ ...pattern })),
    action: rule?.action ?? "deny",
    severity: rule?.severity ?? "high",
  };
}
function toRule(draft: Draft): ToolPolicyRule {
  const description = draft.description.trim();
  return {
    id: draft.id.trim(),
    ...(description ? { description } : {}),
    harnesses: draft.harnesses,
    tool: draft.tool.trim(),
    command_patterns: draft.patterns
      .map((pattern) => ({ kind: pattern.kind, value: pattern.value }))
      .filter((pattern) => pattern.value.trim() !== ""),
    action: draft.action,
    severity: draft.severity,
  };
}

/** Replace `document`'s policy whole; add or edit `rule`. `null` adds a new rule. */
export function RuleDialog({
  open,
  rule,
  document,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  rule: ToolPolicyRule | null;
  document: ToolPolicyDocument;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title={rule ? text.edit : text.add}
          description={rule ? text.editDescription : text.addDescription}
        />
        {open && (
          <RuleForm
            key={rule?.id ?? "new"}
            rule={rule}
            document={document}
            onSaved={async () => {
              await onSaved();
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
function RuleForm({
  rule,
  document,
  onSaved,
}: {
  rule: ToolPolicyRule | null;
  document: ToolPolicyDocument;
  onSaved: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFor(rule));
  const [localError, setLocalError] = useState<string | null>(null);
  const editing = rule !== null;
  const save = useMutation({
    mutationFn: async () => {
      const built = toRule(draft);
      const rules = editing
        ? document.rules.map((current) =>
            current.id === rule.id ? built : current,
          )
        : [...document.rules, built];
      return unwrap(
        await api.PUT("/api/v1/admin/tool-policy", {
          body: { enabled: document.enabled, rules },
        }),
      );
    },
    onSuccess: onSaved,
  });
  const patch = (partial: Partial<Draft>) => {
    setDraft((prior) => ({ ...prior, ...partial }));
  };
  const setPattern = (index: number, partial: Partial<Pattern>) => {
    patch({
      patterns: draft.patterns.map((pattern, at) =>
        at === index ? { ...pattern, ...partial } : pattern,
      ),
    });
  };
  const toggleHarness = (harness: Harness, on: boolean) => {
    // A Set add/remove, not a per-harness branch: the harness value is data here.
    const next = new Set(draft.harnesses);
    if (on) next.add(harness);
    else next.delete(harness);
    patch({ harnesses: [...next] });
  };
  const submit = () => {
    const id = draft.id.trim();
    if (!idExpression.test(id)) {
      setLocalError(text.ruleIdHint);
      return;
    }
    if (!editing && document.rules.some((current) => current.id === id)) {
      setLocalError(text.duplicateId);
      return;
    }
    setLocalError(null);
    save.mutate();
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field label={text.ruleId} hint={text.ruleIdHint}>
        {(props) => (
          <Input
            {...props}
            required
            autoFocus={!editing}
            maxLength={64}
            pattern="[a-z0-9][a-z0-9_\-]{0,63}"
            className="font-mono text-xs"
            value={draft.id}
            disabled={editing || save.isPending}
            onChange={(event) => {
              patch({ id: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label={text.descriptionLabel} hint={text.descriptionHint}>
        {(props) => (
          <Input
            {...props}
            maxLength={200}
            value={draft.description}
            disabled={save.isPending}
            onChange={(event) => {
              patch({ description: event.target.value });
            }}
          />
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{text.harnesses}</legend>
        <p className="text-xs text-muted">{text.harnessesHint}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {harnesses.map((harness) => (
            <CheckboxField
              key={harness}
              label={copy.app.harnesses[harness]}
              checked={draft.harnesses.includes(harness)}
              disabled={save.isPending}
              onCheckedChange={(checked) => {
                toggleHarness(harness, checked === true);
              }}
            />
          ))}
        </div>
      </fieldset>
      <Field label={text.tool} hint={text.toolHint}>
        {(props) => (
          <Input
            {...props}
            required
            maxLength={128}
            className="font-mono text-xs"
            value={draft.tool}
            disabled={save.isPending}
            onChange={(event) => {
              patch({ tool: event.target.value });
            }}
          />
        )}
      </Field>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{text.patterns}</p>
        <p className="text-xs text-muted">{text.patternsHint}</p>
        <div className="flex flex-col gap-2">
          {draft.patterns.map((pattern, index) => (
            <div key={index} className="flex items-start gap-2">
              <NativeSelect
                aria-label={text.patternKind}
                className="w-28 shrink-0"
                value={pattern.kind}
                disabled={save.isPending}
                onChange={(event) => {
                  setPattern(index, {
                    kind:
                      event.target.value === "regex" ? "regex" : "substring",
                  });
                }}
              >
                <option value="substring">{text.patternSubstring}</option>
                <option value="regex">{text.patternRegex}</option>
              </NativeSelect>
              <Input
                aria-label={text.patternValue}
                maxLength={512}
                className="font-mono text-xs"
                placeholder={text.patternValue}
                value={pattern.value}
                disabled={save.isPending}
                onChange={(event) => {
                  setPattern(index, { value: event.target.value });
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={text.removePattern}
                disabled={save.isPending}
                onClick={() => {
                  patch({
                    patterns: draft.patterns.filter((_, at) => at !== index),
                  });
                }}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
        </div>
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={save.isPending || draft.patterns.length >= 32}
            onClick={() => {
              patch({
                patterns: [...draft.patterns, { kind: "substring", value: "" }],
              });
            }}
          >
            <Plus aria-hidden />
            {text.addPattern}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={text.action}>
          {(props) => (
            <NativeSelect
              {...props}
              value={draft.action}
              disabled={save.isPending}
              onChange={(event) => {
                patch({
                  action:
                    actions.find((option) => option === event.target.value) ??
                    "deny",
                });
              }}
            >
              {actions.map((action) => (
                <option key={action} value={action}>
                  {text.actions[action]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={text.severity}>
          {(props) => (
            <NativeSelect
              {...props}
              value={draft.severity}
              disabled={save.isPending}
              onChange={(event) => {
                patch({
                  severity:
                    severities.find(
                      (option) => option === event.target.value,
                    ) ?? "high",
                });
              }}
            >
              {severities.map((severity) => (
                <option key={severity} value={severity}>
                  {text.severities[severity]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      {localError && <Alert variant="danger">{localError}</Alert>}
      {save.error && <Alert variant="danger">{errorMessage(save.error)}</Alert>}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary" disabled={save.isPending}>
            {copy.app.common.cancel}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? copy.app.common.saving : copy.app.common.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
