import * as z from "zod";
import { nullableTextSchema, normalizerContextSchema } from "./common.js";

export const gitContextSchema = z.strictObject({
  root: z.string(),
  remoteUrl: nullableTextSchema,
  branch: nullableTextSchema,
  head: nullableTextSchema,
});
export const parentHintSchema = z.strictObject({
  harnessSessionId: z.string().min(1),
  relation: z.enum(["SUBAGENT", "SPAWNED"]),
  agentId: z.string().optional(),
  agentType: z.string().optional(),
});
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
