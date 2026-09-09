import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { organizationRoleSchema } from "@agentcommons/core/schemas/common";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { dateTime, errorMessage, statusLabel } from "../../lib/display";
import type { Member } from "../../lib/types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "../../components/ui/dialog";
import { Field } from "../../components/ui/field";
import { Alert, Spinner } from "../../components/ui/feedback";
import { NativeSelect, Textarea } from "../../components/ui/input";
import { CopyButton, DefinitionList } from "../../components/app/states";
import { CodeBlock } from "./display";

export type Role = Member["role"];
export const roles = organizationRoleSchema.options;

export function RoleSelect({
  value,
  onChange,
  id,
  label,
  disabled,
  className,
}: {
  value: Role;
  onChange: (role: Role) => void;
  id?: string | undefined;
  label?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <NativeSelect
      id={id}
      aria-label={label}
      value={value}
      disabled={disabled}
      className={className}
      onChange={(event) => {
        onChange(organizationRoleSchema.parse(event.target.value));
      }}
    >
      {roles.map((role) => (
        <option key={role} value={role}>
          {statusLabel(role)}
        </option>
      ))}
    </NativeSelect>
  );
}
const resultTone = {
  added: "success",
  existing: "neutral",
  error: "danger",
} as const;

export function AddPeopleDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => Promise<unknown>;
}) {
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<Role>("member");
  const add = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/api/v1/admin/users", {
          body: {
            emails: emails
              .split(/[\s,;]+/)
              .map((email) => email.trim())
              .filter(Boolean),
            role,
          },
        }),
      ),
    onSuccess: async () => {
      setEmails("");
      await onAdded();
    },
  });
  const close = (next: boolean) => {
    if (add.isPending) return;
    onOpenChange(next);
    if (!next) {
      add.reset();
      setEmails("");
      setRole("member");
    }
  };
  const text = copy.admin.users;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader title={text.add} description={text.addDescription} />
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <Field label={text.emails} hint={text.emailsHint}>
            {(props) => (
              <Textarea
                {...props}
                required
                rows={4}
                autoFocus
                value={emails}
                disabled={add.isPending}
                onChange={(event) => {
                  setEmails(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label={text.role}>
            {(props) => (
              <RoleSelect
                id={props.id}
                value={role}
                onChange={setRole}
                disabled={add.isPending}
              />
            )}
          </Field>
          {add.error && (
            <Alert variant="danger">{errorMessage(add.error)}</Alert>
          )}
          {add.data && (
            <div className="flex flex-col gap-2" role="status">
              <p className="text-[13px] font-medium">{text.results}</p>
              <ul className="flex flex-col divide-y divide-line-soft rounded-md border border-line">
                {add.data.results.map((result) => (
                  <li
                    key={result.email}
                    className="flex flex-col gap-1.5 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {result.email}
                      </span>
                      <Badge variant={resultTone[result.status]}>
                        {text[result.status]}
                      </Badge>
                      {result.setup_url && (
                        <CopyButton
                          value={result.setup_url}
                          label={text.setupLink}
                          showLabel
                          variant="secondary"
                        />
                      )}
                    </div>
                    {result.error && (
                      <p className="text-xs text-danger">{result.error}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={add.isPending}>
                {add.data ? copy.app.common.done : copy.app.common.cancel}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={add.isPending || emails.trim() === ""}
            >
              {add.isPending ? text.adding : text.addSubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
/** Issues a password setup link for one member as soon as it opens. */
export function PasswordSetupDialog({
  member,
  onClose,
}: {
  member: Member | null;
  onClose: () => void;
}) {
  const text = copy.admin.users;
  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader title={text.setup} description={text.setupDescription} />
        {member && <PasswordSetupBody key={member.id} member={member} />}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{copy.app.common.close}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function PasswordSetupBody({ member }: { member: Member }) {
  const text = copy.admin.users;
  const setup = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/api/v1/admin/users/password-setup", {
          body: { user_id: member.user_id },
        }),
      ),
  });
  const { mutate } = setup;
  useEffect(() => {
    mutate();
  }, [mutate]);
  return (
    <div className="flex flex-col gap-3">
      <DefinitionList
        items={[
          { label: text.setupFor, value: member.email },
          {
            label: text.expires,
            value: setup.data
              ? dateTime(setup.data.expires_at)
              : copy.app.common.unavailable,
          },
        ]}
      />
      {setup.isPending && (
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner />
          {text.creatingLink}
        </p>
      )}
      {setup.error && (
        <Alert variant="danger">{errorMessage(setup.error)}</Alert>
      )}
      {setup.data && (
        <CodeBlock
          text={setup.data.setup_url}
          copyLabel={text.setupLink}
          maxHeight="max-h-40"
        />
      )}
    </div>
  );
}
