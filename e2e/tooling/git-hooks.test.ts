import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

// @req R-INF-04
it("real commits and pushes run the checked-in gates and stop on failures", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons hooks "));
  const repo = join(directory, "repo");
  const remote = join(directory, "remote.git");
  const bin = join(directory, "bin");
  for (const path of [repo, bin]) mkdirSync(path);
  const log = join(directory, "calls.txt");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    AC_HOOK_LOG: log,
    AC_FAIL_GATE: "",
  };
  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: repo, env, encoding: "utf8" });
  try {
    const pnpm = join(bin, "pnpm");
    writeFileSync(
      pnpm,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$AC_HOOK_LOG"\nif [ "$*" = "$AC_FAIL_GATE" ]; then exit 17; fi\n',
    );
    chmodSync(pnpm, 0o755);
    expect(git("init", "--initial-branch=main").status).toBe(0);
    expect(git("config", "user.name", "Hook test").status).toBe(0);
    expect(
      git("config", "user.email", "hook-test@example.invalid").status,
    ).toBe(0);
    for (const hook of ["pre-commit", "pre-push", "commit-msg"]) {
      const destination = join(repo, ".git/hooks", hook);
      copyFileSync(
        new URL(`../../.husky/${hook}`, import.meta.url),
        destination,
      );
      const contents = readFileSync(destination, "utf8");
      writeFileSync(destination, `#!/bin/sh\nset -e\n${contents}`);
      chmodSync(destination, 0o755);
    }
    writeFileSync(join(repo, "test.txt"), "test\n");
    expect(git("add", "test.txt").status).toBe(0);
    env.AC_FAIL_GATE = "exec lint-staged";
    expect(git("commit", "-m", "test: verify hooks").status).not.toBe(0);
    expect(git("rev-parse", "--verify", "HEAD").status).not.toBe(0);
    env.AC_FAIL_GATE = "";
    expect(git("commit", "-m", "test: verify hooks").status).toBe(0);
    expect(git("init", "--bare", remote).status).toBe(0);
    expect(git("remote", "add", "origin", remote).status).toBe(0);
    env.AC_FAIL_GATE = "typecheck";
    expect(git("push", "origin", "main").status).not.toBe(0);
    expect(
      git("--git-dir", remote, "rev-parse", "--verify", "refs/heads/main")
        .status,
    ).not.toBe(0);
    env.AC_FAIL_GATE = "";
    expect(git("push", "origin", "main").status).toBe(0);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls.slice(-4)).toEqual([
      "typecheck",
      "test",
      "openapi:check",
      "spec:check",
    ]);
    expect(calls).toContain("exec lint-staged");
    expect(
      calls.some((call) => call.startsWith("exec commitlint --edit")),
    ).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
