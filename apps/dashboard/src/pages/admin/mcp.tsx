import { copy } from "../../copy";
import { PageHeader } from "../../components/ui/feedback";
import { AdminKeysTable } from "../../features/admin/keys-table";
import { ManagementKeyCard } from "../../features/admin/management-mcp";

const text = copy.admin.mcp;

/** Management MCP (§10): what the `agentcommons-admin` server is, a new key with its registrations, and the keys that grant it. */
export function ManagementMcpPage() {
  return (
    <>
      <PageHeader title={text.title} description={text.description} />
      <div className="flex w-full max-w-4xl flex-col gap-5">
        <ManagementKeyCard />
      </div>
      <section className="flex flex-col gap-3" data-testid="management-keys">
        <div>
          <h2 className="text-base font-semibold">{text.keys.title}</h2>
          <p className="text-sm leading-relaxed text-muted">
            {text.keys.description}
          </p>
        </div>
        <AdminKeysTable
          toolGroup="administration"
          testId="management-keys-table"
          label={text.keys.title}
          csvName={text.keys.csvName}
          empty={{ title: text.keys.empty, hint: text.keys.emptyHint }}
        />
      </section>
    </>
  );
}
