import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * @req R-INF-11 A release keeps the bundled database until the operator cuts over: rendering
 * parameters that name an external database must not restart the stack against it.
 */
function guard(oldEnv: string | null, newEnv: string) {
  const root = mkdtempSync(join(tmpdir(), "agentcommons-apply-guard-"));
  const stack = join(root, "app");
  mkdirSync(join(stack, "scripts", "self-host"), { recursive: true });
  cpSync(
    new URL("../../scripts/self-host/lib.sh", import.meta.url),
    join(stack, "scripts", "self-host", "lib.sh"),
  );
  if (oldEnv !== null) writeFileSync(join(stack, ".env"), oldEnv);
  writeFileSync(join(stack, ".env.new"), newEnv);
  const script = `
    . "${new URL("../scripts/single-node/host-lib.sh", import.meta.url).pathname}"
    cd "$app"
    if [ -f .env ] && [ "$(setting AGENTCOMMONS_DATABASE .env.new)" = external ] &&
      [ "$(setting AGENTCOMMONS_DATABASE .env)" != external ]; then
      keep_bundled_database .env.new .env .env.external
    fi
    mv .env.new .env
  `;
  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, AGENTCOMMONS_APP_DIR: stack },
  });
  const read = (name: string) => {
    try {
      return readFileSync(join(stack, name), "utf8");
    } catch {
      return null;
    }
  };
  return { result, env: read(".env"), external: read(".env.external") };
}
const external = [
  "PUBLIC_URL='https://example.test'",
  "AGENTCOMMONS_DATABASE='external'",
  "DATABASE_URL='postgresql://ac_app:x@cluster.example:5432/agentcommons?sslmode=require'",
  "DATABASE_MIGRATION_URL='postgresql://m:x@cluster.example:5432/agentcommons?sslmode=require'",
  "DATABASE_TRACE_CONTROL_URL='postgresql://c:x@cluster.example:5432/agentcommons?sslmode=require'",
  "CLICKHOUSE_POSTGRES_HOST='cluster.example'",
  "CLICKHOUSE_POSTGRES_PORT='5432'",
  "POSTGRES_PASSWORD='new-master'",
  "",
].join("\n");
const bundled = [
  "PUBLIC_URL='https://example.test'",
  "DATABASE_URL='postgresql://ac_app:old@db:5432/agentcommons'",
  "DATABASE_MIGRATION_URL='postgresql://m:old@db:5432/agentcommons'",
  "DATABASE_TRACE_CONTROL_URL='postgresql://c:old@db:5432/agentcommons'",
  "CLICKHOUSE_POSTGRES_HOST='db'",
  "POSTGRES_PASSWORD='old-master'",
  "",
].join("\n");

describe("apply.sh keeps the bundled database until the cutover", () => {
  it("keeps the running database settings and parks the external render", () => {
    const { result, env, external: parked } = guard(bundled, external);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("keeps the bundled db container");
    expect(env).toContain("AGENTCOMMONS_DATABASE='bundled'");
    expect(env).toContain(
      "DATABASE_URL='postgresql://ac_app:old@db:5432/agentcommons'",
    );
    expect(env).toContain("CLICKHOUSE_POSTGRES_HOST='db'");
    expect(env).toContain("POSTGRES_PASSWORD='old-master'");
    // Settings the old .env never had keep the rendered value; nothing else is lost.
    expect(env).toContain("CLICKHOUSE_POSTGRES_PORT='5432'");
    expect(env).toContain("PUBLIC_URL='https://example.test'");
    expect(env).not.toContain("cluster.example");
    expect(parked).toContain("AGENTCOMMONS_DATABASE='external'");
    expect(parked).toContain("CLICKHOUSE_POSTGRES_HOST='cluster.example'");
  });
  it("adopts the external database on a fresh host and after the cutover", () => {
    const fresh = guard(null, external);
    expect(fresh.result.status).toBe(0);
    expect(fresh.env).toContain("AGENTCOMMONS_DATABASE='external'");
    expect(fresh.external).toBeNull();
    const cutOver = guard(external, external);
    expect(cutOver.env).toContain("CLICKHOUSE_POSTGRES_HOST='cluster.example'");
    expect(cutOver.external).toBeNull();
  });
});
