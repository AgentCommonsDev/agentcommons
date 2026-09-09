import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  dashboardDefinitionSchema,
  dashboardTimePresets,
  dashboardVariableTypes,
  type DashboardDefinition,
  type DashboardVariable,
} from "@agentcommons/core/schemas/dashboards";
import { copy } from "../../copy";
import { CopyButton } from "../../components/app/states";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
} from "../../components/ui/dialog";
import { Field } from "../../components/ui/field";
import { Alert } from "../../components/ui/feedback";
import { Input, NativeSelect, Textarea } from "../../components/ui/input";
import { Disclosure } from "../admin/display";
import { formatIssues } from "./inspector";
import { definitionJson } from "./model";

function makeVariable(
  type: DashboardVariable["type"],
  base: { name: string; label?: string | undefined },
): DashboardVariable {
  const shared = {
    name: base.name,
    ...(base.label === undefined ? {} : { label: base.label }),
  };
  switch (type) {
    case "time_range":
      return { ...shared, type, default: "30d" };
    case "text":
      return { ...shared, type, default: "" };
    default:
      return { ...shared, type };
  }
}
function VariableRow({
  variable,
  onChange,
  onRemove,
}: {
  variable: DashboardVariable;
  onChange: (variable: DashboardVariable) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end">
      <Field label={copy.dashboards.settings.variableType}>
        {(props) => (
          <NativeSelect
            {...props}
            value={variable.type}
            onChange={(event) => {
              const type =
                dashboardVariableTypes.find(
                  (entry) => entry === event.target.value,
                ) ?? "text";
              onChange(makeVariable(type, variable));
            }}
          >
            {dashboardVariableTypes.map((type) => (
              <option key={type} value={type}>
                {copy.dashboards.variables.types[type]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field label={copy.dashboards.settings.variableName}>
        {(props) => (
          <Input
            {...props}
            className="font-mono"
            value={variable.name}
            maxLength={40}
            onChange={(event) => {
              onChange({
                ...variable,
                name: event.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9_]/g, "_"),
              });
            }}
          />
        )}
      </Field>
      <Field
        label={copy.dashboards.settings.variableLabel}
        optional={copy.app.common.optional}
      >
        {(props) => (
          <Input
            {...props}
            value={variable.label ?? ""}
            maxLength={40}
            onChange={(event) => {
              const next: DashboardVariable = { ...variable };
              if (event.target.value) next.label = event.target.value;
              else delete next.label;
              onChange(next);
            }}
          />
        )}
      </Field>
      {variable.type === "time_range" ? (
        <Field label={copy.dashboards.settings.defaultPreset}>
          {(props) => (
            <NativeSelect
              {...props}
              value={variable.default}
              onChange={(event) => {
                const preset =
                  dashboardTimePresets.find(
                    (entry) => entry === event.target.value,
                  ) ?? "30d";
                onChange({ ...variable, default: preset });
              }}
            >
              {dashboardTimePresets.map((preset) => (
                <option key={preset} value={preset}>
                  {copy.dashboards.variables.presets[preset]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      ) : variable.type === "text" ? (
        <Field label={copy.dashboards.settings.defaultText}>
          {(props) => (
            <Input
              {...props}
              value={variable.default}
              maxLength={256}
              onChange={(event) => {
                onChange({ ...variable, default: event.target.value });
              }}
            />
          )}
        </Field>
      ) : (
        <div className="hidden sm:block" />
      )}
      <Button
        variant="ghost"
        size="icon"
        className="text-muted hover:text-danger"
        aria-label={copy.dashboards.settings.removeVariable}
        onClick={onRemove}
      >
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}
function JsonSection({
  definition,
  onApply,
}: {
  definition: DashboardDefinition;
  onApply: (definition: DashboardDefinition) => void;
}) {
  const serialized = definitionJson(definition);
  const [text, setText] = useState(serialized);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (!dirty) setText(serialized);
  }, [serialized, dirty]);
  const apply = () => {
    setApplied(false);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      setIssues([error instanceof Error ? error.message : String(error)]);
      return;
    }
    const result = dashboardDefinitionSchema.safeParse(parsed);
    if (!result.success) {
      setIssues(formatIssues(result.error));
      return;
    }
    setIssues([]);
    setDirty(false);
    setApplied(true);
    onApply(result.data);
  };
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium">
          {copy.dashboards.settings.json}
        </h3>
        <CopyButton
          value={serialized}
          showLabel
          size="sm"
          variant="secondary"
        />
      </div>
      <Textarea
        data-testid="dashboard-json"
        aria-label={copy.dashboards.settings.json}
        className="min-h-48 font-mono text-[12px]"
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setDirty(true);
          setApplied(false);
          setText(event.target.value);
        }}
      />
      <p className="text-xs text-muted">{copy.dashboards.settings.jsonHint}</p>
      {issues.length > 0 && (
        <Alert variant="danger">
          <ul className="list-disc pl-4 font-mono text-xs">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="secondary" disabled={!dirty} onClick={apply}>
          {copy.dashboards.settings.applyJson}
        </Button>
        {applied && (
          <span role="status" className="text-xs text-success">
            {copy.dashboards.settings.jsonApplied}
          </span>
        )}
      </div>
    </section>
  );
}
/** Description, variables and whole-definition JSON import and export. */
export function DashboardSettingsDialog({
  open,
  onOpenChange,
  description,
  definition,
  onDescription,
  onDefinition,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  description: string;
  definition: DashboardDefinition;
  onDescription: (description: string) => void;
  onDefinition: (definition: DashboardDefinition) => void;
}) {
  const setVariables = (variables: DashboardVariable[]) => {
    onDefinition({ ...definition, variables });
  };
  const addVariable = () => {
    const taken = new Set(
      definition.variables.map((variable) => variable.name),
    );
    let name = "variable";
    for (let index = 2; taken.has(name); index++)
      name = `variable_${String(index)}`;
    setVariables([
      ...definition.variables,
      makeVariable("time_range", { name }),
    ]);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" data-testid="dashboard-settings">
        <DialogHeader title={copy.dashboards.settings.title} />
        <div className="flex flex-col gap-6">
          <Field
            label={copy.dashboards.settings.description}
            optional={copy.app.common.optional}
          >
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                maxLength={400}
                placeholder={copy.dashboards.settings.descriptionPlaceholder}
                value={description}
                onChange={(event) => {
                  onDescription(event.target.value);
                }}
              />
            )}
          </Field>
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-[13px] font-medium">
                  {copy.dashboards.settings.variables}
                </h3>
                <p className="text-xs text-muted">
                  {copy.dashboards.settings.variablesHint}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={definition.variables.length >= 8}
                onClick={addVariable}
              >
                <Plus aria-hidden />
                {copy.dashboards.settings.addVariable}
              </Button>
            </div>
            {definition.variables.length === 0 ? (
              <p className="text-xs text-muted">
                {copy.dashboards.settings.noVariables}
              </p>
            ) : (
              definition.variables.map((variable, index) => (
                <VariableRow
                  key={index}
                  variable={variable}
                  onChange={(next) => {
                    setVariables(
                      definition.variables.map((entry, at) =>
                        at === index ? next : entry,
                      ),
                    );
                  }}
                  onRemove={() => {
                    setVariables(
                      definition.variables.filter((_entry, at) => at !== index),
                    );
                  }}
                />
              ))
            )}
            <p className="text-xs text-muted">
              {copy.dashboards.settings.variableNameHint}
            </p>
          </section>
          {/* The form is the one way to edit; the JSON import sits behind one explicit switch. */}
          <Disclosure
            showLabel={copy.dashboards.settings.jsonShow}
            hideLabel={copy.dashboards.settings.jsonHide}
          >
            <JsonSection definition={definition} onApply={onDefinition} />
          </Disclosure>
        </div>
      </DialogContent>
    </Dialog>
  );
}
