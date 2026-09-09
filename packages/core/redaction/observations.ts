import { z } from "zod";
import { observedCommitSchema } from "../schemas/ingest.js";
import { normalizerContextSchema } from "../schemas/common.js";
import {
  ingestContextSchema,
  parentHintSchema,
} from "../schemas/ingest-context.js";
import {
  protocolArray,
  protocolLiterals,
  protocolObject,
  protocolTimestamp,
} from "./structure.js";
import type { Redactor, RedactionResult } from "./index.js";

export const gitContextStructure = protocolObject([
  "root",
  "remoteUrl",
  "branch",
  "head",
]);
export const parentHintStructure = protocolObject(
  Object.keys(parentHintSchema.shape),
  { relation: protocolLiterals(...parentHintSchema.shape.relation.options) },
);
/**
 * The upload context minus its normalizer fields (`activeLeafId`, `transcriptMetadata`),
 * which `redactNormalizerContext` redacts with identity canonicalization.
 */
export const ingestContextStructure = protocolObject(
  Object.keys(ingestContextSchema.shape).filter(
    (key) => !(key in normalizerContextSchema.shape),
  ),
  {
    installation: protocolObject(
      Object.keys(ingestContextSchema.shape.installation.shape),
    ),
    git: gitContextStructure,
    parentHint: parentHintStructure,
  },
);
export const observedCommitStructure = protocolObject(
  ["sha", "subject", "author"],
  { timestamp: protocolTimestamp },
);
export const endObservationStructure = protocolObject(
  ["reason", "head", "observedDiffStat", "dirtyFileCount"],
  { observedCommits: protocolArray(observedCommitStructure) },
);
export async function redactObservedCommits(
  input: unknown,
  redactor: Redactor,
): Promise<RedactionResult<z.infer<typeof observedCommitSchema>[]>> {
  const result = await redactor.json(
    z.array(observedCommitSchema).parse(input),
    protocolArray(observedCommitStructure),
  );
  return {
    ...result,
    value: z.array(observedCommitSchema).parse(result.value),
  };
}
