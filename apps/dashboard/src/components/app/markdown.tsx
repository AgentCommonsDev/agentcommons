import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/utils";
import { CopyButton } from "./states";

/** One table names every language shiki loads; aliases point at its keys. */
const langs = {
  bash: () => import("@shikijs/langs/bash"),
  json: () => import("@shikijs/langs/json"),
  typescript: () => import("@shikijs/langs/typescript"),
  javascript: () => import("@shikijs/langs/javascript"),
  tsx: () => import("@shikijs/langs/tsx"),
  jsx: () => import("@shikijs/langs/jsx"),
  sql: () => import("@shikijs/langs/sql"),
  python: () => import("@shikijs/langs/python"),
  diff: () => import("@shikijs/langs/diff"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  markdown: () => import("@shikijs/langs/markdown"),
};
const plain = "text";
const supported = new Set([...Object.keys(langs), plain]);
const aliases: Record<string, keyof typeof langs> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  ts: "typescript",
  js: "javascript",
  py: "python",
  yml: "yaml",
  md: "markdown",
};
let highlighter: ReturnType<typeof loadHighlighter> | undefined;
async function loadHighlighter() {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] =
    await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
  return createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [
      // Tokens sit on the block's raised background, not the theme's own. On the light
      // tint (#f0f3f8) only the high-contrast GitHub palette keeps every token at the
      // 4.5:1 WCAG AA ratio the accessibility checks enforce; github-light's keyword,
      // variable and comment colors fall short there.
      import("@shikijs/themes/github-light-high-contrast"),
      import("@shikijs/themes/github-dark-high-contrast"),
    ],
    langs: Object.values(langs).map((load) => load()),
  });
}
/**
 * Shiki HTML for `content`, or null until the highlighter has loaded (callers show the
 * plain text meanwhile). One highlighter instance serves every code block on the page.
 */
function useHighlightedCode(
  content: string,
  language = plain,
): { lang: string; html: string | null } {
  const normalized = aliases[language] ?? language;
  const lang = supported.has(normalized) ? normalized : plain;
  const [html, setHtml] = useState<{ content: string; html: string } | null>(
    null,
  );
  useEffect(() => {
    let current = true;
    highlighter ??= loadHighlighter();
    void highlighter
      .then((instance) => {
        if (current)
          setHtml({
            content,
            html: instance.codeToHtml(content, {
              lang,
              themes: {
                light: "github-light-high-contrast",
                dark: "github-dark-high-contrast",
              },
              // Colors come from the `--shiki-*` variables that `.code-block` reads per
              // theme; the block's scroll container is the one focus stop, not the <pre>.
              defaultColor: false,
              tabindex: false,
            }),
          });
      })
      .catch(() => {
        if (current) setHtml(null);
      });
    return () => {
      current = false;
    };
  }, [content, lang]);
  return { lang, html: html?.content === content ? html.html : null };
}
/**
 * The one code block: a framed body under a header row that carries the copy control and,
 * for multi-line code in a known language, the language name. Highlighting loads lazily;
 * plain text and shiki output share the `.code-block` metrics so nothing moves when it lands.
 */
export function CodeBlock({
  content,
  language = plain,
  copyLabel,
  showCopyLabel = false,
  maxHeight,
  wrap = false,
  testId,
  className,
}: {
  content: string;
  language?: string | undefined;
  copyLabel?: string | undefined;
  /** Show `copyLabel` as the button text rather than only its accessible name. */
  showCopyLabel?: boolean | undefined;
  /** Tailwind max-height class; the block scrolls inside itself once reached. */
  maxHeight?: string | undefined;
  /** Wrap long lines instead of scrolling them, for a command the reader must see whole. */
  wrap?: boolean | undefined;
  /** `data-testid` of the body, whose text is exactly `content`. */
  testId?: string | undefined;
  className?: string | undefined;
}) {
  const { lang, html } = useHighlightedCode(content, language);
  // A one-line snippet does not need a language caption above it.
  const label = lang !== plain && content.includes("\n") ? lang : null;
  return (
    <div
      className={cn(
        "code-block my-2 overflow-hidden rounded-lg border border-line bg-raised",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line-soft py-1 pr-1 pl-3 text-[11px] text-muted">
        <span className="font-mono">{label}</span>
        <CopyButton
          value={content}
          label={copyLabel}
          showLabel={showCopyLabel}
        />
      </div>
      <div
        data-testid={testId}
        tabIndex={0}
        className={cn(
          "overflow-auto font-mono text-[12.5px] leading-relaxed text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
          wrap && "code-block-wrap",
          maxHeight,
        )}
        {...(html !== null
          ? { dangerouslySetInnerHTML: { __html: html } }
          : {
              children: (
                <pre>
                  <code>{content}</code>
                </pre>
              ),
            })}
      />
    </div>
  );
}
export function Markdown({
  content,
  className,
}: {
  content: string;
  className?: string | undefined;
}) {
  return (
    <div className={cn("prose-app", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className: codeClass, children }) => {
            const text = typeof children === "string" ? children : "";
            const language = /language-([^\s]+)/.exec(codeClass ?? "")?.[1];
            return language || text.endsWith("\n") ? (
              <CodeBlock
                content={text.replace(/\n$/, "")}
                language={language}
              />
            ) : (
              <code>{children}</code>
            );
          },
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            // Author-written columns may be wider than the page; they scroll here.
            <div
              className="my-2 overflow-x-auto"
              tabIndex={0}
              data-table-layout="scroll-x"
            >
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
