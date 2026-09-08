import { expect, type APIRequestContext } from "@playwright/test";

/** A 202 acknowledges durable receipt; the actual worker publishes the read model later. */
export async function waitForSession(
  request: APIRequestContext,
  sessionId: string,
  apiKey: string,
) {
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/sessions/${sessionId}`, {
          headers: { authorization: `Bearer ${apiKey}` },
        });
        expect([200, 404], await response.text()).toContain(response.status());
        return response.status();
      },
      { timeout: 30_000 },
    )
    .toBe(200);
}
