import { ChevronDown, ChevronRight, SlidersHorizontal } from "lucide-react";
import {
  Fragment,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { copy } from "../../copy";
import { cn } from "../../lib/utils";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
  SheetContent,
} from "../../components/ui/dialog";
import { Field } from "../../components/ui/field";
import { NativeSelect } from "../../components/ui/input";

const wideQuery = "(min-width: 640px)";
function subscribe(callback: () => void) {
  const media = window.matchMedia(wideQuery);
  media.addEventListener("change", callback);
  return () => {
    media.removeEventListener("change", callback);
  };
}
/** True at Tailwind's `sm` breakpoint and above; true on the server. */
function useWideScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(wideQuery).matches,
    () => true,
  );
}
interface FilterControl {
  id: string;
  label: string;
  /** Width in the inline row, as a Tailwind class such as `sm:w-56`. */
  width?: string;
  /**
   * Show the label above the control in the inline row too. Text and select controls
   * name themselves through a placeholder or first option; a date input cannot, so a
   * bare pair of them never says which end of the range each one is.
   */
  showLabel?: boolean;
  render: (props: FilterControlProps) => ReactNode;
}
/**
 * Filters for a table. Wide screens get an inline row with Apply and Clear; phones get one
 * button that opens the same controls, labelled, in a bottom sheet.
 */
export function FilterBar({
  controls,
  onApply,
  onClear,
  activeCount,
  label,
  summary,
  disabled = false,
}: {
  controls: FilterControl[];
  onApply: () => void;
  onClear: () => void;
  /** Number of applied filters; shows the Clear button and the badge on phones. */
  activeCount: number;
  label: string;
  /** Short text shown next to the button on phones, such as the applied date range. */
  summary?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const wide = useWideScreen();
  const [open, setOpen] = useState(false);
  const baseId = useId();
  if (wide)
    return (
      <form
        role="search"
        aria-label={label}
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
      >
        {controls.map((control) => {
          const id = `${baseId}-${control.id}`;
          const rendered = control.render({
            id,
            "aria-label": control.label,
            className: control.width ?? "sm:w-48",
          });
          return control.showLabel ? (
            <span key={control.id} className="flex items-center gap-1.5">
              <label htmlFor={id} className="text-xs text-muted">
                {control.label}
              </label>
              {rendered}
            </span>
          ) : (
            <Fragment key={control.id}>{rendered}</Fragment>
          );
        })}
        <Button type="submit" variant="secondary" disabled={disabled}>
          {copy.app.common.apply}
        </Button>
        {activeCount > 0 && (
          <Button type="button" variant="ghost" onClick={onClear}>
            {copy.app.common.clear}
          </Button>
        )}
      </form>
    );
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label={label}
            className="relative"
          >
            <SlidersHorizontal aria-hidden />
            {activeCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-fg">
                {activeCount}
              </span>
            )}
          </Button>
        </DialogTrigger>
        <SheetContent side="bottom">
          <DialogHeader title={label} />
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              onApply();
              setOpen(false);
            }}
          >
            {controls.map((control) => (
              <Field key={control.id} label={control.label}>
                {(props) =>
                  control.render({
                    id: props.id,
                    "aria-label": control.label,
                    className: "w-full",
                  })
                }
              </Field>
            ))}
            <DialogFooter className="pt-1">
              {activeCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    onClear();
                    setOpen(false);
                  }}
                >
                  {copy.app.common.clear}
                </Button>
              )}
              <Button type="submit" disabled={disabled}>
                {copy.app.common.apply}
              </Button>
            </DialogFooter>
          </form>
        </SheetContent>
      </Dialog>
      {summary && (
        <span className="min-w-0 truncate text-xs text-muted">{summary}</span>
      )}
    </div>
  );
}
/** The props `FilterBar` hands each control. */
interface FilterControlProps {
  id: string;
  "aria-label": string;
  className: string;
}
/** Tri-state filter: everything, only `on`, or only `off`. */
export function BooleanFilterSelect({
  value,
  labels,
  onChange,
  ...props
}: FilterControlProps & {
  value: boolean | undefined;
  labels: { all: string; on: string; off: string };
  onChange: (next: boolean | undefined) => void;
}) {
  return (
    <NativeSelect
      {...props}
      value={value === undefined ? "" : value ? "on" : "off"}
      onChange={(event) => {
        onChange(
          event.target.value === "" ? undefined : event.target.value === "on",
        );
      }}
    >
      <option value="">{labels.all}</option>
      <option value="on">{labels.on}</option>
      <option value="off">{labels.off}</option>
    </NativeSelect>
  );
}
/** Filter on one value of a closed set, or everything when cleared. */
export function EnumFilterSelect<Value extends string>({
  value,
  options,
  optionLabel,
  allLabel,
  onChange,
  ...props
}: FilterControlProps & {
  value: Value | undefined;
  options: readonly Value[];
  optionLabel: (value: Value) => string;
  allLabel: string;
  onChange: (next: Value | undefined) => void;
}) {
  return (
    <NativeSelect
      {...props}
      value={value ?? ""}
      onChange={(event) => {
        onChange(options.find((option) => option === event.target.value));
      }}
    >
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {optionLabel(option)}
        </option>
      ))}
    </NativeSelect>
  );
}
/** A labelled control sized for a filter form; full width on phones. */
export function FilterField({
  label,
  hint,
  children,
  className,
  wide = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: (props: { id: string; "aria-describedby"?: string }) => ReactNode;
  className?: string | undefined;
  wide?: boolean | undefined;
}) {
  return (
    <Field
      label={label}
      {...(hint === undefined ? {} : { hint })}
      className={cn("w-full min-w-0", wide ? "sm:w-72" : "sm:w-48", className)}
    >
      {children}
    </Field>
  );
}
/** Collapsible card for filter sets that are too large for one row. */
export function FiltersCard({
  title,
  activeCount,
  defaultOpen = false,
  children,
}: {
  title: string;
  activeCount: number;
  defaultOpen?: boolean | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen || activeCount > 0);
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <Card>
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-raised/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        onClick={() => {
          setOpen((prior) => !prior);
        }}
      >
        <Icon size={16} aria-hidden className="text-muted" />
        <span>{title}</span>
        {activeCount > 0 && (
          <Badge variant="accent">
            {copy.admin.audit.activeFilters(activeCount)}
          </Badge>
        )}
        <span className="sr-only">
          {open ? copy.admin.audit.hideFilters : copy.admin.audit.showFilters}
        </span>
      </button>
      {open && (
        <CardContent className="border-t border-line-soft pt-4">
          {children}
        </CardContent>
      )}
    </Card>
  );
}
/** Drop empty strings so filters serialize to the exact keys the API accepts. */
export function compact<T extends Record<string, string>>(
  draft: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(draft).filter(([, value]) => value.trim() !== ""),
  ) as Partial<T>;
}
/** A copy of the filters without one key, so the remaining keys stay exact for the API. */
export function without<T extends object, K extends keyof T>(
  value: T,
  key: K,
): Omit<T, K> {
  return Object.fromEntries(
    Object.entries(value).filter(([name]) => name !== key),
  ) as Omit<T, K>;
}
export function countActive(filters: Record<string, unknown>): number {
  return Object.values(filters).filter(
    (value) => value !== undefined && value !== "" && value !== null,
  ).length;
}
/** `datetime-local` values are local wall time; the API wants UTC instants. */
export function localToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
/** `date` values are UTC calendar days for metric filters. */
export function dateToIso(value: string): string {
  return `${value}T00:00:00.000Z`;
}
