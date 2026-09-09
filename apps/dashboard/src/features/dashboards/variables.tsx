import { Check, ChevronDown, X } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import {
  dashboardTimePresets,
  type DashboardVariable,
  type DashboardVariableValue,
} from "@agentcommons/core/schemas/dashboards";
import { copy } from "../../copy";
import { harnessLabel, number } from "../../lib/display";
import { cn } from "../../lib/utils";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox, Label } from "../../components/ui/field";
import { Spinner } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/menu";
import { useVariableOptions, type ListOption } from "./api";
import {
  listValue,
  textValueOf,
  timeRangeValue,
  variableLabel,
  type TimePreset,
  type VariableValues,
} from "./model";

const dateOnly = (iso: string) => iso.slice(0, 10);
const startOfDay = (date: string) => `${date}T00:00:00Z`;
function nextDay(date: string): string {
  const value = new Date(startOfDay(date));
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}
const today = () => new Date().toISOString().slice(0, 10);

function TimeRangeControl({
  variable,
  value,
  onChange,
}: {
  variable: Extract<DashboardVariable, { type: "time_range" }>;
  value: DashboardVariableValue | undefined;
  onChange: (value: DashboardVariableValue) => void;
}) {
  const current = timeRangeValue(value, variable.default);
  const custom = typeof current === "object";
  const [open, setOpen] = useState(custom);
  const from = custom ? dateOnly(current.from) : "";
  const to = custom
    ? dateOnly(new Date(Date.parse(current.to) - 1000).toISOString())
    : "";
  const fromId = useId();
  const toId = useId();
  const commit = (nextFrom: string, nextTo: string) => {
    if (!nextFrom || !nextTo) return;
    const [start, end] =
      nextFrom <= nextTo ? [nextFrom, nextTo] : [nextTo, nextFrom];
    onChange({ from: startOfDay(start), to: nextDay(end) });
  };
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={variableLabel(variable)}
        className="flex flex-wrap gap-1"
      >
        {dashboardTimePresets.map((preset: TimePreset) => (
          <Button
            key={preset}
            type="button"
            size="sm"
            variant={!custom && current === preset ? "primary" : "secondary"}
            aria-pressed={!custom && current === preset}
            className="h-7 rounded-full px-2.5 text-xs"
            onClick={() => {
              setOpen(false);
              onChange(preset);
            }}
          >
            {copy.dashboards.variables.presets[preset]}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={custom ? "primary" : "secondary"}
          aria-pressed={custom}
          aria-expanded={open}
          className="h-7 rounded-full px-2.5 text-xs"
          onClick={() => {
            setOpen((prior) => !prior || !custom);
          }}
        >
          {copy.dashboards.variables.custom}
        </Button>
      </div>
      {open && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={fromId} className="text-xs text-muted">
              {copy.dashboards.variables.from}
            </Label>
            <Input
              id={fromId}
              type="date"
              className="h-8 w-40 text-xs"
              value={from}
              max={to || today()}
              onChange={(event) => {
                commit(event.target.value, to || today());
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={toId} className="text-xs text-muted">
              {copy.dashboards.variables.to}
            </Label>
            <Input
              id={toId}
              type="date"
              className="h-8 w-40 text-xs"
              value={to}
              min={from}
              onChange={(event) => {
                commit(from || event.target.value, event.target.value);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MultiSelect({
  label,
  options,
  loading,
  selected,
  onChange,
  searchable = true,
}: {
  label: string;
  options: ListOption[];
  loading: boolean;
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const known = options.filter(
      (option) => needle === "" || option.value.toLowerCase().includes(needle),
    );
    const extra = selected
      .filter((value) => !options.some((option) => option.value === value))
      .map((value) => ({ value, count: null }));
    return [...extra, ...known];
  }, [options, search, selected]);
  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    );
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 max-w-full justify-between gap-2 text-xs"
        >
          <span className="truncate">
            {selected.length === 0
              ? copy.dashboards.variables.all
              : selected.length === 1
                ? selected[0]
                : `${String(selected.length)} ${copy.dashboards.variables.selectedSuffix}`}
          </span>
          {selected.length > 0 && (
            <Badge variant="accent">{String(selected.length)}</Badge>
          )}
          <ChevronDown aria-hidden className="text-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-2 p-2"
      >
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-xs font-medium text-muted">{label}</span>
          {selected.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                onChange([]);
              }}
            >
              <X aria-hidden />
              {copy.app.common.clear}
            </Button>
          )}
        </div>
        {searchable && (
          <Input
            type="search"
            className="h-8 text-xs"
            placeholder={copy.dashboards.variables.searchPlaceholder}
            aria-label={copy.dashboards.variables.searchPlaceholder}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        )}
        <ul className="app-scroll max-h-64 overflow-y-auto" aria-label={label}>
          {loading && (
            <li className="flex items-center gap-2 px-2 py-2 text-xs text-muted">
              <Spinner size={14} />
              {copy.dashboards.variables.loading}
            </li>
          )}
          {!loading && filtered.length === 0 && (
            <li className="px-2 py-2 text-xs text-muted">
              {copy.dashboards.variables.noMatches}
            </li>
          )}
          {filtered.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                  onClick={() => {
                    toggle(option.value);
                  }}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-line bg-surface",
                      checked && "border-primary bg-primary text-primary-fg",
                    )}
                  >
                    {checked && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {option.value}
                  </span>
                  {option.count !== null && (
                    <span className="shrink-0 text-xs text-muted">
                      {number(option.count)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function HarnessControl({
  label,
  selected,
  onChange,
}: {
  label: string;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const harnesses = Object.keys(copy.app.harnesses);
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      {harnesses.map((option) => {
        const id = `harness-${option}`;
        const checked = selected.includes(option);
        return (
          <span key={option} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={checked}
              onCheckedChange={(next) => {
                onChange(
                  next === true
                    ? [...selected, option]
                    : selected.filter((item) => item !== option),
                );
              }}
            />
            <Label
              htmlFor={id}
              className="cursor-pointer text-[13px] font-normal"
            >
              {harnessLabel(option)}
            </Label>
          </span>
        );
      })}
    </div>
  );
}

function TextControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [edited, setEdited] = useState(false);
  const shown = edited ? draft : value;
  const commit = () => {
    setEdited(false);
    if (draft !== value) onChange(draft.slice(0, 256));
  };
  return (
    <Input
      aria-label={label}
      className="h-8 w-56 max-w-full text-xs"
      placeholder={copy.dashboards.variables.textPlaceholder}
      value={shown}
      maxLength={256}
      onChange={(event) => {
        setEdited(true);
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

/** One control per declared variable; the same component serves the bar and control tiles. */
export function VariableControl({
  variable,
  value,
  onChange,
}: {
  variable: DashboardVariable;
  value: DashboardVariableValue | undefined;
  onChange: (value: DashboardVariableValue) => void;
}) {
  const label = variableLabel(variable);
  switch (variable.type) {
    case "time_range":
      return (
        <TimeRangeControl
          variable={variable}
          value={value}
          onChange={onChange}
        />
      );
    case "repo":
    case "user":
      return (
        <ListVariable
          kind={variable.type}
          label={label}
          selected={listValue(value)}
          onChange={onChange}
        />
      );
    case "harness":
      return (
        <HarnessControl
          label={label}
          selected={listValue(value)}
          onChange={onChange}
        />
      );
    case "text":
      return (
        <TextControl
          label={label}
          value={textValueOf(value, variable.default)}
          onChange={onChange}
        />
      );
  }
}
function ListVariable({
  kind,
  label,
  selected,
  onChange,
}: {
  kind: "repo" | "user";
  label: string;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const options = useVariableOptions(kind, true);
  return (
    <MultiSelect
      label={label}
      options={options.data ?? []}
      loading={options.isPending}
      selected={selected}
      onChange={onChange}
    />
  );
}
function VariableField({
  variable,
  children,
  className,
}: {
  variable: DashboardVariable;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted">
        {variableLabel(variable)}
      </span>
      {children}
    </div>
  );
}
export function VariablesBar({
  variables,
  values,
  onChange,
  className,
}: {
  variables: readonly DashboardVariable[];
  values: VariableValues;
  onChange: (name: string, value: DashboardVariableValue) => void;
  className?: string | undefined;
}) {
  if (variables.length === 0) return null;
  return (
    <section
      data-testid="variables-bar"
      aria-label={copy.dashboards.variables.label}
      className={cn(
        "flex flex-wrap items-start gap-x-6 gap-y-3 rounded-lg border border-line bg-surface px-4 py-3",
        className,
      )}
    >
      {variables.map((variable) => (
        <VariableField
          key={variable.name}
          variable={variable}
          className="max-w-full"
        >
          <VariableControl
            variable={variable}
            value={values[variable.name]}
            onChange={(value) => {
              onChange(variable.name, value);
            }}
          />
        </VariableField>
      ))}
    </section>
  );
}
