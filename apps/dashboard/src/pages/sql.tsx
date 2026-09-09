import { formatSchemaContext } from "@agentcommons/core/format";
import { errorSchema } from "@agentcommons/core/schemas/common";
import {
  sqlOutputSchema,
  type SqlOutput,
} from "@agentcommons/core/schemas/sql";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BookMarked,
  CircleAlert,
  CircleCheck,
  Database,
  History,
  Play,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { CopyButton } from "../components/app/states";
import { useWorkspace } from "../components/app/workspace";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogTitle,
  SheetContent,
} from "../components/ui/dialog";
import {
  EmptyState,
  Kbd,
  PageHeader,
  Spinner,
} from "../components/ui/feedback";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/menu";
import { copy } from "../copy";
import type { SqlProblem } from "../features/sql/diagnostics";
import { SqlEditor, type SqlEditorHandle } from "../features/sql/editor";
import { SchemaExplorer } from "../features/sql/explorer";
import {
  clearHistory,
  pushHistory,
  readHistory,
  type HistoryEntry,
} from "../features/sql/history";
import { SqlResults } from "../features/sql/results";
import {
  columnsInScope,
  completionNamespace,
  functionCompletions,
  groupViews,
  hasEmbeddings,
} from "../features/sql/schema";
import { api } from "../lib/api/client";
import { relativeTime, truncate } from "../lib/display";

class QueryFailure extends Error {
  constructor(
    message: string,
    readonly position: number | null,
  ) {
    super(message);
    this.name = "QueryFailure";
  }
}
async function runQuery(sql: string): Promise<SqlOutput> {
  const result = await api.POST("/api/v1/query", { body: { sql } });
  if (!result.response.ok || result.data === undefined) {
    const parsed = errorSchema.safeParse(result.error);
    throw new QueryFailure(
      parsed.success ? parsed.data.message : copy.app.common.requestFailed,
      parsed.success ? (parsed.data.position ?? null) : null,
    );
  }
  return sqlOutputSchema.parse(result.data);
}
const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);
const firstExample = copy.sql.examples[0];

/** A small SQL IDE: schema explorer, live-checked editor, status line and results. */
export function SqlPage() {
  const { organization } = useWorkspace();
  const editor = useRef<SqlEditorHandle>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() =>
    readHistory(organization.id),
  );
  const [sql, setSql] = useState<string>(
    () => history[0]?.sql ?? firstExample.sql,
  );
  const [problems, setProblems] = useState<SqlProblem[]>([]);
  const [serverError, setServerError] = useState<SqlProblem | null>(null);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const schema = useQuery({
    queryKey: [organization.id, "schema"],
    queryFn: async ({ signal }) => {
      const result = await api.GET("/api/v1/schema", { signal });
      if (!result.response.ok || result.data === undefined) {
        const parsed = errorSchema.safeParse(result.error);
        throw new Error(
          parsed.success ? parsed.data.message : copy.app.common.requestFailed,
        );
      }
      return result.data;
    },
    staleTime: 5 * 60_000,
  });
  const views = useMemo(() => groupViews(schema.data), [schema.data]);
  const namespace = useMemo(() => completionNamespace(views), [views]);
  const functions = useMemo(
    () => functionCompletions(schema.data?.functions ?? []),
    [schema.data],
  );
  const columnSource = useMemo(() => columnsInScope(views), [views]);
  const embeddings = useMemo(() => hasEmbeddings(views), [views]);
  const run = useMutation({
    mutationFn: runQuery,
    onMutate: () => {
      setServerError(null);
    },
    onSuccess: (_data, text) => {
      setHistory(pushHistory(organization.id, text));
    },
    onError: (error) => {
      const failure = error instanceof QueryFailure ? error : null;
      const message =
        failure?.message ??
        (error instanceof Error ? error.message : String(error));
      setServerError(
        editor.current?.markServerError(failure?.position ?? null, message) ?? {
          from: 0,
          to: 0,
          line: 1,
          column: 1,
          message,
          capability: null,
        },
      );
    },
  });
  const execute = () => {
    if (!sql.trim() || run.isPending) return;
    run.mutate(sql);
  };
  const load = (text: string) => {
    editor.current?.setValue(text);
    setSql(text);
  };
  const insert = (text: string) => {
    editor.current?.insert(text);
  };
  const problem = problems[0];
  const status = run.isPending
    ? {
        tone: "muted",
        text: copy.sql.status.running,
        icon: <Spinner size={14} />,
      }
    : serverError
      ? {
          tone: "danger",
          text: `${copy.sql.status.queryError}${
            serverError.from > 0 || serverError.to > 0
              ? ` ${copy.sql.status.atLine} ${String(serverError.line)}, ${copy.sql.status.column} ${String(serverError.column)}`
              : ""
          }: ${serverError.message}`,
          icon: <CircleAlert size={14} aria-hidden />,
        }
      : problem
        ? {
            tone: "danger",
            text: `${problem.capability ? copy.sql.status.unavailable : copy.sql.status.syntaxError} ${copy.sql.status.atLine} ${String(problem.line)}, ${copy.sql.status.column} ${String(problem.column)}: ${problem.message}`,
            icon: <CircleAlert size={14} aria-hidden />,
          }
        : {
            tone: "success",
            text: run.data
              ? `${copy.sql.status.ready}${copy.app.common.separator}${copy.sql.status.ranIn} ${String(Math.round(run.data.duration_ms))} ${copy.sql.results.ms}`
              : copy.sql.status.ready,
            icon: <CircleCheck size={14} aria-hidden />,
          };
  const explorer = (className: string, onInsert: (text: string) => void) => (
    <SchemaExplorer
      className={className}
      views={views}
      functions={schema.data?.functions ?? []}
      loading={schema.isPending}
      error={schema.error}
      retry={() => {
        void schema.refetch();
      }}
      onInsert={onInsert}
    />
  );
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={copy.sql.title} description={copy.sql.description} />
      <div className="flex items-start gap-5">
        <aside
          data-testid="sql-explorer"
          aria-label={copy.sql.explorer.title}
          className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] w-[280px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-surface lg:flex"
        >
          <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2 text-[13px] font-semibold">
            <Database size={14} aria-hidden className="text-subtle" />
            {copy.sql.explorer.title}
          </div>
          {explorer("min-h-0 flex-1", insert)}
        </aside>
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              data-testid="sql-run"
              onClick={execute}
              disabled={run.isPending || !sql.trim()}
            >
              {run.isPending ? (
                <Spinner size={14} className="text-primary-fg" />
              ) : (
                <Play aria-hidden />
              )}
              {run.isPending ? copy.sql.editor.running : copy.sql.editor.run}
              <Kbd className="ml-1 hidden border-primary-fg/30 bg-transparent text-primary-fg/80 sm:inline-flex">
                {isMac
                  ? copy.sql.editor.shortcutMac
                  : copy.sql.editor.shortcutOther}
              </Kbd>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">
                  <BookMarked aria-hidden />
                  {copy.sql.editor.examples}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-80 max-w-[calc(100vw-2rem)]"
              >
                <DropdownMenuLabel>
                  {copy.sql.editor.examples}
                </DropdownMenuLabel>
                {copy.sql.examples.map((example) => (
                  <DropdownMenuItem
                    key={example.label}
                    className="flex-col items-start gap-0.5"
                    onSelect={() => {
                      load(example.sql);
                    }}
                  >
                    <span className="font-medium">{example.label}</span>
                    <span className="text-xs text-muted">
                      {example.description}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">
                  <History aria-hidden />
                  {copy.sql.editor.history}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-96 max-w-[calc(100vw-2rem)]"
              >
                <DropdownMenuLabel>{copy.sql.editor.history}</DropdownMenuLabel>
                {history.length === 0 ? (
                  <p className="px-2.5 py-2 text-xs text-muted">
                    {copy.sql.editor.historyEmpty}
                  </p>
                ) : (
                  <>
                    {history.map((entry) => (
                      <DropdownMenuItem
                        key={`${entry.at}-${entry.sql}`}
                        className="flex-col items-start gap-0.5"
                        onSelect={() => {
                          load(entry.sql);
                        }}
                      >
                        <span className="w-full truncate font-mono text-xs">
                          {truncate(entry.sql.replaceAll(/\s+/g, " "), 90)}
                        </span>
                        <span className="text-[11px] text-subtle">
                          {relativeTime(entry.at)}
                        </span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      onSelect={() => {
                        setHistory(clearHistory(organization.id));
                      }}
                    >
                      <Trash2 aria-hidden />
                      {copy.sql.editor.clearHistory}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Button
                variant="secondary"
                className="lg:hidden"
                onClick={() => {
                  setExplorerOpen(true);
                }}
              >
                <Database aria-hidden />
                {copy.sql.explorer.open}
              </Button>
              <CopyButton value={sql} label={copy.sql.editor.copyQuery} />
              {schema.data && (
                <span
                  data-testid="sql-copy-context"
                  title={copy.sql.explorer.copyContextHint}
                >
                  <CopyButton
                    value={formatSchemaContext(schema.data)}
                    label={copy.sql.explorer.copyContext}
                    showLabel
                    variant="secondary"
                  />
                </span>
              )}
            </div>
          </div>
          <SqlEditor
            ref={editor}
            initialValue={sql}
            onChange={(text) => {
              setSql(text);
              setServerError(null);
            }}
            onRun={execute}
            onDiagnostics={setProblems}
            namespace={namespace}
            functions={functions}
            columnSource={columnSource}
            embeddings={embeddings}
            disabled={run.isPending}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <p
              data-testid="sql-status"
              role="status"
              aria-live="polite"
              className={
                status.tone === "danger"
                  ? "flex min-w-0 items-start gap-1.5 text-danger"
                  : status.tone === "success"
                    ? "flex min-w-0 items-start gap-1.5 text-success"
                    : "flex min-w-0 items-start gap-1.5 text-muted"
              }
            >
              <span className="mt-px shrink-0">{status.icon}</span>
              <span className="min-w-0 break-words">{status.text}</span>
            </p>
            <p className="hidden text-subtle md:block">
              {copy.sql.editor.help}
            </p>
          </div>
          {run.data ? (
            <SqlResults data={run.data} />
          ) : (
            <EmptyState
              icon={<Sparkles aria-hidden />}
              title={copy.sql.results.empty}
              description={
                <>
                  <span className="hidden lg:inline">
                    {copy.sql.results.emptyHint}
                  </span>
                  <span className="lg:hidden">
                    {copy.sql.results.emptyHintMobile}
                  </span>
                </>
              }
              action={copy.sql.examples.slice(0, 3).map((example) => (
                <Button
                  key={example.label}
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    load(example.sql);
                  }}
                >
                  {example.label}
                </Button>
              ))}
            />
          )}
        </section>
      </div>
      <Dialog open={explorerOpen} onOpenChange={setExplorerOpen}>
        <SheetContent side="right" className="gap-0 p-0">
          <div className="flex flex-col gap-0.5 border-b border-line-soft px-4 py-3 pr-12">
            <DialogTitle className="text-[15px] font-semibold">
              {copy.sql.explorer.title}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted">
              {copy.sql.explorer.insert}
            </DialogDescription>
          </div>
          {explorer("min-h-0 flex-1", (text) => {
            insert(text);
            setExplorerOpen(false);
          })}
        </SheetContent>
      </Dialog>
    </div>
  );
}
