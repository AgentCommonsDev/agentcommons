import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

const panelClass =
  "z-50 min-w-40 overflow-hidden rounded-lg border border-line bg-surface p-1 text-fg shadow-xl";
const itemClass =
  "relative flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-raised [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(panelClass, "max-h-[70vh] overflow-y-auto", className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}
export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  destructive?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        itemClass,
        destructive && "text-danger [&_svg]:text-danger",
        className,
      )}
      {...props}
    />
  );
}
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(itemClass, "pl-8", className)}
      {...props}
    >
      <span className="absolute left-2.5 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check size={14} aria-hidden />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}
export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        "px-2.5 py-1.5 text-[11px] font-medium tracking-wide text-subtle uppercase",
        className,
      )}
      {...props}
    />
  );
}
export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("my-1 h-px bg-line-soft", className)}
      {...props}
    />
  );
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(panelClass, "w-72 p-3", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 max-w-xs rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs leading-relaxed text-fg shadow-lg",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
