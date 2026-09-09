import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Activity,
  BookOpen,
  Check,
  ChevronsUpDown,
  ClipboardList,
  CreditCard,
  Database,
  ExternalLink,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  ScrollText,
  Search,
  Settings2,
  ShieldCheck,
  Sliders,
  Sun,
  TerminalSquare,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { copy, links } from "../../copy";
import type { Me, Organization } from "../../lib/types";
import { paths } from "../../lib/routes";
import { useTheme } from "../../lib/theme";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/menu";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  match?: (pathname: string) => boolean;
  external?: boolean;
}
const workspaceNavigation: NavItem[] = [
  {
    to: paths.home,
    label: copy.app.navigation.home,
    icon: LayoutDashboard,
    match: (pathname) =>
      pathname === paths.home || pathname.startsWith("/app/dashboards"),
  },
  {
    to: paths.sessions,
    label: copy.app.navigation.sessions,
    icon: Search,
    match: (pathname) => pathname.startsWith(paths.sessions),
  },
  { to: paths.sql, label: copy.app.navigation.sql, icon: Database },
  {
    to: paths.install,
    label: copy.app.navigation.install,
    icon: TerminalSquare,
  },
  { to: paths.keys, label: copy.app.navigation.keys, icon: KeyRound },
];
const organizationNavigation: NavItem[] = [
  { to: paths.admin.users, label: copy.app.navigation.users, icon: Users },
  {
    to: paths.admin.keys,
    label: copy.app.navigation.adminKeys,
    icon: KeyRound,
  },
  {
    to: paths.admin.audit,
    label: copy.app.navigation.audit,
    icon: ClipboardList,
  },
  {
    to: paths.admin.moderation,
    label: copy.app.navigation.moderation,
    icon: ShieldCheck,
  },
  {
    to: paths.admin.redaction,
    label: copy.app.navigation.redaction,
    icon: Sliders,
  },
  { to: paths.admin.status, label: copy.app.navigation.status, icon: Activity },
  {
    to: paths.admin.settings,
    label: copy.app.navigation.settings,
    icon: Settings2,
  },
];

export function Brand({
  className,
  href = paths.home,
}: {
  className?: string | undefined;
  href?: string | undefined;
}) {
  return (
    <a
      href={href}
      className={cn(
        "flex items-center gap-2.5 font-semibold tracking-tight",
        className,
      )}
    >
      <img
        src="/logo.png"
        alt=""
        width={26}
        height={26}
        className="size-[26px] [filter:var(--logo-filter)]"
      />
      <span>{copy.brand}</span>
    </a>
  );
}
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={
        theme === "dark"
          ? copy.app.common.theme.light
          : copy.app.common.theme.dark
      }
    >
      {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: (() => void) | undefined;
}) {
  const active = item.match ? item.match(pathname) : pathname === item.to;
  const Icon = item.icon;
  return (
    <a
      href={item.to}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        active && "bg-raised font-medium text-fg",
      )}
    >
      <Icon
        size={17}
        aria-hidden
        className={cn(active ? "text-accent" : "text-subtle")}
      />
      <span className="truncate">{item.label}</span>
      {item.external && (
        <ExternalLink size={13} aria-hidden className="ml-auto text-subtle" />
      )}
    </a>
  );
}
function Navigation({
  pathname,
  admin,
  billing,
  onNavigate,
}: {
  pathname: string;
  admin: boolean;
  billing: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const workspace = billing
    ? [
        ...workspaceNavigation,
        {
          to: paths.billing,
          label: copy.app.navigation.billing,
          icon: CreditCard,
        },
      ]
    : workspaceNavigation;
  return (
    <nav
      aria-label={copy.app.navigation.label}
      className="flex flex-1 flex-col gap-5"
    >
      <div className="flex flex-col gap-0.5">
        <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-subtle uppercase">
          {copy.app.navigation.workspace}
        </p>
        {workspace.map((item) => (
          <NavLink
            key={item.to}
            item={item}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ))}
      </div>
      {admin && (
        <div className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-subtle uppercase">
            {copy.app.navigation.organization}
          </p>
          {organizationNavigation.map((item) => (
            <NavLink
              key={item.to}
              item={item}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-line-soft pt-3">
        <NavLink
          item={{
            to: paths.api,
            label: copy.app.navigation.api,
            icon: BookOpen,
          }}
          pathname={pathname}
          onNavigate={onNavigate}
        />
        <NavLink
          item={{
            to: links.documentation,
            label: copy.app.navigation.site,
            icon: ExternalLink,
            external: true,
          }}
          pathname={pathname}
        />
      </div>
    </nav>
  );
}
function OrganizationSwitcher({
  organizations,
  current,
  disabled,
  canCreate,
  onSwitch,
}: {
  organizations: Organization[];
  current: Organization | null;
  disabled: boolean;
  canCreate: boolean;
  onSwitch: (id: string) => void;
}) {
  // With nothing to switch to and nothing to create, the name is a label, not a menu.
  if (organizations.length <= 1 && !canCreate)
    return (
      <span
        data-testid="organization-name"
        className="flex h-9 max-w-[220px] items-center truncate px-2.5 text-sm font-medium"
      >
        {current?.name ?? copy.app.navigation.chooseOrganization}
      </span>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 max-w-[220px] justify-between gap-2 px-2.5 font-medium"
          disabled={disabled}
          aria-label={copy.app.navigation.switchOrganization}
        >
          <span className="truncate">
            {current?.name ?? copy.app.navigation.chooseOrganization}
          </span>
          <ChevronsUpDown size={14} aria-hidden className="text-subtle" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        <DropdownMenuLabel>
          {copy.app.navigation.switchOrganization}
        </DropdownMenuLabel>
        {organizations.map((organization) => (
          <DropdownMenuItem
            key={organization.id}
            data-organization-id={organization.id}
            onSelect={() => {
              if (organization.id !== current?.id) onSwitch(organization.id);
            }}
          >
            <span className="flex-1 truncate">{organization.name}</span>
            {organization.id === current?.id && (
              <Check aria-hidden className="text-accent" />
            )}
          </DropdownMenuItem>
        ))}
        {canCreate && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={paths.organizationsNew}>
                <Plus aria-hidden />
                {copy.app.navigation.newOrganization}
              </a>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function AppShell({
  me,
  organizations,
  admin,
  billing,
  pathname,
  switching,
  onSwitch,
  onSignOut,
  children,
}: {
  me: Me;
  organizations: Organization[];
  admin: boolean;
  billing: boolean;
  pathname: string;
  switching: boolean;
  onSwitch: (id: string) => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const initial = (me.user.name || me.user.email).slice(0, 1).toUpperCase();
  return (
    <div className="flex min-h-dvh bg-bg text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-fg"
      >
        {copy.skip}
      </a>
      {/* The aside stretches with the page so its background never ends early on long
          screens or full-page captures; the nav inside stays pinned while scrolling. */}
      <aside className="hidden w-60 shrink-0 self-stretch border-r border-line bg-surface lg:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-6 px-3 py-4">
          <Brand className="px-2.5" />
          <Navigation pathname={pathname} admin={admin} billing={billing} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-bg/90 px-3 backdrop-blur sm:px-5">
          <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogPrimitive.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label={copy.app.navigation.menu}
              >
                <Menu aria-hidden />
              </Button>
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
              <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[88vw] flex-col gap-6 overflow-y-auto border-r border-line bg-surface px-3 py-4 focus:outline-none">
                <DialogPrimitive.Title className="sr-only">
                  {copy.app.navigation.label}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">
                  {copy.app.navigation.workspace}
                </DialogPrimitive.Description>
                <div className="flex items-center justify-between px-2.5">
                  <Brand />
                  <DialogPrimitive.Close asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={copy.app.navigation.closeMenu}
                    >
                      <X aria-hidden />
                    </Button>
                  </DialogPrimitive.Close>
                </div>
                <Navigation
                  pathname={pathname}
                  admin={admin}
                  billing={billing}
                  onNavigate={() => {
                    setMenuOpen(false);
                  }}
                />
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
          <OrganizationSwitcher
            organizations={organizations}
            current={me.organization}
            disabled={switching}
            canCreate={billing}
            onSwitch={onSwitch}
          />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={copy.app.navigation.account}
                  className="rounded-full"
                >
                  <span className="flex size-7 items-center justify-center rounded-full bg-accent-bg text-xs font-semibold text-accent">
                    {initial}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <div className="px-2.5 py-2">
                  <p className="truncate text-sm font-medium">
                    {me.user.name || me.user.email}
                  </p>
                  {/* Accounts without a name show the address once, not twice. */}
                  {me.user.name && me.user.name !== me.user.email && (
                    <p className="truncate text-xs text-muted">
                      {me.user.email}
                    </p>
                  )}
                </div>
                {billing && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <a href={paths.privacy} target="_blank" rel="noreferrer">
                        <ShieldCheck aria-hidden />
                        {copy.legal.privacy.title}
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={paths.tos} target="_blank" rel="noreferrer">
                        <ScrollText aria-hidden />
                        {copy.legal.terms.title}
                      </a>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onSignOut}>
                  <LogOut aria-hidden />
                  {copy.app.navigation.signOut}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main
          id="main"
          className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
