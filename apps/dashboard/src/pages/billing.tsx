import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CreditCard, RefreshCw } from "lucide-react";
import type { PaidPlan } from "@agentcommons/core/schemas/billing";
import { formatBillingDate } from "@agentcommons/core/format/billing";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { useBillingConfig } from "../lib/billing-config";
import { metricValue, number } from "../lib/display";
import { useWorkspace } from "../components/app/workspace";
import {
  DefinitionList,
  LoadingState,
  RequestError,
} from "../components/app/states";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Field } from "../components/ui/field";
import { Alert, EmptyState, PageHeader } from "../components/ui/feedback";
import { NativeSelect } from "../components/ui/input";
import { ProgressBar, Stat, StatGrid } from "../features/admin/display";

const text = copy.billing;
export function BillingPage() {
  const config = useBillingConfig();
  const { organization } = useWorkspace();
  const [plan, setPlan] = useState<PaidPlan>("pro");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const query = useQuery({
    queryKey: [organization.id, "billing"],
    enabled: config.enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/billing", { signal })),
    refetchInterval: 30_000,
  });
  const open = async (action: "checkout" | "portal") => {
    setPending(true);
    setActionError(null);
    try {
      const result =
        action === "checkout"
          ? unwrap(
              await api.POST("/api/v1/billing/checkout", { body: { plan } }),
            )
          : unwrap(await api.POST("/api/v1/billing/portal", { body: {} }));
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      await query.refetch();
    } catch (error) {
      setActionError(error);
    } finally {
      setPending(false);
    }
  };
  if (!config.enabled)
    return (
      <>
        <PageHeader title={text.title} />
        <EmptyState
          icon={<CreditCard aria-hidden />}
          title={copy.saas.unavailable}
        />
      </>
    );
  const data = query.data;
  const planLabel = data
    ? data.plan === "unmetered"
      ? text.unmetered
      : copy.saas[data.plan]
    : "";
  const included = data?.included_records ?? null;
  const usedRatio = data && included ? data.records_used / included : 0;
  return (
    <>
      <PageHeader
        title={text.title}
        description={text.description}
        actions={
          <Button
            variant="secondary"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            <RefreshCw aria-hidden />
            {copy.app.common.refresh}
          </Button>
        }
      />
      {query.isPending && <LoadingState />}
      {query.error && (
        <RequestError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      {data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Card data-testid="billing-plan">
            <CardHeader>
              <CardTitle>{text.plan}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-2xl font-semibold tracking-tight">
                {planLabel}
              </p>
              <DefinitionList
                columns={2}
                items={[
                  {
                    label: text.period,
                    value: formatBillingDate(data.period_start),
                  },
                  {
                    label: text.periodEnd,
                    value: formatBillingDate(data.period_end),
                  },
                ]}
              />
              {data.can_manage ? (
                <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
                  {data.plan !== "unmetered" && (
                    <>
                      <Field label={text.planChoice}>
                        {(props) => (
                          <NativeSelect
                            {...props}
                            value={plan}
                            disabled={pending}
                            onChange={(event) => {
                              setPlan(
                                event.target.value === "pro_embeddings"
                                  ? "pro_embeddings"
                                  : "pro",
                              );
                            }}
                          >
                            <option value="pro">{copy.saas.pro}</option>
                            <option value="pro_embeddings">
                              {copy.saas.pro_embeddings}
                            </option>
                          </NativeSelect>
                        )}
                      </Field>
                      <Button
                        disabled={pending || !data.checkout_enabled}
                        onClick={() => {
                          void open("checkout");
                        }}
                      >
                        {pending
                          ? text.opening
                          : data.plan === "free"
                            ? text.upgrade
                            : text.changePlan}
                        <ArrowUpRight aria-hidden />
                      </Button>
                    </>
                  )}
                  {data.portal_enabled && (
                    <Button
                      variant="secondary"
                      disabled={pending}
                      onClick={() => {
                        void open("portal");
                      }}
                    >
                      {pending ? text.opening : text.portal}
                      <ArrowUpRight aria-hidden />
                    </Button>
                  )}
                  {!data.checkout_enabled && (
                    <p className="text-xs leading-relaxed text-muted">
                      {copy.saas.checkoutUnavailable}
                    </p>
                  )}
                  <p className="text-xs leading-relaxed text-muted">
                    {text.returnHint}
                  </p>
                </div>
              ) : (
                <p className="border-t border-line-soft pt-4 text-sm text-muted">
                  {text.ownerOnly}
                </p>
              )}
              {actionError !== null && <RequestError error={actionError} />}
              {data.cal_com_url && (
                <Button asChild variant="link" className="self-start">
                  <a
                    href={data.cal_com_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {copy.saas.demo}
                    <ArrowUpRight aria-hidden />
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{text.used}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <StatGrid className="lg:grid-cols-3">
                <Stat label={text.used} value={number(data.records_used)} />
                <Stat
                  label={text.limit}
                  value={included === null ? text.unmetered : number(included)}
                />
                <Stat
                  label={text.remaining}
                  value={
                    data.remaining === null
                      ? text.unmetered
                      : number(data.remaining)
                  }
                />
              </StatGrid>
              {included !== null && (
                <div className="flex flex-col gap-1.5">
                  <ProgressBar
                    value={data.records_used}
                    max={Math.max(1, included)}
                    label={text.progress}
                    tone={
                      data.remaining === 0
                        ? "danger"
                        : usedRatio >= 0.8
                          ? "warning"
                          : "primary"
                    }
                  />
                  <p className="text-xs text-muted">
                    {text.progress}
                    {copy.app.common.separator}
                    {metricValue(Math.min(1, usedRatio), "ratio")}
                  </p>
                </div>
              )}
              {data.plan === "free" && data.remaining === 0 && (
                <Alert variant="warning" title={text.cap}>
                  {text.pending}
                </Alert>
              )}
              {data.plan !== "free" && data.plan !== "unmetered" && (
                <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
                  <StatGrid className="lg:grid-cols-3">
                    <Stat
                      label={text.overage}
                      value={number(data.overage_records)}
                    />
                    <Stat
                      label={text.embedded}
                      value={number(data.embedding_messages_used)}
                    />
                    <Stat
                      label={text.captureEstimate}
                      value={metricValue(data.estimated_capture_usd, "usd")}
                    />
                    <Stat
                      label={text.embeddingEstimate}
                      value={metricValue(data.estimated_embedding_usd, "usd")}
                    />
                    <Stat
                      label={text.meteringPending}
                      value={number(data.metering_pending)}
                    />
                    <Stat
                      label={text.reconciliation}
                      value={number(data.metering_reconciliation_required)}
                    />
                  </StatGrid>
                  <p className="text-xs leading-relaxed text-muted">
                    {text.estimates}
                  </p>
                </div>
              )}
              <p className="text-xs leading-relaxed text-muted">
                {copy.saas.counting}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
