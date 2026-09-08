import {
  normalizerContextSchema,
  type NormalizerContext,
} from "../schemas/common.js";
import { canonicalIdentity } from "./tool-results.js";
import { protocolObject, protocolTimestamp } from "./structure.js";
import type { Redactor, RedactionResult } from "./index.js";

export const normalizerContextStructure = protocolObject(["activeLeafId"], {
  transcriptMetadata: protocolObject(["sessionId", "sourceRecordCount"], {
    startTime: protocolTimestamp,
  }),
});
export async function redactNormalizerContext(
  context: NormalizerContext,
  redactor: Redactor,
): Promise<RedactionResult<NormalizerContext>> {
  const result = await redactor.json(context, normalizerContextStructure);
  const value = normalizerContextSchema.parse(result.value);
  if (context.activeLeafId) {
    const identity = await canonicalIdentity(context.activeLeafId, redactor);
    value.activeLeafId = identity.value;
    result.counts.push(...identity.counts);
  }
  const sessionId = context.transcriptMetadata?.sessionId;
  if (typeof sessionId === "string" && value.transcriptMetadata) {
    const identity = await canonicalIdentity(sessionId, redactor);
    value.transcriptMetadata.sessionId = identity.value;
    result.counts.push(...identity.counts);
  }
  return { value, counts: result.counts };
}
