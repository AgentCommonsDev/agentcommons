import { copy } from "../copy";
import { PageHeader } from "../components/ui/feedback";
import { SessionSearch } from "../features/sessions/session-search";

/** Search words and filters over every captured session the reader can see. */
export function SessionsPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={copy.sessions.title}
        description={copy.sessions.description}
      />
      <SessionSearch />
    </div>
  );
}
