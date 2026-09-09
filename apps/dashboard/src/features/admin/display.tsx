import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { copy } from "../../copy";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { CopyButton } from "../../components/app/states";

/** Responsive grid of stat tiles: two per row on phones, four on wide screens. */
export function StatGrid({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string | undefined;
  "data-testid"?: string;
}) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}
      {...props}
    >
      {children}
    </div>
  );
}
export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <Card className={cn("min-w-0 gap-1 px-4 py-3.5", className)}>
      <p className="truncate text-xs font-medium text-muted">{label}</p>
      <p className="truncate text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {hint && <p className="text-xs leading-relaxed text-subtle">{hint}</p>}
    </Card>
  );
}
export function ProgressBar({
  value,
  max,
  label,
  tone = "primary",
  className,
}: {
  value: number;
  max: number;
  label: string;
  tone?: "primary" | "danger" | "warning" | undefined;
  className?: string | undefined;
}) {
  const bounded = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-raised",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          tone === "primary" && "bg-primary",
          tone === "danger" && "bg-danger",
          tone === "warning" && "bg-warning",
        )}
        style={{ width: `${String(Math.round(bounded * 1000) / 10)}%` }}
      />
    </div>
  );
}
/** Monospace block for JSON and redacted text; scrolls inside itself. */
export function CodeBlock({
  text,
  copyLabel,
  className,
  maxHeight = "max-h-80",
}: {
  text: string;
  copyLabel?: string | undefined;
  className?: string | undefined;
  maxHeight?: string | undefined;
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <pre
        className={cn(
          "overflow-auto rounded-md border border-line bg-raised px-3 py-2.5 pr-11 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-fg",
          maxHeight,
        )}
      >
        {text}
      </pre>
      <CopyButton
        value={text}
        label={copyLabel ?? copy.app.common.copy}
        className="absolute top-1.5 right-1.5"
      />
    </div>
  );
}
export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
/** Inline show/hide toggle for secondary content such as a data table under a chart. */
export function Disclosure({
  showLabel,
  hideLabel,
  defaultOpen = false,
  children,
  className,
}: {
  showLabel: string;
  hideLabel: string;
  defaultOpen?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        className="self-start px-2 text-muted"
        onClick={() => {
          setOpen((prior) => !prior);
        }}
      >
        <Icon aria-hidden />
        {open ? hideLabel : showLabel}
      </Button>
      {open && children}
    </div>
  );
}
