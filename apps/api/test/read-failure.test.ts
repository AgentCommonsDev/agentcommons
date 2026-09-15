import { describe, expect, it } from "vitest";
import { traceReadFailure } from "../src/repositories/read-failure.js";

// @req R-GET-07
describe("traceReadFailure maps control connection drops to a retryable 503", () => {
  it("classifies a dropped control connection as READ_BUSY, not an unexpected 500", () => {
    for (const message of [
      "Connection terminated unexpectedly",
      "Connection terminated due to connection timeout",
      "server has closed the connection",
      "read ECONNRESET",
      "socket hang up",
    ]) {
      const failure = traceReadFailure(new Error(message));
      expect(failure?.statusCode, message).toBe(503);
      expect(failure?.code, message).toBe("READ_BUSY");
      expect(failure?.detail, message).toMatchObject({ retry_after: 5 });
    }
  });
  it("leaves an unrelated error unclassified so a real bug stays a 500", () => {
    expect(
      traceReadFailure(new Error("cannot read properties of undefined")),
    ).toBeNull();
  });
});
