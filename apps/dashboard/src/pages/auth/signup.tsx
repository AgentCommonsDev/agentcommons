import { KeyRound, MailCheck, UserPlus } from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { QueryState } from "../../components/app/states";
import { AuthMethods } from "../../components/provider-sign-in";
import { Button } from "../../components/ui/button";
import { Alert, Spinner } from "../../components/ui/feedback";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { copy } from "../../copy";
import { authClient, authResult } from "../../lib/auth-client";
import { useBillingConfig } from "../../lib/billing-config";
import { errorMessage } from "../../lib/display";
import { paths, withReturn } from "../../lib/routes";
import { useAuthConfig } from "../../lib/use-auth-config";
import {
  AccountAgreement,
  AccountForm,
  AccountHeading,
  AccountLink,
  AccountLinks,
  AccountPrompt,
  AccountUnavailable,
} from "./layout";

const text = copy.site.signup;
/** The application page the visitor asked for before signing up, carried through every link. */
type ReturnTo = string | undefined;
/**
 * The two "send me a link" requests share one form; only the copy and the call differ.
 * Callback paths are relative: the server resolves them against its public URL.
 */
const emailRequests = {
  verification: {
    title: text.verifyEmail,
    description: text.verifyRequestDescription,
    submit: text.verifySubmit,
    sent: copy.auth.verificationSent,
    resent: text.sent,
    Icon: MailCheck,
    send: (email: string, next: ReturnTo) =>
      authClient.sendVerificationEmail({
        email,
        callbackURL: withReturn(paths.onboarding, next),
      }),
  },
  reset: {
    title: text.resetTitle,
    description: text.resetDescription,
    submit: text.resetSubmit,
    sent: text.resetSent,
    resent: text.resetSent,
    Icon: KeyRound,
    send: (email: string, next: ReturnTo) =>
      authClient.requestPasswordReset({
        email,
        redirectTo: withReturn(paths.setupPassword, next),
      }),
  },
} as const;
type EmailRequestKind = keyof typeof emailRequests;

function EmailLinkRequest({
  kind,
  initialEmail,
  next,
}: {
  kind: EmailRequestKind;
  /** When given, the address is fixed and the button re-sends the link. */
  initialEmail?: string | undefined;
  next: ReturnTo;
}) {
  const request = emailRequests[kind];
  const resend = initialEmail !== undefined;
  const [email, setEmail] = useState(initialEmail ?? "");
  const send = useMutation({
    mutationFn: async () =>
      authResult(await request.send(email, next), text.emailFailed),
  });
  return (
    <>
      <AccountForm
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate();
        }}
      >
        {resend ? (
          <p className="verified-email rounded-md border border-line bg-raised px-3 py-2 text-sm font-medium">
            {email}
          </p>
        ) : (
          <Field label={copy.auth.email}>
            {(props) => (
              <Input
                {...props}
                type="email"
                name="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
                disabled={send.isPending}
              />
            )}
          </Field>
        )}
        <Button
          type="submit"
          variant={resend ? "secondary" : "primary"}
          className="w-full"
          disabled={send.isPending}
        >
          {send.isPending && <Spinner className="text-current" />}
          {send.isPending
            ? text.sending
            : resend
              ? text.resend
              : request.submit}
        </Button>
      </AccountForm>
      {send.isSuccess && (
        <Alert variant="success">
          {resend ? request.resent : request.sent}
        </Alert>
      )}
      {send.error && <Alert variant="danger">{errorMessage(send.error)}</Alert>}
    </>
  );
}
/** Shown after signup and while onboarding waits for a verified address. */
export function VerificationNotice({
  email,
  next,
}: {
  email: string;
  next: ReturnTo;
}) {
  return (
    <>
      <AccountHeading
        icon={<MailCheck aria-hidden />}
        title={text.verifyTitle}
        description={text.verifyDescription}
      />
      <EmailLinkRequest kind="verification" initialEmail={email} next={next} />
    </>
  );
}

export function SignupPage({ next }: { next: ReturnTo }) {
  const billing = useBillingConfig();
  const config = useAuthConfig();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  /* The verification link and the provider callback both end in onboarding, which opens `next` once the account is ready. */
  const callbackPath = withReturn(paths.onboarding, next);
  const submit = useMutation({
    mutationFn: async () => {
      authResult(
        await authClient.signUp.email({
          name,
          email,
          password,
          callbackURL: callbackPath,
        }),
        text.failed,
      );
      return email;
    },
  });
  if (!billing.enabled) return <AccountUnavailable title={text.title} />;
  if (submit.isSuccess)
    return <VerificationNotice email={submit.data} next={next} />;
  const pending = submit.isPending;
  return (
    <>
      <AccountHeading
        icon={<UserPlus aria-hidden />}
        title={text.title}
        description={text.description}
      />
      <QueryState query={config} rows={3} title={copy.auth.configError}>
        {(methods) =>
          methods.signup_mode !== "open" ? (
            <Alert variant="info">{text.unavailable}</Alert>
          ) : (
            <AuthMethods
              config={methods}
              callbackPath={callbackPath}
              toggleLabel={copy.auth.signupPasswordInstead}
              toggleTestId="signup-use-password"
              disabled={pending}
              error={submit.error}
              passwordForm={
                <AccountForm
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit.mutate();
                  }}
                >
                  <Field label={text.name}>
                    {(props) => (
                      <Input
                        {...props}
                        name="name"
                        autoComplete="name"
                        required
                        value={name}
                        onChange={(event) => {
                          setName(event.target.value);
                        }}
                        disabled={pending}
                      />
                    )}
                  </Field>
                  <Field label={copy.auth.email}>
                    {(props) => (
                      <Input
                        {...props}
                        type="email"
                        name="email"
                        autoComplete="username"
                        required
                        value={email}
                        onChange={(event) => {
                          setEmail(event.target.value);
                        }}
                        disabled={pending}
                      />
                    )}
                  </Field>
                  <Field
                    label={copy.auth.password}
                    hint={copy.auth.passwordHint}
                  >
                    {(props) => (
                      <Input
                        {...props}
                        type="password"
                        name="password"
                        autoComplete="new-password"
                        minLength={8}
                        required
                        value={password}
                        onChange={(event) => {
                          setPassword(event.target.value);
                        }}
                        disabled={pending}
                      />
                    )}
                  </Field>
                  <Button
                    type="submit"
                    data-testid="signup-submit"
                    className="w-full"
                    disabled={pending}
                  >
                    {pending && <Spinner className="text-current" />}
                    {pending ? text.submitting : text.submit}
                  </Button>
                </AccountForm>
              }
            >
              <AccountAgreement />
            </AuthMethods>
          )
        }
      </QueryState>
      <AccountLinks>
        <AccountPrompt
          text={text.already}
          href={withReturn(paths.login, next)}
          link={text.signIn}
        />
        <AccountLink href={withReturn(paths.verifyEmail, next)}>
          {text.verifyEmail}
        </AccountLink>
      </AccountLinks>
    </>
  );
}

function AccountEmailPage({
  kind,
  next,
}: {
  kind: EmailRequestKind;
  next: ReturnTo;
}) {
  const billing = useBillingConfig();
  const request = emailRequests[kind];
  if (!billing.enabled) return <AccountUnavailable title={request.title} />;
  const Icon = request.Icon;
  return (
    <>
      <AccountHeading
        icon={<Icon aria-hidden />}
        title={request.title}
        description={request.description}
      />
      <EmailLinkRequest kind={kind} next={next} />
      <AccountLinks>
        <AccountLink href={withReturn(paths.login, next)}>
          {copy.auth.backToSignIn}
        </AccountLink>
      </AccountLinks>
    </>
  );
}
export function ForgotPasswordPage({ next }: { next: ReturnTo }) {
  return <AccountEmailPage kind="reset" next={next} />;
}
export function VerifyEmailPage({ next }: { next: ReturnTo }) {
  return <AccountEmailPage kind="verification" next={next} />;
}
