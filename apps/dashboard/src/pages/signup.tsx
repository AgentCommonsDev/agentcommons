import { useState } from "react";
import { UserPlus } from "lucide-react";
import { copy } from "../copy";
import { useBillingConfig } from "../lib/billing-config";
import { useAuthConfig } from "../lib/use-auth-config";
import { authClient } from "../lib/auth-client";
import { errorMessage } from "../lib/display";
import { Button } from "../components/ui/button";
import {
  Field,
  LoadingState,
  RequestError,
} from "../components/workspace/primitives";
import { ProviderSignIn } from "../components/provider-sign-in";
const emailRequests = {
  verification: {
    title: copy.signup.verifyEmail,
    description: copy.signup.verifyRequestDescription,
    submit: copy.signup.verifySubmit,
    sent: copy.signup.sent,
    send: (email: string) =>
      authClient.sendVerificationEmail({
        email,
        callbackURL: new URL("/onboarding", window.location.origin).href,
      }),
  },
  reset: {
    title: copy.signup.resetTitle,
    description: copy.signup.resetDescription,
    submit: copy.signup.resetSubmit,
    sent: copy.signup.resetSent,
    send: (email: string) =>
      authClient.requestPasswordReset({
        email,
        redirectTo: new URL("/setup-password", window.location.origin).href,
      }),
  },
};
function EmailLinkRequest({
  kind,
  initialEmail,
}: {
  kind: keyof typeof emailRequests;
  initialEmail?: string;
}) {
  const request = emailRequests[kind];
  const [email, setEmail] = useState(initialEmail ?? "");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          setSent(false);
          void request
            .send(email)
            .then((response) => {
              if (response.error)
                throw new Error(
                  response.error.message ?? copy.signup.emailFailed,
                );
              setSent(true);
            })
            .catch((caught: unknown) => {
              setError(errorMessage(caught));
            })
            .finally(() => {
              setPending(false);
            });
        }}
      >
        {initialEmail === undefined ? (
          <Field label={copy.workspace.auth.email}>
            {(props) => (
              <input
                {...props}
                type="email"
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
        ) : (
          <p className="verified-email">{email}</p>
        )}
        <Button
          type="submit"
          variant={initialEmail === undefined ? "primary" : "secondary"}
          disabled={pending}
        >
          {pending
            ? copy.signup.sending
            : initialEmail === undefined
              ? request.submit
              : copy.signup.resend}
        </Button>
      </form>
      {sent && <p role="status">{request.sent}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <a className="text-link login-back" href="/login">
        {copy.signup.signIn}
      </a>
    </>
  );
}
export function VerificationNotice({ email }: { email: string }) {
  return (
    <>
      <h1>{copy.signup.verifyTitle}</h1>
      <p>{copy.signup.verifyDescription}</p>
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
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await authClient.signUp.email({
        name,
        email,
        password,
        callbackURL: new URL("/onboarding", window.location.origin).href,
      });
      if (response.error)
        throw new Error(response.error.message ?? copy.signup.failed);
      setCreated(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };
  return (
    <main id="main" className="login-page container">
      <div className="login-card">
        {!billing.enabled ? (
          <>
            <h1>{copy.signup.title}</h1>
            <p>{copy.saas.unavailable}</p>
          </>
        ) : config.isPending ? (
          <LoadingState />
        ) : config.error ? (
          <RequestError
            error={config.error}
            retry={() => {
              void config.refetch();
            }}
          />
        ) : config.data.signup_mode !== "open" ? (
          <>
            <h1>{copy.signup.title}</h1>
            <p>{copy.signup.unavailable}</p>
          </>
        ) : created ? (
          <VerificationNotice email={email} />
        ) : (
          <>
            <div className="login-icon">
              <UserPlus size={26} strokeWidth={1.4} aria-hidden />
            </div>
            <h1>{copy.signup.title}</h1>
            <p>{copy.signup.description}</p>
            {config.data.email_password_enabled && (
              <form
                className="auth-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <Field label={copy.signup.name}>
                  {(props) => (
                    <input
                      {...props}
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
                <Field label={copy.workspace.auth.email}>
                  {(props) => (
                    <input
                      {...props}
                      type="email"
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
                <Field label={copy.workspace.auth.password}>
                  {(props) => (
                    <input
                      {...props}
                      type="password"
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
                <Button type="submit" disabled={pending}>
                  {pending ? copy.signup.submitting : copy.signup.submit}
                </Button>
              </form>
            )}
            {config.data.email_password_enabled &&
              (config.data.oidc_enabled || config.data.social_provider) && (
                <div className="auth-divider">{copy.workspace.auth.or}</div>
              )}
            <ProviderSignIn
              config={config.data}
              callbackPath="/onboarding"
              disabled={pending}
              onError={setError}
            />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <a className="text-link login-back" href="/verify-email">
              {copy.signup.verifyEmail}
            </a>
            <p className="login-detail">
              {copy.signup.already} <a href="/login">{copy.signup.signIn}</a>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
function AccountEmailPage({ kind }: { kind: keyof typeof emailRequests }) {
  const billing = useBillingConfig();
  const request = emailRequests[kind];
  return (
    <main id="main" className="login-page container">
      <div className="login-card">
        <h1>{request.title}</h1>
        {billing.enabled ? (
          <>
            <p>{request.description}</p>
            <EmailLinkRequest kind={kind} />
          </>
        ) : (
          <p>{copy.saas.unavailable}</p>
        )}
      </div>
    </main>
  );
}
export function ForgotPasswordPage() {
  return <AccountEmailPage kind="reset" />;
}
export function VerifyEmailPage() {
  return <AccountEmailPage kind="verification" />;
}
