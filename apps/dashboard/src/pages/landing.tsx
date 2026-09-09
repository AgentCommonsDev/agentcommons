import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Braces,
  Check,
  Fingerprint,
  GitFork,
  Layers,
  LockKeyhole,
  Network,
  ShieldCheck,
  Terminal,
  Users,
} from "lucide-react";
import { copy, links } from "../copy";
import { paths } from "../lib/routes";
import { Pricing } from "../components/pricing";
import { DemoCalendar } from "../components/demo-calendar";
import { useBillingConfig } from "../lib/billing-config";
import { Example } from "../components/example";
import { Button } from "../components/ui/button";
import { usePublicAccount } from "../lib/public-account";

/** One icon per card; the copy carries the card id so the mapping is checked by the compiler. */
const principleIcons: Record<
  (typeof copy.site.principles.cards)[number]["id"],
  typeof Layers
> = { continuity: Layers, coordination: BookOpen, provenance: GitFork };
const securityIcons: Record<
  (typeof copy.site.security.items)[number]["id"],
  typeof ShieldCheck
> = { redaction: ShieldCheck, isolation: Fingerprint, audit: LockKeyhole };

function Architecture() {
  return (
    <div
      className="architecture"
      role="img"
      aria-label={copy.site.flow.diagramLabel}
    >
      <div className="architecture-sources">
        <span className="diagram-label">{copy.site.flow.capture}</span>
        {copy.site.flow.sources.map((name, index) => (
          <div className="source-node" key={name}>
            <span
              className={`source-symbol source-symbol-${String(index)}`}
              aria-hidden
            >
              {index === 0 ? (
                <Layers size={15} />
              ) : index === 1 ? (
                <Terminal size={15} />
              ) : index === 2 ? (
                <Network size={15} />
              ) : (
                <Braces size={15} />
              )}
            </span>
            {name}
            <span className="node-port" />
          </div>
        ))}
      </div>
      <div className="connections connections-input" aria-hidden>
        <svg viewBox="0 0 150 270" preserveAspectRatio="none">
          <path d="M0 56 H46 Q64 56 64 74 V139 Q64 157 82 157 H150 M0 111 H64 M0 166 H64 M0 221 H46 Q64 221 64 203 V175 Q64 157 82 157" />
          <circle cx="149" cy="157" r="3" />
        </svg>
      </div>
      <div className="history-node">
        <div className="history-logo">
          <img src="/logo.png" alt="" width={46} height={46} />
        </div>
        <strong>{copy.site.flow.center}</strong>
        <span>{copy.site.flow.centerDetail}</span>
        <div className="node-data" aria-hidden>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="connections connections-output" aria-hidden>
        <svg viewBox="0 0 150 270" preserveAspectRatio="none">
          <path d="M0 157 H58 Q76 157 76 139 V105 Q76 87 94 87 H150 M76 157 V209 Q76 227 94 227 H150" />
          <circle cx="1" cy="157" r="3" />
        </svg>
      </div>
      <div className="architecture-destinations">
        {copy.site.flow.destinations.map((destination, index) => (
          <div className="destination-node" key={destination.title}>
            {index === 0 ? (
              <Terminal size={21} aria-hidden />
            ) : (
              <Users size={21} aria-hidden />
            )}
            <strong>{destination.title}</strong>
            <span>{destination.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LandingPage() {
  const billing = useBillingConfig();
  const account = usePublicAccount();
  return (
    <main id="main">
      <section className="hero">
        <div className="hero-grid" aria-hidden />
        <div className="container hero-content">
          <div className="eyebrow hero-eyebrow">
            <span className="eyebrow-rule" />
            {copy.site.hero.eyebrow}
          </div>
          <h1>
            {copy.site.hero.title}
            <br />
            <span>{copy.site.hero.titleEnd}</span>
          </h1>
          <p className="hero-description">{copy.site.hero.description}</p>
          <div className="hero-actions">
            <Button asChild>
              <a href={account.href}>
                {account.label}
                <ArrowRight size={16} aria-hidden />
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href={links.repository}>
                {copy.site.hero.secondary}
                <ArrowUpRight size={15} aria-hidden />
              </a>
            </Button>
          </div>
          <p className="hero-status">
            <span className="status-dot" />
            {billing.enabled ? copy.site.saas.status : copy.site.hero.status}
          </p>
        </div>
      </section>

      <section
        className="preview-section container"
        aria-labelledby="preview-heading"
      >
        <div className="section-heading preview-heading">
          <div>
            <span className="eyebrow">{copy.site.preview.eyebrow}</span>
            <h2 id="preview-heading">{copy.site.preview.heading}</h2>
          </div>
          <p>{copy.site.preview.description}</p>
        </div>
        <Example />
      </section>

      <section
        className="flow-section section-space"
        id="how-it-works"
        aria-labelledby="flow-heading"
      >
        <div className="container">
          <div className="section-heading centered">
            <span className="eyebrow">{copy.site.flow.eyebrow}</span>
            <h2 id="flow-heading">{copy.site.flow.heading}</h2>
            <p>{copy.site.flow.description}</p>
          </div>
          <Architecture />
          <p className="diagram-note">
            <span className="status-dot" />
            {copy.site.flow.sourcesNote}
          </p>
        </div>
      </section>

      <section
        className="principles-section container section-space"
        aria-labelledby="principles-heading"
      >
        <div className="section-heading">
          <span className="eyebrow">{copy.site.principles.eyebrow}</span>
          <h2 id="principles-heading">
            {billing.enabled
              ? copy.site.saas.principlesTitle
              : copy.site.principles.heading}
          </h2>
        </div>
        <div className="principle-grid">
          {copy.site.principles.cards.map((card) => {
            const Icon = principleIcons[card.id];
            return (
              <article className="principle-card" key={card.title}>
                <div className="principle-top">
                  <span className="mono-label">{card.label}</span>
                  <Icon size={19} aria-hidden />
                </div>
                <h3>{card.title}</h3>
                <p>{card.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="security-section section-space"
        id="your-data"
        aria-labelledby="security-heading"
      >
        <div className="container security-layout">
          <div className="security-intro">
            <span className="eyebrow">
              {billing.enabled
                ? copy.site.saas.securityEyebrow
                : copy.site.security.eyebrow}
            </span>
            <h2 id="security-heading">
              {billing.enabled
                ? copy.site.saas.securityHeading
                : copy.site.security.heading}
            </h2>
            <p>
              {billing.enabled
                ? copy.site.saas.securityDescription
                : copy.site.security.description}
            </p>
            <a className="text-link" href={links.specification}>
              {copy.site.security.link}
              <ArrowUpRight size={15} aria-hidden />
            </a>
            <div className="security-seal" aria-hidden>
              <div className="seal-grid" />
              <ShieldCheck size={45} strokeWidth={1} />
              <i className="seal-corner seal-corner-a" />
              <i className="seal-corner seal-corner-b" />
              <i className="seal-corner seal-corner-c" />
              <i className="seal-corner seal-corner-d" />
            </div>
          </div>
          <div className="security-items">
            {copy.site.security.items.map((item) => {
              const Icon = securityIcons[item.id];
              return (
                <article key={item.title}>
                  <div className="security-icon">
                    <Icon size={20} strokeWidth={1.5} aria-hidden />
                  </div>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </div>
                </article>
              );
            })}
            <p className="security-note">
              <Check size={14} aria-hidden />
              {copy.site.security.note}
            </p>
          </div>
        </div>
      </section>

      <Pricing />
      {billing.enabled && (
        <div className="container">
          <DemoCalendar />
        </div>
      )}
      <section className="closing-section">
        <div className="container">
          <span className="eyebrow">{copy.site.closing.eyebrow}</span>
          <h2>{copy.site.closing.heading}</h2>
          <p>{copy.site.closing.description}</p>
          <div className="hero-actions">
            <Button asChild>
              <a href={account.href}>
                {account.label}
                <ArrowRight size={16} aria-hidden />
              </a>
            </Button>
            <Button variant="ghost" asChild>
              <a href={paths.docs}>
                {copy.site.closing.secondary}
                <ArrowUpRight size={15} aria-hidden />
              </a>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
