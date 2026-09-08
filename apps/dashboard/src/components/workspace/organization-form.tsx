import { useState } from "react";
import { onboardingInputSchema } from "@agentcommons/core/schemas/auth";
import { copy } from "../../copy";
import { Button } from "../ui/button";
import { Field, RequestError } from "./primitives";
export function OrganizationForm({
  onSubmit,
}: {
  onSubmit: (input: { name: string; slug: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <form
      className="auth-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const input = onboardingInputSchema.safeParse({ name, slug });
        if (!input.success) {
          setError(input.error);
          return;
        }
        setPending(true);
        void onSubmit(input.data)
          .catch(setError)
          .finally(() => {
            setPending(false);
          });
      }}
    >
      <Field label={copy.signup.organizationName}>
        {(props) => (
          <input
            {...props}
            autoComplete="organization"
            required
            maxLength={onboardingInputSchema.shape.name.maxLength ?? undefined}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            disabled={pending}
          />
        )}
      </Field>
      <Field label={copy.signup.slug} hint={copy.signup.slugHint}>
        {(props) => (
          <input
            {...props}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={onboardingInputSchema.shape.slug.maxLength ?? undefined}
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
            }}
            disabled={pending}
          />
        )}
      </Field>
      {error !== null && <RequestError error={error} />}
      <Button type="submit" disabled={pending}>
        {pending
          ? copy.signup.organizationPending
          : copy.signup.organizationSubmit}
      </Button>
    </form>
  );
}
