import { useMutation } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { RequestError } from "../../components/app/states";
import { useWorkspace } from "../../components/app/workspace";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { NativeSelect } from "../../components/ui/input";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { dateTime, textValue } from "../../lib/display";
import { cn } from "../../lib/utils";
import { canInstall } from "./permissions";
import { useKeysPage } from "./queries";

/** `POST /me/keys/:id/reveal`: the caller's own active key, decrypted and audited server-side. */
async function revealKey(id: string): Promise<string> {
  return unwrap(
    await api.POST("/api/v1/me/keys/{id}/reveal", {
      params: { path: { id } },
      body: {},
    }),
  ).key;
}
/** Reveal as a mutation; both the table button and the install picker call it. */
function useRevealKey() {
  return useMutation({ mutationFn: revealKey });
}

/** Reveals one active key and puts it on the clipboard; the value itself is never rendered. */
export function CopyKeyButton({
  keyId,
  className,
}: {
  keyId: string;
  className?: string | undefined;
}) {
  const reveal = useRevealKey();
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const label =
    state === "copied" ? copy.keys.reveal.copied : copy.keys.reveal.copy;
  const perform = async () => {
    try {
      await navigator.clipboard.writeText(await reveal.mutateAsync(keyId));
      setState("copied");
      setTimeout(() => {
        setState("idle");
      }, 1600);
    } catch {
      setState("error");
    }
  };
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={label}
        disabled={reveal.isPending}
        onClick={() => {
          void perform();
        }}
      >
        {state === "copied" ? (
          <Check aria-hidden className="text-success" />
        ) : (
          <Copy aria-hidden />
        )}
        {label}
      </Button>
      <span
        role="status"
        className={state === "error" ? "text-xs text-danger" : "sr-only"}
      >
        {state === "copied"
          ? copy.keys.reveal.copied
          : state === "error"
            ? copy.keys.reveal.failed
            : ""}
      </span>
    </span>
  );
}

/**
 * Pick one of the caller's active ingest+read keys for the installer. The chosen key is
 * revealed and handed to `onKey`; clearing the choice or a failed reveal hands back null.
 * With no eligible key the picker only points at the create form above it, so nothing on
 * the Install page sends a first-time developer elsewhere.
 */
export function InstallKeyPicker({
  onKey,
  initialKeyId,
}: {
  onKey: (key: string | null) => void;
  /** A key the page already holds (just created here) starts selected; no reveal needed. */
  initialKeyId?: string | undefined;
}) {
  const { organization } = useWorkspace();
  const [selectedId, setSelectedId] = useState(initialKeyId ?? "");
  const reveal = useRevealKey();
  const keys = useKeysPage(organization.id, {
    cursor: null,
    limit: 100,
    sort: "created_at",
    order: "desc",
  });
  const eligible = (keys.data?.items ?? []).filter(canInstall);
  if (keys.data !== undefined && eligible.length === 0)
    return (
      <p className="text-sm text-muted" data-testid="install-key-picker">
        {copy.keys.reveal.noKeys}
      </p>
    );
  return (
    <div className="flex flex-col gap-2" data-testid="install-key-picker">
      <Field label={copy.keys.reveal.pick} hint={copy.keys.reveal.pickHint}>
        {(props) => (
          <NativeSelect
            {...props}
            className="max-w-md"
            value={selectedId}
            disabled={keys.isPending || reveal.isPending}
            onChange={(event) => {
              const id = event.target.value;
              setSelectedId(id);
              if (id === "") {
                onKey(null);
                return;
              }
              reveal.mutate(id, {
                onSuccess: onKey,
                onError: () => {
                  onKey(null);
                },
              });
            }}
          >
            <option value="">{copy.keys.reveal.pickNone}</option>
            {eligible.map((key) => (
              <option key={key.id} value={key.id}>
                {textValue(key.name)}
                {copy.app.common.separator}
                {dateTime(key.created_at)}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      {reveal.error !== null && <RequestError error={reveal.error} />}
    </div>
  );
}
