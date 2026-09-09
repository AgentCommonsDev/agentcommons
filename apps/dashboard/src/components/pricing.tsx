import { formatPlans } from "@agentcommons/core/format/billing";
import { ArrowRight } from "lucide-react";
import { copy } from "../copy";
import { useBillingConfig } from "../lib/billing-config";
import { Button } from "./ui/button";

export function Pricing() {
  const config = useBillingConfig();
  if (!config.enabled) return null;
  const formatted = formatPlans(config);
  return (
    <section
      className="pricing-section section-space container"
      id="pricing"
      aria-labelledby="pricing-heading"
    >
      <div className="section-heading centered">
        <div>
          <span className="eyebrow">{copy.saas.pricing}</span>
          <h2 id="pricing-heading">{copy.saas.pricingTitle}</h2>
        </div>
        <p>{copy.saas.pricingDescription}</p>
      </div>
      <div className="pricing-grid">
        {(["free", "pro"] as const).map((plan) => (
          <article
            className={`pricing-card pricing-${plan}`}
            key={plan}
            aria-label={copy.saas[plan]}
          >
            <h3>{copy.saas[plan]}</h3>
            <p>
              {plan === "free"
                ? copy.saas.freeDescription
                : copy.saas.proDescription}
            </p>
            <div className="plan-price">
              <strong>
                {plan === "free" ? copy.saas.freePrice : formatted.proPrice}
              </strong>
              <span>{copy.saas.perMonth}</span>
            </div>
            <p className="plan-allowance">
              <strong>
                {plan === "free"
                  ? formatted.freeAllowance
                  : formatted.proAllowance}
              </strong>{" "}
              {copy.saas.sessionsPerMonth}
            </p>
            {plan === "pro" && (
              <p className="field-hint">
                {formatted.captureRate ? (
                  <>
                    {formatted.captureRate} {copy.saas.captureRate}
                  </>
                ) : (
                  copy.saas.rateUnavailable
                )}
              </p>
            )}
            <Button asChild variant={plan === "pro" ? "primary" : "secondary"}>
              <a href="/signup">
                {copy.saas.signup}
                <ArrowRight size={16} aria-hidden />
              </a>
            </Button>
            <ul>
              {copy.saas.included.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </article>
        ))}
        <article className="pricing-card" aria-label={copy.saas.enterprise}>
          <h3>{copy.saas.enterprise}</h3>
          <p>{copy.saas.enterpriseDescription}</p>
          <div className="enterprise-space" aria-hidden />
          <Button asChild variant="secondary">
            <a href="#demo">
              {copy.saas.demo}
              <ArrowRight size={16} aria-hidden />
            </a>
          </Button>
          {!config.cal_com_url && (
            <p className="field-hint">{copy.saas.calendarUnavailable}</p>
          )}
        </article>
      </div>
      <div className="pricing-addon">
        <h3>{copy.saas.embeddingsAddon}</h3>
        <p>
          {formatted.embeddingPrice} {copy.saas.perMonth}
          {copy.app.common.separator}
          {formatted.embeddingRate ? (
            <>
              {formatted.embeddingRate} {copy.saas.embeddingRate}
            </>
          ) : (
            copy.saas.rateUnavailable
          )}
        </p>
      </div>
      <p className="pricing-counting">{copy.saas.counting}</p>
    </section>
  );
}
