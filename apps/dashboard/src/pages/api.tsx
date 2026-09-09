import { ExternalLink } from "lucide-react";
import { Button } from "../components/ui/button";
import { PageHeader } from "../components/ui/feedback";
import { copy } from "../copy";
import { ApiReference } from "../features/api-reference/reference";
import { paths } from "../lib/routes";

/** The live Scalar reference inside the application shell. */
export function ApiReferencePage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={copy.apiReference.title}
        description={copy.apiReference.description}
        actions={
          <Button asChild variant="secondary">
            <a href={paths.apiReference} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden />
              {copy.apiReference.openNew}
            </a>
          </Button>
        }
      />
      <ApiReference />
    </div>
  );
}
