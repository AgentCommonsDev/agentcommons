import { expect, it, vi } from "vitest";
import { environment } from "../src/env.js";

const base = {
  PUBLIC_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "server-environment-test-secret-at-least-32-characters",
  DATABASE_URL: "postgresql://app:fixture@localhost/database",
  CLICKHOUSE_URL: "http://localhost:8123",
  CLICKHOUSE_WRITER_USER: "writer",
  CLICKHOUSE_WRITER_PASSWORD: "fixture-writer",
  CLICKHOUSE_ACCESS_USER: "access",
  CLICKHOUSE_ACCESS_PASSWORD: "fixture-access",
  CLICKHOUSE_READER_SECRET: "fixture-readers-at-least-thirty-two-characters",
};

// @req R-INF-10
it("reports the release baked into the image and the host's update setting, defaulting to a development build that updates", () => {
  expect(environment(base).server).toEqual({
    version: "development",
    autoUpdate: true,
    updateStateFile: "/var/lib/agentcommons/update-state",
  });
  expect(
    environment({
      ...base,
      AGENTCOMMONS_VERSION: "0123456789ab",
      AUTO_UPDATE: "false",
      UPDATE_STATE_FILE: "/mnt/updater/update-state",
    }).server,
  ).toEqual({
    version: "0123456789ab",
    autoUpdate: false,
    updateStateFile: "/mnt/updater/update-state",
  });
  // An empty value from a rendered .env means "unset", not an empty version.
  expect(
    environment({ ...base, AGENTCOMMONS_VERSION: "" }).server.version,
  ).toBe("development");
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(() => environment({ ...base, AUTO_UPDATE: "yes" })).toThrow();
  } finally {
    log.mockRestore();
  }
});
