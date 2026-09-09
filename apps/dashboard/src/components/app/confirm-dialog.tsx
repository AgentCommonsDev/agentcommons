import { useState, type ReactNode } from "react";
import { copy } from "../../copy";
import { errorMessage } from "../../lib/display";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "../ui/dialog";
import { Field } from "../ui/field";
import { Alert } from "../ui/feedback";
import { Textarea } from "../ui/input";

/**
 * Confirmation for audited actions. Destructive actions record a reason;
 * `requireReason` false gives a plain confirm.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = true,
  requireReason = true,
  action,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  requireReason?: boolean;
  action: (reason: string) => Promise<unknown>;
  children?: ReactNode;
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
        if (!next) {
          setReason("");
          setError(null);
        }
      }}
    >
      <DialogContent size="sm">
        <DialogHeader title={title} description={description} />
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {children}
          {requireReason && (
            <Field
              label={copy.app.common.reason}
              hint={copy.app.common.reasonHint}
            >
              {(props) => (
                <Textarea
                  {...props}
                  required
                  maxLength={2000}
                  rows={3}
                  value={reason}
                  disabled={pending}
                  autoFocus
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
              )}
            </Field>
          )}
          {error && <Alert variant="danger">{error}</Alert>}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={pending}>
                {copy.app.common.cancel}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant={destructive ? "danger" : "primary"}
              disabled={
                pending || (requireReason && reason.trim().length === 0)
              }
            >
              {pending ? copy.app.common.pending : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
