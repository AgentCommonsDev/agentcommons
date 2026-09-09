import * as z from "zod";
import {
  nullableTextSchema,
  normalizerContextSchema,
  parentRelationSchema,
} from "./common.js";

export const gitContextSchema = z.strictObject({
  root: z.string(),
  remoteUrl: nullableTextSchema,
  branch: nullableTextSchema,
  head: nullableTextSchema,
});
/** A fork is recorded by the child's own transcript, so the shim never hints one. */
export const parentHintSchema = z.strictObject({
  harnessSessionId: z.string().min(1),
  relation: parentRelationSchema.exclude(["FORK"]),
  agentId: z.string().optional(),
  agentType: z.string().optional(),
});
export type ParentHint = z.infer<typeof parentHintSchema>;
export const ingestContextSchema = z.strictObject({
  cwd: z.string().min(1),
  installation: z.strictObject({
    hostname: z.string().min(1),
    osUser: z.string(),
    platform: z.string().min(1),
    arch: z.string().min(1),
  }),
  ...normalizerContextSchema.shape,
  git: gitContextSchema.nullable(),
  parentHint: parentHintSchema.nullable(),
});
