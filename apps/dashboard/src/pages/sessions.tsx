import { useState } from "react";
import { Search, X } from "lucide-react";
import { copy } from "../copy";
import { Button } from "../components/ui/button";
import { Alert, EmptyState, PageHeader } from "../components/ui/feedback";
import { Input } from "../components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
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

const views: readonly ResultView[] = ["sessions", "messages"];
/** The words box; remounted by its parent whenever the applied query changes. */
function SearchForm({
  initial,
  onSubmit,
  onClear,
}: {
  initial: string;
  onSubmit: (query: string) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <form
      role="search"
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft.trim());
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
        {initial && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={copy.sessions.search.clear}
            onClick={onClear}
          >
            <X aria-hidden />
          </Button>
        )}
      </div>
    </form>
  );
}
/** One search experience: words plus filters in the URL, results as sessions or messages. */
export function SessionsPage() {
  const { state, update } = useSearchState();
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
        <SearchForm
          key={state.query}
          initial={state.query}
          onSubmit={(query) => {
            update({ query, view: query ? null : state.view });
          }}
          onClear={() => {
            update({ query: "", view: null });
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <FilterPopover state={state} onChange={update} />
          <FilterChips state={state} onChange={update} />
        </div>
      </section>
      {filters.error && <Alert variant="danger">{filters.error}</Alert>}
      <Tabs
        value={view}
        onValueChange={(value) => {
          const next = views.find((item) => item === value);
          if (next) chooseView(next);
        }}
        className="flex flex-col gap-5"
      >
        <TabsList
          variant="segmented"
          aria-label={copy.sessions.views.label}
          className="self-start"
        >
          <TabsTrigger
            variant="segmented"
            value="sessions"
            data-testid="sessions-view-sessions"
          >
            {copy.sessions.views.sessions}
          </TabsTrigger>
          <TabsTrigger
            variant="segmented"
            value="messages"
            data-testid="sessions-view-messages"
          >
            {copy.sessions.views.messages}
          </TabsTrigger>
        </TabsList>
        {filters.filters && (
          <>
            <TabsContent value="messages" className="pt-0">
              {state.query.trim() || filtered ? (
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
              )}
            </TabsContent>
            <TabsContent value="sessions" className="flex flex-col gap-5 pt-0">
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
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
