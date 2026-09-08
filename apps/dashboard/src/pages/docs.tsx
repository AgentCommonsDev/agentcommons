import { ArrowUpRight } from "lucide-react";
import { copy, links } from "../copy";
export function DocsPage() {
  return (
    <main id="main" className="docs-page container">
      <div className="section-heading">
        <span className="eyebrow">{copy.navigation.docs}</span>
        <h1>{copy.publicGuide.title}</h1>
      </div>
      <article>
        {copy.publicGuide.sections.map((section) => (
          <p key={section}>{section}</p>
        ))}
      </article>
      <div className="docs-links">
        <a className="text-link" href={links.repository}>
          {copy.footer.links.source}
          <ArrowUpRight size={14} aria-hidden />
        </a>
        <a className="text-link" href={links.specification}>
          {copy.footer.links.specification}
          <ArrowUpRight size={14} aria-hidden />
        </a>
      </div>
    </main>
  );
}
