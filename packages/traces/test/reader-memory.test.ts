// @req R-INF-17
import { describe, expect, it } from "vitest";
import { readerSettings } from "../src/client.js";
import { clickHouseEnvironment } from "../src/config.js";

const environment = {
  CLICKHOUSE_URL: "http://clickhouse:8123",
  CLICKHOUSE_WRITER_USER: "ac_trace_writer",
  CLICKHOUSE_WRITER_PASSWORD: "writer-password",
  CLICKHOUSE_READER_SECRET: "reader-secret-long-enough-for-the-schema",
  CLICKHOUSE_ACCESS_USER: "ac_trace_access",
  CLICKHOUSE_ACCESS_PASSWORD: "access-password",
};
describe("reader memory", () => {
  it("defaults to 256 MiB and follows CLICKHOUSE_READER_MEMORY_MB within its bounds", () => {
    expect(clickHouseEnvironment(environment).readerMemoryMb).toBe(256);
    expect(
      clickHouseEnvironment({
        ...environment,
        CLICKHOUSE_READER_MEMORY_MB: "1024",
      }).readerMemoryMb,
    ).toBe(1024);
    for (const invalid of ["32", "70000", "1.5", "lots"])
      expect(() =>
        clickHouseEnvironment({
          ...environment,
          CLICKHOUSE_READER_MEMORY_MB: invalid,
        }),
      ).toThrow();
  });
  it("renders the configured memory into every reader principal's settings", () => {
    expect(readerSettings(256)).toContain("max_memory_usage=268435456,");
    expect(readerSettings(1024)).toContain("max_memory_usage=1073741824,");
    // The rest of the profile does not depend on the memory setting.
    expect(readerSettings(1024).replace("1073741824", "268435456")).toBe(
      readerSettings(256),
    );
    expect(readerSettings(256)).toContain("max_execution_time=5,");
  });
});
