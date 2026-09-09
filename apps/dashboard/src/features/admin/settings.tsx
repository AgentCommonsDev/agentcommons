import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  builtinDashboardId,
  builtinDashboardIds,
} from "@agentcommons/core/schemas/dashboards";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { useBillingConfig } from "../../lib/billing-config";
import { errorMessage, number } from "../../lib/display";
import { paths } from "../../lib/routes";
import { useWorkspace } from "../../components/app/workspace";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import {
  CopyButton,
  DefinitionList,
  LoadingState,
  RequestError,
  StatusBadge,
} from "../../components/app/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Field, Label, Switch } from "../../components/ui/field";
import { Alert, EmptyState } from "../../components/ui/feedback";
import { Input, NativeSelect } from "../../components/ui/input";
import { ProgressBar } from "./display";

export function GeneralCard() {
  const { organization } = useWorkspace();
  const text = copy.settings.general;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{text.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <DefinitionList
          columns={2}
          items={[
            { label: text.name, value: organization.name },
            {
              label: text.role,
              value: <StatusBadge value={organization.role} />,
            },
            {
              label: text.id,
              value: (
                <>
                  <span className="font-mono text-xs break-all">
                    {organization.id}
                  </span>
                  <CopyButton value={organization.id} />
                </>
              ),
            },
            {
              label: text.slug,
              value: (
                <span className="font-mono text-xs">{organization.slug}</span>
              ),
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}

export function EmbeddingsCard() {
  const { organization } = useWorkspace();
  const billing = useBillingConfig();
  const client = useQueryClient();
  const switchId = useId();
  const text = copy.settings.embeddings;
  const [confirm, setConfirm] = useState<boolean | null>(null);
  const queryKey = [organization.id, "organization-embeddings"];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/organization/embeddings", { signal })),
    refetchInterval: (state) =>
      state.state.data?.effective && state.state.data.sessions_pending > 0
        ? 10_000
        : false,
  });
  const data = query.data;
  const canToggle = data
    ? data.enabled || (data.available && data.entitled)
    : false;
  return (
    <Card data-testid="settings-embeddings">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{text.title}</CardTitle>
          <CardDescription>{text.description}</CardDescription>
        </div>
        {data && (
          <div className="flex items-center gap-2.5">
            <Label htmlFor={switchId}>{text.toggle}</Label>
            <Switch
              id={switchId}
              checked={data.enabled}
              disabled={!canToggle}
              onCheckedChange={(next) => {
                setConfirm(next);
              }}
            />
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.isPending && <LoadingState rows={2} />}
        {query.error && (
          <RequestError
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        )}
        {data && (
          <>
            {!data.available && (
              <Alert variant="info">{text.unavailable}</Alert>
            )}
            {data.available && billing.enabled && !data.entitled && (
              <Alert
                variant="warning"
                action={
                  <Button asChild variant="secondary" size="sm">
                    <a href={paths.billing}>{text.viewPlans}</a>
                  </Button>
                }
              >
                {text.notEntitled}
              </Alert>
            )}
            {data.last_attempt === "failed" && (
              <Alert variant="danger">{text.failed}</Alert>
            )}
            {data.available && data.enabled && data.last_attempt === null && (
              <Alert variant="info">{text.unchecked}</Alert>
            )}
            {data.provider === "fake" && (
              <Alert variant="info">{text.fake}</Alert>
            )}
            <p className="text-sm leading-relaxed text-muted">
              {data.effective ? text.enabledHint : text.disabledHint}
            </p>
            <DefinitionList
              columns={3}
              items={[
                {
                  label: text.provider,
                  value: data.provider ?? copy.app.common.unavailable,
                },
                {
                  label: text.model,
                  value: data.model ?? copy.app.common.unavailable,
                },
                { label: text.total, value: number(data.sessions_total) },
                { label: text.indexed, value: number(data.sessions_indexed) },
                { label: text.pending, value: number(data.sessions_pending) },
              ]}
            />
            {data.effective && data.sessions_total > 0 && (
              <ProgressBar
                value={data.sessions_indexed}
                max={data.sessions_total}
                label={text.indexed}
              />
            )}
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm ? text.enableTitle : text.disableTitle}
        description={confirm ? text.enableDescription : text.disableDescription}
        confirmLabel={confirm ? text.enable : text.disable}
        destructive={false}
        action={async (reason) => {
          if (confirm === null) return;
          const value = unwrap(
            await api.PATCH("/api/v1/organization/embeddings", {
              body: { enabled: confirm, reason },
            }),
          );
          client.setQueryData(queryKey, value);
          await Promise.all([
            client.invalidateQueries({ queryKey: [organization.id] }),
            client.invalidateQueries({ queryKey: ["auth-config"] }),
          ]);
        }}
      />
    </Card>
  );
}

export function DomainsCard() {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const text = copy.settings.domains;
  const [domain, setDomain] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const queryKey = [organization.id, "admin", "domains"];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/admin/domains", {
          params: { query: { limit: 100, sort: "domain", order: "asc" } },
          signal,
        }),
      ),
  });
  const add = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/api/v1/admin/domains", {
          body: { domain: domain.trim().toLowerCase() },
        }),
      ),
    onSuccess: async (result) => {
      setAdded(result.domain);
      setDomain("");
      await client.invalidateQueries({ queryKey });
    },
  });
  const enabled = query.data?.enabled ?? false;
  return (
    <Card data-testid="settings-domains">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{text.title}</CardTitle>
          <CardDescription>{text.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.data && !enabled && (
          <Alert variant="info">{text.disabled}</Alert>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAdded(null);
            add.mutate();
          }}
        >
          <Field label={text.domain} hint={text.hint}>
            {(props) => (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  {...props}
                  required
                  maxLength={253}
                  placeholder={text.placeholder}
                  className="sm:max-w-sm"
                  value={domain}
                  disabled={!enabled || add.isPending}
                  onChange={(event) => {
                    setDomain(event.target.value);
                  }}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={!enabled || add.isPending || domain.trim() === ""}
                >
                  {add.isPending ? text.adding : text.add}
                </Button>
              </div>
            )}
          </Field>
        </form>
        {add.error && <Alert variant="danger">{errorMessage(add.error)}</Alert>}
        {added && <Alert variant="success">{text.added(added)}</Alert>}
        {query.isPending ? (
          <LoadingState rows={2} />
        ) : query.error ? (
          <RequestError
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        ) : query.data.items.length === 0 ? (
          <EmptyState compact title={text.empty} description={text.emptyHint} />
        ) : (
          <ul className="divide-y divide-line-soft rounded-md border border-line">
            {query.data.items.map((item) => (
              <li
                key={item.domain}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate font-mono">
                  {item.domain}
                </span>
                <Badge variant="success">{text.allowed}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function DefaultDashboardCard() {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const text = copy.settings.dashboard;
  const [choice, setChoice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: [organization.id, "dashboards", "settings"],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/dashboards", { signal })),
  });
  const current = query.data?.default_id ?? null;
  const value = choice ?? current ?? builtinDashboardId;
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/api/v1/dashboards/{id}/default", {
          params: { path: { id: value } },
          body: {},
        }),
      ),
    onSuccess: async () => {
      setChoice(null);
      await client.invalidateQueries({
        predicate: (item) =>
          JSON.stringify(item.queryKey).includes("dashboard"),
      });
    },
  });
  // Only saved dashboards and the shipped Team overview may be the Home default;
  // the other built-ins are rejected by the API.
  const eligible = (query.data?.items ?? []).filter(
    (item) => !item.builtin || item.id === builtinDashboardIds.teamOverview,
  );
  const selected = eligible.find((item) => item.id === value);
  const optionLabel = (item: { name: string; builtin: boolean }) =>
    item.builtin ? `${item.name} (${text.builtin})` : item.name;
  return (
    <Card data-testid="settings-default-dashboard">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{text.title}</CardTitle>
          <CardDescription>{text.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {query.isPending && <LoadingState rows={1} />}
        {query.error && (
          <RequestError
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        )}
        {query.data && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <Field label={text.select} hint={text.builtinHint}>
              {(props) => (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <NativeSelect
                    {...props}
                    className="sm:max-w-md"
                    value={value}
                    disabled={save.isPending}
                    onChange={(event) => {
                      setChoice(event.target.value);
                    }}
                  >
                    {eligible.map((item) => (
                      <option key={item.id} value={item.id}>
                        {optionLabel(item)}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    type="submit"
                    disabled={save.isPending || value === current}
                  >
                    {save.isPending
                      ? copy.app.common.saving
                      : copy.app.common.save}
                  </Button>
                </div>
              )}
            </Field>
            {selected && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                {selected.builtin && <Badge>{text.builtin}</Badge>}
                <Badge variant="outline">
                  {text.tiles(selected.tile_count)}
                </Badge>
                {selected.description && <span>{selected.description}</span>}
              </div>
            )}
            {save.error && (
              <Alert variant="danger">{errorMessage(save.error)}</Alert>
            )}
            {save.isSuccess && choice === null && (
              <Alert variant="success">{text.saved}</Alert>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
