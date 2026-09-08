import {
  similarInputSchema,
  similarOutputSchema,
  sessionIdSchema,
} from "@agentcommons/core";
import { sessionHeader, visibleSession } from "../repositories/read-model.js";
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
        sessionIdSchema.parse(id);
        const request = similarInputSchema.parse(input);
        return this.dependencies.readers.read(caller, async (client) => {
          await visibleSession(client, id);
          const rows = await client.query<Record<string, unknown>>(
            "SELECT s.* FROM api_ro.similar_sessions($1::uuid,$2::integer) WITH ORDINALITY nearest(session_id,ordinal) JOIN api_ro.sessions s USING(session_id) ORDER BY nearest.ordinal",
            [id, request.max_rows],
          );
          const sessions = [];
          for (const row of rows.rows)
            sessions.push(await sessionHeader(client, row));
          return similarOutputSchema.parse({ sessions });
        });
      },
    );
  }
}
