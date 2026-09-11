import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "../../components/ui/dialog";
import { Alert } from "../../components/ui/feedback";
import { CheckboxField, Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { copy } from "../../copy";
import { errorMessage } from "../../lib/display";
import {
  adminOnlyPermissions,
  buildPermissions,
  permissionOrder,
  type Permission,
} from "./permissions";
import { createPersonalKey } from "./queries";

/** Ingest and read on; the tool groups and admin are opt-in (§8.2). */
const defaultSelection: Record<Permission, boolean> = {
  ingest: true,
  read: true,
  dashboards: false,
  administration: false,
  admin: false,
};

/** Name, permissions and optional expiry; the secret is handed to the caller exactly once. */
export function CreateKeyDialog({
  open,
  onOpenChange,
  allowAdmin,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowAdmin: boolean;
  onCreated: (secret: string) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [days, setDays] = useState("");
  const [selection, setSelection] = useState(defaultSelection);
  const permissions = buildPermissions(selection);
  const hasPermission =
    permissions.sessions !== undefined || permissions.admin !== undefined;
  const create = useMutation({
    mutationFn: async () => {
      const expires =
        days.trim() === "" ? null : Math.floor(Number(days) * 86_400);
      return createPersonalKey({
        name: name.trim(),
        permissions,
        ...(expires !== null && expires > 0 ? { expires_in: expires } : {}),
      });
    },
    onSuccess: async (result) => {
      onOpenChange(false);
      setName("");
      setDays("");
      setSelection(defaultSelection);
      await onCreated(result.key);
    },
  });
  const offered = permissionOrder.filter(
    (permission) => allowAdmin || !adminOnlyPermissions.includes(permission),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (create.isPending) return;
        onOpenChange(next);
        if (!next) create.reset();
      }}
    >
      <DialogContent>
        <DialogHeader
          title={copy.keys.create.title}
          description={copy.keys.create.description}
        />
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (hasPermission) create.mutate();
          }}
        >
          <Field label={copy.keys.create.name} hint={copy.keys.create.nameHint}>
            {(props) => (
              <Input
                {...props}
                required
                autoFocus
                maxLength={128}
                placeholder={copy.keys.create.namePlaceholder}
                value={name}
                disabled={create.isPending}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </Field>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-[13px] font-medium">
              {copy.keys.permissions.label}
            </legend>
            {offered.map((permission) => (
              <CheckboxField
                key={permission}
                label={copy.keys.permissions[permission]}
                hint={copy.keys.permissions[`${permission}Hint`]}
                checked={selection[permission]}
                // The administration tools need admin on the same key (§9.2): the box
                // opens once Admin is checked and clears when Admin is cleared.
                disabled={
                  create.isPending ||
                  (permission === "administration" && !selection.admin)
                }
                onCheckedChange={(checked) => {
                  setSelection((prior) => ({
                    ...prior,
                    [permission]: checked === true,
                    ...(permission === "admin" && checked !== true
                      ? { administration: false }
                      : {}),
                  }));
                }}
              />
            ))}
            {!hasPermission && (
              <p role="alert" className="text-xs text-danger">
                {copy.keys.permissions.required}
              </p>
            )}
          </fieldset>
          <Field
            label={copy.keys.create.expires}
            optional={copy.app.common.optional}
            hint={copy.keys.create.expiresHint}
          >
            {(props) => (
              <span className="flex items-center gap-2">
                <Input
                  {...props}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  step={1}
                  className="max-w-32"
                  value={days}
                  disabled={create.isPending}
                  onChange={(event) => {
                    setDays(event.target.value);
                  }}
                />
                <span className="text-sm text-muted">
                  {copy.keys.create.expiresUnit}
                </span>
              </span>
            )}
          </Field>
          {create.error !== null && (
            <Alert variant="danger">{errorMessage(create.error)}</Alert>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={create.isPending}>
                {copy.app.common.cancel}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={
                create.isPending || !hasPermission || name.trim() === ""
              }
            >
              {create.isPending
                ? copy.keys.create.pending
                : copy.keys.create.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
