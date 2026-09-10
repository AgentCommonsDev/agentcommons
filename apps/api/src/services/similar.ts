import { embeddingsDisabledMessage } from "../embeddings/settings.js";
import { traceViewCatalog } from "@agentcommons/core/sql";
import { sqlIdentifier } from "@agentcommons/traces";
import { ServiceError } from "./context.js";
import {
  similarInputSchema,
  similarOutputSchema,
  sessionIdSchema,
} from "@agentcommons/core";
import { sessionHeaders, visibleSession } from "../repositories/read-model.js";
import type { QueryService } from "./query.js";
import { readOperation, type ReadDependencies } from "./read-operation.js";
import type { ServiceContext } from "./context.js";
/** Every `sessions` column, as the shared catalog documents the view. */
const sessionColumns = Object.keys(traceViewCatalog.sessions.columns);
export class SimilarService {
  constructor(
    private readonly dependencies: ReadDependencies,
    private readonly query: Pick<QueryService, "embeddingsEnabled">,
  ) {}
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
        const availability = await this.query.embeddingsEnabled(caller);
        if (!availability.enabled)
          throw new ServiceError(
            404,
            "EMBEDDINGS_DISABLED",
            embeddingsDisabledMessage("Similar sessions", availability),
          );
        sessionIdSchema.parse(id);
        const request = similarInputSchema.parse(input);
        return this.dependencies.readers.read(caller, async (client) => {
          await visibleSession(client, id);
          const rows = await client.query(
            `SELECT ${sessionColumns.map((name) => `s.${sqlIdentifier(name)} AS ${sqlIdentifier(name)}`).join(",")} FROM api_ro.similar_sessions(source={source:UUID},max_rows={max_rows:UInt32}) nearest JOIN api_ro.sessions s USING(session_id) ORDER BY nearest.distance,nearest.session_id`,
            { source: id, max_rows: request.max_rows },
          );
          const sessions = await sessionHeaders(client, caller, rows.rows);
          return similarOutputSchema.parse({ sessions });
        });
      },
    );
  }
}
