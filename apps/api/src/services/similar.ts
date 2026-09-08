import { organizationEmbeddingSetting } from "../embeddings/settings.js";
import { canonicalSessionColumns, sqlIdentifier } from "@agentcommons/traces";
import { ServiceError } from "./context.js";
import {
  similarInputSchema,
  similarOutputSchema,
  sessionIdSchema,
} from "@agentcommons/core";
import { sessionHeaders, visibleSession } from "../repositories/read-model.js";
import { readOperation, type ReadDependencies } from "./read-operation.js";
import type { ServiceContext } from "./context.js";
export class SimilarService {
  constructor(private readonly dependencies: ReadDependencies) {}
  execute(context: ServiceContext, id: string, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "sessions.similar",
        resourceType: "session",
        resourceIds: [id],
        detail: input,
      },
      async (caller) => {
        if (
          !(
            await organizationEmbeddingSetting(
              this.dependencies.prisma,
              caller.organizationId,
              false,
              Boolean(this.dependencies.saas),
            )
          ).enabled
        )
          throw new ServiceError(
            404,
            "EMBEDDINGS_DISABLED",
            "Similar sessions are disabled for this organization.",
          );
        sessionIdSchema.parse(id);
        const request = similarInputSchema.parse(input);
        return this.dependencies.readers.read(caller, async (client) => {
          await visibleSession(client, id);
          const rows = await client.query(
            `SELECT ${canonicalSessionColumns.map((name) => `s.${sqlIdentifier(name)} AS ${sqlIdentifier(name)}`).join(",")} FROM api_ro.similar_sessions(source={source:UUID},max_rows={max_rows:UInt32}) nearest JOIN api_ro.sessions s USING(session_id) ORDER BY nearest.distance,nearest.session_id`,
            { source: id, max_rows: request.max_rows },
          );
          const sessions = await sessionHeaders(client, rows.rows);
          return similarOutputSchema.parse({ sessions });
        });
      },
    );
  }
}
