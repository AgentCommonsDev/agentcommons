import { useEffect, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { copy } from "../copy";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Alert, EmptyState, PageHeader } from "../components/ui/feedback";
import { Input } from "../components/ui/input";
import { FilterChips } from "../features/sessions/filter-chips";
import { FilterPopover } from "../features/sessions/filter-popover";
import { MessageResults } from "../features/sessions/search-results";
import {
  apiFilters,
  effectiveView,
  hasFilters,
  type ResultView,
} from "../features/sessions/search-state";
import { SessionsTable } from "../features/sessions/sessions-table";
import { useSearchState } from "../features/sessions/use-search-state";

function Segment({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "h-8 cursor-pointer rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        active ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
/** One search experience: words plus filters in the URL, results as sessions or messages. */
export function SessionsPage() {
  const { state, update } = useSearchState();
  const [draft, setDraft] = useState(state.query);
  useEffect(() => {
    setDraft(state.query);
  }, [state.query]);
  const view = effectiveView(state);
  const filters = apiFilters(state);
  const filtered = hasFilters(state);
  const chooseView = (next: ResultView) => {
    update({ view: next });
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={copy.sessions.title}
        description={copy.sessions.description}
      />
      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 sm:p-4">
        <form
          role="search"
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            const query = draft.trim();
            update({ query, view: query ? null : state.view });
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              size={16}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            />
            <Input
              type="search"
              data-testid="sessions-search"
              aria-label={copy.sessions.search.label}
              placeholder={copy.sessions.search.placeholder}
              value={draft}
              className="pl-9"
              onChange={(event) => {
                setDraft(event.target.value);
              }}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1 sm:flex-none">
              {copy.sessions.search.submit}
            </Button>
            {state.query && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={copy.sessions.search.clear}
                onClick={() => {
                  setDraft("");
                  update({ query: "", view: null });
                }}
              >
                <X aria-hidden />
              </Button>
            )}
          </div>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <FilterPopover state={state} onChange={update} />
          <FilterChips state={state} onChange={update} />
        </div>
      </section>
      {filters.error && <Alert variant="danger">{filters.error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label={copy.sessions.views.label}
          className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5"
        >
          <Segment
            active={view === "sessions"}
            testId="sessions-view-sessions"
            onClick={() => {
              chooseView("sessions");
            }}
          >
            {copy.sessions.views.sessions}
          </Segment>
          <Segment
            active={view === "messages"}
            testId="sessions-view-messages"
            onClick={() => {
              chooseView("messages");
            }}
          >
            {copy.sessions.views.messages}
          </Segment>
        </div>
      </div>
      {filters.filters &&
        (view === "messages" ? (
          state.query.trim() || filtered ? (
            <MessageResults
              query={state.query.trim()}
              filters={filters.filters}
            />
          ) : (
            <EmptyState
              compact
              title={copy.sessions.results.needQuery}
              description={copy.sessions.results.needQueryHint}
            />
          )
        ) : (
          <>
            {state.query.trim() && (
              <Alert
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      chooseView("messages");
                    }}
                  >
                    {copy.sessions.views.showMessages}
                  </Button>
                }
              >
                {copy.sessions.views.wordsHint}
              </Alert>
            )}
            <SessionsTable filters={filters.filters} filtered={filtered} />
          </>
        ))}
    </div>
  );
}
