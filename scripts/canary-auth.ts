import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { startMailpit } from "../apps/api/test/mailpit.js";

/** Verify a local canary identity through real native HTTP and captured SMTP. */
export async function verifyCanaryEmail(
  origin: string,
  email: string,
  mail: Pick<Awaited<ReturnType<typeof startMailpit>>, "messages">,
) {
  const response = await fetch(`${origin}/auth/send-verification-email`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, callbackURL: `${origin}/app` }),
  });
  assert.equal(
    response.status,
    200,
    "Native verification mail request failed.",
  );
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const message = (await mail.messages(email)).find(
      (item) => item.Subject === "Verify your AgentCommons email",
    );
    if (message) {
      const url = new URL(
        z.url().parse(message.Text.match(/https?:\/\/\S+/)?.[0]),
      );
      assert.equal(url.origin, origin);
      assert.equal(url.pathname, "/auth/verify-email");
      const verified = await fetch(url, { redirect: "manual" });
      assert.equal(verified.status, 302, "Native email verification failed.");
      return;
    }
    await delay(100);
  }
  throw new Error(
    "Native verification email did not reach the local SMTP sink.",
  );
}
