import { ArrowUpRight } from "lucide-react";
import { copy, type LegalDocument } from "../copy";
import { useBillingConfig } from "../lib/billing-config";
import { NotFoundPage } from "./not-found";

/** Stable in-page anchors for the contents list, derived from the headings. */
const anchor = (heading: string) =>
  heading
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");

/**
 * One renderer for both legal documents: the Privacy Policy and the Terms of Service
 * are copy data. Like the blog, the pages describe the hosted service and are absent
 * on customer instances.
 */
export function LegalPage({
  document,
  related,
}: {
  document: LegalDocument;
  related: { title: string; href: string };
}) {
  const config = useBillingConfig();
  if (config.mode === "customer") return <NotFoundPage />;
  return (
    <main id="main" className="docs-page legal-page container">
      <div className="section-heading">
        <span className="eyebrow">{copy.legal.eyebrow}</span>
        <h1>{document.title}</h1>
        <p className="legal-effective">
          {copy.legal.effective}{" "}
          <time dateTime={document.effective}>{document.effectiveText}</time>
        </p>
      </div>
      <article>
        {document.intro.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <nav className="legal-contents" aria-label={copy.legal.contents}>
          <ol>
            {document.sections.map((section) => (
              <li key={section.heading}>
                <a href={`#${anchor(section.heading)}`}>{section.heading}</a>
              </li>
            ))}
          </ol>
        </nav>
        {document.sections.map((section) => (
          <section key={section.heading}>
            <h2 id={anchor(section.heading)}>{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.items && (
              <ul>
                {section.items.map((item) => (
                  <li key={item.text}>
                    {item.term && <strong>{item.term}</strong>} {item.text}
                  </li>
                ))}
              </ul>
            )}
            {section.closing?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </article>
      <div className="docs-links">
        <a className="text-link" href={related.href}>
          {related.title}
          <ArrowUpRight size={14} aria-hidden />
        </a>
        <a className="text-link" href={`mailto:${copy.legal.contactEmail}`}>
          {copy.legal.contactEmail}
        </a>
      </div>
    </main>
  );
}
