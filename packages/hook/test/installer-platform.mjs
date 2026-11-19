import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const artifacts = resolve(process.argv[2] ?? "apps/api/public");
const directory = await mkdtemp(join(tmpdir(), "agentcommons-platform-"));
const bin = join(directory, "bin");
await mkdir(bin);
for (const name of ["claude", "codex", "gemini", "pi"])
  await writeFile(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
let corrupt = false;
let requests = 0;
const server = createServer(async (request, response) => {
  requests++;
  try {
    if (request.url === "/api/v1/me") {
      response.writeHead(
        request.headers.authorization === "Bearer platform-test-credential"
          ? 200
          : 401,
        { "content-type": "application/json" },
      );
      response.end(
        JSON.stringify({ organization: { id: "native-org-identity" } }),
      );
      return;
    }
    if (!request.url?.startsWith("/hook/") || request.url.includes("..")) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.end(
      corrupt && request.url.endsWith("hook.js")
        ? "corrupt"
        : await readFile(join(artifacts, request.url)),
    );
  } catch {
    response.writeHead(404);
    response.end();
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
async function run(command, args, env) {
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const [code] = await once(child, "exit");
  return { code, output };
}
try {
  for (const shell of ["bash", "zsh", "fish"]) {
    const root = join(directory, shell);
    const home = join(root, "native");
    const data = join(root, "data");
    const env = {
      ...process.env,
      AGENTCOMMONS_DIR: data,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      SHELL: `/bin/${shell}`,
    };
    const args = [
      join(artifacts, "install.sh"),
      "--server",
      origin,
      "--key",
      "platform-test-credential",
      "--config-home",
      home,
    ];
    const rc =
      shell === "fish"
        ? join(home, ".config/fish/config.fish")
        : join(home, shell === "zsh" ? ".zshrc" : ".bashrc");
    // The exports an older installer wrote after the user's own line; install removes them.
    const exported =
      shell === "fish"
        ? "set -gx AGENTCOMMONS_API_KEY 'platform-test-credential'"
        : "export AGENTCOMMONS_API_KEY='platform-test-credential'";
    await mkdir(join(rc, ".."), { recursive: true });
    await writeFile(
      rc,
      `set_by_user=1\n\n# agentcommons-hook begin\n${exported}\n# agentcommons-hook end\n`,
    );
    const first = await run("sh", args, env);
    assert.equal(first.code, 0, first.output);
    assert.match(first.output, /trust hooks/);
    // The guidance lands in each harness's global instructions file, named in the output.
    assert.match(first.output, /AgentCommons guidance from .*CLAUDE\.md/);
    const configPath = join(data, "config.json");
    const original = await readFile(configPath, "utf8");
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    // A real shell sourcing its startup file no longer gets the key (R-INST-10).
    assert.equal(await readFile(rc, "utf8"), "set_by_user=1\n");
    const rcCheck =
      shell === "fish"
        ? 'source "$argv[1]"; not set -q AGENTCOMMONS_API_KEY'
        : '. "$1"; test -z "${AGENTCOMMONS_API_KEY+set}"';
    const sourced = await run(
      shell,
      ["-c", rcCheck, ...(shell === "fish" ? [] : ["agentcommons-test"]), rc],
      env,
    );
    assert.equal(sourced.code, 0, sourced.output);
    const again = await run("sh", args, env);
    assert.equal(again.code, 0, again.output);
    assert.equal(await readFile(configPath, "utf8"), original);
    const oldBytes = await readFile(join(data, "hook.js"));
    corrupt = true;
    assert.notEqual((await run("sh", args, env)).code, 0);
    assert.deepEqual(await readFile(join(data, "hook.js")), oldBytes);
    corrupt = false;
    const before = requests;
    const uninstall = await run(
      "sh",
      [join(artifacts, "install.sh"), "--uninstall", "--config-home", home],
      env,
    );
    assert.equal(uninstall.code, 0, uninstall.output);
    assert.equal(requests, before);
    assert.equal(await readFile(configPath, "utf8"), original);
    assert.equal(await readFile(rc, "utf8"), "set_by_user=1\n");
    process.stdout.write(
      JSON.stringify({
        platform: process.platform,
        node: process.versions.node,
        shell,
        installed: true,
        rcParsed: true,
        checksumRejected: true,
        offlineUninstall: true,
      }) + "\n",
    );
  }
} finally {
  server.closeAllConnections();
  server.close();
}
