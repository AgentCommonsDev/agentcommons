import { sign } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HookManifest } from "@agentcommons/core/schemas/ingest";
import { hash, writeAtomic } from "../src/files.js";
import { configure } from "../src/install.js";
import { selfUpdate } from "../src/update.js";

/** The release signer the bundle under test pins (ADR 0102). */
const releaseKey = await vi.hoisted(async () =>
  (await import("node:crypto")).generateKeyPairSync("ed25519"),
);
vi.mock("../src/release-keys.js", () => ({
  RELEASE_KEYS: [
    releaseKey.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
  ],
}));

/** `writeFileSync` fails with ENOSPC while `disk.full` is set; every other fs call is real. */
const disk = vi.hoisted(() => ({ full: false, onlyStaged: false }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  const writeFileSync: typeof actual.writeFileSync = (...args) => {
    const staged =
      typeof args[0] === "string" && /\.update\.(js|mjs)$/.test(args[0]);
    if (disk.full && (!disk.onlyStaged || staged)) {
      // The file exists (open succeeded); the bytes never land.
      if (typeof args[0] === "string") actual.writeFileSync(args[0], "");
      throw Object.assign(new Error("ENOSPC: no space left on device, write"), {
        code: "ENOSPC",
      });
    }
    actual.writeFileSync(...args);
  };
  return { ...actual, writeFileSync };
});

const OLD_BUNDLE = "process.stdout.write('old bundle');\n";
const NEW_BUNDLE = `const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
if (process.argv[2] === "version")
  process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));
`;
const leftovers = (directory: string): string[] =>
  readdirSync(directory).filter((name) =>
    /\.claim$|\.tmp$|\.update\.(js|mjs)$/.test(name),
  );

describe("full disk", () => {
  afterEach(() => {
    disk.full = false;
    disk.onlyStaged = false;
  });
  // @req R-CAP-22
  it("an exclusive publish whose write fails leaves no claim file behind", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentcommons-enospc-"));
    writeAtomic(join(directory, "state.json"), { v: 1 });
    disk.full = true;
    expect(() => {
      writeAtomic(join(directory, "state.json"), { v: 2 });
    }).toThrow(/ENOSPC/);
    disk.full = false;
    expect(leftovers(directory)).toEqual([]);
    // The previous content is intact: the replacement never reached the rename.
    expect(
      JSON.parse(readFileSync(join(directory, "state.json"), "utf8")),
    ).toEqual({ v: 1 });
  });
  // @req R-CAP-16 @req R-CAP-22
  it("a staged artifact whose write fails is removed, the installed bundle stays and the failure is logged", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentcommons-enospc-"));
    const executable = join(directory, "hook.js");
    writeFileSync(executable, OLD_BUNDLE, { mode: 0o600 });
    writeFileSync(
      join(directory, "pi-extension.mjs"),
      "export const marker = 'old';\n",
    );
    const config = configure(directory, {
      server: "http://127.0.0.1:3000",
      key: "test",
    });
    const manifest: HookManifest = {
      version: "0.1.0-enospc",
      sha256: hash(NEW_BUNDLE),
      url: "/hook/0.1.0-enospc/hook.js",
      extensionSha256: hash("export const marker = 'old';\n"),
      extensionUrl: "/hook/0.1.0-enospc/pi-extension.mjs",
      builtAt: "2026-10-29T00:00:00.000Z",
    };
    const manifestText = JSON.stringify(manifest);
    const signatureFile = JSON.stringify({
      signatures: [
        sign(null, Buffer.from(manifestText), releaseKey.privateKey).toString(
          "base64",
        ),
      ],
    });
    const fetcher: typeof fetch = (input) => {
      const url =
        input instanceof URL
          ? input.href
          : typeof input === "string"
            ? input
            : input.url;
      return Promise.resolve(
        new Response(
          url.endsWith("manifest.json")
            ? manifestText
            : url.endsWith("manifest.json.sig")
              ? signatureFile
              : NEW_BUNDLE,
        ),
      );
    };
    disk.full = true;
    disk.onlyStaged = true;
    expect(
      await selfUpdate(directory, executable, config, { fetch: fetcher }),
    ).toBe("skipped");
    disk.full = false;
    expect(readFileSync(executable, "utf8")).toBe(OLD_BUNDLE);
    expect(leftovers(directory)).toEqual([]);
    expect(readFileSync(join(directory, "hook.log"), "utf8")).toContain(
      "Hook update skipped: ENOSPC",
    );
    // Space is back: the next check (an hour later) completes the swap.
    writeFileSync(
      join(directory, "update.json"),
      JSON.stringify({ checkedAt: 0 }),
    );
    expect(
      await selfUpdate(directory, executable, config, { fetch: fetcher }),
    ).toBe("updated");
    expect(readFileSync(executable, "utf8")).toBe(NEW_BUNDLE);
    expect(existsSync(join(directory, "update.lock"))).toBe(false);
  });
});
