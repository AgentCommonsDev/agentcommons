import { copy } from "../../copy";
import { PageHeader } from "../../components/ui/feedback";
import { AdminKeysTable } from "../../features/admin/keys-table";

const text = copy.admin.keys;

export function AdminKeysPage() {
  return (
    <>
      <PageHeader title={text.title} description={text.description} />
      <AdminKeysTable
        testId="admin-keys-table"
        label={text.title}
        csvName={text.csvName}
        empty={{ title: text.empty, hint: text.emptyHint }}
      />
    </>
  );
}
