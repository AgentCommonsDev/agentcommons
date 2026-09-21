/**
 * Sign-in, password setup and onboarding strings. SaaS account strings shared with the
 * public site (signup form, email requests, organization form) live in `copy.site.signup`.
 */
export const authCopy = {
  email: "Email address",
  password: "Password",
  newPassword: "New password",
  confirmPassword: "Confirm password",
  signIn: "Sign in",
  signingIn: "Signing in…",
  continueWith: "Continue with",
  /** Display names for social providers; the provider id is shown when it is not listed. */
  providers: {
    github: "GitHub",
    google: "Google",
    microsoft: "Microsoft",
    gitlab: "GitLab",
    apple: "Apple",
    okta: "Okta",
  },
  sso: "Continue with organization SSO",
  passwordInstead: "Sign in with email and password instead",
  providerInstead: "Use your organization's sign-in instead",
  signupPasswordInstead: "Sign up with email and password instead",
  nativeTitle: "Sign in to your organization",
  nativeDescription: "Use the account your organization administrator added.",
  welcomeBack: "Welcome back",
  passwordSetupTitle: "Set your password",
  passwordSetupDescription: "Choose a password for your existing account.",
  passwordManagerEmail: "Email for your password manager",
  passwordManagerHint:
    "Your setup link identifies the account. Add your email so your password manager saves the sign-in.",
  setupSubmit: "Set password",
  setupDone: "Your password has been set. You can now sign in.",
  passwordMismatch: "The passwords do not match.",
  passwordHint: "Use at least 8 characters.",
  noMethods:
    "No sign-in method is configured for this instance. Contact its administrator.",
  ssoRequired:
    "This organization requires SSO. Email and password sign-in is turned off for its members.",
  invalidSetup:
    "This password setup link is missing its token. Ask your administrator for a new link.",
  signInFailed: "Sign-in failed. Check your credentials and try again.",
  setupFailed: "Password setup failed. The link may have expired.",
  noAccount: "Access is managed by your organization administrator.",
  configError: "Could not load the sign-in options.",
  or: "or",
  loginRequired: "Sign in to continue.",
  noAccountYet: "No account yet?",
  signupLink: "Create an account",
  backToSignIn: "Back to sign in",
  backToSite: "Back to the project site",
  verificationSent:
    "If an account matches this address, a verification link will arrive by email.",
  organizationNameHint:
    "The organization's address is derived from its name. You can rename it later in Settings.",
  onboardingNext:
    "Next, you will see how to capture sessions from your team's coding tools.",
  redirecting: "Opening your workspace…",
  newOrganizationDescription:
    "A separate organization keeps its own members, API keys and session history.",
  signedInAs: "Signed in as",
} as const;
