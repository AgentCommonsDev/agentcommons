import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./primitives";
import { copy } from "../../copy";

const supported = new Set([
  "bash",
  "json",
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "sql",
  "python",
  "diff",
  "yaml",
  "markdown",
  "text",
]);
const aliases: Record<string, string> = {
  sh: "bash",
  shell: "bash",
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
    langs: [
      import("@shikijs/langs/bash"),
      import("@shikijs/langs/json"),
      import("@shikijs/langs/typescript"),
      import("@shikijs/langs/javascript"),
      import("@shikijs/langs/tsx"),
      import("@shikijs/langs/jsx"),
      import("@shikijs/langs/sql"),
      import("@shikijs/langs/python"),
      import("@shikijs/langs/diff"),
      import("@shikijs/langs/yaml"),
      import("@shikijs/langs/markdown"),
    ],
  });
}
function CodeBlock({
  content,
  language,
}: {
  content: string;
  language: string;
}) {
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
  return (
    <div className="code-block">
      <div className="code-block-toolbar">
        <span>
          {lang === "text" ? copy.workspace.detail.unknownLanguage : lang}
        </span>
        <CopyButton value={content} />
      </div>
      {html?.content === content ? (
        <div
          className="highlighted-code"
          tabIndex={0}
          role="region"
          aria-label={copy.workspace.detail.fullContent}
          dangerouslySetInnerHTML={{ __html: html.html }}
        />
      ) : (
        <pre tabIndex={0}>
          <code>{content}</code>
        </pre>
      )}
    </div>
  );
}
export function Markdown({ content }: { content: string }) {
  return (
    <div className="message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const text = typeof children === "string" ? children : "";
            const language = /language-([^\s]+)/.exec(className ?? "")?.[1];
            return language || text.endsWith("\n") ? (
              <CodeBlock
                content={text.replace(/\n$/, "")}
                language={language ?? "text"}
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
            <div
              className="markdown-table"
              tabIndex={0}
              role="region"
              aria-label={copy.workspace.common.tableLabel}
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
