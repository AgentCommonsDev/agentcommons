import { setTimeout } from "node:timers/promises";
import { sessionEventSchema, sessionIdSchema } from "@agentcommons/core";
import type { ReaderPools } from "@agentcommons/db";
import type { AuthService } from "./auth.js";
import type { AuditService } from "./audit.js";
import { readOperation } from "./read-operation.js";
import {
  requirePermission,
  ServiceError,
  type ServiceContext,
} from "./context.js";
import { visibleSession } from "../repositories/read-model.js";
import { wireRow } from "./read-budget.js";

export class SessionEventsService {
  constructor(
    private readonly dependencies: {
      readers: ReaderPools;
      auth: AuthService;
      audit: AuditService;
      intervalMs?: number;
    },
  ) {}
  open(context: ServiceContext, id: string) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "sessions.events", resourceType: "session", resourceIds: [id] },
      async (caller) => {
        const sessionId = sessionIdSchema.parse(id);
        const snapshot = async (current: ServiceContext) =>
          this.dependencies.readers.read(
            requirePermission(current, "read"),
            async (client) => {
              const row = wireRow(await visibleSession(client, sessionId));
              return sessionEventSchema.parse({
                session_id: row.session_id,
                status: row.status,
                message_count: row.message_count,
                last_received_at: row.last_activity_at,
              });
            },
          );
        const initial = await snapshot(context);
        const dependencies = this.dependencies;
        async function* changes(signal: AbortSignal) {
          let previous = JSON.stringify(initial);
          yield initial;
          while (!signal.aborted) {
            try {
              await setTimeout(dependencies.intervalMs ?? 5000, undefined, {
                signal,
              });
            } catch (error) {
              if (error instanceof Error && error.name === "AbortError") return;
              throw error;
            }
            const identity = await dependencies.auth.authenticate(
              context.headers,
              context,
            );
            if (identity.caller?.organizationId !== caller.organizationId)
              throw new ServiceError(
                403,
                "ORGANIZATION_CHANGED",
                "The active organization changed.",
              );
            const current = await snapshot({
              ...context,
              caller: identity.caller,
            });
            const serialized = JSON.stringify(current);
            if (serialized !== previous) {
              previous = serialized;
              yield current;
            }
          }
        }
        return { changes };
      },
      () => ({ session_id: id }),
    );
  }
}
