import { useEffect, useState } from "react";
import { Alert } from "../../components/ui/feedback";
import { copy } from "../../copy";
import { paths } from "../../lib/routes";

/** The Scalar reference framed inside the app; it reloads when the theme toggles. */
export function ApiReference() {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const listener = () => {
      setGeneration((prior) => prior + 1);
    };
    window.addEventListener("agentcommons:theme", listener);
    return () => {
      window.removeEventListener("agentcommons:theme", listener);
    };
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="info">
        {copy.apiReference.auth}{" "}
        <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[12.5px]">
          {copy.apiReference.authExample}
        </code>
      </Alert>
      <iframe
        key={generation}
        data-testid="api-reference-frame"
        title={copy.apiReference.frameTitle}
        src={paths.apiReference}
        className="min-h-[calc(100dvh-14rem)] w-full rounded-lg border border-line bg-surface"
      />
    </div>
  );
}
