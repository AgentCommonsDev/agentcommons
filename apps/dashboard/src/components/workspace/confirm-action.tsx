import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { X } from "lucide-react";
import { copy } from "../../copy";
import { errorMessage } from "../../lib/display";
import { Button } from "../ui/button";
import { Field } from "./primitives";
export function ConfirmAction({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  action,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  action: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await action(reason.trim());
      onOpenChange(false);
      setReason("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          onOpenChange(next);
          if (!next) {
            setReason("");
            setError(null);
          }
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                aria-label={copy.workspace.common.close}
              >
                <X size={19} aria-hidden />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description>{description}</Dialog.Description>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Field
              label={copy.workspace.common.reason}
              hint={copy.workspace.common.reasonHint}
            >
              {(props) => (
                <textarea
                  {...props}
                  required
                  minLength={1}
                  maxLength={2000}
                  value={reason}
                  disabled={pending}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
              )}
            </Field>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <Dialog.Close asChild>
                <Button variant="secondary" disabled={pending}>
                  {copy.workspace.common.cancel}
                </Button>
              </Dialog.Close>
              <Button
                className="button-danger"
                disabled={pending || reason.trim().length === 0}
                type="submit"
              >
                {pending ? copy.workspace.common.saving : confirmLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
