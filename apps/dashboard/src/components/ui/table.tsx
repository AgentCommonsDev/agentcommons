import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/**
 * How a table relates to its container. `fit` (the default) uses a fixed layout so the
 * columns share the container width and nothing ever scrolls sideways; long values wrap
 * or truncate inside their cell. `scroll-y` keeps that layout inside a bounded box that
 * scrolls vertically (a dashboard tile). `scroll-x` is for a grid of arbitrary result
 * columns that may legitimately be wider than the page and scrolls sideways instead.
 * Scrolling containers are focusable regions so keyboard users can scroll them
 * (axe: scrollable-region-focusable).
 */
type TableLayout = "fit" | "scroll-x" | "scroll-y";
export function Table({
  className,
  containerClassName,
  containerLabel,
  layout = "fit",
  ...props
}: ComponentProps<"table"> & {
  containerClassName?: string | undefined;
  containerLabel?: string | undefined;
  layout?: TableLayout | undefined;
}) {
  const scrolls = layout !== "fit";
  return (
    <div
      className={cn(
        "w-full",
        layout === "scroll-x" && "overflow-x-auto",
        containerClassName,
      )}
      data-table-layout={layout}
      {...(scrolls
        ? {
            tabIndex: 0,
            role: "region",
            "aria-label": containerLabel ?? props["aria-label"],
          }
        : {})}
    >
      <table
        className={cn(
          "w-full caption-bottom text-sm",
          layout !== "scroll-x" && "table-fixed",
          className,
        )}
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
/**
 * Headers wrap between words. `wrap-anywhere` is the last resort for a column narrower
 * than its longest word, so a header can never spill past its cell and widen the table.
 */
export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-10 px-3 text-left align-middle text-xs font-medium wrap-anywhere text-muted first:pl-4 last:pr-4",
        className,
      )}
      {...props}
    />
  );
}
/** Cells wrap anywhere so an unbroken identifier never widens its column. */
export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 align-middle text-sm wrap-anywhere first:pl-4 last:pr-4",
        className,
      )}
      {...props}
    />
  );
}
