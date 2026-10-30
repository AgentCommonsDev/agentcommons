import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ingestEnvelopeSchema,
  type HookManifest,
} from "@agentcommons/core/schemas/ingest";
import { loadConfig } from "../src/config.js";
import { hash } from "../src/files.js";
import { recordHook } from "../src/hook.js";
import { configure } from "../src/install.js";
import { loadState, statePath } from "../src/state.js";
import { recordConfigured, selfUpdate } from "../src/update.js";
import { upload } from "../src/upload.js";

/** The release signer these tests stand in for; the bundle under test pins its public key. */
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
/** A key the bundle does not pin: what a server, a registry token or a network path could sign with. */
const strangerKey = generateKeyPairSync("ed25519");
const signatureFile = (text: string, key = releaseKey): string =>
  JSON.stringify({
    signatures: [
      sign(null, Buffer.from(text), key.privateKey).toString("base64"),
    ],
  });

const OLD_BUNDLE = "process.stdout.write('old bundle');\n";
const OLD_EXTENSION = "export const marker = 'old';\n";
/** A CommonJS bundle that passes the self-test: `version` prints its own digest. */
const NEW_BUNDLE = `const { createHash } = require("node:crypto");
const { readFileSync, appendFileSync } = require("node:fs");
if (process.argv[2] === "version")
  process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));
if (process.argv[2] === "install")
  appendFileSync(process.env.AGENTCOMMONS_DIR + "/install-runs.log", process.argv.slice(3).join(" ") + "\\n");
`;
const NEW_EXTENSION = "export const marker = 'new';\n";
const BROKEN_BUNDLE = "process.exit(1);\n";
/** Every signed release carries a build stamp (ADR 0102); tests of age override it. */
const RELEASED_AT = "2026-10-29T00:00:00.000Z";

/**
 * How the fixture server signs the manifest it serves: with the pinned release key (a real
 * release), with a key the bundle does not pin, not at all (no signature file), or with a
 * release signature over other bytes than the ones served.
 */
type Signing = "release" | "stranger" | "absent" | "other-bytes";

function fixture(
  overrides: Partial<HookManifest> = {},
  bundle = NEW_BUNDLE,
  signing: Signing = "release",
) {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-update-"));
  const executable = join(directory, "hook.js");
  writeFileSync(executable, OLD_BUNDLE, { mode: 0o600 });
  writeFileSync(join(directory, "pi-extension.mjs"), OLD_EXTENSION, {
    mode: 0o600,
  });
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const fakeCli = (name: string) => {
    writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  };
  fakeCli("claude");
  vi.stubEnv("PATH", bin);
  const configHome = join(directory, "home");
  mkdirSync(configHome);
  const config = configure(directory, {
    server: "http://127.0.0.1:3000",
    key: "test",
    organizationId: "019939c0-0000-7000-8000-000000000001",
    credentialHash: hash("test"),
    // Reconcile re-runs install with the flags the installer recorded.
    installOptions: { configHome },
  });
  // As after `hook.js install`: the wiring record names the installed (old) bundle.
  recordConfigured(directory, executable, ["claude"]);
  const transcript = join(directory, "transcript.jsonl");
  writeFileSync(transcript, '{"uuid":"one"}\n');
  const manifest: HookManifest = {
    version: "0.1.0-test",
    sha256: hash(bundle),
    url: "/hook/0.1.0-test/hook.js",
    extensionSha256: hash(NEW_EXTENSION),
    extensionUrl: "/hook/0.1.0-test/pi-extension.mjs",
    builtAt: RELEASED_AT,
    ...overrides,
  };
  // Served byte for byte as signed: the signature covers the exact text.
  const manifestText = JSON.stringify(manifest);
  const signature: string | null = {
    release: signatureFile(manifestText),
    stranger: signatureFile(manifestText, strangerKey),
    absent: null,
    "other-bytes": signatureFile(`${manifestText} `),
  }[signing];
  const requests: string[] = [];
  const uploaded: string[] = [];
  /** What the server answers an ingest POST with; a 5xx keeps the batch pending. */
  let ingestStatus = 202;
  const fetcher: typeof fetch = (input, options) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    requests.push(`${options?.method ?? "GET"} ${url.pathname}`);
    if (options?.method === "POST") {
      const body = ingestEnvelopeSchema.parse(
        JSON.parse(
          typeof options.body === "string" ? options.body : "null",
        ) as unknown,
      );
      uploaded.push(body.hook.sha256);
      return Promise.resolve(new Response(null, { status: ingestStatus }));
    }
    if (url.pathname === "/hook/manifest.json")
      return Promise.resolve(new Response(manifestText));
    if (url.pathname === "/hook/manifest.json.sig")
      return Promise.resolve(
        signature === null
          ? new Response(null, { status: 404 })
          : new Response(signature),
      );
    if (url.pathname === "/hook/0.1.0-test/hook.js")
      return Promise.resolve(new Response(bundle));
    if (url.pathname === "/hook/0.1.0-test/pi-extension.mjs")
      return Promise.resolve(new Response(NEW_EXTENSION));
    return Promise.resolve(
      Response.json({ organization: { id: config.organizationId } }),
    );
  };
  /** One hook event of a fresh session (or of `session`) followed by its uploader run. */
  const run = async (
    options: Partial<Parameters<typeof upload>[4]> = {},
    session = randomUUID(),
    effective: typeof config = config,
  ): Promise<string> => {
    const path = recordHook(directory, executable, effective, "claude", {
      session_id: session,
      transcript_path: transcript,
      cwd: directory,
      hook_event_name: "Stop",
    });
    if (!path) throw new Error("Missing state.");
    await upload(directory, executable, path, effective, {
      fetch: fetcher,
      sweep: false,
      ...options,
    });
    return path;
  };
  const log = () => {
    const path = join(directory, "hook.log");
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  };
  const installRuns = () => {
    const path = join(directory, "install-runs.log");
    return existsSync(path)
      ? readFileSync(path, "utf8").trim().split("\n")
      : [];
  };
  return {
    directory,
    executable,
    config,
    configHome,
    fakeCli,
    manifest,
    requests,
    uploaded,
    run,
    fetcher,
    log,
    installRuns,
    setIngestStatus: (status: number) => {
      ingestStatus = status;
    },
  };
}
/** Every regular file under `directory` except the ones named, with its bytes. */
function filesUnder(directory: string, except: readonly string[]) {
  const files = new Map<string, string>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (!except.includes(relative(directory, path)))
        files.set(relative(directory, path), readFileSync(path, "utf8"));
    }
  };
  walk(directory);
  return files;
}

describe("hook self-update", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  // @req R-CAP-16 @req R-ING-16
  it("reports the installed digests, replaces a differing bundle and extension atomically after verifying them, and rechecks at most hourly", async () => {
    const f = fixture();
    await f.run();
    expect(f.uploaded).toEqual([hash(OLD_BUNDLE)]);
    expect(readFileSync(f.executable, "utf8")).toBe(NEW_BUNDLE);
    expect(readFileSync(join(f.directory, "pi-extension.mjs"), "utf8")).toBe(
      NEW_EXTENSION,
    );
    expect(f.log()).toContain("Updated to hook 0.1.0-test");
    expect(
      f.requests.filter((request) => request === "GET /hook/manifest.json"),
    ).toHaveLength(1);
    expect(f.requests).toContain("GET /hook/0.1.0-test/hook.js");
    expect(existsSync(join(f.directory, "update.lock"))).toBe(false);
    await f.run();
    // The next upload reports the new bundle and does not ask the server again within the hour.
    expect(f.uploaded.at(-1)).toBe(hash(NEW_BUNDLE));
    expect(
      f.requests.filter((request) => request === "GET /hook/manifest.json"),
    ).toHaveLength(1);
  });
  // @req R-CAP-16
  it("keeps the installed files when the artifact digest, the self-test or the origin fails", async () => {
    const tampered = fixture({ sha256: hash("something else") });
    await tampered.run();
    expect(readFileSync(tampered.executable, "utf8")).toBe(OLD_BUNDLE);
    expect(tampered.log()).toContain("does not match its digest");

    const broken = fixture({}, BROKEN_BUNDLE);
    await broken.run();
    expect(readFileSync(broken.executable, "utf8")).toBe(OLD_BUNDLE);
    expect(
      readFileSync(join(broken.directory, "pi-extension.mjs"), "utf8"),
    ).toBe(OLD_EXTENSION);
    expect(broken.log()).toContain("failed its self-test");

    const foreign = fixture({ url: "https://elsewhere.example/hook.js" });
    await foreign.run();
    expect(readFileSync(foreign.executable, "utf8")).toBe(OLD_BUNDLE);
    expect(foreign.requests).not.toContain("GET /hook.js");
    expect(foreign.log()).toContain("outside the configured server");
    for (const f of [tampered, broken, foreign])
      expect(
        readFileSync(f.directory + "/hook.js", "utf8").length,
      ).toBeGreaterThan(0);
  });
  // @req R-CAP-16
  it("does nothing when the installed files already match the manifest", async () => {
    const f = fixture();
    writeFileSync(f.executable, NEW_BUNDLE);
    writeFileSync(join(f.directory, "pi-extension.mjs"), NEW_EXTENSION);
    await f.run();
    expect(f.requests).toContain("GET /hook/manifest.json");
    expect(f.requests).not.toContain("GET /hook/0.1.0-test/hook.js");
    expect(f.log()).not.toContain("Updated");
  });
  // @req R-CAP-29
  it("acts on a manifest only when a pinned release key signed its exact bytes, before any download, age check or self-test", async () => {
    for (const [signing, reason] of [
      ["absent", "The hook manifest signature returned HTTP 404."],
      ["stranger", "The hook manifest is not signed by a release key."],
      ["other-bytes", "The hook manifest is not signed by a release key."],
    ] as const) {
      // An older stamp too: an unsigned manifest must not even reach the age guard.
      const f = fixture(
        { builtAt: "2020-01-01T00:00:00.000Z" },
        NEW_BUNDLE,
        signing,
      );
      seedInstalled(f.directory, hash(OLD_BUNDLE), RELEASED_AT);
      expect(
        await selfUpdate(f.directory, f.executable, f.config, {
          fetch: f.fetcher,
        }),
        signing,
      ).toBe("skipped");
      expect(f.log(), signing).toContain(`Hook update skipped: ${reason}`);
      expect(f.log()).not.toContain("older hook build");
      expect(readFileSync(f.executable, "utf8")).toBe(OLD_BUNDLE);
      expect(readFileSync(join(f.directory, "pi-extension.mjs"), "utf8")).toBe(
        OLD_EXTENSION,
      );
      expect(f.requests).toEqual([
        "GET /hook/manifest.json",
        "GET /hook/manifest.json.sig",
      ]);
      expect(staged(f.directory)).toEqual([]);
    }
  });
  // @req R-CAP-29
  it("needs no signature when the served digests already name the installed files", async () => {
    const f = fixture(
      { sha256: hash(OLD_BUNDLE), extensionSha256: hash(OLD_EXTENSION) },
      NEW_BUNDLE,
      "absent",
    );
    expect(
      await selfUpdate(f.directory, f.executable, f.config, {
        fetch: f.fetcher,
      }),
    ).toBe("current");
    expect(f.requests).toEqual(["GET /hook/manifest.json"]);
    expect(f.log()).toBe("");
  });
  // @req R-CAP-17
  it("re-runs the bundle's install with the recorded flags after a swap and when a new harness appears, and converges hourly after a failure", async () => {
    const f = fixture();
    await f.run();
    // The swap ran the new bundle's install once with the recorded config home.
    expect(f.installRuns()).toEqual([`--config-home ${f.configHome}`]);
    expect(f.log()).toContain("Configured harnesses claude with bundle");
    await f.run();
    expect(f.installRuns(), "nothing changed").toHaveLength(1);
    // A supported CLI that the last install did not see is wired on the next run.
    f.fakeCli("gemini");
    await f.run();
    expect(f.installRuns()).toHaveLength(2);
    expect(f.log()).toContain(
      "Configured harnesses claude, gemini with bundle",
    );
    await f.run();
    expect(f.installRuns(), "steady state").toHaveLength(2);
  });
  // @req R-CAP-17 @req R-INST-10
  it("still reads a configuration an older installer recorded with the retired --no-shell-rc, and reconciles with the config home alone", async () => {
    const f = fixture();
    const path = join(f.directory, "config.json");
    const recorded = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    writeFileSync(
      path,
      JSON.stringify({
        ...recorded,
        installOptions: { configHome: f.configHome, noShellRc: true },
      }),
    );
    await f.run({}, randomUUID(), loadConfig(f.directory));
    expect(f.installRuns()).toEqual([`--config-home ${f.configHome}`]);
  });
  // @req R-CAP-17
  it("never runs install for a directory that hook.js install did not set up", async () => {
    const f = fixture();
    // No recorded install flags: the installer never ran here.
    await f.run({}, randomUUID(), { ...f.config, installOptions: undefined });
    expect(readFileSync(f.executable, "utf8")).toBe(NEW_BUNDLE);
    expect(f.installRuns()).toEqual([]);
    expect(f.log()).not.toContain("Configured harnesses");
  });
  // @req R-CAP-17
  it("rebuilds a missing wiring record when the install flags are recorded", async () => {
    const f = fixture();
    // The installed bundle is current and the hourly check is not due: only the record is
    // missing, as left behind by an older uploader whose strict read of update.json fell
    // back to `{ checkedAt }`. The flags in config.json prove the installer set this
    // directory up, so one install run rebuilds the record.
    writeFileSync(f.executable, NEW_BUNDLE);
    writeFileSync(join(f.directory, "pi-extension.mjs"), NEW_EXTENSION);
    writeFileSync(
      join(f.directory, "update.json"),
      JSON.stringify({ checkedAt: Date.now() }),
    );
    await f.run();
    expect(f.requests).not.toContain("GET /hook/manifest.json");
    expect(f.installRuns()).toEqual([`--config-home ${f.configHome}`]);
    expect(
      JSON.parse(readFileSync(join(f.directory, "update.json"), "utf8")),
    ).toMatchObject({
      configured: { sha256: hash(NEW_BUNDLE), harnesses: ["claude"] },
    });
    await f.run();
    expect(f.installRuns(), "recorded again, nothing to do").toHaveLength(1);
  });
  // @req R-CAP-16 @req R-CAP-22
  it("refuses a bundle that passes `version` but fails in hook mode, so a release that could never start its uploader again does not replace a working one", async () => {
    const crashy = `${NEW_BUNDLE}if (!["version", "install"].includes(process.argv[2])) { process.stderr.write("crashy"); process.exit(2); }\n`;
    const f = fixture({ sha256: hash(crashy) }, crashy);
    await f.run();
    expect(readFileSync(f.executable, "utf8")).toBe(OLD_BUNDLE);
    expect(f.log()).toContain(
      "failed its hook-mode self-test (exit 2: crashy)",
    );
    expect(
      readdirSync(f.directory).filter((name) => name.includes(".update.")),
    ).toEqual([]);
    // The probe must not have recorded anything for its synthetic session.
    expect(
      existsSync(statePath(f.directory, "claude", "agentcommons-self-test")),
    ).toBe(false);
  });
  // @req R-CAP-17
  it("logs a failed reconfiguration and retries it at most hourly", async () => {
    const failing = NEW_BUNDLE.replace(
      'if (process.argv[2] === "install")',
      'if (process.argv[2] === "install") process.exit(3);\nif (false)',
    );
    const f = fixture({ sha256: hash(failing) }, failing);
    await f.run();
    expect(readFileSync(f.executable, "utf8")).toBe(failing);
    expect(f.log()).toContain(
      "Harness configuration skipped: install exited with 3",
    );
    const attempts = () =>
      (f.log().match(/Harness configuration skipped/g) ?? []).length;
    expect(attempts()).toBe(1);
    await f.run();
    expect(attempts(), "throttled within the hour").toBe(1);
  });
  // @req R-CAP-16 @req R-CAP-05 @req R-CAP-21
  it("swaps the bundle around a pending batch without touching the spool, the pending batch or ackedCursor, which the next run then delivers", async () => {
    const f = fixture();
    const session = randomUUID();
    // The server is down: the batch stays pending and the cursor stays put. No update
    // check yet, so the swap below is the only change between the two runs.
    f.setIngestStatus(503);
    const path = await f.run(
      { sleep: () => Promise.resolve(), update: false },
      session,
    );
    const interrupted = loadState(path);
    expect(interrupted.ackedCursor).toEqual({ kind: "jsonl", offset: 0 });
    if (!interrupted.pending) throw new Error("The batch must stay pending.");
    const pendingBytes = readFileSync(interrupted.pending.file, "utf8");
    const before = filesUnder(f.directory, []);
    // The swap, as the uploader runs it mid-flight (§6.2): it replaces its own files only.
    expect(
      await selfUpdate(f.directory, f.executable, f.config, {
        fetch: f.fetcher,
      }),
    ).toBe("updated");
    expect(readFileSync(f.executable, "utf8")).toBe(NEW_BUNDLE);
    const after = filesUnder(f.directory, []);
    const changed = [...new Set([...before.keys(), ...after.keys()])]
      .filter((file) => before.get(file) !== after.get(file))
      .sort();
    expect(changed).toEqual([
      "hook.js",
      "hook.log",
      "pi-extension.mjs",
      "update.json",
    ]);
    // The next run (the machine's next hook) delivers exactly the pending bytes and only
    // then advances the cursor; the manifest is not asked again within the hour.
    f.setIngestStatus(202);
    await f.run({}, session);
    expect(f.uploaded.at(-1)).toBe(
      ingestEnvelopeSchema.parse(JSON.parse(pendingBytes) as unknown).hook
        .sha256,
    );
    const delivered = loadState(path);
    expect(delivered.pending).toBeNull();
    expect(delivered.ackedCursor).toEqual({
      kind: "jsonl",
      offset: readFileSync(join(f.directory, "transcript.jsonl")).length,
    });
    expect(
      f.requests.filter((request) => request === "GET /hook/manifest.json"),
    ).toHaveLength(1);
  });
  // @req R-CAP-16 @req R-CAP-21
  it("still checks for an update when the drain itself fails, so a broken bundle receives the release that fixes it", async () => {
    const f = fixture();
    await expect(
      f.run({
        checkpoint: () => Promise.reject(new Error("interrupted")),
      }),
    ).rejects.toThrow("interrupted");
    expect(readFileSync(f.executable, "utf8")).toBe(NEW_BUNDLE);
    expect(f.log()).toContain("Updated to hook 0.1.0-test");
    expect(f.installRuns()).toHaveLength(1);
  });
  // @req R-CAP-16 @req R-CAP-21
  it("never fetches in hook mode", () => {
    const f = fixture();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("hook mode must not reach the network"));
    try {
      const path = recordHook(
        f.directory,
        f.executable,
        {
          ...configure(f.directory, {}),
        },
        "claude",
        {
          session_id: randomUUID(),
          transcript_path: join(f.directory, "transcript.jsonl"),
          cwd: f.directory,
          hook_event_name: "Stop",
        },
      );
      expect(path).not.toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(existsSync(join(f.directory, "update.lock"))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });
  // @req R-CAP-17 @req R-CAP-21
  it("keeps fields a newer bundle wrote to update.json through an older bundle's read-modify-write, so the wiring record survives", async () => {
    const f = fixture();
    const statePath = join(f.directory, "update.json");
    const recorded = JSON.parse(readFileSync(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    writeFileSync(
      statePath,
      JSON.stringify({
        ...recorded,
        futureField: { introduced: "by a later bundle" },
        configured: {
          ...(recorded.configured as Record<string, unknown>),
          futureFlag: true,
        },
      }),
    );
    await f.run();
    // The swap reconfigured (the record was readable), and the unknown fields are intact.
    expect(f.installRuns()).toHaveLength(1);
    const after = JSON.parse(readFileSync(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(after.futureField).toEqual({ introduced: "by a later bundle" });
    expect(after.configured).toMatchObject({ sha256: hash(NEW_BUNDLE) });
  });
});

const OLDER = "2026-09-10T00:00:00.000Z";
const INSTALLED_AT = "2026-09-11T00:00:00.000Z";
const NEWER = "2026-09-12T00:00:00.000Z";
/** As after a self-update recorded which bundle it installed, and when it was built. */
function seedInstalled(
  directory: string,
  sha256: string,
  builtAt?: string,
): void {
  const path = join(directory, "update.json");
  const state = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    unknown
  >;
  writeFileSync(
    path,
    JSON.stringify({
      ...state,
      checkedAt: 0,
      installed: { sha256, ...(builtAt ? { builtAt } : {}) },
    }),
  );
}
const staged = (directory: string): string[] =>
  readdirSync(directory).filter((name) => name.includes(".update."));

describe("hook self-update never moves to an older build", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  // @req R-CAP-27
  it("takes a newer build and records its stamp beside the digest", async () => {
    const f = fixture({ builtAt: NEWER });
    seedInstalled(f.directory, hash(OLD_BUNDLE), INSTALLED_AT);
    expect(
      await selfUpdate(f.directory, f.executable, f.config, {
        fetch: f.fetcher,
      }),
    ).toBe("updated");
    expect(readFileSync(f.executable, "utf8")).toBe(NEW_BUNDLE);
    const state = JSON.parse(
      readFileSync(join(f.directory, "update.json"), "utf8"),
    ) as { installed?: unknown };
    expect(state.installed).toEqual({
      sha256: hash(NEW_BUNDLE),
      builtAt: NEWER,
    });
  });
  // @req R-CAP-27
  it("keeps the current bundle when the server offers a strictly older build", async () => {
    const f = fixture({ builtAt: OLDER });
    seedInstalled(f.directory, hash(OLD_BUNDLE), INSTALLED_AT);
    expect(
      await selfUpdate(f.directory, f.executable, f.config, {
        fetch: f.fetcher,
      }),
    ).toBe("skipped");
    expect(readFileSync(f.executable, "utf8")).toBe(OLD_BUNDLE);
    expect(readFileSync(join(f.directory, "pi-extension.mjs"), "utf8")).toBe(
      OLD_EXTENSION,
    );
    expect(f.log()).toContain("offers an older hook build");
    expect(f.log()).toContain("keeping the current one");
    // Held before any download, so nothing was fetched or staged.
    expect(f.requests).not.toContain("GET /hook/0.1.0-test/hook.js");
    expect(staged(f.directory)).toEqual([]);
    // The recorded stamp is unchanged: a hold touches no state but `checkedAt`.
    const state = JSON.parse(
      readFileSync(join(f.directory, "update.json"), "utf8"),
    ) as { installed?: unknown };
    expect(state.installed).toEqual({
      sha256: hash(OLD_BUNDLE),
      builtAt: INSTALLED_AT,
    });
  });
  // @req R-CAP-27
  it("refuses an older build even when the manifest lies about its digest", async () => {
    const f = fixture({ builtAt: OLDER, sha256: hash("a different bundle") });
    seedInstalled(f.directory, hash(OLD_BUNDLE), INSTALLED_AT);
    expect(
      await selfUpdate(f.directory, f.executable, f.config, {
        fetch: f.fetcher,
      }),
    ).toBe("skipped");
    expect(readFileSync(f.executable, "utf8")).toBe(OLD_BUNDLE);
    expect(f.requests).not.toContain("GET /hook/0.1.0-test/hook.js");
    expect(staged(f.directory)).toEqual([]);
  });
  // @req R-CAP-27
  it("does nothing when the stamp and the digests already match", async () => {
    const f = fixture({
      builtAt: INSTALLED_AT,
      sha256: hash(OLD_BUNDLE),
      extensionSha256: hash(OLD_EXTENSION),
    });
    seedInstalled(f.directory, hash(OLD_BUNDLE), INSTALLED_AT);
    expect(
      await selfUpdate(f.directory, f.executable, f.config, {
        fetch: f.fetcher,
      }),
    ).toBe("current");
    expect(readFileSync(f.executable, "utf8")).toBe(OLD_BUNDLE);
  });
  // @req R-CAP-27
  it("updates on the digest when no stamp is recorded for the installed bundle yet", async () => {
    // A first upgrade after a fresh install: nothing to compare the offered stamp with.
    const first = fixture({ builtAt: OLDER });
    expect(
      await selfUpdate(first.directory, first.executable, first.config, {
        fetch: first.fetcher,
      }),
    ).toBe("updated");
    expect(readFileSync(first.executable, "utf8")).toBe(NEW_BUNDLE);
  });
  // @req R-CAP-27 @req R-CAP-29
  it("refuses a signed manifest without a build stamp, which the age guard could not judge", async () => {
    const unstamped = fixture({ builtAt: undefined });
    expect(
      await selfUpdate(
        unstamped.directory,
        unstamped.executable,
        unstamped.config,
        { fetch: unstamped.fetcher },
      ),
    ).toBe("skipped");
    expect(readFileSync(unstamped.executable, "utf8")).toBe(OLD_BUNDLE);
    expect(unstamped.requests).not.toContain("GET /hook/0.1.0-test/hook.js");
  });
});
