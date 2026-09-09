import {
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-raised", className)}
      {...props}
    />
  );
}
export function Spinner({
  className,
  size = 16,
}: {
  className?: string | undefined;
  size?: number | undefined;
}) {
  return (
    <LoaderCircle
      size={size}
      aria-hidden
      className={cn("animate-spin text-muted", className)}
    />
  );
}
const alertStyles = {
  info: { className: "border-line bg-raised text-fg", Icon: Info },
  success: {
    className: "border-transparent bg-success-bg text-success",
    Icon: CircleCheck,
  },
  warning: {
    className: "border-transparent bg-warning-bg text-warning",
    Icon: TriangleAlert,
  },
  danger: {
    className: "border-transparent bg-danger-bg text-danger",
    Icon: CircleAlert,
  },
} as const;
export function Alert({
  variant = "info",
  title,
  children,
  action,
  className,
  role,
}: {
  variant?: keyof typeof alertStyles | undefined;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string | undefined;
  role?: "alert" | "status" | undefined;
}) {
  const { className: tone, Icon } = alertStyles[variant];
  return (
    <div
      role={role ?? (variant === "danger" ? "alert" : "status")}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        tone,
        className,
      )}
    >
      <Icon size={17} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <p className="font-medium">{title}</p>}
        {children && (
          <div className={cn(title && "mt-0.5 opacity-90")}>{children}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-raised px-1 font-mono text-[11px] text-muted",
        className,
      )}
      {...props}
    />
  );
}
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string | undefined;
  compact?: boolean | undefined;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-6 text-center",
        compact ? "py-8" : "py-14",
        className,
      )}
    >
      {icon && <div className="mb-1 text-subtle [&_svg]:size-7">{icon}</div>}
      <p className="text-[15px] font-semibold">{title}</p>
      {description && (
        <p className="max-w-md text-sm leading-relaxed text-muted">
          {description}
        </p>
      )}
      {action && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div>
      )}
    </div>
  );
}
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-xs font-medium text-muted">{eyebrow}</div>
        )}
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight sm:text-2xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
