import { Check, Copy, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { copy } from "../../copy";
import { errorMessage, statusLabel } from "../../lib/display";
import { cn } from "../../lib/utils";
import { Badge, type badgeVariants } from "../ui/badge";
import { Button } from "../ui/button";
import { Alert, Skeleton, Spinner } from "../ui/feedback";
import type { VariantProps } from "class-variance-authority";

export function LoadingState({
  rows = 3,
  className,
}: {
  rows?: number | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col gap-3", className)}
    >
      <span className="flex items-center gap-2 text-sm text-muted">
        <Spinner />
        {copy.app.common.loading}
      </span>
      <div aria-hidden className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton
            key={index}
            className="h-9"
            style={{ width: `${String(100 - index * 12)}%` }}
          />
        ))}
      </div>
    </div>
  );
}
export function RequestError({
  error,
  retry,
  title,
  className,
}: {
  error: unknown;
  retry?: (() => void) | undefined;
  title?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <Alert
      variant="danger"
      title={title ?? copy.app.common.requestFailed}
      className={className}
      action={
        retry && (
          <Button variant="secondary" size="sm" onClick={retry}>
            <RefreshCw aria-hidden />
            {copy.app.common.retry}
          </Button>
        )
      }
    >
      {errorMessage(error)}
    </Alert>
  );
}
/** The one query lifecycle: skeleton while pending, error with retry, then the data. */
export function QueryState<T>({
  query,
  rows,
  title,
  children,
}: {
  query: Pick<UseQueryResult<T>, "isPending" | "error" | "data" | "refetch">;
  rows?: number | undefined;
  title?: string | undefined;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <LoadingState rows={rows} />;
  if (query.error)
    return (
      <RequestError
        error={query.error}
        title={title}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  return <>{children(query.data as T)}</>;
}
export function CopyButton({
  value,
  label,
  showLabel = false,
  size = "icon-sm",
  variant = "ghost",
  className,
}: {
  value: string;
  label?: string | undefined;
  showLabel?: boolean | undefined;
  size?: "icon-sm" | "sm" | undefined;
  variant?: "ghost" | "secondary" | undefined;
  className?: string | undefined;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const text = label ?? copy.app.common.copy;
  const perform = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => {
        setState("idle");
      }, 1600);
    } catch {
      setState("error");
    }
  };
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Button
        variant={variant}
        size={showLabel ? "sm" : size}
        aria-label={state === "copied" ? copy.app.common.copied : text}
        onClick={() => {
          void perform();
        }}
      >
        {state === "copied" ? (
          <Check aria-hidden className="text-success" />
        ) : (
          <Copy aria-hidden />
        )}
        {showLabel && (state === "copied" ? copy.app.common.copied : text)}
      </Button>
      <span
        role="status"
        className={state === "error" ? "text-xs text-danger" : "sr-only"}
      >
        {state === "copied"
          ? copy.app.common.copied
          : state === "error"
            ? copy.app.common.copyFailed
            : ""}
      </span>
    </span>
  );
}
const statusTone: Record<
  string,
  VariantProps<typeof badgeVariants>["variant"]
> = {
  ACTIVE: "success",
  running: "accent",
  queued: "neutral",
  completed: "success",
  failed: "danger",
  ERROR: "danger",
  INCOMPLETE: "warning",
  ENDED: "neutral",
  INACTIVE: "neutral",
  IDLE: "neutral",
  PUBLIC: "neutral",
  PRIVATE: "warning",
  PURGED: "danger",
  owner: "accent",
  admin: "accent",
  member: "neutral",
  USER: "accent",
  ASSISTANT: "neutral",
  TOOL_USE: "outline",
  TOOL_RESULT: "outline",
  THINKING: "outline",
  SYSTEM: "outline",
  SUBAGENT: "accent",
  FORK: "accent",
  SPAWNED: "accent",
  REGEX: "neutral",
  SECRETLINT_RULE: "neutral",
};
export function StatusBadge({
  value,
  className,
}: {
  value: string;
  className?: string | undefined;
}) {
  return (
    <Badge variant={statusTone[value] ?? "neutral"} className={className}>
      {statusLabel(value)}
    </Badge>
  );
}
/** Label/value rows for detail panels; wraps on narrow screens. */
export function DefinitionList({
  items,
  className,
  columns = 2,
}: {
  items: { label: ReactNode; value: ReactNode; wide?: boolean | undefined }[];
  className?: string | undefined;
  columns?: 2 | 3 | 4 | undefined;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-3",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        columns === 4 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className={cn("min-w-0", item.wide && "sm:col-span-full")}
        >
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className="mt-0.5 flex min-w-0 items-center gap-1 text-sm wrap-anywhere">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
