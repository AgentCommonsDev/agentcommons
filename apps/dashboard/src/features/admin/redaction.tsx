import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { z } from "zod";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import type { paths } from "../../lib/api/generated";
import { redactionRuleIds } from "../../lib/api/options";
import { errorMessage, number } from "../../lib/display";
import type { Policy } from "../../lib/types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "../../components/ui/dialog";
import { CheckboxField, Field } from "../../components/ui/field";
import { Alert } from "../../components/ui/feedback";
import { Input, NativeSelect, Textarea } from "../../components/ui/input";
import { ProgressBar } from "../../components/app/display";
import { CodeBlock } from "../../components/app/markdown";
import { RequestError, StatusBadge } from "../../components/app/states";

type PolicyBody =
  paths["/api/v1/admin/redaction/policies"]["post"]["requestBody"]["content"]["application/json"];
const presetRuleId = "@secretlint/secretlint-rule-preset-recommend";
const ruleSchema = z.enum(redactionRuleIds);
type RuleId = z.infer<typeof ruleSchema>;
const ruleLabel = (id: string) =>
  id.replace("@secretlint/secretlint-rule-", "");
const ruleDocsUrl = (id: RuleId) =>
  `https://github.com/secretlint/secretlint/blob/master/packages/${id
    .split("/")
    .map(encodeURIComponent)
    .join("/")}/README.md`;
const text = copy.admin.redaction;

/** Allow patterns stored in a secretlint policy's options. */
function allowsOf(options: unknown): string[] {
  if (typeof options !== "object" || options === null || !("allows" in options))
    return [];
  const allows = options.allows;
  return Array.isArray(allows)
    ? allows.filter((value): value is string => typeof value === "string")
    : [];
}
/** The saved row converted back into the input the API accepts, with optional overrides. */
export function policyBody(
  policy: Policy,
  overrides: { enabled?: boolean } = {},
): PolicyBody {
  const common = {
    name: policy.name,
    replacement: policy.replacement,
    enabled: overrides.enabled ?? policy.enabled,
  };
  if (policy.kind === "REGEX")
    return {
      ...common,
      kind: "REGEX",
      pattern: policy.pattern ?? "",
      flags: policy.flags ?? "g",
    };
  const allows = allowsOf(policy.options);
  return {
    ...common,
    kind: "SECRETLINT_RULE",
    ruleId: ruleSchema.parse(policy.rule_id),
    options: allows.length > 0 ? { allows } : {},
  };
}
/** Whether an enabled policy already runs the recommended preset. */
export function usePresetEnabled(organizationId: string) {
  return useQuery({
    queryKey: [organizationId, "admin", "policies", "preset"],
    queryFn: async ({ signal }) => {
      const page = unwrap(
        await api.GET("/api/v1/admin/redaction/policies", {
          params: {
            query: {
              filters: { kind: "SECRETLINT_RULE", enabled: true },
              limit: 100,
              format: "json",
            },
          },
          signal,
        }),
      );
      return page.items.some((policy) => policy.rule_id === presetRuleId);
    },
  });
}
export function RuleLink({ id }: { id: string | null }) {
  const known = ruleSchema.safeParse(id);
  if (!known.success)
    return (
      <span className="font-mono text-xs">
        {id ?? copy.app.common.unavailable}
      </span>
    );
  return (
    <a
      href={ruleDocsUrl(known.data)}
      target="_blank"
      rel="noreferrer"
      title={text.ruleDocs}
      className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline"
    >
      {ruleLabel(known.data)}
      <ExternalLink size={12} aria-hidden />
    </a>
  );
}

interface Draft {
  name: string;
  kind: Policy["kind"];
  pattern: string;
  flags: string;
  replacement: string;
  enabled: boolean;
  ruleId: RuleId;
  allows: string;
}
function draftFor(policy: Policy | null): Draft {
  const rule = ruleSchema.safeParse(policy?.rule_id);
  return {
    name: policy?.name ?? "",
    kind: policy?.kind ?? "REGEX",
    pattern: policy?.pattern ?? "",
    flags: policy?.flags ?? "g",
    replacement: policy?.replacement ?? "",
    enabled: policy?.enabled ?? true,
    ruleId: rule.success ? rule.data : redactionRuleIds[0],
    allows: allowsOf(policy?.options).join("\n"),
  };
}
function toBody(draft: Draft, ruleId: RuleId): PolicyBody {
  const replacement = draft.replacement.trim();
  const common = {
    name: draft.name.trim(),
    enabled: draft.enabled,
    ...(replacement ? { replacement } : {}),
  };
  if (draft.kind === "REGEX")
    return {
      ...common,
      kind: "REGEX",
      pattern: draft.pattern,
      flags: draft.flags.trim(),
    };
  const allows = draft.allows
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    ...common,
    kind: "SECRETLINT_RULE",
    ruleId,
    options: allows.length > 0 ? { allows } : {},
  };
}
type Preview = { output: string; count: number } | { invalid: true } | null;
function previewRegex(draft: Draft, sample: string): Preview {
  if (!sample || !draft.pattern) return null;
  try {
    const flags = draft.flags.includes("g") ? draft.flags : `${draft.flags}g`;
    const regex = new RegExp(draft.pattern, flags);
    const replacement =
      draft.replacement.trim() || `[REDACTED:${draft.name.trim() || "name"}]`;
    let count = 0;
    const output = sample.replace(regex, () => {
      count += 1;
      return replacement;
    });
    return { output, count };
  } catch {
    return { invalid: true };
  }
}
function ruleOptionLabel(id: RuleId, presetEnabled: boolean): string {
  const label = ruleLabel(id);
  return presetEnabled && id !== presetRuleId
    ? `${label} (${text.includedByPreset})`
    : label;
}

export function PolicyDialog({
  open,
  policy,
  presetEnabled,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  /** `null` creates a new policy. */
  policy: Policy | null;
  presetEnabled: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title={policy ? text.edit : text.add}
          description={policy ? text.editDescription : text.addDescription}
        />
        {open && (
          <PolicyForm
            key={policy?.id ?? "new"}
            policy={policy}
            presetEnabled={presetEnabled}
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
function PolicyForm({
  policy,
  presetEnabled,
  onSaved,
}: {
  policy: Policy | null;
  presetEnabled: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFor(policy));
  const [sample, setSample] = useState("");
  const builtin = policy?.builtin ?? false;
  const ruleOptions = redactionRuleIds.filter(
    (id) =>
      id !== presetRuleId || !presetEnabled || policy?.rule_id === presetRuleId,
  );
  const ruleId =
    ruleOptions.find((id) => id === draft.ruleId) ??
    ruleOptions[0] ??
    draft.ruleId;
  const save = useMutation({
    mutationFn: async () => {
      const body = toBody(draft, ruleId);
      return policy
        ? unwrap(
            await api.PATCH("/api/v1/admin/redaction/policies/{id}", {
              params: { path: { id: policy.id } },
              body,
            }),
          )
        : unwrap(await api.POST("/api/v1/admin/redaction/policies", { body }));
    },
    onSuccess: onSaved,
  });
  const preview = useMemo(() => previewRegex(draft, sample), [draft, sample]);
  const patch = (partial: Partial<Draft>) => {
    setDraft((prior) => ({ ...prior, ...partial }));
  };
  const advanced = draft.kind === "SECRETLINT_RULE";
  const AdvancedIcon = advanced ? ChevronDown : ChevronRight;
  const previewLine =
    preview === null
      ? null
      : "invalid" in preview
        ? text.previewInvalid
        : preview.count === 0
          ? text.previewNoMatches
          : text.previewMatches(preview.count);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Field label={text.name} hint={text.nameHint}>
        {(props) => (
          <Input
            {...props}
            required
            autoFocus={!builtin}
            maxLength={64}
            pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{0,63}"
            value={draft.name}
            disabled={builtin || save.isPending}
            onChange={(event) => {
              patch({ name: event.target.value });
            }}
          />
        )}
      </Field>
      {advanced ? (
        <>
          <Field label={text.rule} hint={text.advancedHint}>
            {(props) => (
              <NativeSelect
                {...props}
                value={ruleId}
                disabled={builtin || save.isPending}
                onChange={(event) => {
                  patch({ ruleId: ruleSchema.parse(event.target.value) });
                }}
              >
                {ruleOptions.map((id) => (
                  <option key={id} value={id}>
                    {ruleOptionLabel(id, presetEnabled)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <RuleLink id={ruleId} />
          <Field label={text.allows} hint={text.allowsHint}>
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                className="font-mono text-xs"
                value={draft.allows}
                disabled={save.isPending}
                onChange={(event) => {
                  patch({ allows: event.target.value });
                }}
              />
            )}
          </Field>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_6rem]">
          <Field label={text.pattern} hint={text.patternHint}>
            {(props) => (
              <Input
                {...props}
                required
                maxLength={1024}
                className="font-mono text-xs"
                value={draft.pattern}
                disabled={save.isPending}
                onChange={(event) => {
                  patch({ pattern: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label={text.flags} hint={text.flagsHint}>
            {(props) => (
              <Input
                {...props}
                pattern="[gimsu]*"
                maxLength={5}
                className="font-mono text-xs"
                value={draft.flags}
                disabled={save.isPending}
                onChange={(event) => {
                  patch({ flags: event.target.value });
                }}
              />
            )}
          </Field>
        </div>
      )}
      <Field label={text.replacement} hint={text.replacementHint(draft.name)}>
        {(props) => (
          <Input
            {...props}
            maxLength={256}
            className="font-mono text-xs"
            value={draft.replacement}
            disabled={save.isPending}
            onChange={(event) => {
              patch({ replacement: event.target.value });
            }}
          />
        )}
      </Field>
      {!advanced && (
        <Field label={text.preview} hint={text.previewHint}>
          {(props) => (
            <div className="flex flex-col gap-2">
              <Textarea
                {...props}
                rows={3}
                className="font-mono text-xs"
                value={sample}
                onChange={(event) => {
                  setSample(event.target.value);
                }}
              />
              {previewLine && (
                <p
                  className={
                    preview && "invalid" in preview
                      ? "text-xs text-danger"
                      : "text-xs text-muted"
                  }
                  role="status"
                >
                  {previewLine}
                </p>
              )}
              {preview && "output" in preview && preview.count > 0 && (
                <CodeBlock content={preview.output} maxHeight="max-h-40" />
              )}
            </div>
          )}
        </Field>
      )}
      {!builtin && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={advanced}
          // The label is a sentence; on a 320 px phone it wraps rather than widening the dialog.
          className="h-auto max-w-full self-start px-2 py-1.5 text-left whitespace-normal text-muted"
          onClick={() => {
            patch({ kind: advanced ? "REGEX" : "SECRETLINT_RULE" });
          }}
        >
          <AdvancedIcon aria-hidden />
          {advanced ? text.regexInstead : text.advanced}
        </Button>
      )}
      <CheckboxField
        label={text.enabled}
        hint={text.enabledHint}
        checked={draft.enabled}
        disabled={save.isPending}
        onCheckedChange={(checked) => {
          patch({ enabled: checked === true });
        }}
      />
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

export function TestRedactionCard({
  policies,
}: {
  policies: readonly Policy[];
}) {
  const [sample, setSample] = useState("");
  const test = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/api/v1/admin/redaction/test", {
          body: { text: sample },
        }),
      ),
  });
  const policyName = (id: string) =>
    policies.find((policy) => policy.id === id)?.name ?? id;
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{text.test}</CardTitle>
          <CardDescription>{text.testDescription}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            test.mutate();
          }}
        >
          <Field label={text.testText}>
            {(props) => (
              <Textarea
                {...props}
                rows={4}
                className="font-mono text-xs"
                value={sample}
                onChange={(event) => {
                  setSample(event.target.value);
                }}
              />
            )}
          </Field>
          <div>
            <Button
              type="submit"
              variant="secondary"
              disabled={test.isPending || sample.trim() === ""}
            >
              {test.isPending ? text.running : text.run}
            </Button>
          </div>
          {test.error && (
            <Alert variant="danger">{errorMessage(test.error)}</Alert>
          )}
          {test.data && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="text-xs text-muted">{text.result}</p>
                <CodeBlock content={test.data.text} maxHeight="max-h-80" />
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted">{text.matches}</p>
                {test.data.matches.length === 0 ? (
                  <p className="text-sm text-muted">{text.noMatches}</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {test.data.matches.map((match) => (
                      <li
                        key={match.policy_id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Badge variant="accent">
                          {policyName(match.policy_id)}
                        </Badge>
                        <span className="tabular-nums text-muted">
                          {number(match.count)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function RescanProgressCard({
  organizationId,
  jobId,
  onDismiss,
}: {
  organizationId: string;
  jobId: string;
  onDismiss: () => void;
}) {
  const progress = useQuery({
    queryKey: [organizationId, "admin", "rescan", jobId],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/admin/redaction/rescan/{id}", {
          params: { path: { id: jobId } },
          signal,
        }),
      ),
    refetchInterval: (query) =>
      query.state.data?.state === "completed" ||
      query.state.data?.state === "failed"
        ? false
        : 2000,
  });
  const data = progress.data;
  const description = [text.job, jobId].join(copy.app.common.separator);
  return (
    <Card role="status" aria-live="polite">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{text.progress}</CardTitle>
          <CardDescription className="font-mono text-xs break-all">
            {description}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {data && <StatusBadge value={data.state} />}
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            {text.dismiss}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {progress.error && (
          <RequestError
            error={progress.error}
            retry={() => {
              void progress.refetch();
            }}
          />
        )}
        {data && (
          <>
            <ProgressBar
              value={data.processed_sessions}
              max={Math.max(1, data.total_sessions)}
              label={text.progress}
              tone={data.state === "failed" ? "danger" : "primary"}
            />
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex items-baseline gap-1.5">
                <dt className="text-muted">{text.processed}</dt>
                <dd className="tabular-nums">
                  {number(data.processed_sessions)}
                  {copy.app.common.fractionSeparator}
                  {number(data.total_sessions)}
                </dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-muted">{text.redactions}</dt>
                <dd className="tabular-nums">{number(data.redaction_count)}</dd>
              </div>
            </dl>
            {data.error && <Alert variant="danger">{data.error}</Alert>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
