import {
  ChevronDown,
  ChevronRight,
  FunctionSquare,
  Search,
  Table2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { LoadingState, RequestError } from "../../components/app/states";
import { Badge } from "../../components/ui/badge";
import { EmptyState } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/menu";
import { copy } from "../../copy";
import { cn } from "../../lib/utils";
import {
  filterFunctions,
  filterViews,
  functionSnippet,
  shortType,
  type SchemaColumn,
  type SchemaFunction,
  type SchemaView,
} from "./schema";

const rowClass =
  "flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12.5px] transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

function ColumnRow({
  column,
  onInsert,
}: {
  column: SchemaColumn;
  onInsert: (text: string) => void;
}) {
  const button = (
    <button
      type="button"
      className={cn(rowClass, "pl-7")}
      onClick={() => {
        onInsert(column.column_name);
      }}
    >
      <span className="min-w-0 flex-1 truncate font-mono">
        {column.column_name}
      </span>
      <Badge variant="outline" className="font-mono text-[10px]">
        {shortType(column.data_type)}
      </Badge>
    </button>
  );
  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" align="start">
          <p className="font-mono text-[11px] text-muted">{column.data_type}</p>
          {column.description && <p className="mt-0.5">{column.description}</p>}
          <p className="mt-1 text-[11px] text-subtle">
            {copy.sql.explorer.insert}
          </p>
        </TooltipContent>
      </Tooltip>
    </li>
  );
}
function ViewRow({
  view,
  expanded,
  onToggle,
  onInsert,
}: {
  view: SchemaView;
  expanded: boolean;
  onToggle: () => void;
  onInsert: (text: string) => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <li>
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={
            expanded ? copy.sql.explorer.collapse : copy.sql.explorer.expand
          }
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          onClick={onToggle}
        >
          <Chevron size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={cn(rowClass, "px-1.5")}
          onClick={() => {
            onInsert(view.name);
          }}
        >
          <Table2 size={13} aria-hidden className="shrink-0 text-subtle" />
          <span className="min-w-0 flex-1 truncate font-mono font-medium">
            {view.name}
          </span>
          <span className="text-[11px] text-subtle">
            {view.columns.length} {copy.sql.explorer.columns}
          </span>
        </button>
      </div>
      {expanded && (
        <ul className="mt-0.5 mb-1 flex flex-col">
          {view.columns.map((column) => (
            <ColumnRow
              key={column.column_name}
              column={column}
              onInsert={onInsert}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
function FunctionRow({
  fn,
  onInsert,
}: {
  fn: SchemaFunction;
  onInsert: (text: string) => void;
}) {
  const signature = `${fn.function_name}(${fn.arguments})`;
  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(rowClass, "pl-2")}
            onClick={() => {
              onInsert(functionSnippet(fn));
            }}
          >
            <FunctionSquare
              size={13}
              aria-hidden
              className="shrink-0 text-subtle"
            />
            <span className="min-w-0 flex-1 truncate font-mono">
              {signature}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" align="start">
          <p className="font-mono text-[11px] text-muted">
            {copy.sql.explorer.returns} {fn.result_type}
          </p>
          {fn.description && <p className="mt-0.5">{fn.description}</p>}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

/** Searchable tree of views, columns and functions; clicks insert names into the editor. */
export function SchemaExplorer({
  views,
  functions,
  loading,
  error,
  retry,
  onInsert,
  className,
}: {
  views: readonly SchemaView[];
  functions: readonly SchemaFunction[];
  loading: boolean;
  error: unknown;
  retry: () => void;
  onInsert: (text: string) => void;
  className?: string | undefined;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const visibleViews = useMemo(() => filterViews(views, query), [views, query]);
  const visibleFunctions = useMemo(
    () => filterFunctions(functions, query),
    [functions, query],
  );
  const searching = query.trim() !== "";
  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn("flex min-h-0 flex-col", className)}>
        <div className="relative shrink-0 px-3 pt-3 pb-2">
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-5.5 mt-0.5 -translate-y-1/2 text-subtle"
          />
          <Input
            type="search"
            aria-label={copy.sql.explorer.search}
            placeholder={copy.sql.explorer.searchPlaceholder}
            value={query}
            className="h-8 pl-8 text-[13px]"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {loading ? (
            <div className="p-2">
              <LoadingState rows={4} />
            </div>
          ) : error !== null && error !== undefined ? (
            <div className="p-2">
              <RequestError
                error={error}
                retry={retry}
                title={copy.sql.explorer.unavailable}
              />
            </div>
          ) : visibleViews.length === 0 && visibleFunctions.length === 0 ? (
            <EmptyState
              compact
              className="m-1.5"
              title={copy.sql.explorer.noMatches}
              description={copy.sql.explorer.noMatchesHint}
            />
          ) : (
            <>
              <p className="px-2 pt-1 pb-1 text-[11px] font-medium tracking-wide text-subtle uppercase">
                {copy.sql.explorer.views}
              </p>
              <ul className="flex flex-col">
                {visibleViews.map((view) => (
                  <ViewRow
                    key={view.name}
                    view={view}
                    expanded={
                      searching
                        ? expanded[view.name] !== false
                        : expanded[view.name] === true
                    }
                    onToggle={() => {
                      setExpanded((prior) => ({
                        ...prior,
                        [view.name]: searching
                          ? prior[view.name] === false
                          : prior[view.name] !== true,
                      }));
                    }}
                    onInsert={onInsert}
                  />
                ))}
              </ul>
              {visibleFunctions.length > 0 && (
                <>
                  <p className="px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide text-subtle uppercase">
                    {copy.sql.explorer.functions}
                  </p>
                  <ul className="flex flex-col">
                    {visibleFunctions.map((fn) => (
                      <FunctionRow
                        key={fn.function_name}
                        fn={fn}
                        onInsert={onInsert}
                      />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
