import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { sessionEventSchema } from "@agentcommons/core/schemas/get";
import type { paths } from "./api/generated";
import { registerStream } from "./streams";

const endpoint = "/api/v1/sessions/{id}/events" satisfies keyof paths;
export function useSessionStream(
  organizationId: string,
  sessionId: string,
  active: boolean,
  setConnected: (connected: boolean) => void,
  setLatestSequence: (sequence: number) => void,
): void {
  const client = useQueryClient();
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
        setLatestSequence(Math.max(0, data.message_count - 1));
        void Promise.all(
          ["session", "raw", "tree"].map((key) =>
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
  }, [
    active,
    organizationId,
    sessionId,
    client,
    setConnected,
    setLatestSequence,
  ]);
}
