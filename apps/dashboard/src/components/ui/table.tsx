import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/**
 * Scrolls inside its container; the page never scrolls sideways. The container is a
 * focusable region so keyboard users can scroll it (axe: scrollable-region-focusable).
 */
export function Table({
  className,
  containerClassName,
  containerLabel,
  ...props
}: ComponentProps<"table"> & {
  containerClassName?: string | undefined;
  containerLabel?: string | undefined;
}) {
  return (
    <div
      className={cn("w-full overflow-x-auto", containerClassName)}
      tabIndex={0}
      role="region"
      aria-label={containerLabel ?? props["aria-label"]}
    >
      <table
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}
export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      className={cn("[&_tr]:border-b [&_tr]:border-line", className)}
      {...props}
    />
  );
}
export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return (
    <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  );
}
export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-line-soft transition-colors data-[clickable]:cursor-pointer data-[clickable]:hover:bg-raised/60",
        className,
      )}
      {...props}
    />
  );
}
export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-10 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted first:pl-4 last:pr-4",
        className,
      )}
      {...props}
    />
  );
}
export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 align-middle text-sm first:pl-4 last:pr-4",
        className,
      )}
      {...props}
    />
  );
}
