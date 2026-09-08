import { useEffect, useMemo, useRef } from "react";
import type { z } from "zod";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  autocompletion,
  completionKeymap,
  startCompletion,
  closeCompletion,
  completeFromList,
} from "@codemirror/autocomplete";
import {
  sql,
  StandardSQL,
  SQLDialect,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import {
  linter,
  lintGutter,
  openLintPanel,
  forceLinting,
} from "@codemirror/lint";
import {
  HighlightStyle,
  syntaxHighlighting,
  bracketMatching,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { parseTraceSql, TraceSqlParseError } from "@agentcommons/core/sql";
import type { schemaOutputSchema } from "@agentcommons/core/schemas/rest";
import { sqlInputSchema } from "@agentcommons/core/schemas/sql";
import { copy } from "../../copy";
import { Button } from "../ui/button";

type Schema = z.infer<typeof schemaOutputSchema>;
// Token styling follows ClickHouse quoting/comments; native parsing remains authoritative.
// https://clickhouse.com/docs/reference/syntax
const clickHouse = SQLDialect.define({
  ...StandardSQL.spec,
  identifierQuotes: '"`',
  backslashEscapes: true,
  hashComments: true,
  slashComments: true,
});
const language = new Compartment();
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--sql-keyword)" },
  { tag: tags.string, color: "var(--sql-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--sql-number)" },
  { tag: tags.comment, color: "var(--muted)", fontStyle: "italic" },
]);
export function SqlEditor({
  value,
  onChange,
  onRun,
  schema,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  schema: Schema | undefined;
  disabled: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onRun, disabled });
  callbacks.current = { onChange, onRun, disabled };
  const initial = useRef(value);
  const namespace = useMemo<SQLNamespace>(() => {
    const result: Record<
      string,
      { label: string; detail: string; info?: string }[]
    > = {};
    for (const column of schema?.columns ?? [])
      (result[column.view_name] ??= []).push({
        label: column.column_name,
        detail: column.data_type,
        ...(column.description ? { info: column.description } : {}),
      });
    return result;
  }, [schema]);
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": copy.workspace.sql.editor,
            "aria-describedby": "sql-editor-help",
            spellcheck: "false",
          }),
          language.of(sql({ dialect: clickHouse, upperCaseKeywords: true })),
          autocompletion({ icons: false }),
          keymap.of([
            {
              key: "Mod-Enter",
              run: (view) => {
                closeCompletion(view);
                if (!callbacks.current.disabled) callbacks.current.onRun();
                return true;
              },
            },
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          lintGutter(),
          linter(
            (view) => {
              const text = view.state.doc.toString();
              if (!text.trim()) return [];
              const input = sqlInputSchema.safeParse({ sql: text });
              if (!input.success)
                return [
                  {
                    from: 0,
                    to: text.length,
                    severity: "error",
                    message:
                      input.error.issues[0]?.message ??
                      copy.workspace.sql.syntaxError,
                  },
                ];
              try {
                parseTraceSql(text);
                return [];
              } catch (error) {
                const location =
                  error instanceof TraceSqlParseError
                    ? error.location
                    : undefined;
                const from = Math.min(
                  text.length,
                  Math.max(0, location?.start.offset ?? text.length - 1),
                );
                return [
                  {
                    from,
                    to: Math.min(
                      text.length,
                      Math.max(from + 1, location?.end.offset ?? from + 1),
                    ),
                    severity: "error",
                    message: copy.workspace.sql.syntaxError,
                  },
                ];
              }
            },
            { delay: 500 },
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
  }, []);
  useEffect(() => {
    editor.current?.dispatch({
      effects: language.reconfigure([
        sql({
          dialect: clickHouse,
          schema: namespace,
          upperCaseKeywords: true,
        }),
        clickHouse.language.data.of({
          autocomplete: completeFromList([
            ...[
              "PREWHERE",
              "FINAL",
              "QUALIFY",
              "SAMPLE",
              "ARRAY",
              "ASOF",
              "GLOBAL",
              "SETTINGS",
            ].map((label) => ({ label, type: "keyword" })),
            ...(schema?.functions ?? []).map((item) => ({
              label: item.function_name,
              type: "function",
              detail: item.arguments,
              info: item.description ?? item.result_type,
            })),
          ]),
        }),
      ]),
    });
  }, [namespace, schema]);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== value)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
  }, [value]);
  useEffect(() => {
    if (disabled && editor.current) closeCompletion(editor.current);
  }, [disabled]);
  return (
    <div className="sql-editor-panel">
      <div className="sql-editor-actions">
        <Button
          type="button"
          variant="ghost"
          size="small"
          onClick={() => {
            const view = editor.current;
            if (view) {
              view.focus();
              startCompletion(view);
            }
          }}
        >
          {copy.workspace.sql.complete}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="small"
          onClick={() => {
            const view = editor.current;
            if (view) {
              forceLinting(view);
              openLintPanel(view);
            }
          }}
        >
          {copy.workspace.sql.diagnostics}
        </Button>
      </div>
      <div ref={host} className="sql-code-editor" />
      <p id="sql-editor-help" className="sql-editor-help">
        {copy.workspace.sql.editorHelp}
      </p>
    </div>
  );
}
