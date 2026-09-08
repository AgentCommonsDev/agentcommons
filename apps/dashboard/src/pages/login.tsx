import { ArrowLeft } from "lucide-react";
import { copy } from "../copy";
import { Button } from "../components/ui/button";

export function NotFoundPage() {
  return (
    <main id="main" className="login-page container">
      <div className="login-card">
        <h1>{copy.notFound.title}</h1>
        <p>{copy.notFound.description}</p>
        <Button asChild>
          <a href="/">
            {copy.notFound.action}
            <ArrowLeft size={15} aria-hidden />
          </a>
        </Button>
      </div>
    </main>
  );
}
