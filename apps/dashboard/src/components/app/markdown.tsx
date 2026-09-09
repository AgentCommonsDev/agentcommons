import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copy } from "../../copy";
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
      import("@shikijs/themes/github-light"),
      import("@shikijs/themes/github-dark"),
    ],
    langs: Object.values(langs).map((load) => load()),
  });
}
/** Fenced code with a language label and copy control; highlighting loads lazily. */
/**
 * Shiki HTML for `content`, or null until the highlighter has loaded (callers show the
 * plain text meanwhile). One highlighter instance serves every code block on the page.
 */
export function useHighlightedCode(
  content: string,
  language = "text",
): { lang: string; html: string | null } {
  const normalized = aliases[language] ?? language;
  const lang = supported.has(normalized) ? normalized : "text";
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
              themes: { light: "github-light", dark: "github-dark" },
              defaultColor: false,
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
export function CodeBlock({
  content,
  language = "text",
  className,
}: {
  content: string;
  language?: string | undefined;
  className?: string | undefined;
}) {
  const { lang, html } = useHighlightedCode(content, language);
  return (
    <div
      className={cn(
        "not-prose my-2 overflow-hidden rounded-lg border border-line bg-raised",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-line-soft px-3 py-1 text-[11px] text-muted">
        <span className="font-mono">
          {lang === "text" ? copy.app.common.unavailable : lang}
        </span>
        <CopyButton value={content} />
      </div>
      {html !== null ? (
        <div
          className="highlighted-code overflow-x-auto"
          tabIndex={0}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="m-0 overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed">
          <code>{content}</code>
        </pre>
      )}
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
            <div className="my-2 overflow-x-auto" tabIndex={0}>
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
