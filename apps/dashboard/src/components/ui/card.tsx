import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-line bg-surface text-fg",
        className,
      )}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3",
        className,
      )}
      {...props}
    />
  );
}
export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cn("text-[15px] leading-tight font-semibold", className)}
      {...props}
    />
  );
}
export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn("mt-1 text-[13px] leading-relaxed text-muted", className)}
      {...props}
    />
  );
}
export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}
export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-t border-line-soft px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}
