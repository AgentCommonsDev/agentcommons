import { ArrowUpRight, Menu, X } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { usePublicAccount } from "../lib/public-account";
import { useBillingConfig } from "../lib/billing-config";
import { copy, links } from "../copy";
import { paths } from "../lib/routes";
import { ThemeToggle } from "./app/theme-toggle";
import { Button } from "./ui/button";

const site = copy.site;
function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <a
      className={footer ? "brand brand-footer" : "brand"}
      href={paths.site}
      aria-label={site.navigation.home}
    >
      <img
        src="/logo.png"
        alt=""
        className="brand-mark"
        width={32}
        height={32}
      />
      <span>{site.brand}</span>
    </a>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const billing = useBillingConfig();
  const account = usePublicAccount();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <a href="#main" className="skip-link">
        {site.skip}
      </a>
      <header className="site-header">
        <div className="container header-inner">
          <Brand />
          <nav
            className={menuOpen ? "main-nav menu-open" : "main-nav"}
            aria-label={site.navigation.label}
          >
            <a
              href="/#how-it-works"
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              {site.navigation.product}
            </a>
            <a
              href="/#your-data"
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              {site.navigation.principles}
            </a>
            {billing.enabled && (
              <a
                href="/#pricing"
                onClick={() => {
                  setMenuOpen(false);
                }}
              >
                {site.saas.pricing}
              </a>
            )}
            {billing.enabled && (
              <a href={paths.login}>{site.navigation.login}</a>
            )}
            {billing.mode !== "customer" && (
              <a href={paths.blog}>{site.blog.navigation}</a>
            )}
            <a href={paths.docs}>
              {site.navigation.docs}
              <ArrowUpRight size={13} aria-hidden />
            </a>
          </nav>
          <div className="header-actions">
            <ThemeToggle />
            <Button variant="secondary" size="sm" asChild>
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
                menuOpen
                  ? copy.app.navigation.closeMenu
                  : copy.app.navigation.menu
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
              <p>{site.footer.description}</p>
            </div>
            <nav aria-label={site.navigation.docs}>
              <a href={links.repository}>{site.footer.links.source}</a>
              <a href={links.specification}>
                {site.footer.links.specification}
              </a>
              <a href={links.security}>{site.footer.links.security}</a>
              <a href={links.license}>{site.footer.links.license}</a>
              {billing.mode !== "customer" && (
                <>
                  <a href={paths.privacy}>{copy.legal.privacy.title}</a>
                  <a href={paths.tos}>{copy.legal.terms.title}</a>
                </>
              )}
            </nav>
          </div>
          <div className="footer-bottom">
            <span>
              {site.footer.source}
              {copy.app.common.separator}
              {site.saas.madeIn}
            </span>
            <span>
              <span className="status-dot" />
              {billing.enabled ? site.saas.footerStatus : site.footer.status}
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}
