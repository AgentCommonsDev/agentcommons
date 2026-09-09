import { KeyRound, MailCheck, UserPlus } from "lucide-react";
import { useState } from "react";
import { LoadingState, RequestError } from "../../components/app/states";
import { ProviderSignIn } from "../../components/provider-sign-in";
import { Button } from "../../components/ui/button";
import { Alert, Spinner } from "../../components/ui/feedback";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { copy } from "../../copy";
import { authClient } from "../../lib/auth-client";
import { useBillingConfig } from "../../lib/billing-config";
import { errorMessage } from "../../lib/display";
import { paths } from "../../lib/routes";
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

/**
 * The two "send me a link" requests share one form; only the copy and the call differ.
 * Callback paths are relative: the server resolves them against its public URL.
 */
const emailRequests = {
  verification: {
    title: copy.signup.verifyEmail,
    description: copy.signup.verifyRequestDescription,
    submit: copy.signup.verifySubmit,
    sent: copy.auth.verificationSent,
    resent: copy.signup.sent,
    Icon: MailCheck,
    send: (email: string) =>
      authClient.sendVerificationEmail({
        email,
        callbackURL: paths.onboarding,
      }),
  },
  reset: {
    title: copy.signup.resetTitle,
    description: copy.signup.resetDescription,
    submit: copy.signup.resetSubmit,
    sent: copy.signup.resetSent,
    resent: copy.signup.resetSent,
    Icon: KeyRound,
    send: (email: string) =>
      authClient.requestPasswordReset({
        email,
        redirectTo: paths.setupPassword,
      }),
  },
} as const;
type EmailRequestKind = keyof typeof emailRequests;

function EmailLinkRequest({
  kind,
  initialEmail,
}: {
  kind: EmailRequestKind;
  /** When given, the address is fixed and the button re-sends the link. */
  initialEmail?: string | undefined;
}) {
  const request = emailRequests[kind];
  const resend = initialEmail !== undefined;
  const [email, setEmail] = useState(initialEmail ?? "");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setPending(true);
    setError(null);
    setSent(false);
    try {
      const response = await request.send(email);
      if (response.error)
        throw new Error(response.error.message ?? copy.signup.emailFailed);
      setSent(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <AccountForm
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
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
                disabled={pending}
              />
            )}
          </Field>
        )}
        <Button
          type="submit"
          variant={resend ? "secondary" : "primary"}
          className="w-full"
          disabled={pending}
        >
          {pending && <Spinner className="text-current" />}
          {pending
            ? copy.signup.sending
            : resend
              ? copy.signup.resend
              : request.submit}
        </Button>
      </AccountForm>
      {sent && (
        <Alert variant="success">
          {resend ? request.resent : request.sent}
        </Alert>
      )}
      {error && <Alert variant="danger">{error}</Alert>}
    </>
  );
}
/** Shown after signup and while onboarding waits for a verified address. */
export function VerificationNotice({ email }: { email: string }) {
  return (
    <>
      <AccountHeading
        icon={<MailCheck aria-hidden />}
        title={copy.signup.verifyTitle}
        description={copy.signup.verifyDescription}
      />
      <EmailLinkRequest kind="verification" initialEmail={email} />
    </>
  );
}

export function SignupPage() {
  const billing = useBillingConfig();
  const config = useAuthConfig();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  // With a provider configured, that is the one path shown; the password form is a switch away.
  const [usePassword, setUsePassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await authClient.signUp.email({
        name,
        email,
        password,
        callbackURL: paths.onboarding,
      });
      if (response.error)
        throw new Error(response.error.message ?? copy.signup.failed);
      setCreated(email);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };
  if (!billing.enabled) return <AccountUnavailable title={copy.signup.title} />;
  if (created !== null) return <VerificationNotice email={created} />;
  const provider = config.data
    ? config.data.oidc_enabled || config.data.social_provider
    : false;
  const passwordEnabled = config.data?.email_password_enabled ?? false;
  const showPassword = passwordEnabled && (!provider || usePassword);
  const showProvider = Boolean(provider) && !usePassword;
  return (
    <>
      <AccountHeading
        icon={<UserPlus aria-hidden />}
        title={copy.signup.title}
        description={copy.signup.description}
      />
      {config.isPending ? (
        <LoadingState rows={3} />
      ) : config.error ? (
        <RequestError
          title={copy.auth.configError}
          error={config.error}
          retry={() => {
            void config.refetch();
          }}
        />
      ) : config.data.signup_mode !== "open" ? (
        <Alert variant="info">{copy.signup.unavailable}</Alert>
      ) : (
        <>
          {showPassword && (
            <AccountForm
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <Field label={copy.signup.name}>
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
              <Field label={copy.auth.password} hint={copy.auth.passwordHint}>
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
                {pending ? copy.signup.submitting : copy.signup.submit}
              </Button>
            </AccountForm>
          )}
          {showProvider && (
            <ProviderSignIn
              config={config.data}
              callbackPath={paths.onboarding}
              disabled={pending}
              onError={setError}
            />
          )}
          {passwordEnabled && provider && (
            <Button
              type="button"
              variant="link"
              size="sm"
              data-testid="signup-use-password"
              className="self-center"
              disabled={pending}
              onClick={() => {
                setUsePassword((prior) => !prior);
              }}
            >
              {usePassword
                ? copy.auth.providerInstead
                : copy.auth.signupPasswordInstead}
            </Button>
          )}
          {!passwordEnabled && !provider && (
            <Alert variant="danger">{copy.auth.noMethods}</Alert>
          )}
          {error && <Alert variant="danger">{error}</Alert>}
          {(config.data.email_password_enabled || provider) && (
            <AccountAgreement />
          )}
        </>
      )}
      <AccountLinks>
        <AccountPrompt
          text={copy.signup.already}
          href={paths.login}
          link={copy.signup.signIn}
        />
        <AccountLink href={paths.verifyEmail}>
          {copy.signup.verifyEmail}
        </AccountLink>
      </AccountLinks>
    </>
  );
}

function AccountEmailPage({ kind }: { kind: EmailRequestKind }) {
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
      <EmailLinkRequest kind={kind} />
      <AccountLinks>
        <AccountLink href={paths.login}>{copy.auth.backToSignIn}</AccountLink>
      </AccountLinks>
    </>
  );
}
export function ForgotPasswordPage() {
  return <AccountEmailPage kind="reset" />;
}
export function VerifyEmailPage() {
  return <AccountEmailPage kind="verification" />;
}
