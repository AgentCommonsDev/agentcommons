import { Plus } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "../components/app/workspace";
import { Button } from "../components/ui/button";
import { PageHeader } from "../components/ui/feedback";
import { copy } from "../copy";
import { CreateKeyDialog } from "../features/keys/create-key-dialog";
import { KeySecretPanel } from "../features/keys/key-secret";
import { KeysTable } from "../features/keys/keys-table";
import { useRefreshKeys } from "../features/keys/queries";

/** The caller's keys: create (the secret shows once), sort, export and revoke. */
export function KeysPage() {
  const { organization, admin } = useWorkspace();
  const refresh = useRefreshKeys(organization.id);
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={copy.keys.title}
        description={copy.keys.description}
        actions={
          <Button
            data-testid="keys-create"
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            <Plus aria-hidden />
            {copy.keys.create.action}
          </Button>
        }
      />
      {secret !== null && (
        <KeySecretPanel
          secret={secret}
          onDismiss={() => {
            setSecret(null);
          }}
        />
      )}
      <KeysTable
        onCreate={() => {
          setCreateOpen(true);
        }}
      />
      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        allowAdmin={admin}
        onCreated={async (key) => {
          setSecret(key);
          await refresh();
        }}
      />
    </div>
  );
}
