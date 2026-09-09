import {
  autocompletion,
  closeCompletion,
  completeFromList,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  sql,
  SQLDialect,
  StandardSQL,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import {
  bracketMatching,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import type { Completion, CompletionSource } from "@codemirror/autocomplete";
import { copy } from "../../copy";
import { cn } from "../../lib/utils";
import { diagnose, problemAt, type SqlProblem } from "./diagnostics";

// Token styling follows ClickHouse quoting and comments; the native parser stays authoritative.
const clickHouse = SQLDialect.define({
  ...StandardSQL.spec,
  keywords: `${StandardSQL.spec.keywords ?? ""} prewhere final qualify sample asof global settings interpolate fill ties`,
  identifierQuotes: '"`',
  backslashEscapes: true,
  hashComments: true,
  slashComments: true,
});
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--accent)", fontWeight: "600" },
  { tag: tags.string, color: "var(--success)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--warning)" },
  { tag: tags.comment, color: "var(--muted)", fontStyle: "italic" },
  { tag: tags.operator, color: "var(--muted)" },
]);
const theme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-serverError": {
    background: "color-mix(in srgb, var(--danger) 18%, transparent)",
    textDecoration: "underline wavy var(--danger)",
    textDecorationSkipInk: "none",
  },
});
const language = new Compartment();
const setServerError = StateEffect.define<{
  from: number;
  to: number;
} | null>();
const serverErrorMark = Decoration.mark({ class: "cm-serverError" });
/** The last run's server-side error stays highlighted until the text changes. */
const serverError = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = transaction.docChanged
      ? Decoration.none
      : value.map(transaction.changes);
    for (const effect of transaction.effects)
      if (effect.is(setServerError))
        next =
          effect.value === null
            ? Decoration.none
            : Decoration.set([
                serverErrorMark.range(effect.value.from, effect.value.to),
              ]);
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export interface SqlEditorHandle {
  /** Replace the selection (or insert at the cursor) and focus the editor. */
  insert(text: string): void;
  /** Replace the whole document. */
  setValue(text: string): void;
  focus(): void;
  /** Highlight a server-reported 1-based position; the returned problem feeds the status line. */
  markServerError(position: number | null, message: string): SqlProblem;
}
export const SqlEditor = forwardRef<
  SqlEditorHandle,
  {
    initialValue: string;
    onChange: (sql: string) => void;
    onRun: () => void;
    onDiagnostics: (problems: SqlProblem[]) => void;
    namespace: SQLNamespace;
    functions: Completion[];
    /** Bare-identifier completions for the views the query already reads. */
    columnSource: CompletionSource;
    embeddings: boolean;
    disabled: boolean;
    className?: string | undefined;
  }
>(function SqlEditor(
  {
    initialValue,
    onChange,
    onRun,
    onDiagnostics,
    namespace,
    functions,
    columnSource,
    embeddings,
    disabled,
    className,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const callbacks = useRef({
    onChange,
    onRun,
    onDiagnostics,
    disabled,
    embeddings,
  });
  callbacks.current = { onChange, onRun, onDiagnostics, disabled, embeddings };
  const initial = useRef(initialValue);
  const languageExtension = useMemo(
    () => [
      sql({ dialect: clickHouse, schema: namespace, upperCaseKeywords: true }),
      clickHouse.language.data.of({ autocomplete: columnSource }),
      clickHouse.language.data.of({
        autocomplete: completeFromList(functions),
      }),
    ],
    [namespace, functions, columnSource],
  );
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          theme,
          serverError,
          EditorView.contentAttributes.of({
            "aria-label": copy.sql.editor.label,
            spellcheck: "false",
            autocorrect: "off",
            autocapitalize: "off",
          }),
          language.of(languageExtension),
          autocompletion({
            activateOnTyping: true,
            icons: false,
            maxRenderedOptions: 60,
          }),
          keymap.of([
            {
              key: "Mod-Enter",
              run: (target) => {
                closeCompletion(target);
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
            (target) => {
              const text = target.state.doc.toString();
              const problems = diagnose(text, callbacks.current.embeddings);
              callbacks.current.onDiagnostics(problems);
              return problems.map<Diagnostic>((problem) => ({
                from: problem.from,
                to: problem.to,
                severity: "error",
                message: problem.message,
              }));
            },
            { delay: 350 },
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
    // The editor mounts once; later prop changes reconfigure it below.
  }, []);
  useEffect(() => {
    editor.current?.dispatch({
      effects: language.reconfigure(languageExtension),
    });
  }, [languageExtension]);
  useEffect(() => {
    if (disabled && editor.current) closeCompletion(editor.current);
  }, [disabled]);
  useImperativeHandle(
    ref,
    () => ({
      insert(text) {
        const view = editor.current;
        if (!view) return;
        view.dispatch(view.state.replaceSelection(text));
        view.focus();
      },
      setValue(text) {
        const view = editor.current;
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          selection: { anchor: text.length },
        });
        view.focus();
      },
      focus() {
        editor.current?.focus();
      },
      markServerError(position, message) {
        const view = editor.current;
        const text = view?.state.doc.toString() ?? "";
        const problem = problemAt(text, position, message);
        if (view && text.length > 0)
          view.dispatch({
            effects: [
              setServerError.of({ from: problem.from, to: problem.to }),
              EditorView.scrollIntoView(problem.from),
            ],
            selection: { anchor: problem.from },
          });
        return problem;
      },
    }),
    [],
  );
  return (
    <div
      ref={host}
      data-testid="sql-editor"
      className={cn(
        "h-[260px] max-h-[70vh] min-h-[140px] resize-y overflow-hidden rounded-lg border border-line bg-surface focus-within:border-accent",
        disabled && "opacity-70",
        className,
      )}
    />
  );
});
