import { OrganizationPicker } from "./organization-picker";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity,
  BookOpen,
  Download,
  CreditCard,
  House,
  ArrowUpRight,
  ClipboardList,
  Database,
  KeyRound,
  LogOut,
  Menu,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useBillingConfig } from "../../lib/billing-config";
import { useState } from "react";
import type { ReactNode } from "react";
import { copy } from "../../copy";
import type { Me, Organization } from "../../lib/types";
import { Brand, ThemeToggle } from "../shell";
import { Button } from "../ui/button";

const primaryNavigation = [
  { href: "/home", label: copy.workspace.navigation.home, icon: House },
  {
    href: "/sessions",
    label: copy.workspace.navigation.sessions,
    icon: Search,
  },
  {
    href: "/installation",
    label: copy.workspace.navigation.installation,
    icon: Download,
  },
  { href: "/sql", label: copy.workspace.navigation.sql, icon: Database },
  { href: "/keys", label: copy.workspace.navigation.keys, icon: KeyRound },
  { href: "/api/docs", label: copy.workspace.navigation.docs, icon: BookOpen },
];
const adminNavigation = [
  { href: "/admin/users", label: copy.workspace.navigation.users, icon: Users },
  {
    href: "/admin/keys",
    label: copy.workspace.navigation.adminKeys,
    icon: KeyRound,
  },
  {
    href: "/admin/audit",
    label: copy.workspace.navigation.audit,
    icon: ClipboardList,
  },
  {
    href: "/admin/moderation",
    label: copy.workspace.navigation.moderation,
    icon: ShieldCheck,
  },
  {
    href: "/admin/redaction",
    label: copy.workspace.navigation.redaction,
    icon: Settings2,
  },
  {
    href: "/admin/status",
    label: copy.workspace.navigation.status,
    icon: Activity,
  },
];
function Navigation({ pathname, admin }: { pathname: string; admin: boolean }) {
  const billing = useBillingConfig();
  const render = (items: { href: string; label: string; icon: LucideIcon }[]) =>
    items.map(({ href, label, icon: Icon }) => (
      <a
        key={href}
        href={href}
        aria-current={
          pathname === href ||
          (href === "/sessions" && pathname.startsWith("/s/"))
            ? "page"
            : undefined
        }
      >
        <Icon size={17} aria-hidden />
        {label}
      </a>
    ));
  return (
    <>
      <Brand />
      <nav aria-label={copy.workspace.navigation.label}>
        {render(primaryNavigation)}
        {billing.enabled &&
          render([
            { href: "/usage", label: copy.billing.title, icon: CreditCard },
          ])}
        {admin && (
          <>
            <span className="workspace-nav-label">
              {copy.workspace.navigation.administration}
            </span>
            {render(adminNavigation)}
          </>
        )}
      </nav>
      <div className="workspace-sidebar-bottom">
        <a href="/">
          {copy.workspace.navigation.project}
          <ArrowUpRight size={12} aria-hidden />
        </a>
      </div>
    </>
  );
}
export function WorkspaceFrame({
  admin,
  me,
  organizations,
  pathname,
  switching,
  onSwitch,
  onSignOut,
  children,
}: {
  admin: boolean;
  me: Me;
  organizations: Organization[];
  pathname: string;
  switching: boolean;
  onSwitch: (id: string) => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const billing = useBillingConfig();
  return (
    <div className="workspace">
      <a href="#main" className="skip-link">
        {copy.skip}
      </a>
      <aside className="workspace-sidebar">
        <Navigation pathname={pathname} admin={admin} />
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <div className="workspace-org-picker">
            <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
              <Dialog.Trigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="workspace-mobile-menu"
                  aria-label={copy.workspace.navigation.menu}
                >
                  <Menu size={19} aria-hidden />
                </Button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="dialog-overlay" />
                <Dialog.Content className="workspace-sidebar mobile-open">
                  <Dialog.Title className="sr-only">
                    {copy.workspace.navigation.label}
                  </Dialog.Title>
                  <Dialog.Description className="sr-only">
                    {copy.workspace.navigation.organization}
                  </Dialog.Description>
                  <Dialog.Close asChild>
                    <Button
                      className="mobile-nav-close"
                      variant="ghost"
                      size="icon"
                      aria-label={copy.workspace.navigation.closeMenu}
                    >
                      <X size={19} aria-hidden />
                    </Button>
                  </Dialog.Close>
                  <Navigation pathname={pathname} admin={admin} />
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <OrganizationPicker
              organizations={organizations}
              value={me.organization?.id ?? ""}
              disabled={switching}
              canCreate={billing.enabled}
              onChange={onSwitch}
            />
          </div>
          <div className="workspace-topbar-actions">
            <span className="account-label">{me.user.email}</span>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="small"
              onClick={onSignOut}
              aria-label={copy.workspace.navigation.signOut}
            >
              <LogOut size={16} aria-hidden />
              <span className="sign-out-label">
                {copy.workspace.navigation.signOut}
              </span>
            </Button>
          </div>
        </header>
        <main id="main" className="workspace-content">
          {children}
        </main>
      </div>
    </div>
  );
}
