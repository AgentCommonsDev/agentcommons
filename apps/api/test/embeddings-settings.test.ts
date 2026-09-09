import { describe, expect, it } from "vitest";
import {
  embeddingAvailability,
  embeddingsDisabledMessage,
  embeddingsUnavailable,
} from "../src/embeddings/settings.js";
import type { Prisma } from "@agentcommons/db";

// @req R-EMB-06
describe("embedding availability messages", () => {
  it("names the capability, the closed gate and who can open it, in gate order", () => {
    const open = {
      available: true,
      requested: true,
      entitled: true,
      enabled: true,
    };
    expect(
      embeddingsDisabledMessage("similar_sessions", {
        ...open,
        available: false,
        enabled: false,
      }),
    ).toBe(
      "similar_sessions needs embeddings, and this instance has no embedding provider configured. The instance operator has to configure one.",
    );
    // A SaaS organization that stored the opt-in but has no paid embeddings sees the plan,
    // not its own setting, because flipping the setting cannot help.
    expect(
      embeddingsDisabledMessage("Similar sessions", {
        ...open,
        entitled: false,
        enabled: false,
      }),
    ).toBe(
      "Similar sessions needs embeddings, which are part of the Pro with embeddings plan. An organization owner can change the plan under Billing.",
    );
    expect(
      embeddingsDisabledMessage("cosineDistance", {
        ...open,
        requested: false,
        enabled: false,
      }),
    ).toBe(
      "cosineDistance needs embeddings, which are turned off for this organization. An organization admin can turn them on under Settings.",
    );
  });

  it("never reads the organization setting when the operator flag is off", async () => {
    const tx = {
      organizationSettings: {
        findUnique: () => {
          throw new Error("The setting must not be read without a provider.");
        },
      },
    } as unknown as Prisma.TransactionClient;
    expect(await embeddingAvailability(tx, "org", false, true)).toEqual(
      embeddingsUnavailable,
    );
  });
});
