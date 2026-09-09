import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

const controlClass =
  "w-full min-w-0 rounded-md border border-line bg-surface text-sm text-fg placeholder:text-subtle transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input className={cn(controlClass, "h-9 px-3", className)} {...props} />
  );
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        controlClass,
        "min-h-20 px-3 py-2 leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}
/** Styled native select: keyboard, mobile and screen-reader behavior come from the browser. */
export function NativeSelect({
  className,
  children,
  ...props
}: ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex w-full", className)}>
      <select
        className={cn(controlClass, "h-9 appearance-none pr-8 pl-3")}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={15}
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted"
      />
    </span>
  );
}
