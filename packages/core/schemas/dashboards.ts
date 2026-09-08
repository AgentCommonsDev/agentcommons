import { z } from "zod";
import {
  identityIdSchema,
  jsonValueSchema,
  sessionIdSchema,
  utcDateTimeSchema,
} from "./common.js";
import { sqlInputSchema } from "./sql.js";

export const dashboardWidgetSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/),
  title: z.string().trim().min(1).max(80),
  sql: sqlInputSchema.shape.sql,
  display: z.enum(["number", "line", "bar", "table"]),
  x: z.string().min(1).max(128).optional(),
  y: z.string().min(1).max(128).optional(),
  unit: z.enum(["count", "ratio", "seconds", "tokens", "usd"]),
});
export const dashboardDefinitionSchema = z
  .strictObject({
    version: z.literal(1),
    widgets: z.array(dashboardWidgetSchema).min(1).max(12),
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();
    value.widgets.forEach((widget, index) => {
      if (ids.has(widget.id))
        context.addIssue({
          code: "custom",
          path: ["widgets", index, "id"],
          message: "Each widget needs a different ID.",
        });
      ids.add(widget.id);
      if (["line", "bar"].includes(widget.display) && (!widget.x || !widget.y))
        context.addIssue({
          code: "custom",
          path: ["widgets", index],
          message: "Choose the label and value columns for this chart.",
        });
    });
  });
export const dashboardSaveInputSchema = z
  .strictObject({
    id: sessionIdSchema.optional(),
    revision: z.number().int().nonnegative().optional(),
    name: z.string().trim().min(1).max(80),
    definition: dashboardDefinitionSchema,
  })
  .superRefine((value, context) => {
    if ((value.id === undefined) !== (value.revision === undefined))
      context.addIssue({
        code: "custom",
        path: ["revision"],
        message: "Include the saved revision when updating a dashboard.",
      });
  });
export const dashboardIdInputSchema = z.strictObject({ id: sessionIdSchema });
export const dashboardProfileSchema = z.strictObject({
  id: sessionIdSchema,
  organization_id: identityIdSchema,
  user_id: identityIdSchema,
  name: z.string(),
  definition: dashboardDefinitionSchema,
  revision: z.number().int().nonnegative(),
  updated_at: utcDateTimeSchema,
});
export const dashboardListOutputSchema = z.strictObject({
  items: z.array(dashboardProfileSchema).max(20),
  definition_schema: jsonValueSchema,
});
export const dashboardDeleteOutputSchema = z.strictObject({
  deleted: z.boolean(),
});
export type DashboardDefinition = z.infer<typeof dashboardDefinitionSchema>;
