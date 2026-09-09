import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const Tabs = TabsPrimitive.Root;
export function TabsList({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex w-full shrink-0 items-end gap-1 overflow-x-auto border-b border-line",
        className,
      )}
      {...props}
    />
  );
}
export function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium text-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent data-[state=active]:border-accent data-[state=active]:text-fg [&_svg]:size-4",
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
