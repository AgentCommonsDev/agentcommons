import { useState } from "react";
import { X } from "lucide-react";
import {
  searchConditionFields,
  searchConditionSchema,
  type SearchCondition,
} from "@agentcommons/core/schemas/search";
import { copy } from "../../copy";
import { Button } from "../ui/button";

export function SearchConditions({
  conditions,
  onChange,
}: {
  conditions: SearchCondition[];
  onChange: (conditions: SearchCondition[]) => void;
}) {
  const [field, setField] = useState("tool_name");
  const [op, setOp] = useState("contains");
  const [value, setValue] = useState("");
  const [path, setPath] = useState('["query"]');
  const [json, setJson] = useState(false);
  const [error, setError] = useState(false);
  const labels = copy.workspace.sessions.conditions;
  return (
    <section className="search-conditions" aria-label={labels.title}>
      <details>
        <summary>{labels.title}</summary>
        <p className="workspace-muted">{labels.description}</p>
        <form
          className="filter-row search-condition-form"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const candidate: unknown = {
                field,
                op,
                ...(field === "tool_input"
                  ? { path: JSON.parse(path) as unknown }
                  : {}),
                ...(op === "exists"
                  ? {}
                  : {
                      value:
                        op === "eq" && json
                          ? (JSON.parse(value) as unknown)
                          : value,
                    }),
              };
              const parsed = searchConditionSchema.safeParse(candidate);
              if (!parsed.success) {
                setError(true);
                return;
              }
              onChange([...conditions, parsed.data]);
              setValue("");
              setError(false);
            } catch {
              setError(true);
            }
          }}
        >
          <label>
            {labels.field}
            <select
              value={field}
              onChange={(event) => {
                setField(event.target.value);
                setJson(false);
                setError(false);
              }}
            >
              {Object.keys(searchConditionFields).map((name) => (
                <option value={name} key={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {labels.operator}
            <select
              value={op}
              onChange={(event) => {
                setOp(event.target.value);
                setError(false);
              }}
            >
              {Object.entries(labels.operators).map(([name, label]) => (
                <option value={name} key={name}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {field === "tool_input" && (
            <label>
              {labels.path}
              <input
                value={path}
                onChange={(event) => {
                  setPath(event.target.value);
                }}
                placeholder={labels.pathExample}
              />
            </label>
          )}
          {op !== "exists" && (
            <label>
              {labels.value}
              <input
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                }}
              />
            </label>
          )}
          {op === "eq" && (
            <label className="condition-json">
              <input
                type="checkbox"
                checked={json}
                onChange={(event) => {
                  setJson(event.target.checked);
                }}
              />
              {labels.json}
            </label>
          )}
          <Button
            type="submit"
            variant="secondary"
            disabled={conditions.length >= 10}
          >
            {labels.add}
          </Button>
        </form>
        {field === "tool_input" && (
          <p className="workspace-muted">{labels.pathHelp}</p>
        )}
        {json && op === "eq" && (
          <p className="workspace-muted">{labels.jsonHelp}</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {labels.invalid}
          </p>
        )}
        {conditions.length >= 10 && (
          <p className="workspace-muted">{labels.limit}</p>
        )}
      </details>
      <div className="filter-chips">
        {conditions.map((condition, index) => (
          <span
            className="filter-chip"
            key={JSON.stringify([index, condition])}
          >
            <span>
              {condition.field}
              {condition.path ? ` ${JSON.stringify(condition.path)}` : ""}{" "}
              {labels.operators[condition.op]}{" "}
              {"value" in condition ? JSON.stringify(condition.value) : ""}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${labels.remove} ${String(index + 1)}`}
              onClick={() => {
                onChange(
                  conditions.filter((_, position) => position !== index),
                );
              }}
            >
              <X size={12} aria-hidden />
            </Button>
          </span>
        ))}
      </div>
    </section>
  );
}
