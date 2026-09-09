import { ArrowLeft } from "lucide-react";
import { copy } from "../copy";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/feedback";
import { paths } from "../lib/routes";

export function NotFoundPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-xl px-6 py-16">
      <EmptyState
        title={copy.site.notFound.title}
        description={copy.site.notFound.description}
        action={
          <Button asChild>
            <a href={paths.site}>
              <ArrowLeft aria-hidden />
              {copy.site.notFound.action}
            </a>
          </Button>
        }
      />
    </main>
  );
}
