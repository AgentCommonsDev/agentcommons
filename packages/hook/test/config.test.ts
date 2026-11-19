import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configSchema } from "../src/config.js";
import { configure } from "../src/install.js";

const valid = {
  key: "test",
  installationId: "019939c0-0000-7000-8000-000000000001",
  node: "/usr/bin/node",
};
const accepts = (server: string) =>
  configSchema.safeParse({ ...valid, server }).success;

describe("the configured server", () => {
  // @req R-INST-09
  it("is HTTPS, or plain HTTP only to this machine", () => {
    for (const server of [
      "https://agentcommons.example.test",
      "https://203.0.113.7:8443",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://127.1.2.3",
      "http://[::1]:3000",
    ])
      expect(accepts(server), server).toBe(true);
    for (const server of [
      "http://agentcommons.example.test",
      "http://203.0.113.7",
      "http://10.0.0.5:3000",
      "http://localhost.example.test",
      "http://127.0.0.1.nip.io",
      "https://user:secret@agentcommons.example.test",
      "ftp://agentcommons.example.test",
    ])
      expect(accepts(server), server).toBe(false);
  });
  // @req R-INST-09
  it("is checked when the installer writes the configuration, so a plain-HTTP install fails before anything is wired", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentcommons-config-"));
    expect(() =>
      configure(directory, {
        server: "http://agentcommons.example.test",
        key: "test",
      }),
    ).toThrow("plain HTTP is accepted only for localhost");
  });
});
