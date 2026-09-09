import { ArrowLeft } from "lucide-react";
import { copy } from "../copy";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/feedback";
import { paths } from "../lib/routes";

export function NotFoundPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-xl px-6 py-16">
      <EmptyState
        title={copy.notFound.title}
        description={copy.notFound.description}
        action={
          <Button asChild>
            <a href={paths.site}>
              <ArrowLeft aria-hidden />
              {copy.notFound.action}
            </a>
          </Button>
        }
      />
    </main>
  );
}
