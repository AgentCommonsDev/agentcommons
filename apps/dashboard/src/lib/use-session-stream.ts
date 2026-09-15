import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { sessionEventSchema } from "@agentcommons/core/schemas/get";
import type { paths } from "./api/generated";
import { registerStream } from "./streams";

const endpoint = "/api/v1/sessions/{id}/events" satisfies keyof paths;
/** One `session` event: the status and message count the server saw at that tick. */
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export function useSessionStream(
  organizationId: string,
  sessionId: string,
  active: boolean,
  setConnected: (connected: boolean) => void,
  onEvent: (event: SessionEvent) => void,
): void {
  const client = useQueryClient();
  // The session tree (subagent hierarchy) changes rarely, so the heavy tree query is
  // refreshed at most this often rather than on every event; the transcript still updates
  // live. This keeps a rapidly reconnecting or very active stream from refetching the tree
  // on every event.
  const lastTreeRefresh = useRef(0);
  useEffect(() => {
    if (!active) return;
    const stream = new EventSource(
      endpoint.replace("{id}", encodeURIComponent(sessionId)),
      { withCredentials: true },
    );
    const dispose = registerStream(stream);
    stream.onopen = () => {
      setConnected(true);
    };
    stream.onerror = () => {
      setConnected(false);
    };
    stream.addEventListener("session", (event: MessageEvent<string>) => {
      try {
        const data = sessionEventSchema.parse(JSON.parse(event.data));
        if (data.session_id !== sessionId) return;
        onEvent(data);
        const keys = ["session", "raw"];
        if (Date.now() - lastTreeRefresh.current >= 30_000) {
          lastTreeRefresh.current = Date.now();
          keys.push("tree");
        }
        void Promise.all(
          keys.map((key) =>
            client.invalidateQueries({
              queryKey: [organizationId, key, sessionId],
            }),
          ),
        );
      } catch {
        setConnected(false);
        dispose();
      }
    });
    return () => {
      dispose();
      setConnected(false);
    };
  }, [active, organizationId, sessionId, client, setConnected, onEvent]);
}
