// @req R-INF-15
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("../..", import.meta.url));
const selfHost = join(repository, "scripts", "self-host");
const lib = join(selfHost, "lib.sh");

// The hook bundle the manifest points at, and the digest the manifest declares for it. A
// verify run downloads the bundle and hashes it, so a correct manifest names this digest.
const bundle = "// agentcommons hook bundle bytes";
const bundleSha = createHash("sha256").update(bundle).digest("hex");
const version = "0123456789ab";
const goodManifest = JSON.stringify({
  version,
  sha256: bundleSha,
  url: `/hook/${version}/hook.js`,
  extensionSha256: "0".repeat(64),
  extensionUrl: `/hook/${version}/pi-extension.mjs`,
});

/**
 * A fake `docker` that answers only the calls `verify_deploy` makes (the published port, the
 * running API container's image id and its `AGENTCOMMONS_VERSION`), and a fake `curl` that
 * serves `/ready`, the hook manifest, the bundle and a `POST /mcp` handshake from environment
 * variables, emulating `-o FILE`, `-w %{http_code}` and `-f` the way the host scripts call it.
 */
const fakeDocker = `#!/usr/bin/env bash
case "$*" in
"compose port api 3000") echo 127.0.0.1:3000 ;;
"compose ps -q api") [ -z "$FAKE_RUNNING" ] || echo container-1 ;;
"inspect --format {{.Image}} container-1") echo "$FAKE_RUNNING" ;;
"inspect --format {{range .Config.Env}}{{println .}}{{end}} container-1")
  printf 'PATH=/usr/bin\\nAGENTCOMMONS_VERSION=%s\\n' "$FAKE_VERSION" ;;
"compose ps" | "compose logs --tail 50 api") ;;
*) echo "unexpected docker $*" >&2; exit 99 ;;
esac
exit 0
`;
const fakeCurl = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$FAKE_LOG"
out=""; want_code=0; fail=0; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) [ "$2" = '%{http_code}' ] && want_code=1; shift 2 ;;
    -X) shift 2 ;;
    -H | --data | --data-raw | --data-binary | --max-time | --connect-timeout) shift 2 ;;
    http://* | https://*) url="$1"; shift ;;
    -*f*) fail=1; shift ;;
    -*) shift ;;
    *) shift ;;
  esac
done
emit() { if [ -n "$out" ]; then printf '%s' "$1" >"$out"; else printf '%s' "$1"; fi; }
code=200; body=""
case "$url" in
  */ready) if [ "$(cat "$FAKE_READY_FILE" 2>/dev/null)" != 1 ]; then code=503; else body='{"status":"ok"}'; fi ;;
  */hook/manifest.json) body="$FAKE_MANIFEST" ;;
  */hook/*/hook.js) body="$FAKE_BUNDLE" ;;
  */mcp) code="\${FAKE_MCP_CODE:-401}"; body="\${FAKE_MCP_BODY:-}"; [ -n "$body" ] || body='{"code":"BEARER_REQUIRED","message":"bearer"}' ;;
  *) code=404 ;;
esac
emit "$body"
[ "$want_code" = 1 ] && printf '%s' "$code"
if [ "$fail" = 1 ]; then case "$code" in 4* | 5*) exit 22 ;; esac; fi
exit 0
`;

interface Scenario {
  manifest?: string;
  bundle?: string;
  mcpCode?: string;
  mcpBody?: string;
  running?: string;
  runningVersion?: string;
  ready?: boolean;
  args?: string[];
}
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "post-deploy-verify-"));
  directories.push(root);
  const stack = join(root, "stack");
  mkdirSync(join(stack, "scripts", "self-host"), { recursive: true });
  copyFileSync(lib, join(stack, "scripts/self-host/lib.sh"));
  writeFileSync(join(stack, "docker-compose.yml"), "");
  writeFileSync(join(stack, ".env"), "PUBLIC_URL=http://localhost:3000\n");
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "docker"), fakeDocker, { mode: 0o755 });
  writeFileSync(join(bin, "curl"), fakeCurl, { mode: 0o755 });
  // A wrapper sources the shipped library and calls the function under test, exactly as the
  // updater and the single-node apply do.
  const runner = join(root, "verify.sh");
  writeFileSync(
    runner,
    '. "$AGENTCOMMONS_APP_DIR/scripts/self-host/lib.sh"\nverify_deploy "$@"\n',
  );
  const log = join(root, "curl.log");
  const readyFile = join(root, "ready");
  function run(scenario: Scenario = {}) {
    writeFileSync(log, "");
    writeFileSync(readyFile, scenario.ready === false ? "0\n" : "1\n");
    const result = spawnSync("bash", [runner, ...(scenario.args ?? [])], {
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        AGENTCOMMONS_APP_DIR: stack,
        AGENTCOMMONS_STATE_DIR: join(root, "state"),
        AGENTCOMMONS_READY_ATTEMPTS: "2",
        AGENTCOMMONS_READY_INTERVAL: "0",
        FAKE_LOG: log,
        FAKE_READY_FILE: readyFile,
        FAKE_RUNNING: scenario.running ?? "sha256:running",
        FAKE_VERSION: scenario.runningVersion ?? version,
        FAKE_MANIFEST: scenario.manifest ?? goodManifest,
        FAKE_BUNDLE: scenario.bundle ?? bundle,
        FAKE_MCP_CODE: scenario.mcpCode ?? "",
        FAKE_MCP_BODY: scenario.mcpBody ?? "",
      },
    });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
  return { run };
}

describe("post-deploy verify_deploy", () => {
  it("ships a syntactically valid library that defines verify_deploy", () => {
    execFileSync("bash", ["-n", lib]);
    const source = execFileSync("cat", [lib], { encoding: "utf8" });
    expect(source).toContain("verify_deploy()");
    expect(source).toContain("/hook/manifest.json");
    expect(source).toContain("/mcp");
  });
  it("passes when /ready, the manifest and its bundle, and the MCP handshake are all healthy", () => {
    const { run } = fixture();
    const ok = run();
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("/ready ok");
    expect(ok.stdout).toContain(`hook ${version} bundle sha matches`);
    expect(ok.stdout).toContain("MCP serving (HTTP 401)");
  });
  it("fails on a stubbed empty manifest", () => {
    const { run } = fixture();
    const empty = run({ manifest: "" });
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain("not a valid manifest");
    // Malformed but non-empty JSON is rejected for the same reason.
    const broken = run({ manifest: "{ this is not json" });
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain("not a valid manifest");
  });
  it("fails when the bundle sha256 does not match the manifest", () => {
    const { run } = fixture();
    const mismatch = run({ bundle: "tampered bundle bytes" });
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain("does not match the manifest");
  });
  it("fails when the manifest points at a bundle that is not fetchable", () => {
    const { run } = fixture();
    const missing = run({
      manifest: JSON.stringify({
        version,
        sha256: bundleSha,
        url: "/hook/gone/missing.bin",
        extensionSha256: "0".repeat(64),
        extensionUrl: `/hook/${version}/pi-extension.mjs`,
      }),
    });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("is not fetchable");
  });
  it("fails on a 5xx MCP handshake and on a 404 from a missing MCP route", () => {
    const { run } = fixture();
    const server = run({ mcpCode: "500" });
    expect(server.status).toBe(1);
    expect(server.stderr).toContain("POST /mcp returned HTTP 500");
    const missing = run({ mcpCode: "404" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("not an MCP handshake");
  });
  it("accepts a 200 JSON-RPC handshake but rejects a 200 that is not JSON-RPC", () => {
    const { run } = fixture();
    const handshake = run({
      mcpCode: "200",
      mcpBody:
        '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}',
    });
    expect(handshake.status, handshake.stderr).toBe(0);
    expect(handshake.stdout).toContain("MCP serving (HTTP 200)");
    const notRpc = run({ mcpCode: "200", mcpBody: '{"hello":"world"}' });
    expect(notRpc.status).toBe(1);
    expect(notRpc.stderr).toContain("without a JSON-RPC result");
  });
  it("fails when /ready never comes up within the bounded wait", () => {
    const { run } = fixture();
    const down = run({ ready: false });
    expect(down.status).toBe(1);
    expect(down.stderr).toContain("did not become ready");
  });
  it("checks the deployed release when an expected version and image are given", () => {
    const { run } = fixture();
    // The incident-(a) shape: a floating tag served an older image than the deploy intended,
    // so the API reports a different commit than the release archive named.
    const staleVersion = run({
      runningVersion: "abcabcabcabc",
      args: ["0123456789ab"],
    });
    expect(staleVersion.status).toBe(1);
    expect(staleVersion.stderr).toContain(
      "reports version abcabcabcabc, not the deployed 0123456789ab",
    );
    const staleImage = run({
      running: "sha256:old",
      args: ["0123456789ab", "sha256:intended"],
    });
    expect(staleImage.status).toBe(1);
    expect(staleImage.stderr).toContain(
      "runs image sha256:old, not the deployed sha256:intended",
    );
    // The matching release passes, and "development" is not compared (a manual build).
    const matched = run({ args: ["0123456789ab", "sha256:running"] });
    expect(matched.status, matched.stderr).toBe(0);
    const development = run({
      runningVersion: "abcabcabcabc",
      args: ["development"],
    });
    expect(development.status, development.stderr).toBe(0);
  });
});
