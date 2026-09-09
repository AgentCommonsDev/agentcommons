import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  searchConditionSchema,
  searchFiltersSchema,
} from "@agentcommons/core/schemas/search";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { useWorkspace } from "../../components/app/workspace";
import { Button } from "../../components/ui/button";
import { CheckboxField, Field } from "../../components/ui/field";
import { Input, NativeSelect } from "../../components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/menu";
import {
  dayToIso,
  fieldHint,
  fileOperations,
  fieldSpec,
  fieldSpecs,
  fieldTitle,
  parsePath,
  valueText,
  withValue,
  type FieldSpec,
  type Operator,
  type SearchState,
} from "./search-state";

const suggestionSql = {
  repos: "SELECT repo_name FROM repos ORDER BY session_count DESC LIMIT 200",
  users: "SELECT email FROM users ORDER BY email LIMIT 200",
  tools:
    "SELECT tool_name FROM session_tools GROUP BY tool_name ORDER BY count() DESC LIMIT 200",
} as const;
function useSuggestions(
  source: FieldSpec["suggest"],
  enabled: boolean,
): string[] {
  const { organization } = useWorkspace();
  const query = useQuery({
    queryKey: [organization.id, "filter-suggestions", source],
    queryFn: async ({ signal }) => {
      if (!source) return [];
      const result = unwrap(
        await api.POST("/api/v1/query", {
          body: { sql: suggestionSql[source] },
          signal,
        }),
      );
      return result.rows.flatMap((row) =>
        typeof row[0] === "string" && row[0] !== "" ? [row[0]] : [],
      );
    },
    enabled: enabled && source !== null,
    staleTime: 5 * 60_000,
  });
  return query.data ?? [];
}
function jsonPrimitive(value: string): string | number | boolean | null {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return value;
}
/** One control for every filter the API supports; the field table decides the inputs. */
export function FilterPopover({
  state,
  onChange,
}: {
  state: SearchState;
  onChange: (next: SearchState) => void;
}) {
  const labels = copy.sessions.filters;
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<FieldSpec["key"]>("repo_name");
  const [operator, setOperator] = useState<Operator>("eq");
  const [value, setValue] = useState("");
  const [path, setPath] = useState("");
  const [json, setJson] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [operation, setOperation] = useState("");
  const [filePath, setFilePath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const spec = fieldSpec(field);
  const suggestions = useSuggestions(spec.suggest, open);
  const changeField = (next: FieldSpec["key"]) => {
    const nextSpec = fieldSpec(next);
    setField(next);
    setOperator(nextSpec.operators[0] ?? "eq");
    setValue(nextSpec.options?.[0] ?? "");
    setJson(false);
    setError(null);
  };
  const reset = () => {
    setValue(spec.options?.[0] ?? "");
    setPath("");
    setJson(false);
    setFrom("");
    setTo("");
    setOperation("");
    setFilePath("");
    setError(null);
  };
  const submit = () => {
    setError(null);
    if (spec.key === "date") {
      const since = from ? dayToIso(from, false) : null;
      const until = to ? dayToIso(to, true) : null;
      if ((from && !since) || (to && !until) || (!since && !until)) {
        setError(labels.invalid);
        return;
      }
      onChange({ ...state, since, until });
    } else if (spec.key === "files") {
      // One control, two quick filters: the server tests both on the same file row.
      const prefix = filePath.trim();
      const candidate = {
        ...(prefix ? { file_prefix: prefix } : {}),
        ...(operation ? { file_operation: operation } : {}),
      };
      if (!prefix && !operation) {
        setError(labels.files.required);
        return;
      }
      if (!searchFiltersSchema.safeParse(candidate).success) {
        setError(labels.invalid);
        return;
      }
      let next = state;
      if (prefix) next = withValue(next, "file_prefix", prefix);
      if (operation) next = withValue(next, "file_operation", operation);
      onChange(next);
    } else if (operator === "eq" && spec.quick) {
      const trimmed = value.trim();
      const check = searchFiltersSchema.safeParse({ [spec.quick]: trimmed });
      if (!trimmed || !check.success) {
        setError(labels.invalid);
        return;
      }
      onChange(withValue(state, spec.quick, trimmed));
    } else {
      if (state.where.length >= 10) {
        setError(labels.limit);
        return;
      }
      const candidate: Record<string, unknown> = {
        field: spec.key,
        op: operator,
      };
      if (spec.key === "tool_input") {
        const parsed = parsePath(path);
        if (!parsed) {
          setError(labels.invalid);
          return;
        }
        candidate.path = parsed;
      }
      if (operator !== "exists")
        candidate.value =
          json && operator === "eq" ? jsonPrimitive(value) : value;
      const parsed = searchConditionSchema.safeParse(candidate);
      if (!parsed.success) {
        setError(labels.invalid);
        return;
      }
      onChange({ ...state, where: [...state.where, parsed.data] });
    }
    reset();
    setOpen(false);
  };
  const composite = spec.key === "date" || spec.key === "files";
  const showValue = !composite && operator !== "exists";
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" data-testid="sessions-add-filter">
          <Plus aria-hidden />
          {labels.add}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-1.5rem)] p-4"
        aria-label={labels.title}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field label={labels.field} hint={fieldHint(spec.key)}>
            {(props) => (
              <NativeSelect
                {...props}
                value={field}
                onChange={(event) => {
                  const next = fieldSpecs.find(
                    (item) => item.key === event.target.value,
                  );
                  if (next) changeField(next.key);
                }}
              >
                {fieldSpecs.map((item) => (
                  <option key={item.key} value={item.key}>
                    {fieldTitle(item.key)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {spec.key === "date" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={labels.from}>
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    value={from}
                    max={to || undefined}
                    onChange={(event) => {
                      setFrom(event.target.value);
                    }}
                  />
                )}
              </Field>
              <Field label={labels.to}>
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    value={to}
                    min={from || undefined}
                    onChange={(event) => {
                      setTo(event.target.value);
                    }}
                  />
                )}
              </Field>
              <p className="col-span-2 text-xs leading-relaxed text-muted">
                {labels.dateHint}
              </p>
            </div>
          )}
          {spec.key === "files" && (
            <>
              <Field label={labels.files.operation}>
                {(props) => (
                  <NativeSelect
                    {...props}
                    value={operation}
                    onChange={(event) => {
                      setOperation(event.target.value);
                      setError(null);
                    }}
                  >
                    <option value="">{labels.files.anyOperation}</option>
                    {fileOperations.map((option) => (
                      <option key={option} value={option}>
                        {valueText("file_operation", option)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={labels.files.path} error={error}>
                {(props) => (
                  <Input
                    {...props}
                    value={filePath}
                    placeholder={labels.files.pathPlaceholder}
                    autoComplete="off"
                    autoFocus
                    onChange={(event) => {
                      setFilePath(event.target.value);
                      setError(null);
                    }}
                  />
                )}
              </Field>
            </>
          )}
          {!composite && (
            <>
              {spec.operators.length > 1 && (
                <Field label={labels.operator}>
                  {(props) => (
                    <NativeSelect
                      {...props}
                      value={operator}
                      onChange={(event) => {
                        const next = spec.operators.find(
                          (item) => item === event.target.value,
                        );
                        if (next) setOperator(next);
                        setError(null);
                      }}
                    >
                      {spec.operators.map((item) => (
                        <option key={item} value={item}>
                          {item === "eq" && spec.quick
                            ? labels.isAnyOf
                            : labels.operators[item]}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
              )}
              {spec.key === "tool_input" && (
                <Field label={labels.path} hint={labels.pathHint}>
                  {(props) => (
                    <Input
                      {...props}
                      value={path}
                      placeholder={labels.pathPlaceholder}
                      autoComplete="off"
                      onChange={(event) => {
                        setPath(event.target.value);
                      }}
                    />
                  )}
                </Field>
              )}
              {showValue && (
                <Field label={labels.value} error={error}>
                  {(props) =>
                    spec.options ? (
                      <NativeSelect
                        {...props}
                        value={value}
                        onChange={(event) => {
                          setValue(event.target.value);
                        }}
                      >
                        {spec.options.map((option) => (
                          <option key={option} value={option}>
                            {valueText(spec.key, option)}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <>
                        <Input
                          {...props}
                          value={value}
                          autoComplete="off"
                          autoFocus
                          list={spec.suggest ? listId : undefined}
                          onChange={(event) => {
                            setValue(event.target.value);
                          }}
                        />
                        {spec.suggest && (
                          <datalist id={listId}>
                            {suggestions.map((item) => (
                              <option key={item} value={item} />
                            ))}
                          </datalist>
                        )}
                      </>
                    )
                  }
                </Field>
              )}
              {spec.key === "tool_input" && operator === "eq" && (
                <CheckboxField
                  label={labels.json}
                  hint={labels.jsonHint}
                  checked={json}
                  onCheckedChange={(checked) => {
                    setJson(checked === true);
                  }}
                />
              )}
            </>
          )}
          {error && !showValue && spec.key !== "files" && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
              }}
            >
              {copy.app.common.cancel}
            </Button>
            <Button type="submit" size="sm">
              {labels.apply}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
