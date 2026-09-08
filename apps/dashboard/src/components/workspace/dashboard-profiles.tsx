import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { JsonForms } from "@jsonforms/react";
import { vanillaCells, vanillaRenderers } from "@jsonforms/vanilla-renderers";
import type { JsonSchema, UISchemaElement } from "@jsonforms/core";
import * as Dialog from "@radix-ui/react-dialog";
import { z } from "zod";
import {
  dashboardSaveInputSchema,
  type DashboardDefinition,
} from "@agentcommons/core/schemas/dashboards";
import { api, defined, unwrap } from "../../lib/api/client";
import { copy } from "../../copy";
import { useWorkspace } from "./context";
import { Button } from "../ui/button";
import { Field, RequestError } from "./primitives";
import { DashboardWidget } from "./dashboard-widget";
const labels = copy.workspace.profiles;
const schemaShape = z
  .object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.object({}).loose()),
  })
  .loose();
const initialDefinition: DashboardDefinition = {
  version: 1,
  widgets: [
    {
      id: "sessions",
      title: labels.widgetTitle,
      sql: "SELECT COUNT(*) AS value FROM sessions",
      display: "number",
      y: "value",
      unit: "count",
    },
  ],
};
const fieldLabels: Readonly<Record<string, string>> = labels.fields;
function parseDraft(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(labels.invalidJson);
  }
}
function formLayout(schema: JsonSchema): UISchemaElement {
  const properties = schema.properties ?? {};
  const widgets = z
    .object({
      items: z.object({ properties: z.record(z.string(), z.unknown()) }),
    })
    .safeParse(properties.widgets);
  const detail = {
    type: "VerticalLayout",
    elements: Object.keys(
      widgets.success ? widgets.data.items.properties : {},
    ).map((key) => ({
      type: "Control",
      scope: `#/properties/${key}`,
      label: fieldLabels[key] ?? key,
      options: key === "sql" ? { multi: true } : {},
    })),
  };
  return {
    type: "VerticalLayout",
    elements: Object.keys(properties)
      .filter((key) => key !== "version")
      .map((key) => ({
        type: "Control",
        scope: `#/properties/${key}`,
        label: fieldLabels[key] ?? key,
        options: key === "widgets" ? { detail } : {},
      })),
  };
}
export function DashboardProfiles({ children }: { children: ReactNode }) {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  const [name, setName] = useState<string>(labels.newName);
  const [definition, setDefinition] = useState<unknown>(initialDefinition);
  const [raw, setRaw] = useState(JSON.stringify(initialDefinition, null, 2));
  const [mode, setMode] = useState("form");
  const [error, setError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState(false);
  const list = useQuery({
    queryKey: [organization.id, "dashboards"],
    queryFn: async ({ signal }) => {
      const response = unwrap(
        await api.GET("/api/v1/me/dashboards", { signal }),
      );
      return {
        ...response,
        formSchema: schemaShape.parse(response.definition_schema),
      };
    },
  });
  const profile = list.data?.items.find((item) => item.id === selected);
  const schema = useMemo<JsonSchema | undefined>(
    () => list.data?.formSchema,
    [list.data],
  );
  const ui = useMemo(() => (schema ? formLayout(schema) : undefined), [schema]);
  const formHost = useRef<HTMLDivElement>(null);
  const widgetCount = useRef(initialDefinition.widgets.length);
  useEffect(() => {
    const parsed = z
      .object({ widgets: z.array(z.unknown()) })
      .safeParse(definition);
    if (!parsed.success) return;
    if (
      editing &&
      mode === "form" &&
      parsed.data.widgets.length < widgetCount.current
    )
      formHost.current
        ?.querySelector<HTMLButtonElement>(".button-add")
        ?.focus();
    widgetCount.current = parsed.data.widgets.length;
  }, [definition, editing, mode]);
  const save = useMutation({
    mutationFn: async () => {
      const value = mode === "json" ? parseDraft(raw) : definition;
      const input = dashboardSaveInputSchema.parse({
        ...(revision ?? {}),
        name,
        definition: value,
      });
      return unwrap(
        await api.POST("/api/v1/me/dashboards", { body: defined(input) }),
      );
    },
    onSuccess: async (result) => {
      await client.invalidateQueries({
        queryKey: [organization.id, "dashboards"],
      });
      setSelected(result.id);
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.DELETE("/api/v1/me/dashboards/{id}", {
          body: {},
          params: { path: { id: selected } },
        }),
      ),
    onSuccess: async () => {
      setSelected("");
      setDeleting(false);
      await client.invalidateQueries({
        queryKey: [organization.id, "dashboards"],
      });
    },
  });
  const openEditor = (duplicate: boolean) => {
    const value = profile?.definition ?? initialDefinition;
    setRevision(
      profile && !duplicate
        ? { id: profile.id, revision: profile.revision }
        : null,
    );
    setName(profile?.name ?? labels.newName);
    setDefinition(value);
    setRaw(JSON.stringify(value, null, 2));
    setMode("form");
    setError(null);
    save.reset();
    setEditing(true);
  };
  return (
    <>
      <div className="dashboard-picker">
        <Field label={labels.selector}>
          {(props) => (
            <select
              {...props}
              value={selected}
              disabled={editing}
              onChange={(event) => {
                setSelected(event.target.value);
              }}
            >
              <option value="">{labels.builtin}</option>
              {list.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="dashboard-picker-actions">
          <Button
            variant="secondary"
            disabled={!schema || editing}
            onClick={() => {
              setSelected("");
              setRevision(null);
              setName(labels.newName);
              setDefinition(initialDefinition);
              setRaw(JSON.stringify(initialDefinition, null, 2));
              setMode("form");
              setError(null);
              save.reset();
              setEditing(true);
            }}
          >
            {labels.create}
          </Button>
          {profile && !editing && (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  openEditor(false);
                }}
              >
                {labels.edit}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  openEditor(true);
                }}
              >
                {labels.duplicate}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  remove.reset();
                  setDeleting(true);
                }}
              >
                {labels.remove}
              </Button>
            </>
          )}
        </div>
      </div>
      {list.error && <RequestError error={list.error} />}
      {!editing &&
        (profile ? (
          <>
            <h1>{profile.name}</h1>
            <div className="dashboard-widgets">
              {profile.definition.widgets.map((widget) => (
                <DashboardWidget key={widget.id} widget={widget} />
              ))}
            </div>
          </>
        ) : (
          children
        ))}
      {editing && schema && ui && (
        <section className="profile-editor" aria-label={labels.editor}>
          <h2>{revision ? labels.edit : labels.create}</h2>
          <p>{labels.description}</p>
          <a href="/sql" target="_blank" rel="noreferrer">
            {labels.schemaLink}
          </a>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              save.mutate();
            }}
          >
            <Field label={labels.name}>
              {(props) => (
                <input
                  {...props}
                  value={name}
                  maxLength={80}
                  required
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              )}
            </Field>
            <Field label={labels.editor}>
              {(props) => (
                <select
                  {...props}
                  value={mode}
                  onChange={(event) => {
                    setError(null);
                    if (event.target.value === "form") {
                      try {
                        setDefinition(parseDraft(raw));
                      } catch {
                        setError(new Error(labels.invalidJson));
                        return;
                      }
                    } else setRaw(JSON.stringify(definition, null, 2));
                    setMode(event.target.value);
                  }}
                >
                  <option value="form">{labels.form}</option>
                  <option value="json">{labels.json}</option>
                </select>
              )}
            </Field>
            {mode === "form" ? (
              <div ref={formHost} className="profile-jsonforms">
                <JsonForms
                  schema={schema}
                  uischema={ui}
                  data={definition}
                  renderers={vanillaRenderers}
                  cells={vanillaCells}
                  validationMode="NoValidation"
                  readonly={save.isPending}
                  onChange={({ data }: { data: unknown }) => {
                    setDefinition(data);
                  }}
                />
              </div>
            ) : (
              <Field label={labels.definition}>
                {(props) => (
                  <textarea
                    {...props}
                    rows={18}
                    spellCheck={false}
                    value={raw}
                    disabled={save.isPending}
                    onChange={(event) => {
                      setRaw(event.target.value);
                    }}
                  />
                )}
              </Field>
            )}
            {error !== null && <RequestError error={error} />}{" "}
            {save.error && <RequestError error={save.error} />}
            <div className="form-actions">
              <Button type="submit" disabled={save.isPending}>
                {labels.save}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setEditing(false);
                }}
              >
                {labels.cancel}
              </Button>
            </div>
          </form>
        </section>
      )}
      <Dialog.Root open={deleting} onOpenChange={setDeleting}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>{labels.remove}</Dialog.Title>
            <Dialog.Description>{labels.deleteHint}</Dialog.Description>
            {remove.error && <RequestError error={remove.error} />}
            <div className="form-actions">
              <Button
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate();
                }}
              >
                {labels.remove}
              </Button>
              <Dialog.Close asChild>
                <Button variant="ghost" disabled={remove.isPending}>
                  {labels.cancel}
                </Button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
