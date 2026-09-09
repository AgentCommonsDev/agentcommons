import { PageHeader } from "../components/ui/feedback";
import { copy } from "../copy";
import { Install } from "../features/install/install";

/** The first thing a developer does here: copy the installer command and connect a machine. */
export function InstallPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={copy.install.title}
        description={copy.install.description}
      />
      <Install />
    </div>
  );
}
