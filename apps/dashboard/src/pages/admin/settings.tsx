import { copy } from "../../copy";
import { PageHeader } from "../../components/ui/feedback";
import {
  DefaultDashboardCard,
  DomainsCard,
  EmbeddingsCard,
  GeneralCard,
  SsoCard,
} from "../../features/admin/settings";

export function SettingsPage() {
  return (
    <>
      <PageHeader
        title={copy.settings.title}
        description={copy.settings.description}
      />
      <div className="flex w-full max-w-4xl flex-col gap-5">
        <GeneralCard />
        <EmbeddingsCard />
        <DomainsCard />
        <SsoCard />
        <DefaultDashboardCard />
      </div>
    </>
  );
}
