import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** `line` underlines the active tab; `segmented` is a pill group for switching views. */
type TabsVariant = "line" | "segmented";
export const Tabs = TabsPrimitive.Root;
export function TabsList({
  className,
  variant = "line",
  ...props
}: ComponentProps<typeof TabsPrimitive.List> & { variant?: TabsVariant }) {
  return (
    <TabsPrimitive.List
      className={cn(
        variant === "line"
          ? "flex w-full shrink-0 items-end gap-1 overflow-x-auto border-b border-line"
          : "inline-flex items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5",
        className,
      )}
      {...props}
    />
  );
}
export function TabsTrigger({
  className,
  variant = "line",
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger> & { variant?: TabsVariant }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        variant === "line"
          ? "-mb-px inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium text-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent data-[state=active]:border-accent data-[state=active]:text-fg [&_svg]:size-4"
          : "h-8 cursor-pointer rounded-md px-3 text-sm font-medium text-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("pt-5 focus-visible:outline-none", className)}
      {...props}
    />
  );
}
