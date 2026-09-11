import { Link, type LinkOptions } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { copy } from "../../copy";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/menu";

export interface RowMenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  /** Rendered as a router link so the row opens without a full reload. */
  link?: LinkOptions;
  destructive?: boolean;
  disabled?: boolean;
}
/**
 * Overflow menu for a table row, or with `showLabel` a labelled button for a page header.
 * Destructive items sit below a separator.
 */
export function RowMenu({
  label,
  items,
  showLabel = false,
}: {
  label: string;
  items: RowMenuItem[];
  showLabel?: boolean;
}) {
  const safe = items.filter((item) => !item.destructive);
  const destructive = items.filter((item) => item.destructive);
  const render = (item: RowMenuItem) => {
    const Icon = item.icon;
    const content = (
      <>
        {Icon && <Icon aria-hidden />}
        {item.label}
      </>
    );
    const shared = {
      disabled: item.disabled ?? false,
      ...(item.onSelect ? { onSelect: item.onSelect } : {}),
    };
    return item.link ? (
      <DropdownMenuItem key={item.label} asChild {...shared}>
        <Link {...item.link}>{content}</Link>
      </DropdownMenuItem>
    ) : (
      <DropdownMenuItem
        key={item.label}
        destructive={item.destructive ?? false}
        {...shared}
      >
        {content}
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {showLabel ? (
          <Button variant="secondary" size="sm">
            <MoreHorizontal aria-hidden />
            {label}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="text-muted"
          >
            <MoreHorizontal aria-hidden />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {safe.map(render)}
        {safe.length > 0 && destructive.length > 0 && <DropdownMenuSeparator />}
        {destructive.map(render)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
/** Screen-reader-only header for an actions column; the cells carry the buttons. */
export function actionsHeader() {
  return <span className="sr-only">{copy.app.common.actions}</span>;
}
