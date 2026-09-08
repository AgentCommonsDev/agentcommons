import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { metricValue } from "../components/workspace/metric-chart";
import type { PaidPlan } from "@agentcommons/core/schemas/billing";
import { formatBillingDate } from "@agentcommons/core/format/billing";
import { number } from "../lib/display";
import { useBillingConfig } from "../lib/billing-config";
import { useWorkspace } from "../components/workspace/context";
import {
  PageHeading,
  RequestError,
  LoadingState,
  Field,
} from "../components/workspace/primitives";
import { Button } from "../components/ui/button";
import { DemoCalendar } from "../components/demo-calendar";
export function UsagePage() {
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
    refetchInterval: 10_000,
  });
  const navigate = async (action: "checkout" | "portal") => {
    setPending(true);
    setActionError(null);
    try {
      const result =
        action === "checkout"
          ? unwrap(
              await api.POST("/api/v1/billing/checkout", { body: { plan } }),
            )
          : unwrap(await api.POST("/api/v1/billing/portal", { body: {} }));
      if (result.url) window.location.assign(result.url);
      else {
        await query.refetch();
        setPending(false);
      }
    } catch (error) {
      setActionError(error);
      setPending(false);
    }
  };
  if (!config.enabled)
    return (
      <PageHeading
        title={copy.billing.title}
        description={copy.saas.unavailable}
      />
    );
  const data = query.data;
  return (
    <>
      <PageHeading
        title={copy.billing.title}
        description={copy.billing.description}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              void query.refetch();
            }}
          >
            <RefreshCw size={15} aria-hidden />
            {copy.workspace.common.refresh}
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
        <>
          <section className="usage-overview" aria-label={copy.billing.title}>
            <dl className="status-metrics">
              <div>
                <dt>{copy.billing.plan}</dt>
                <dd>
                  {data.plan === "unmetered"
                    ? copy.billing.unmetered
                    : copy.saas[data.plan]}
                </dd>
              </div>
              <div>
                <dt>{copy.billing.used}</dt>
                <dd>{number(data.records_used)}</dd>
              </div>
              <div>
                <dt>{copy.billing.limit}</dt>
                <dd>
                  {data.included_records === null
                    ? copy.billing.unmetered
                    : number(data.included_records)}
                </dd>
              </div>
              <div>
                <dt>{copy.billing.remaining}</dt>
                <dd>
                  {data.remaining === null
                    ? copy.billing.unmetered
                    : number(data.remaining)}
                </dd>
              </div>
            </dl>
            {data.included_records !== null && (
              <progress
                aria-label={copy.billing.progress}
                max={Math.max(1, data.included_records)}
                value={Math.min(
                  data.records_used,
                  Math.max(1, data.included_records),
                )}
              />
            )}
            <dl className="usage-period">
              <div>
                <dt>{copy.billing.period}</dt>
                <dd>{formatBillingDate(data.period_start)}</dd>
              </div>
              <div>
                <dt>{copy.billing.periodEnd}</dt>
                <dd>{formatBillingDate(data.period_end)}</dd>
              </div>
            </dl>
            <p className="field-hint">{copy.saas.counting}</p>
          </section>
          {data.plan === "free" && data.remaining === 0 && (
            <section className="usage-limit-notice" role="status">
              <p>{copy.billing.cap}</p>
              <p>{copy.billing.pending}</p>
            </section>
          )}
          {data.plan !== "free" && data.plan !== "unmetered" && (
            <section>
              <dl className="status-metrics">
                {[
                  [copy.billing.overage, number(data.overage_records)],
                  [copy.billing.embedded, number(data.embedding_messages_used)],
                  [
                    copy.billing.captureEstimate,
                    metricValue(data.estimated_capture_usd, "usd"),
                  ],
                  [
                    copy.billing.embeddingEstimate,
                    metricValue(data.estimated_embedding_usd, "usd"),
                  ],
                  [copy.billing.meteringPending, number(data.metering_pending)],
                  [
                    copy.billing.reconciliation,
                    number(data.metering_reconciliation_required),
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="field-hint">{copy.billing.estimates}</p>
            </section>
          )}
          <div className="usage-actions">
            {data.can_manage ? (
              <>
                {data.plan !== "unmetered" && (
                  <>
                    <Field label={copy.billing.planChoice}>
                      {(props) => (
                        <select
                          {...props}
                          value={plan}
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
                        </select>
                      )}
                    </Field>
                    <Button
                      disabled={pending || !data.checkout_enabled}
                      onClick={() => {
                        void navigate("checkout");
                      }}
                    >
                      {pending
                        ? copy.billing.opening
                        : data.plan === "free"
                          ? copy.billing.upgrade
                          : copy.billing.changePlan}
                      <ArrowUpRight size={15} aria-hidden />
                    </Button>
                  </>
                )}
                {data.portal_enabled && (
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      void navigate("portal");
                    }}
                  >
                    {pending ? copy.billing.opening : copy.billing.portal}
                    <ArrowUpRight size={15} aria-hidden />
                  </Button>
                )}
              </>
            ) : (
              <p>{copy.billing.ownerOnly}</p>
            )}
          </div>
          {!data.checkout_enabled && (
            <p className="field-hint">{copy.saas.checkoutUnavailable}</p>
          )}
          <p className="field-hint">{copy.billing.returnHint}</p>
          {actionError !== null && <RequestError error={actionError} />}
          {data.plan !== "free" && <DemoCalendar />}
        </>
      )}
    </>
  );
}
