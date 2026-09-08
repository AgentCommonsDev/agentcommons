import { z } from "zod";
import { observedCommitSchema } from "../schemas/ingest.js";
import {
  protocolArray,
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
