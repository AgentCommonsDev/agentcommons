import { X } from "lucide-react";
import type { ReactNode } from "react";
import { copy } from "../../copy";
import { dateOnly } from "../../lib/display";
import { Button } from "../../components/ui/button";
import {
  fieldTitle,
  hasFilters,
  valueFilterKeys,
  valueFilterOperator,
  valueText,
  type SearchState,
} from "./search-state";

function Chip({
  children,
  onRemove,
}: {
  children: ReactNode;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-line bg-raised py-0.5 pr-0.5 pl-2.5 text-xs text-fg">
      <span className="min-w-0 truncate">{children}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 rounded-full text-muted"
        aria-label={copy.sessions.filters.remove}
        onClick={onRemove}
      >
        <X size={12} aria-hidden />
      </Button>
    </span>
  );
}
/** Active filters as removable chips; the state they edit lives in the URL. */
export function FilterChips({
  state,
  onChange,
}: {
  state: SearchState;
  onChange: (next: SearchState) => void;
}) {
  const labels = copy.sessions.filters;
  if (!hasFilters(state)) return null;
  const separator = " ";
  return (
    <div
      className="flex min-w-0 max-w-full flex-1 flex-wrap items-center gap-1.5"
      aria-label={labels.label}
    >
      {valueFilterKeys.flatMap((key) =>
        (state.values[key] ?? []).map((value) => (
          <Chip
            key={`${key}:${value}`}
            onRemove={() => {
              const remaining = (state.values[key] ?? []).filter(
                (item) => item !== value,
              );
              const rest = Object.fromEntries(
                Object.entries(state.values).filter(([name]) => name !== key),
              );
              onChange({
                ...state,
                values: remaining.length ? { ...rest, [key]: remaining } : rest,
              });
            }}
          >
            {fieldTitle(key)}
            {separator}
            {labels.operators[valueFilterOperator[key]]}
            {separator}
            <span className="font-medium">{valueText(key, value)}</span>
          </Chip>
        )),
      )}
      {(state.since || state.until) && (
        <Chip
          onRemove={() => {
            onChange({ ...state, since: null, until: null });
          }}
        >
          {labels.dateRange}
          {separator}
          <span className="font-medium">
            {state.since ? dateOnly(state.since) : copy.app.common.unavailable}
            {labels.dateSeparator}
            {state.until ? dateOnly(state.until) : copy.app.common.unavailable}
          </span>
        </Chip>
      )}
      {state.where.map((condition, index) => (
        <Chip
          key={`${String(index)}:${JSON.stringify(condition)}`}
          onRemove={() => {
            onChange({
              ...state,
              where: state.where.filter((_, position) => position !== index),
            });
          }}
        >
          {fieldTitle(condition.field)}
          {condition.path ? ` ${condition.path.join(".")}` : ""}
          {separator}
          {labels.operators[condition.op]}
          {"value" in condition && (
            <>
              {separator}
              <span className="font-medium">
                {valueText(condition.field, condition.value)}
              </span>
            </>
          )}
        </Chip>
      ))}
      <Button
        variant="link"
        size="sm"
        className="text-xs"
        onClick={() => {
          onChange({
            ...state,
            values: {},
            since: null,
            until: null,
            where: [],
          });
        }}
      >
        {labels.clearAll}
      </Button>
    </div>
  );
}
