// @req R-INF-09
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
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
// The release step's Caddy reload (scripts/self-host/lib.sh stack_up).
const reloadCaddy =
  "compose exec -T caddy sh /etc/caddy/entrypoint.sh caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile";

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
"image inspect --format {{.Id}} agentcommons:previous") echo "$FAKE_RUNNING" ;;
"image inspect --format {{.Id}} "*) echo "$FAKE_PULLED" ;;
# The release stamps: the running image id answers with the running stamps, any other
# reference (the pulled id or tag) with the pulled ones; an empty stamp is a missing label.
'image inspect --format {{index .Config.Labels "org.opencontainers.image.revision"}} '*)
  if [ "\${@: -1}" = "$FAKE_RUNNING" ]; then echo "$FAKE_RUNNING_REVISION"; else echo "$FAKE_PULLED_REVISION"; fi ;;
'image inspect --format {{index .Config.Labels "org.opencontainers.image.created"}} '*)
  if [ "\${@: -1}" = "$FAKE_RUNNING" ]; then echo "$FAKE_RUNNING_CREATED"; else echo "$FAKE_PULLED_CREATED"; fi ;;
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
"compose exec -T caddy sh /etc/caddy/entrypoint.sh caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile") [ "$FAKE_RELOAD_FAIL" != 1 ] || exit 1 ;;
"compose restart caddy" | "compose ps" | "compose logs --tail 50 api" | "image prune -f") ;;
*) echo "unexpected docker $*" >&2; exit 99 ;;
esac
exit 0
`;
const fakeCurl = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$FAKE_LOG.curl"
[ "$(cat "$FAKE_READY_FILE")" = 1 ]
`;

/** An image's release stamp: the OCI revision and created labels; an omitted field is a missing label. */
interface Release {
  revision?: string;
  created?: string;
}
/** A fully stamped release, as both build paths produce. */
interface Stamped {
  revision: string;
  created: string;
}
interface Scenario {
  env?: Record<string, string>;
  running?: string;
  pulled?: string;
  /** Stamps of the running image; defaults to the older of the two releases below. */
  runningRelease?: Release;
  /** Stamps of the pulled image; defaults to the newer release, so a plain update proceeds. */
  pulledRelease?: Release;
  ready?: boolean;
  upFails?: boolean;
  pullFails?: boolean;
}
// The production incident of 2026-09-11 in miniature: the host ran a hand-built 048d978
// while the public :stable tag still held the first CI image, 84f9941.
const olderRelease: Stamped = {
  revision: "84f9941".padEnd(40, "0"),
  created: "2026-09-11T04:12:41Z",
};
const newerRelease: Stamped = {
  revision: "048d978".padEnd(40, "0"),
  created: "2026-09-11T16:30:00Z",
};
const newestRelease: Stamped = {
  revision: "1a2b3c4".padEnd(40, "0"),
  created: "2026-09-11T19:05:00Z",
};
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
    const envFile = join(stack, ".env");
    const envBefore = existsSync(envFile)
      ? readFileSync(envFile, "utf8")
      : null;
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
        FAKE_RUNNING_REVISION:
          (scenario.runningRelease ?? olderRelease).revision ?? "",
        FAKE_RUNNING_CREATED:
          (scenario.runningRelease ?? olderRelease).created ?? "",
        FAKE_PULLED_REVISION:
          (scenario.pulledRelease ?? newerRelease).revision ?? "",
        FAKE_PULLED_CREATED:
          (scenario.pulledRelease ?? newerRelease).created ?? "",
        FAKE_VERSION: "0123456789ab",
        FAKE_UP_FAIL: scenario.upFails ? "1" : "0",
        FAKE_PULL_FAIL: scenario.pullFails ? "1" : "0",
        ...scenario.env,
      },
    });
    // The updater changes the image and nothing else: .env is read as the last release
    // left it and never rendered or edited, so it cannot switch databases (ADR 0063).
    expect(existsSync(envFile) ? readFileSync(envFile, "utf8") : null).toBe(
      envBefore,
    );
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
    expect(status.stdout).toContain(
      "running release:   84f994100000 created 2026-09-11T04:12:41Z",
    );
    expect(status.stdout).toContain(`configured image:  ${stable}\n`);
    expect(status.stdout).toContain("pulled image:      sha256:bbb");
    expect(status.stdout).toContain(
      "pulled release:    048d97800000 created 2026-09-11T16:30:00Z",
    );
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
  it("keeps the running image as agentcommons:previous, starts the stack, waits for /ready and reloads Caddy", () => {
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
    expect(order(reloadCaddy)).toBeGreaterThan(
      order("compose config --services"),
    );
    // The reload keeps Caddy's listening sockets open; a restart is only the fallback.
    expect(updated.docker).not.toContain("compose restart caddy");
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
    // Both release stamps are recorded for Admin → Status (R-INF-14).
    expect(state).toContain(`running_revision=${olderRelease.revision}`);
    expect(state).toContain(`running_created=${olderRelease.created}`);
    expect(state).toContain(`pulled_revision=${newerRelease.revision}`);
    expect(state).toContain(`pulled_created=${newerRelease.created}`);
  });
  it("restarts Caddy only when the reload fails, and still reports the update", () => {
    const { run } = fixture();
    const updated = run([], {
      running: "sha256:aaa",
      pulled: "sha256:bbb",
      env: { FAKE_RELOAD_FAIL: "1" },
    });
    expect(updated.status, updated.stderr).toBe(0);
    expect(updated.docker.indexOf("compose restart caddy")).toBeGreaterThan(
      updated.docker.indexOf(reloadCaddy),
    );
    expect(updated.state()).toContain("last_result=updated");
  });
  // @req R-INF-14
  it("holds a floating tag that offers an older release than the one running, and installs the next newer one", () => {
    const { run } = fixture();
    // The host runs a hand-built newer commit; :stable still points at the older CI image.
    const held = run([], {
      running: "sha256:aaa",
      runningRelease: newerRelease,
      pulled: "sha256:bbb",
      pulledRelease: olderRelease,
    });
    expect(held.status, held.stderr).toBe(0);
    expect(held.stdout).toContain("Holding");
    expect(held.stdout).toContain(
      "release 84f994100000 created 2026-09-11T04:12:41Z",
    );
    expect(held.stdout).toContain(
      "running release 048d97800000 created 2026-09-11T16:30:00Z",
    );
    expect(held.docker).toContain("compose pull --quiet api");
    expect(held.docker.some((line) => line.startsWith("tag "))).toBe(false);
    expect(held.docker.some((line) => line.startsWith("compose up"))).toBe(
      false,
    );
    const state = held.state();
    expect(state).toContain("last_result=held-newer-running");
    expect(state).toContain("last_image=sha256:bbb");
    expect(state).toContain(`running_revision=${newerRelease.revision}`);
    expect(state).toContain(`running_created=${newerRelease.created}`);
    expect(state).toContain(`pulled_revision=${olderRelease.revision}`);
    expect(state).toContain(`pulled_created=${olderRelease.created}`);
    // A held check is a completed one: the updater is healthy, it just has nothing newer.
    expect(state).toContain("failures=0");
    expect(state).toMatch(/^last_ok=\d{4}-\d{2}-\d{2}T/m);
    // The next hour repeats the hold without touching the stack.
    const again = run([], {
      running: "sha256:aaa",
      runningRelease: newerRelease,
      pulled: "sha256:bbb",
      pulledRelease: olderRelease,
    });
    expect(again.state()).toContain("last_result=held-newer-running");
    expect(again.docker.some((line) => line.startsWith("compose up"))).toBe(
      false,
    );
    // CI publishes a later commit: installed normally.
    const newer = run([], {
      running: "sha256:aaa",
      runningRelease: newerRelease,
      pulled: "sha256:ccc",
      pulledRelease: newestRelease,
    });
    expect(newer.status, newer.stderr).toBe(0);
    expect(newer.docker).toContain("tag sha256:aaa agentcommons:previous");
    expect(newer.state()).toContain("last_result=updated");
  });
  // @req R-INF-14
  it("treats a build of the same age as not newer, and a rebuild of the running commit as nothing to install", () => {
    const { run } = fixture();
    const sameAge = run([], {
      running: "sha256:aaa",
      runningRelease: newerRelease,
      pulled: "sha256:bbb",
      pulledRelease: { ...olderRelease, created: newerRelease.created },
    });
    expect(sameAge.status, sameAge.stderr).toBe(0);
    expect(sameAge.state()).toContain("last_result=held-newer-running");
    expect(sameAge.docker.some((line) => line.startsWith("compose up"))).toBe(
      false,
    );
    // The same commit built again (a re-run release, a hand build of the CI commit).
    const rebuilt = run([], {
      running: "sha256:aaa",
      runningRelease: newerRelease,
      pulled: "sha256:bbb",
      pulledRelease: { ...newerRelease, created: "2026-09-11T18:00:00Z" },
    });
    expect(rebuilt.status, rebuilt.stderr).toBe(0);
    expect(rebuilt.stdout).toContain(
      "rebuild of the running release 048d97800000",
    );
    expect(rebuilt.state()).toContain("last_result=same-release");
    expect(rebuilt.state()).toContain("failures=0");
    expect(rebuilt.docker.some((line) => line.startsWith("compose up"))).toBe(
      false,
    );
  });
  // @req R-INF-14
  it("holds when a release stamp is missing on either side instead of swapping blindly, but still starts a stack with nothing running", () => {
    const { run } = fixture();
    const pulledUnstamped = run([], {
      running: "sha256:aaa",
      runningRelease: newerRelease,
      pulled: "sha256:bbb",
      pulledRelease: { revision: newestRelease.revision },
    });
    expect(pulledUnstamped.status, pulledUnstamped.stderr).toBe(0);
    expect(pulledUnstamped.stdout).toContain("cannot tell whether");
    expect(pulledUnstamped.stdout).toContain("pulled release: unknown");
    expect(pulledUnstamped.stdout).toContain(
      "org.opencontainers.image.created",
    );
    expect(pulledUnstamped.state()).toContain("last_result=held-unknown-age");
    expect(pulledUnstamped.state()).toContain(
      `pulled_revision=${newestRelease.revision}`,
    );
    expect(pulledUnstamped.state()).toContain("pulled_created=\n");
    expect(
      pulledUnstamped.docker.some((line) => line.startsWith("compose up")),
    ).toBe(false);
    // A running image built without the stamp (a plain `docker compose build`) is never
    // replaced by the timer either; the operator installs the release by hand once.
    const runningUnstamped = run(["--now"], {
      running: "sha256:aaa",
      runningRelease: {},
      pulled: "sha256:bbb",
      pulledRelease: newestRelease,
    });
    expect(runningUnstamped.status, runningUnstamped.stderr).toBe(0);
    expect(runningUnstamped.stdout).toContain("running release: unknown");
    expect(runningUnstamped.state()).toContain("last_result=held-unknown-age");
    expect(
      runningUnstamped.docker.some((line) => line.startsWith("compose up")),
    ).toBe(false);
    // Nothing running means nothing to protect: the stack starts on the pulled image.
    const down = run([], {
      running: "",
      pulled: "sha256:bbb",
      pulledRelease: {},
    });
    expect(down.status, down.stderr).toBe(0);
    expect(down.stdout).toContain("No API container is running");
    expect(down.docker).toContain("compose up -d --no-build --remove-orphans");
    expect(down.docker.some((line) => line.startsWith("tag "))).toBe(false);
    expect(down.state()).toContain("last_result=updated");
  });
  // @req R-INF-14
  it("installs a pinned image exactly as configured, older or unstamped, while an explicit floating tag is still compared", () => {
    const { run } = fixture();
    const pin = `ghcr.io/agentcommonsdev/agentcommons:sha-${olderRelease.revision.slice(0, 12)}`;
    const byTag = run([], {
      env: { AGENTCOMMONS_IMAGE: pin },
      running: "sha256:aaa",
      runningRelease: newerRelease,
      pulled: "sha256:bbb",
      pulledRelease: olderRelease,
    });
    expect(byTag.status, byTag.stderr).toBe(0);
    expect(byTag.stdout).toContain(`${pin} is pinned`);
    expect(byTag.docker).toContain("tag sha256:aaa agentcommons:previous");
    expect(byTag.docker).toContain("compose up -d --no-build --remove-orphans");
    expect(byTag.state()).toContain("last_result=updated");
    const byDigest = run(["--now"], {
      env: {
        AGENTCOMMONS_IMAGE: `ghcr.io/agentcommonsdev/agentcommons@sha256:${"b".repeat(64)}`,
      },
      running: "sha256:aaa",
      runningRelease: newerRelease,
      pulled: "sha256:bbb",
      pulledRelease: {},
    });
    expect(byDigest.status, byDigest.stderr).toBe(0);
    expect(byDigest.stdout).toContain("is pinned");
    expect(byDigest.state()).toContain("last_result=updated");
    // AGENTCOMMONS_IMAGE naming a moving tag is not a pin.
    const floating = run([], {
      env: { AGENTCOMMONS_IMAGE: "registry.example.com/agentcommons:stable" },
      running: "sha256:aaa",
      runningRelease: newerRelease,
      pulled: "sha256:bbb",
      pulledRelease: olderRelease,
    });
    expect(floating.status, floating.stderr).toBe(0);
    expect(floating.state()).toContain("last_result=held-newer-running");
    expect(floating.docker.some((line) => line.startsWith("compose up"))).toBe(
      false,
    );
    // --status names both releases and marks a pin, so an operator sees why nothing moved.
    const status = run(["--status"], {
      env: { AGENTCOMMONS_IMAGE: pin },
      running: "sha256:aaa",
      runningRelease: newerRelease,
      pulled: "sha256:bbb",
      pulledRelease: olderRelease,
    });
    expect(status.stdout).toContain(
      "running release:   048d97800000 created 2026-09-11T16:30:00Z",
    );
    expect(status.stdout).toContain(
      `configured image:  ${pin} (pinned: installed as is)`,
    );
    expect(status.stdout).toContain(
      "pulled release:    84f994100000 created 2026-09-11T04:12:41Z",
    );
    expect(status.stdout).toContain("last_result=held-newer-running");
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
  it("records last_check on every run, counts consecutive failures and records last_ok when a check completes, for Admin → Status", () => {
    const { run } = fixture();
    const first = run(["--now"], { running: "sha256:aaa", pullFails: true });
    expect(first.state()).toMatch(
      /^last_check=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m,
    );
    expect(first.state()).toContain("failures=1");
    expect(first.state()).not.toContain("last_ok=");
    const second = run(["--now"], { running: "sha256:aaa", pullFails: true });
    expect(second.state()).toContain("failures=2");
    // A completed check (nothing to install) resets the count and stamps last_ok.
    const current = run(["--now"], {
      running: "sha256:aaa",
      pulled: "sha256:aaa",
    });
    expect(current.state()).toContain("last_result=unchanged");
    expect(current.state()).toContain("failures=0");
    expect(current.state()).toMatch(/^last_ok=\d{4}-\d{2}-\d{2}T/m);
    // A rolled-back release counts as a failure; the hold that follows completes a check.
    const failed = run([], {
      running: "sha256:aaa",
      pulled: "sha256:fff",
      ready: false,
    });
    expect(failed.state()).toContain("last_result=rolled-back");
    expect(failed.state()).toContain("failures=1");
    const held = run([], { running: "sha256:aaa", pulled: "sha256:fff" });
    expect(held.state()).toContain("last_result=skipped");
    expect(held.state()).toContain("failures=0");
    // The timer with updates off still proves the updater is alive.
    const { run: disabled } = fixture("AUTO_UPDATE=false\n");
    const off = disabled([], { running: "sha256:aaa" });
    expect(off.state()).toContain("last_result=disabled");
    expect(off.state()).toMatch(/^last_check=/m);
    expect(off.state()).toContain("failures=0");
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
