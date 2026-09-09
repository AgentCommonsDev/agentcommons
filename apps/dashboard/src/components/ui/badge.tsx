import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        neutral: "border-line bg-raised text-muted",
        accent: "border-transparent bg-accent-bg text-accent",
        success: "border-transparent bg-success-bg text-success",
        warning: "border-transparent bg-warning-bg text-warning",
        danger: "border-transparent bg-danger-bg text-danger",
        outline: "border-line bg-transparent text-fg",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);
export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
