import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ingestEnvelopeSchema,
  type HookManifest,
} from "@agentcommons/core/schemas/ingest";
import { hash } from "../src/files.js";
import { recordHook } from "../src/hook.js";
import { configure } from "../src/install.js";
import { recordConfigured } from "../src/update.js";
import { upload } from "../src/upload.js";

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

function fixture(overrides: Partial<HookManifest> = {}, bundle = NEW_BUNDLE) {
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
    installOptions: { configHome, noShellRc: true },
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
    ...overrides,
  };
  const requests: string[] = [];
  const uploaded: string[] = [];
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
      return Promise.resolve(new Response(null, { status: 202 }));
    }
    if (url.pathname === "/hook/manifest.json")
      return Promise.resolve(Response.json(manifest));
    if (url.pathname === "/hook/0.1.0-test/hook.js")
      return Promise.resolve(new Response(bundle));
    if (url.pathname === "/hook/0.1.0-test/pi-extension.mjs")
      return Promise.resolve(new Response(NEW_EXTENSION));
    return Promise.resolve(
      Response.json({ organization: { id: config.organizationId } }),
    );
  };
  const run = async () => {
    const path = recordHook(
      directory,
      executable,
      config,
      "claude",
      {
        session_id: randomUUID(),
        transcript_path: transcript,
        cwd: directory,
        hook_event_name: "Stop",
      },
      "launch",
    );
    if (!path) throw new Error("Missing state.");
    await upload(directory, executable, path, config, {
      fetch: fetcher,
      sweep: false,
    });
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
    configHome,
    fakeCli,
    manifest,
    requests,
    uploaded,
    run,
    log,
    installRuns,
  };
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
  // @req R-CAP-17
  it("re-runs the bundle's install with the recorded flags after a swap and when a new harness appears, never touching shell rc files, and converges hourly after a failure", async () => {
    const f = fixture();
    await f.run();
    // The swap ran the new bundle's install once with the recorded config home and no shell rc edits.
    expect(f.installRuns()).toEqual([
      `--config-home ${f.configHome} --no-shell-rc`,
    ]);
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
  // @req R-CAP-17
  it("never runs install for a directory that hook.js install did not set up", async () => {
    const f = fixture();
    rmSync(join(f.directory, "update.json"));
    await f.run();
    expect(readFileSync(f.executable, "utf8")).toBe(NEW_BUNDLE);
    expect(f.installRuns()).toEqual([]);
    expect(f.log()).not.toContain("Configured harnesses");
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
});
