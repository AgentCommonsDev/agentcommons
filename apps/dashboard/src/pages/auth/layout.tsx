import { Outlet } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";
import { Brand } from "../../components/app/shell";
import { ThemeToggle } from "../../components/app/theme-toggle";
import { Card } from "../../components/ui/card";
import { Alert } from "../../components/ui/feedback";
import { copy } from "../../copy";
import { paths } from "../../lib/routes";
import { cn } from "../../lib/utils";

/** Focused chrome for sign-in, signup and onboarding: brand, theme toggle and one card. */
export function AccountLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-fg"
      >
        {copy.site.skip}
      </a>
      <header className="flex h-14 shrink-0 items-center justify-between px-4 sm:px-6">
        <Brand href={paths.site} />
        <ThemeToggle />
      </header>
      <main
        id="main"
        className="flex flex-1 flex-col items-center justify-center px-4 py-6 sm:px-6 sm:py-10"
      >
        <Card
          data-testid="auth-card"
          className="w-full max-w-md gap-6 p-5 shadow-sm sm:p-8"
        >
          <Outlet />
        </Card>
      </main>
      <footer className="flex shrink-0 justify-center px-4 py-5">
        <a
          href={paths.site}
          className="text-sm text-muted transition-colors hover:text-fg"
        >
          {copy.auth.backToSite}
        </a>
      </footer>
    </div>
  );
}

/** Page title inside the account card, with an optional icon above it. */
export function AccountHeading({
  icon,
  title,
  description,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {icon && (
        <div className="flex size-10 items-center justify-center rounded-lg bg-accent-bg text-accent [&_svg]:size-5">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl leading-tight font-semibold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm leading-relaxed text-muted">{description}</p>
        )}
      </div>
    </div>
  );
}
export function AccountForm({ className, ...props }: ComponentProps<"form">) {
  return <form className={cn("flex flex-col gap-4", className)} {...props} />;
}
export function AccountLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={cn(
        "font-medium text-accent underline-offset-4 hover:underline",
        className,
      )}
    >
      {children}
    </a>
  );
}
/** Secondary navigation at the bottom of the card. Stacks on narrow screens. */
export function AccountLinks({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line-soft pt-5 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
      {children}
    </div>
  );
}
/** A sentence followed by a link, kept on one line where the width allows. */
export function AccountPrompt({
  text,
  href,
  link,
}: {
  text: string;
  href: string;
  link: string;
}) {
  return (
    <p className="flex flex-wrap gap-x-1.5 text-muted">
      <span>{text}</span>
      <AccountLink href={href}>{link}</AccountLink>
    </p>
  );
}
/** "By continuing you agree to the Terms of Service and Privacy Policy." next to a primary action. */
export function AccountAgreement() {
  return (
    <p className="text-xs leading-relaxed text-subtle">
      {copy.legal.agreement.before}{" "}
      <AccountLink href={paths.tos}>{copy.legal.terms.title}</AccountLink>{" "}
      {copy.legal.agreement.between}{" "}
      <AccountLink href={paths.privacy}>{copy.legal.privacy.title}</AccountLink>
      {copy.legal.agreement.after}
    </p>
  );
}
export function AccountDivider() {
  return (
    <div
      role="separator"
      className="flex items-center gap-3 text-xs tracking-wide text-subtle uppercase"
    >
      <span aria-hidden className="h-px flex-1 bg-line-soft" />
      {copy.auth.or}
      <span aria-hidden className="h-px flex-1 bg-line-soft" />
    </div>
  );
}
/** Customer-mode fallback for hosted-only pages: no form, one note, a way back. */
export function AccountUnavailable({ title }: { title: string }) {
  return (
    <>
      <AccountHeading title={title} />
      <Alert variant="info">{copy.site.saas.unavailable}</Alert>
      <AccountLinks>
        <AccountLink href={paths.login}>{copy.auth.backToSignIn}</AccountLink>
      </AccountLinks>
    </>
  );
}
