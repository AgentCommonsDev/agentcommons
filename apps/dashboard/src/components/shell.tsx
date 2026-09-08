import { ArrowUpRight, Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePublicAccount } from "../lib/public-account";
import { useBillingConfig } from "../lib/billing-config";
import { copy, links } from "../copy";
import { Button } from "./ui/button";

export function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <a
      className={footer ? "brand brand-footer" : "brand"}
      href="/"
      aria-label={copy.navigation.home}
    >
      <img
        src="/logo.png"
        alt=""
        className="brand-mark"
        width={32}
        height={32}
      />
      <span>{copy.brand}</span>
    </a>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("agentcommons-theme");
      if (stored === "light" || stored === "dark") {
        setTheme(stored);
        document.documentElement.dataset.theme = stored;
      }
    } catch {
      /* Browser storage can be disabled. */
    }
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("agentcommons-theme", next);
    } catch {
      /* Theme still works for this page. */
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={theme === "dark" ? copy.theme.light : copy.theme.dark}
    >
      {theme === "dark" ? (
        <Sun size={17} aria-hidden />
      ) : (
        <Moon size={17} aria-hidden />
      )}
    </Button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const billing = useBillingConfig();
  const account = usePublicAccount();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <a href="#main" className="skip-link">
        {copy.skip}
      </a>
      <header className="site-header">
        <div className="container header-inner">
          <Brand />
          <nav
            className={menuOpen ? "main-nav menu-open" : "main-nav"}
            aria-label={copy.navigation.label}
          >
            <a
              href="/#how-it-works"
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              {copy.navigation.product}
            </a>
            <a
              href="/#your-data"
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              {copy.navigation.principles}
            </a>
            {billing.enabled && (
              <a
                href="/#pricing"
                onClick={() => {
                  setMenuOpen(false);
                }}
              >
                {copy.saas.pricing}
              </a>
            )}
            {billing.enabled && <a href="/login">{copy.navigation.login}</a>}
            {billing.mode !== "customer" && (
              <a href="/blog">{copy.blog.navigation}</a>
            )}
            <a href={links.documentation}>
              {copy.navigation.docs}
              <ArrowUpRight size={13} aria-hidden />
            </a>
          </nav>
          <div className="header-actions">
            <ThemeToggle />
            <Button variant="secondary" size="small" asChild>
              <a href={account.href}>
                {account.shortLabel}
                <ArrowUpRight size={14} aria-hidden />
              </a>
            </Button>
            <Button
              className="menu-toggle"
              variant="ghost"
              size="icon"
              aria-label={
                menuOpen ? copy.navigation.close : copy.navigation.menu
              }
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen(!menuOpen);
              }}
            >
              {menuOpen ? (
                <X size={19} aria-hidden />
              ) : (
                <Menu size={19} aria-hidden />
              )}
            </Button>
          </div>
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <div className="container">
          <div className="footer-top">
            <div>
              <Brand footer />
              <p>{copy.footer.description}</p>
            </div>
            <nav aria-label={copy.navigation.docs}>
              <a href={links.repository}>{copy.footer.links.source}</a>
              <a href={links.specification}>
                {copy.footer.links.specification}
              </a>
              <a href={links.security}>{copy.footer.links.security}</a>
              <a href={links.license}>{copy.footer.links.license}</a>
            </nav>
          </div>
          <div className="footer-bottom">
            <span>
              {copy.footer.source}
              {copy.workspace.common.separator}
              {copy.saas.madeIn}
            </span>
            <span>
              <span className="status-dot" />
              {billing.enabled ? copy.saas.footerStatus : copy.footer.status}
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}
