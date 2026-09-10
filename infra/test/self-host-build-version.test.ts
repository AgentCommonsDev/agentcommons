// @req R-INF-12
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("../..", import.meta.url));
const selfHost = join(repository, "scripts", "self-host");

/** A fake `docker` that records every call and answers the ones `stack_up build` makes. */
const fakeDocker = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$FAKE_LOG"
case "$*" in
"compose build --build-arg "*" api") ;;
"compose up -d --no-build --remove-orphans") ;;
"compose port api 3000") echo 127.0.0.1:3000 ;;
"compose config --services") printf 'api\\ndb\\nmigrate\\n' ;;
*) echo "unexpected docker $*" >&2; exit 99 ;;
esac
exit 0
`;
const fakeCurl = `#!/usr/bin/env bash
exit 0
`;
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "agentcommons-build-version-"));
  directories.push(root);
  const stack = join(root, "stack");
  mkdirSync(join(stack, "scripts", "self-host"), { recursive: true });
  copyFileSync(
    join(selfHost, "lib.sh"),
    join(stack, "scripts/self-host/lib.sh"),
  );
  copyFileSync(
    join(repository, "docker-compose.yml"),
    join(stack, "docker-compose.yml"),
  );
  writeFileSync(join(stack, ".env"), "PUBLIC_URL=http://localhost:3000\n");
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "docker"), fakeDocker, { mode: 0o755 });
  writeFileSync(join(bin, "curl"), fakeCurl, { mode: 0o755 });
  const log = join(root, "docker.log");
  writeFileSync(log, "");
  /** Sources lib.sh inside the stack and runs `stack_up build`, as apply.sh does. */
  function build(env: Record<string, string> = {}) {
    writeFileSync(log, "");
    const result = spawnSync(
      "bash",
      ["-c", ". scripts/self-host/lib.sh && enter_stack && stack_up build"],
      {
        cwd: stack,
        encoding: "utf8",
        env: {
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          HOME: root,
          AGENTCOMMONS_APP_DIR: stack,
          AGENTCOMMONS_STATE_DIR: join(root, "state"),
          AGENTCOMMONS_READY_ATTEMPTS: "1",
          AGENTCOMMONS_READY_INTERVAL: "0",
          FAKE_LOG: log,
          ...env,
        },
      },
    );
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      docker: readFileSync(log, "utf8").trim().split("\n").filter(Boolean),
    };
  }
  return { build, stack };
}
const buildArg = (docker: string[]) =>
  docker
    .find((line) => line.startsWith("compose build"))
    ?.match(/--build-arg AGENTCOMMONS_VERSION=(\S+)/)?.[1];

describe("on-host image builds stamp AGENTCOMMONS_VERSION", () => {
  it("uses the exported version when the caller set one", () => {
    const { build } = fixture();
    const run = build({ AGENTCOMMONS_VERSION: "abcdef123456" });
    expect(run.status, run.stderr).toBe(0);
    expect(buildArg(run.docker)).toBe("abcdef123456");
    expect(run.stdout).toContain("AGENTCOMMONS_VERSION=abcdef123456");
  });
  it("reads the release archive's .commit file when the version is not exported", () => {
    const { build, stack } = fixture();
    writeFileSync(
      join(stack, "agentcommons-release.Ab12Cd.commit"),
      "0123456789abcdef0123456789abcdef01234567\n",
    );
    const run = build();
    expect(run.status, run.stderr).toBe(0);
    expect(buildArg(run.docker)).toBe("0123456789ab");
  });
  it("falls back to the checkout's git HEAD, then to development, and says so", () => {
    const { build, stack } = fixture();
    execFileSync("git", ["init", "-q", "."], { cwd: stack });
    execFileSync(
      "git",
      [
        "-c",
        "user.email=t@example.com",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "stamp",
      ],
      { cwd: stack },
    );
    const head = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: stack,
      encoding: "utf8",
    }).trim();
    const fromGit = build();
    expect(fromGit.status, fromGit.stderr).toBe(0);
    expect(buildArg(fromGit.docker)).toBe(head);
    rmSync(join(stack, ".git"), { recursive: true, force: true });
    const bare = build();
    expect(bare.status, bare.stderr).toBe(0);
    expect(buildArg(bare.docker)).toBe("development");
    expect(bare.stdout).toContain("AGENTCOMMONS_VERSION=development");
  });
});
