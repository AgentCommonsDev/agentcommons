// @req R-INF-09
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
const updater = join(selfHost, "agentcommons-update.sh");
const stable = "ghcr.io/agentcommonsdev/agentcommons:stable";

/**
 * A fake `docker` that answers the calls the updater makes from environment variables and
 * records every invocation, plus a fake `curl` whose readiness answer lives in a file the
 * fake docker flips to "ready" when it sees the rollback command.
 */
const fakeDocker = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$FAKE_LOG"
case "$*" in
"compose ps -q api") [ -z "$FAKE_RUNNING" ] || echo container-1 ;;
"inspect --format {{.Image}} container-1") echo "$FAKE_RUNNING" ;;
"inspect --format {{range .Config.Env}}{{println .}}{{end}} container-1")
  printf 'PATH=/usr/bin\\nAGENTCOMMONS_VERSION=%s\\n' "$FAKE_VERSION" ;;
"compose config") printf 'services:\\n  api:\\n    image: %s\\n  db:\\n    image: postgres:16\\n' "\${AGENTCOMMONS_IMAGE:-${stable}}" ;;
"compose pull --quiet api") [ "$FAKE_PULL_FAIL" != 1 ] || exit 1 ;;
"image inspect --format {{.Id}} ${stable}") echo "$FAKE_PULLED" ;;
"image inspect --format {{.Id}} agentcommons:previous") echo "$FAKE_RUNNING" ;;
"tag "*) ;;
"compose up -d --no-build --remove-orphans") [ "$FAKE_UP_FAIL" != 1 ] || exit 1 ;;
"compose up -d --no-build --no-deps api")
  [ "$AGENTCOMMONS_IMAGE" = agentcommons:previous ] || { echo "rollback without the previous tag" >&2; exit 1; }
  echo 1 >"$FAKE_READY_FILE" ;;
"compose port api 3000") echo 127.0.0.1:3000 ;;
"compose config --services")
  # Written line by line with a pause, like the real client: a reader that stops at
  # "caddy" must not turn the rest into SIGPIPE for the writer.
  printf 'api\\ncaddy\\n'; sleep 0.1; printf 'db\\nmigrate\\n' ;;
"compose restart caddy" | "compose ps" | "compose logs --tail 50 api" | "image prune -f") ;;
*) echo "unexpected docker $*" >&2; exit 99 ;;
esac
exit 0
`;
const fakeCurl = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$FAKE_LOG.curl"
[ "$(cat "$FAKE_READY_FILE")" = 1 ]
`;

interface Scenario {
  env?: Record<string, string>;
  running?: string;
  pulled?: string;
  ready?: boolean;
  upFails?: boolean;
  pullFails?: boolean;
}
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture(env = "AUTO_UPDATE=true\nPUBLIC_URL=http://localhost:3000\n") {
  const root = mkdtempSync(join(tmpdir(), "agentcommons-update-test-"));
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
  writeFileSync(join(stack, ".env"), env);
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "docker"), fakeDocker, { mode: 0o755 });
  writeFileSync(join(bin, "curl"), fakeCurl, { mode: 0o755 });
  const state = join(root, "state");
  const log = join(root, "docker.log");
  const readyFile = join(root, "ready");
  writeFileSync(log, "");
  writeFileSync(`${log}.curl`, "");
  function run(args: string[], scenario: Scenario = {}) {
    writeFileSync(readyFile, scenario.ready === false ? "0\n" : "1\n");
    writeFileSync(log, "");
    const result = spawnSync("bash", [updater, ...args], {
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: root,
        AGENTCOMMONS_APP_DIR: stack,
        AGENTCOMMONS_STATE_DIR: state,
        AGENTCOMMONS_READY_ATTEMPTS: "2",
        AGENTCOMMONS_READY_INTERVAL: "0",
        FAKE_LOG: log,
        FAKE_READY_FILE: readyFile,
        FAKE_RUNNING: scenario.running ?? "",
        FAKE_PULLED: scenario.pulled ?? "",
        FAKE_VERSION: "0123456789ab",
        FAKE_UP_FAIL: scenario.upFails ? "1" : "0",
        FAKE_PULL_FAIL: scenario.pullFails ? "1" : "0",
        ...scenario.env,
      },
    });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      docker: readFileSync(log, "utf8").trim().split("\n").filter(Boolean),
      curl: readFileSync(`${log}.curl`, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean),
      state: () => {
        try {
          return readFileSync(join(state, "update-state"), "utf8");
        } catch {
          return "";
        }
      },
    };
  }
  return { run, stack };
}

describe("self-host updater", () => {
  it("ships syntactically valid scripts and systemd units that run it hourly with a random delay", () => {
    for (const script of ["agentcommons-update.sh", "lib.sh"]) {
      execFileSync("bash", ["-n", join(selfHost, script)]);
      expect(readFileSync(join(selfHost, script), "utf8")).toContain(
        "set -euo pipefail",
      );
    }
    expect(readFileSync(join(selfHost, "lib.sh"), "utf8")).not.toContain("#!");
    const service = readFileSync(
      join(selfHost, "systemd", "agentcommons-update.service"),
      "utf8",
    );
    expect(service).toContain("Type=oneshot");
    expect(service).toContain("Requires=docker.service");
    expect(service).toContain(
      "Environment=AGENTCOMMONS_APP_DIR=/opt/agentcommons/app",
    );
    expect(service).toContain(
      "ExecStart=/opt/agentcommons/agentcommons-update.sh",
    );
    const timer = readFileSync(
      join(selfHost, "systemd", "agentcommons-update.timer"),
      "utf8",
    );
    expect(timer).toContain("OnCalendar=hourly");
    expect(timer).toMatch(/RandomizedDelaySec=\d+m/);
    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("Unit=agentcommons-update.service");
    expect(timer).toContain("WantedBy=timers.target");
  });
  it("does nothing on the timer while AUTO_UPDATE is not true, and still answers --status", () => {
    const { run } = fixture("AUTO_UPDATE='false'\n");
    const off = run([], { running: "sha256:aaa", pulled: "sha256:bbb" });
    expect(off.status).toBe(0);
    expect(off.stdout).toBe("");
    expect(off.docker).toEqual([]);
    expect(off.state()).toContain("last_result=disabled");
    const status = run(["--status"], {
      running: "sha256:aaa",
      pulled: "sha256:bbb",
    });
    expect(status.status).toBe(0);
    expect(status.stdout).toContain("running version:   0123456789ab");
    expect(status.stdout).toContain("running image:     sha256:aaa");
    expect(status.stdout).toContain(`configured image:  ${stable}`);
    expect(status.stdout).toContain("pulled image:      sha256:bbb");
    expect(status.stdout).toContain("automatic updates: false");
    expect(status.stdout).toContain("last_result=disabled");
    expect(status.docker.some((line) => line.startsWith("compose up"))).toBe(
      false,
    );
  });
  it("pulls, compares digests and leaves a current stack alone; --now checks even when opted out", () => {
    const { run } = fixture("AUTO_UPDATE=false\n");
    const same = run(["--now"], {
      running: "sha256:aaa",
      pulled: "sha256:aaa",
    });
    expect(same.status).toBe(0);
    expect(same.stdout).toContain("Up to date");
    expect(same.docker).toContain("compose pull --quiet api");
    expect(same.docker.some((line) => line.startsWith("compose up"))).toBe(
      false,
    );
    expect(same.docker.some((line) => line.startsWith("tag "))).toBe(false);
    expect(same.state()).toContain("last_result=unchanged");
  });
  it("keeps the running image as agentcommons:previous, starts the stack, waits for /ready and restarts Caddy", () => {
    const { run } = fixture();
    const updated = run([], { running: "sha256:aaa", pulled: "sha256:bbb" });
    expect(updated.status, updated.stderr).toBe(0);
    expect(updated.stdout).toContain("Updating to");
    expect(updated.stdout).toContain("Updated to 0123456789ab");
    const order = (line: string) => updated.docker.indexOf(line);
    expect(
      order("tag sha256:aaa agentcommons:previous"),
    ).toBeGreaterThanOrEqual(0);
    expect(order("compose up -d --no-build --remove-orphans")).toBeGreaterThan(
      order("tag sha256:aaa agentcommons:previous"),
    );
    expect(order("compose config --services")).toBeGreaterThan(
      order("compose up -d --no-build --remove-orphans"),
    );
    expect(order("compose restart caddy")).toBeGreaterThan(
      order("compose config --services"),
    );
    expect(updated.docker).toContain("image prune -f");
    expect(updated.docker).not.toContain(
      "compose up -d --no-build --no-deps api",
    );
    expect(updated.curl.at(-1)).toContain("http://127.0.0.1:3000/ready");
    const state = updated.state();
    expect(state).toContain("last_result=updated");
    expect(state).toContain("previous_image=sha256:aaa");
    expect(state).toContain("last_image=sha256:bbb");
    expect(state).toContain("failed_image=\n");
  });
  it("restores the previous image when the release does not become ready, exits non-zero and holds that release", () => {
    const { run } = fixture();
    const failed = run([], {
      running: "sha256:aaa",
      pulled: "sha256:ccc",
      ready: false,
    });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("restoring the previous image");
    expect(failed.stderr).toContain("Rolled back to");
    const order = (line: string) => failed.docker.indexOf(line);
    expect(order("compose up -d --no-build --no-deps api")).toBeGreaterThan(
      order("compose up -d --no-build --remove-orphans"),
    );
    expect(failed.docker).toContain("compose logs --tail 50 api");
    expect(failed.docker).not.toContain("image prune -f");
    expect(failed.state()).toContain("last_result=rolled-back");
    expect(failed.state()).toContain("failed_image=sha256:ccc");
    // The next hour sees the same failed release and skips it without touching the stack.
    const held = run([], { running: "sha256:aaa", pulled: "sha256:ccc" });
    expect(held.status).toBe(0);
    expect(held.stdout).toContain("Skipping");
    expect(held.docker.some((line) => line.startsWith("compose up"))).toBe(
      false,
    );
    expect(held.state()).toContain("last_result=skipped");
    // A newer release is installed normally and clears the hold.
    const newer = run([], { running: "sha256:aaa", pulled: "sha256:ddd" });
    expect(newer.status, newer.stderr).toBe(0);
    expect(newer.state()).toContain("last_result=updated");
    expect(newer.state()).toContain("failed_image=\n");
  });
  it("rolls back when the migration or start fails, and reports a failed pull without touching the stack", () => {
    const { run } = fixture();
    const migration = run([], {
      running: "sha256:aaa",
      pulled: "sha256:eee",
      upFails: true,
    });
    expect(migration.status).toBe(1);
    expect(migration.docker).toContain(
      "compose up -d --no-build --no-deps api",
    );
    expect(migration.state()).toContain("last_result=rolled-back");
    const pull = run(["--now"], { running: "sha256:aaa", pullFails: true });
    expect(pull.status).toBe(1);
    expect(pull.stderr).toContain("Could not pull");
    expect(pull.docker.some((line) => line.startsWith("compose up"))).toBe(
      false,
    );
    expect(pull.state()).toContain("last_result=pull-failed");
  });
  it("refuses to run outside a checkout with docker-compose.yml and .env", () => {
    const { run, stack } = fixture();
    rmSync(join(stack, ".env"));
    const missing = run(["--now"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain(
      "docker-compose.yml and .env are required",
    );
    expect(missing.docker).toEqual([]);
  });
});
