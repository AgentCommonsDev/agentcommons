import { Alert } from "../../components/ui/feedback";
import { copy } from "../../copy";
import { paths } from "../../lib/routes";
import { useTheme } from "../../lib/theme";

/** The Scalar reference framed inside the app; it reloads when the theme toggles. */
export function ApiReference() {
  const { theme } = useTheme();
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="info">
        {copy.apiReference.auth}{" "}
        <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[12.5px]">
          {copy.apiReference.authExample}
        </code>
      </Alert>
      <iframe
        key={theme}
        data-testid="api-reference-frame"
        title={copy.apiReference.frameTitle}
        src={paths.apiReference}
        className="min-h-[calc(100dvh-14rem)] w-full rounded-lg border border-line bg-surface"
      />
    </div>
  );
}
