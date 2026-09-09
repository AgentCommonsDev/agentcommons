import { ArrowUpRight } from "lucide-react";
import { copy, links } from "../copy";
export function DocsPage() {
  return (
    <main id="main" className="docs-page container">
      <div className="section-heading">
        <span className="eyebrow">{copy.site.navigation.docs}</span>
        <h1>{copy.site.publicGuide.title}</h1>
      </div>
      <article>
        {copy.site.publicGuide.sections.map((section) => (
          <p key={section}>{section}</p>
        ))}
      </article>
      <div className="docs-links">
        <a className="text-link" href={links.repository}>
          {copy.site.footer.links.source}
          <ArrowUpRight size={14} aria-hidden />
        </a>
        <a className="text-link" href={links.specification}>
          {copy.site.footer.links.specification}
          <ArrowUpRight size={14} aria-hidden />
        </a>
      </div>
    </main>
  );
}
