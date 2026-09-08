import { randomBytes } from "node:crypto";
import { test as base } from "@playwright/test";

// Independent browser tests represent distinct clients behind the fixture's
// trusted loopback proxy. Keep the real per-client authentication rate limit.
export const test = base.extend({
  context: async ({ context }, use) => {
    const identity = randomBytes(12);
    const suffix = Array.from({ length: 6 }, (_, index) =>
      identity.readUInt16BE(index * 2).toString(16),
    ).join(":");
    await context.setExtraHTTPHeaders({
      "x-forwarded-for": `2001:db8:${suffix}`,
    });
    await use(context);
  },
});
