import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReaderPools } from "../src/readers.js";

const publicId = randomUUID();
const privateId = randomUUID();
const childId = randomUUID();
const purgedId = randomUUID();
const installationId = randomUUID();
const hiddenInstallationId = randomUUID();
const otherPublicId = randomUUID();
const otherPrivateId = randomUUID();
let container: StartedPostgreSqlContainer;
let writer: Client;
let readers: ReaderPools;
let migrationEnvironment: NodeJS.ProcessEnv;
const cleanup: (() => Promise<unknown>)[] = [];
const user = {
  organizationId: "org-a",
  role: "member",
  permissions: { sessions: ["read"] },
  authMethod: "key",
} as const;
const admin = {
  organizationId: "org-a",
  role: "admin",
  permissions: { sessions: ["read"], admin: ["*"] },
  authMethod: "key",
} as const;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  cleanup.push(() => container.stop());
  const appUrl = new URL(container.getConnectionUri());
  appUrl.username = "ac_app";
  appUrl.password = encodeURIComponent("app'quoted!%");
  const readerUrl = new URL(container.getConnectionUri());
  readerUrl.username = "ac_reader_user";
  readerUrl.password = "test-reader";
  const adminReaderUrl = new URL(container.getConnectionUri());
  adminReaderUrl.username = "ac_reader_admin";
  adminReaderUrl.password = "test-admin";
  migrationEnvironment = {
    ...process.env,
    DATABASE_MIGRATION_URL: container.getConnectionUri(),
    DATABASE_URL: appUrl.toString(),
    DATABASE_READER_USER_URL: readerUrl.toString(),
    DATABASE_READER_ADMIN_URL: adminReaderUrl.toString(),
  };
  await promisify(execFile)("pnpm", ["migrate"], {
    cwd: new URL("../", import.meta.url),
    env: migrationEnvironment,
  });
  writer = new Client({ connectionString: container.getConnectionUri() });
  await writer.connect();
  cleanup.push(() => writer.end());
  const userUrl = new URL(container.getConnectionUri());
  userUrl.username = "ac_reader_user";
  userUrl.password = "test-reader";
  const adminUrl = new URL(container.getConnectionUri());
  adminUrl.username = "ac_reader_admin";
  adminUrl.password = "test-admin";
  readers = new ReaderPools(
    {
      user: userUrl.toString(),
      admin: adminUrl.toString(),
    },
    { max: 1 },
  );
  cleanup.push(() => readers.close());
  await writer.query(
    `INSERT INTO public."user" (id,name,email,"updatedAt") VALUES ('owner','Owner','owner@example.test',now())`,
  );
  await writer.query(
    `INSERT INTO public.apikey (id,"referenceId",key,"createdAt","updatedAt") VALUES ('key','org-a','irreversible-test-hash',now(),now())`,
  );
  await writer.query(
    `INSERT INTO organization (id,name,slug,"createdAt") VALUES ('org-a','A','a',now()),('org-b','B','b',now())`,
  );
  await writer.query(
    `INSERT INTO api_key_owner(key_id,organization_id,user_id) VALUES ('key','org-a','owner')`,
  );
  for (const id of [installationId, hiddenInstallationId]) {
    await writer.query(
      `INSERT INTO public.installation(organization_id,id,hostname,os_user,platform,arch) VALUES('org-a',$1,$2,'user','linux','x64')`,
      [id, id],
    );
  }
  for (const [id, visibility, title, host, parent, purged] of [
    [privateId, "PRIVATE", "private parent", hiddenInstallationId, null, null],
    [publicId, "PUBLIC", "public root", installationId, null, null],
    [childId, "PUBLIC", "visible child", installationId, privateId, null],
    [purgedId, "PUBLIC", null, hiddenInstallationId, publicId, new Date()],
  ]) {
    await writer.query(
      `INSERT INTO public.agent_session
      (organization_id,id,harness,harness_session_id,user_id,ingest_api_key_id,installation_id,cwd,started_at,title,visibility,parent_session_id,parent_relation,purged_at,repo_name,tools_used,observed_commits)
      VALUES('org-a',$1::uuid,'CODEX',$1::text,'owner','key',$4,'/repo',now(),$3,$2::public."Visibility",$5,'SUBAGENT',$6,'host/team/repo',ARRAY['Read'],'[{"sha":"abc","subject":"change","author":"owner","timestamp":"2026-09-07T00:00:00Z"}]')`,
      [id, visibility, title, host, parent, purged],
    );
    if (!purged) {
      const batch = randomUUID();
      await writer.query(
        `INSERT INTO public.ingest_batch
        (organization_id,id,session_id,api_key_id,user_id,installation_id,ip,behavior,native_event,record_count,duplicate_count,byte_count,redaction_count,duration_ms,cursor,accepted_count,sent_at)
        VALUES('org-a',$1,$2,'key','owner',$3,'127.0.0.1','sync','Stop',1,0,100,0,1,'0:1',1,now())`,
        [batch, id, host],
      );
      const raw = randomUUID();
      await writer.query(
        `INSERT INTO public.raw_record(organization_id,id,session_id,pos,key,record_type,payload,ingest_batch_id) VALUES('org-a',$1,$2,0,'native','message','{}',$3)`,
        [raw, id, batch],
      );
      await writer.query(
        `INSERT INTO public.message(organization_id,id,session_id,raw_record_id,seq,block_index,role,kind,content,searchable,search_text)
        VALUES('org-a',$1,$2,$3,0,0,'USER','TEXT','running exactIdentifier',true,'running exactIdentifier')`,
        [randomUUID(), id, raw],
      );
      await writer.query(
        `INSERT INTO public.session_file(organization_id,session_id,path,ops) VALUES('org-a',$1,'src/auth.ts',ARRAY['read'])`,
        [id],
      );
    }
  }

  await writer.query(
    `INSERT INTO api_key_owner(key_id,organization_id,user_id) VALUES ('key-b','org-b','owner')`,
  );
  await writer.query(
    `INSERT INTO installation(organization_id,id,hostname,os_user,platform,arch) VALUES ('org-b',$1,'other-host','other-user','linux','x64')`,
    [installationId],
  );
  for (const [id, visibility] of [
    [otherPublicId, "PUBLIC"],
    [otherPrivateId, "PRIVATE"],
  ]) {
    await writer.query(
      `INSERT INTO agent_session(organization_id,id,harness,harness_session_id,user_id,ingest_api_key_id,installation_id,cwd,started_at,title,visibility,repo_name,tools_used)
      VALUES('org-b',$1,'CODEX',$2,'owner','key-b',$3,'/other',now(),'other organization',$4::"Visibility",'host/other/repo',ARRAY['SecretTool'])`,
      [
        id,
        visibility === "PUBLIC" ? publicId : privateId,
        installationId,
        visibility,
      ],
    );
    const batch = randomUUID();
    await writer.query(
      `INSERT INTO ingest_batch(organization_id,id,session_id,api_key_id,user_id,installation_id,ip,behavior,native_event,record_count,duplicate_count,byte_count,redaction_count,duration_ms,cursor,accepted_count,sent_at)
      VALUES('org-b',$1,$2,'key-b','owner',$3,'127.0.0.1','sync','Stop',1,0,100,0,1,'0:1',1,now())`,
      [batch, id, installationId],
    );
    const raw = randomUUID();
    await writer.query(
      `INSERT INTO raw_record(organization_id,id,session_id,pos,key,record_type,payload,ingest_batch_id) VALUES('org-b',$1,$2,0,'native','message','{}',$3)`,
      [raw, id, batch],
    );
    await writer.query(
      `INSERT INTO message(organization_id,id,session_id,raw_record_id,seq,block_index,role,kind,content,searchable,search_text) VALUES('org-b',$1,$2,$3,0,0,'USER','TEXT','running othersecret',true,'running othersecret')`,
      [randomUUID(), id, raw],
    );
    await writer.query(
      `INSERT INTO session_file(organization_id,session_id,path,ops) VALUES('org-b',$1,'secret/private.ts',ARRAY['read'])`,
      [id],
    );
  }
}, 120_000);

afterAll(async () => {
  for (const close of cleanup.reverse()) await close();
});

describe("database visibility contract", () => {
  // @req R-SEC-01
  it("connects as isolated restricted reader roles with bounded read-only transactions", async () => {
    for (const authority of [user, admin]) {
      await readers.read(authority, async (client) => {
        const settings = await client.query(`SELECT current_user,
          current_setting('search_path') AS search_path,
          current_setting('transaction_read_only') AS read_only,
          current_setting('statement_timeout') AS timeout,
          current_setting('work_mem') AS work_mem,
          current_setting('temp_file_limit') AS temp_limit,
          has_schema_privilege(current_user,'public','USAGE') AS public_usage,
          has_schema_privilege(current_user,'api_ro','USAGE') AS view_usage`);
        expect(settings.rows[0]).toEqual({
          current_user:
            authority === admin ? "ac_reader_admin" : "ac_reader_user",
          search_path: "api_ro",
          read_only: "on",
          timeout: "5s",
          work_mem: "16MB",
          temp_limit: "64MB",
          public_usage: false,
          view_usage: true,
        });
      });
      await expect(
        readers.read(authority, (c) =>
          c.query("SELECT * FROM public.agent_session"),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        readers.read(authority, (c) =>
          c.query("UPDATE sessions SET title = 'changed'"),
        ),
      ).rejects.toBeDefined();
      await expect(
        readers.read(authority, (c) => c.query("SET ROLE ac_app")),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  // @req R-SEC-02
  it("filters private and purged rows in every dependent view and invoker function", async () => {
    const views = [
      "sessions",
      "messages",
      "session_files",
      "session_observed_commits",
      "session_tools",
    ];
    for (const authority of [user, admin]) {
      await readers.read(authority, async (c) => {
        for (const view of views) {
          const result = await c.query<{ session_id: string }>(
            `SELECT DISTINCT session_id FROM ${view}`,
          );
          expect(result.rows.map((r) => r.session_id).sort()).toEqual(
            (authority === user
              ? [publicId, childId]
              : view === "sessions" ||
                  view === "session_tools" ||
                  view === "session_observed_commits"
                ? [publicId, childId, privateId, purgedId]
                : [publicId, childId, privateId]
            ).sort(),
          );
        }
        const hits = await c.query<{ session_id: string }>(
          "SELECT * FROM search_messages('running')",
        );
        expect(hits.rows.map((r) => r.session_id).sort()).toEqual(
          (authority === user
            ? [publicId, childId]
            : [publicId, childId, privateId]
          ).sort(),
        );
      });
    }
    const barriers = await writer.query<{ reloptions: string[] }>(
      "SELECT reloptions FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='api_ro' AND relkind='v'",
    );
    expect(barriers.rows).toHaveLength(28);
    expect(
      barriers.rows.every((row) =>
        row.reloptions.includes("security_barrier=true"),
      ),
    ).toBe(true);
    const funcs = await writer.query<{ prosecdef: boolean }>(
      "SELECT prosecdef FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='api_ro'",
    );
    expect(funcs.rows).toEqual([{ prosecdef: false }, { prosecdef: false }]);
  });

  // @req R-SEC-03
  it("derives parent references, counts, repository and installation summaries from visible sessions", async () => {
    await readers.read(user, async (c) => {
      const child = await c.query(
        "SELECT parent_session_id,parent_title FROM sessions WHERE session_id=$1",
        [childId],
      );
      expect(child.rows[0]).toEqual({
        parent_session_id: null,
        parent_title: null,
      });
      expect(
        (
          await c.query(
            "SELECT child_count FROM sessions WHERE session_id=$1",
            [publicId],
          )
        ).rows[0],
      ).toEqual({ child_count: "0" });
      expect(
        (await c.query("SELECT session_count,user_count FROM repos")).rows,
      ).toEqual([{ session_count: "2", user_count: "1" }]);
      expect(
        (
          await c.query(
            "SELECT installation_id,session_count FROM installations",
          )
        ).rows,
      ).toEqual([{ installation_id: installationId, session_count: "2" }]);
    });
    await readers.read(admin, async (c) => {
      expect(
        (
          await c.query(
            "SELECT parent_session_id,parent_title FROM sessions WHERE session_id=$1",
            [childId],
          )
        ).rows[0],
      ).toEqual({
        parent_session_id: privateId,
        parent_title: "private parent",
      });
      expect(
        (
          await c.query(
            "SELECT child_count FROM sessions WHERE session_id=$1",
            [publicId],
          )
        ).rows[0],
      ).toEqual({ child_count: "1" });
      expect((await c.query("SELECT session_count FROM repos")).rows).toEqual([
        { session_count: "4" },
      ]);
      expect((await c.query("SELECT * FROM installations")).rowCount).toBe(2);
    });
  });

  it("uses public visibility for an admin-owned key without admin scope and for demoted owners", async () => {
    for (const caller of [
      { ...user, role: "admin" as const },
      { ...admin, role: "member" as const },
    ]) {
      const result = await readers.read(caller, (c) =>
        c.query("SELECT session_id FROM sessions"),
      );
      expect(result.rowCount).toBe(2);
    }
    const cookie = await readers.read(
      { ...admin, permissions: {}, authMethod: "cookie" },
      (c) => c.query("SELECT session_id FROM sessions"),
    );
    expect(cookie.rowCount).toBe(4);
  });
});

// @req R-SQL-05
it("provides the specified catalog and a description for every exposed column and function", async () => {
  await readers.read(user, async (c) => {
    const columns = await c.query<{
      view_name: string;
      column_name: string;
      description: string;
      data_type: string;
    }>("SELECT * FROM schema_columns");
    expect([...new Set(columns.rows.map((r) => r.view_name))].sort()).toEqual(
      [
        "installations",
        "member_impact",
        "messages",
        "metrics_active_windows",
        "metrics_capture",
        "metrics_activity",
        "metrics_dashboard",
        "metrics_health",
        "metrics_mcp_calls",
        "metrics_members",
        "metrics_outcomes",
        "metrics_own_zero_results",
        "metrics_reads",
        "metrics_redaction",
        "metrics_reuse_sessions",
        "metrics_reuse_weekly",
        "metrics_usage",
        "repos",
        "reuse_edges",
        "schema_columns",
        "schema_functions",
        "session_files",
        "session_observed_commits",
        "session_reuse",
        "session_tools",
        "sessions",
        "users",
      ].sort(),
    );
    expect(
      columns.rows.some((column) => column.view_name === "session_base"),
    ).toBe(false);
    expect(
      columns.rows.every(
        (r) => r.description.length > 0 && r.data_type.length > 0,
      ),
    ).toBe(true);
    expect(
      columns.rows
        .filter((r) => r.view_name === "users")
        .map((r) => r.column_name),
    ).toEqual(["id", "email", "name"]);
    const funcs = await c.query<{
      function_name: string;
      arguments: string;
      result_type: string;
      description: string;
    }>(
      "SELECT function_name,arguments,result_type,description FROM schema_functions",
    );
    expect(funcs.rows).toEqual([
      {
        function_name: "search_messages",
        arguments: "q text",
        result_type: "TABLE(session_id uuid, seq integer, rank real)",
        description:
          "Uncapped lexical matches over visible searchable messages. Compose with session filters; order by rank DESC, session_id, seq.",
      },
    ]);
  });
});

// @req R-SRCH-02
it("generates dual-config A/B/C/D search vectors and indexes searchable messages only", async () => {
  const original = await writer.query<{ raw_record_id: string }>(
    "SELECT raw_record_id FROM message WHERE session_id=$1 LIMIT 1",
    [publicId],
  );
  const rawId = original.rows[0]?.raw_record_id;
  expect(rawId).toBeDefined();
  for (const [i, role, kind, weight, searchable] of [
    [1, "USER", "TEXT", "A", true],
    [2, "ASSISTANT", "TEXT", "B", true],
    [3, "SYSTEM", "TEXT", "B", true],
    [4, "ASSISTANT", "TOOL_USE", "C", true],
    [5, "TOOL_RESULT", "TOOL_RESULT", "D", true],
    [6, "ASSISTANT", "THINKING", "B", false],
  ] as const) {
    const result = await writer.query<{ search_tsv: string }>(
      `INSERT INTO message(organization_id,id,session_id,raw_record_id,seq,block_index,role,kind,content,searchable,search_text)
      VALUES('org-a',$1,$2,$3,$4,$4,$5::"MessageRole",$6::"MessageKind",'running exactIdentifier',$7,'running exactIdentifier') RETURNING search_tsv::text`,
      [randomUUID(), publicId, rawId, i, role, kind, searchable],
    );
    const vector = result.rows[0]?.search_tsv;
    expect(vector).toContain("'run':");
    expect(vector).toContain("'running':");
    expect(vector).toContain("'exactidentifier':");
    if (weight !== "D") expect(vector).toContain(weight);
    else expect(vector).not.toMatch(/[ABC]/);
  }
  const index = await writer.query<{ indexdef: string }>(
    "SELECT indexdef FROM pg_indexes WHERE indexname='message_search'",
  );
  expect(index.rows[0]?.indexdef).toMatch(
    /USING gin \(search_tsv\) WHERE searchable/,
  );
  await expect(
    writer.query(
      "UPDATE message SET search_tsv=''::tsvector WHERE session_id=$1",
      [publicId],
    ),
  ).rejects.toMatchObject({ code: "428C9" });
});

// @req R-SQL-06
it("exposes an uncapped search relation composable with predicates and aggregates", async () => {
  const batch = randomUUID();
  await writer.query(
    `INSERT INTO ingest_batch(organization_id,id,session_id,api_key_id,user_id,installation_id,ip,behavior,native_event,record_count,duplicate_count,byte_count,redaction_count,duration_ms,cursor,accepted_count,sent_at)
    VALUES('org-a',$1,$2,'key','owner',$3,'127.0.0.1','sync','Stop',550,0,550,0,1,'bulk',550,now())`,
    [batch, publicId, installationId],
  );
  for (let pos = 1; pos <= 550; pos++) {
    const raw = randomUUID();
    await writer.query(
      "INSERT INTO raw_record(organization_id,id,session_id,pos,record_type,payload,ingest_batch_id) VALUES('org-a',$1,$2,$3,'message','{}',$4)",
      [raw, publicId, pos, batch],
    );
    await writer.query(
      `INSERT INTO message(organization_id,id,session_id,raw_record_id,seq,block_index,role,kind,content,searchable,search_text)
      VALUES('org-a',$1,$2,$3,$4,0,'USER','TEXT','uncappedneedle',true,'uncappedneedle')`,
      [randomUUID(), publicId, raw, pos + 10],
    );
  }
  await readers.read(user, async (c) => {
    const hits = await c.query<{ rank: number }>(
      "SELECT * FROM search_messages('uncappedneedle')",
    );
    expect(hits.rowCount).toBe(550);
    expect(hits.rows.every((r) => r.rank > 0)).toBe(true);
    expect(
      (
        await c.query(
          "SELECT count(*) FROM search_messages('uncappedneedle') h JOIN sessions s USING(session_id) WHERE s.repo_name='host/team/repo' AND seq > 500",
        )
      ).rows,
    ).toEqual([{ count: "60" }]);
  });
});

it("documents why the SQL guard is required even with restricted roles", async () => {
  await readers.read(user, async (c) => {
    await c.query("SET LOCAL statement_timeout = '10s'");
    const changed = await c.query(
      "SELECT set_config('agentcommons.probe', 'changed', true) AS configured",
    );
    expect(changed.rows).toEqual([{ configured: "changed" }]);
    const catalog = await c.query<{ count: string }>(
      "SELECT count(*) FROM pg_catalog.pg_class",
    );
    expect(Number(catalog.rows[0]?.count)).toBeGreaterThan(0);
  });
});

it("keeps Prisma-owned schema in sync with migrations", async () => {
  const result = await promisify(execFile)(
    "pnpm",
    [
      "exec",
      "prisma",
      "migrate",
      "diff",
      "--from-schema-datasource",
      "prisma",
      "--to-schema-datamodel",
      "prisma",
      "--script",
    ],
    {
      cwd: new URL("../", import.meta.url),
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
    },
  );
  expect(result.stdout).toMatchSnapshot();
}, 30_000);

// @req R-ING-03 @req R-ING-04 @req R-ORG-07
it("enforces canonical uniqueness without reader exposure", async () => {
  const canonical = `redacted-${createHash("sha256").update("native").digest("hex")}`;
  const source = await writer.query<{
    harness_session_id: string;
    ingest_batch_id: string;
  }>(
    "SELECT s.harness_session_id,r.ingest_batch_id FROM agent_session s JOIN raw_record r ON r.session_id=s.id WHERE s.id=$1 LIMIT 1",
    [publicId],
  );
  const original = source.rows[0];
  if (!original) throw new Error("Expected a fixture session.");
  await expect(
    writer.query("UPDATE agent_session SET harness_session_id=$1 WHERE id=$2", [
      `redacted-${createHash("sha256").update(original.harness_session_id).digest("hex")}`,
      privateId,
    ]),
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    writer.query(
      "INSERT INTO raw_record(organization_id,id,session_id,pos,key,record_type,payload,ingest_batch_id) VALUES('org-a',$1,$2,999,$3,'message','{}',$4)",
      [randomUUID(), publicId, canonical, original.ingest_batch_id],
    ),
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    readers.read(user, (client) =>
      client.query("SELECT public.native_identity('native')"),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  expect(
    await readers.read(
      user,
      async (client) =>
        (
          await client.query<{ function_name: string }>(
            "SELECT function_name FROM schema_functions WHERE function_name='native_identity'",
          )
        ).rows,
    ),
  ).toEqual([]);
});

it("isolates every read surface between organizations, including organization admins", async () => {
  for (const caller of [user, admin]) {
    const result = await readers.read(
      { ...caller, organizationId: "org-b" },
      async (c) => {
        const sessions = await c.query<{ session_id: string }>(
          "SELECT session_id FROM sessions",
        );
        const messages = await c.query<{ session_id: string }>(
          "SELECT DISTINCT session_id FROM messages",
        );
        const hits = await c.query<{ session_id: string }>(
          "SELECT * FROM search_messages('running')",
        );
        expect(messages.rows.map((r) => r.session_id).sort()).toEqual(
          sessions.rows.map((r) => r.session_id).sort(),
        );
        expect(hits.rows.map((r) => r.session_id).sort()).toEqual(
          sessions.rows.map((r) => r.session_id).sort(),
        );
        expect((await c.query("SELECT repo_name FROM repos")).rows).toEqual([
          { repo_name: "host/other/repo" },
        ]);
        expect(
          (await c.query("SELECT hostname FROM installations")).rows,
        ).toEqual([{ hostname: "other-host" }]);
        expect(
          (await c.query("SELECT DISTINCT path FROM session_files")).rows,
        ).toEqual([{ path: "secret/private.ts" }]);
        expect(
          (await c.query("SELECT DISTINCT tool_name FROM session_tools")).rows,
        ).toEqual([{ tool_name: "SecretTool" }]);
        return sessions;
      },
    );
    expect(result.rows.map((r) => r.session_id).sort()).toEqual(
      (caller === admin
        ? [otherPublicId, otherPrivateId]
        : [otherPublicId]
      ).sort(),
    );
  }
});

it("clears transaction scope on successful and failed reads and fails closed without it", async () => {
  const url = new URL(container.getConnectionUri());
  url.username = "ac_reader_user";
  url.password = "test-reader";
  const direct = new Client({ connectionString: url.toString() });
  await direct.connect();
  try {
    expect((await direct.query("SELECT * FROM api_ro.sessions")).rowCount).toBe(
      0,
    );
  } finally {
    await direct.end();
  }
  for (const organizationId of ["org-a", "org-b", "org-a"]) {
    const result = await readers.read({ ...admin, organizationId }, (c) =>
      c.query<{ organization_id: string }>(
        "SELECT DISTINCT organization_id FROM sessions",
      ),
    );
    expect(result.rows).toEqual([{ organization_id: organizationId }]);
    await expect(
      readers.read({ ...admin, organizationId }, (c) =>
        c.query("SELECT 1 / 0"),
      ),
    ).rejects.toMatchObject({ code: "22012" });
  }
});

it("rejects cross-organization parents, ownership, installations, batches and source relationships", async () => {
  for (const [sql, params] of [
    [
      "UPDATE agent_session SET parent_session_id=$1 WHERE id=$2",
      [otherPublicId, publicId],
    ],
    [
      "UPDATE agent_session SET ingest_api_key_id='key-b' WHERE id=$1",
      [publicId],
    ],
    [
      "UPDATE agent_session SET installation_id=$1 WHERE id=$2",
      [hiddenInstallationId, otherPublicId],
    ],
    [
      "UPDATE message SET organization_id='org-b' WHERE session_id=$1",
      [publicId],
    ],
    [
      "UPDATE message SET session_id=$1 WHERE session_id=$2",
      [childId, publicId],
    ],
    [
      "UPDATE raw_record SET organization_id='org-b' WHERE session_id=$1",
      [publicId],
    ],
    [
      "UPDATE session_file SET organization_id='org-b' WHERE session_id=$1",
      [publicId],
    ],
  ] as const) {
    await expect(writer.query(sql, [...params])).rejects.toMatchObject({
      code: sql.includes("SET organization_id") ? "23514" : "23503",
    });
  }
});

// @req R-ING-04
it("stores native-key collisions at one source position while constraining keyless and keyed replay identities", async () => {
  const source = await writer.query<{ ingest_batch_id: string }>(
    "SELECT ingest_batch_id FROM raw_record WHERE session_id=$1 AND pos=0",
    [publicId],
  );
  const batchId = source.rows[0]?.ingest_batch_id;
  await writer.query(
    `INSERT INTO raw_record(organization_id,id,session_id,pos,source_version,key,record_type,payload,ingest_batch_id)
    VALUES('org-a',$1,$2,0,1,'native:versionhash','message','{"tools":["Read"]}',$3)`,
    [randomUUID(), publicId, batchId],
  );
  const versions = await writer.query<{ source_version: number }>(
    "SELECT source_version FROM raw_record WHERE session_id=$1 AND pos=0 ORDER BY source_version",
    [publicId],
  );
  expect(versions.rows).toEqual([{ source_version: 0 }, { source_version: 1 }]);
  await writer.query(
    `INSERT INTO raw_record(organization_id,id,session_id,pos,source_version,record_type,payload,ingest_batch_id)
    VALUES('org-a',$1,$2,0,1,'message','{}',$3)`,
    [randomUUID(), publicId, batchId],
  );
  await expect(
    writer.query(
      `INSERT INTO raw_record(organization_id,id,session_id,pos,source_version,record_type,payload,ingest_batch_id)
    VALUES('org-a',$1,$2,0,1,'message','{}',$3)`,
      [randomUUID(), publicId, batchId],
    ),
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    writer.query(
      `INSERT INTO raw_record(organization_id,id,session_id,pos,source_version,key,record_type,payload,ingest_batch_id)
    VALUES('org-a',$1,$2,500,0,'native:versionhash','message','{}',$3)`,
      [randomUUID(), publicId, batchId],
    ),
  ).rejects.toMatchObject({ code: "23505" });
});

it("provisions the actual four-URL migration CLI idempotently with escaped credentials", async () => {
  await promisify(execFile)("pnpm", ["migrate"], {
    cwd: new URL("../", import.meta.url),
    env: migrationEnvironment,
  });
  const app = new Client({
    connectionString: migrationEnvironment.DATABASE_URL,
  });
  await app.connect();
  try {
    expect(
      (await app.query<{ current_user: string }>("SELECT current_user")).rows,
    ).toEqual([{ current_user: "ac_app" }]);
    expect((await app.query("SELECT * FROM agent_session")).rowCount).toBe(6);
    await expect(
      app.query("UPDATE api_key_owner SET user_id='changed'"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("DELETE FROM api_key_owner")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      app.query("UPDATE audit_event SET detail='{}'"),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await app.end();
  }
  const direct = new Client({
    connectionString: migrationEnvironment.DATABASE_READER_USER_URL,
  });
  await direct.connect();
  try {
    await direct.query("BEGIN READ WRITE");
    await expect(
      direct.query("CREATE TEMP TABLE tenant_escape(id int)"),
    ).rejects.toMatchObject({ code: "42501" });
    await direct.query("ROLLBACK");
    expect(
      (
        await direct.query<{ allowed: boolean }>(
          "SELECT has_database_privilege(current_user,current_database(),'TEMPORARY') AS allowed",
        )
      ).rows,
    ).toEqual([{ allowed: false }]);
  } finally {
    await direct.end();
  }
}, 30_000);

// @req R-ORG-06
it("enforces organization foreign keys across every domain table, including policies, audit, and vectors", async () => {
  const scoped = await writer.query<{ table_name: string }>(`
    SELECT c.relname AS table_name FROM pg_constraint fk
    JOIN pg_class c ON c.oid=fk.conrelid
    JOIN pg_class target ON target.oid=fk.confrelid
    WHERE fk.contype='f' AND target.relname='organization'
      AND c.relname NOT IN ('member','invitation') ORDER BY c.relname
  `);
  expect(scoped.rows.map((row) => row.table_name)).toEqual([
    "agent_session",
    "api_key_owner",
    "audit_event",
    "embedding_budget",
    "ingest_batch",
    "installation",
    "message",
    "message_chunk",
    "raw_record",
    "redaction_event",
    "redaction_policy",
    "redaction_run",
    "session_embedding",
    "session_file",
  ]);
  const policyId = randomUUID();
  await writer.query(
    `INSERT INTO redaction_policy(organization_id,id,name,kind,pattern,replacement,updated_at)
    VALUES('org-b',$1,'other-policy','REGEX','secret','[removed]',now())`,
    [policyId],
  );
  const source = await writer.query<{ ingest_batch_id: string; id: string }>(
    "SELECT ingest_batch_id,id FROM raw_record WHERE session_id=$1 AND pos=0 AND source_version=0",
    [publicId],
  );
  await expect(
    writer.query(
      `INSERT INTO redaction_event(organization_id,ingest_batch_id,session_id,policy_id,count)
    VALUES('org-a',$1,$2,$3,1)`,
      [source.rows[0]?.ingest_batch_id, publicId, policyId],
    ),
  ).rejects.toMatchObject({ code: "23503" });
  const vector = `[${Array<string>(1024).fill("0").join(",")}]`;
  await expect(
    writer.query(
      `INSERT INTO session_embedding(organization_id,session_id,model,token_count,updated_at,embedding)
    VALUES('org-b',$1,'fake',1,now(),$2::vector)`,
      [publicId, vector],
    ),
  ).rejects.toMatchObject({ code: "23503" });
  const message = await writer.query<{ id: string }>(
    "SELECT id FROM message WHERE session_id=$1 LIMIT 1",
    [publicId],
  );
  await expect(
    writer.query(
      `INSERT INTO message_chunk(organization_id,id,session_id,message_id,ordinal,content,token_count,model,embedding)
    VALUES('org-b',$1,$2,$3,0,'text',1,'fake',$4::vector)`,
      [randomUUID(), publicId, message.rows[0]?.id, vector],
    ),
  ).rejects.toMatchObject({ code: "23503" });
  await expect(
    writer.query(
      `INSERT INTO audit_event(organization_id,id,request_id,auth_method,ip,transport,action,status_code,duration_ms,detail)
    VALUES('missing-org',$1,'request','key','127.0.0.1','rest','read',200,1,'{}')`,
      [randomUUID()],
    ),
  ).rejects.toMatchObject({ code: "23503" });
  const identities = await writer.query<{ organization_id: string }>(
    "SELECT organization_id FROM agent_session WHERE harness='CODEX' AND harness_session_id=$1 ORDER BY organization_id",
    [publicId],
  );
  expect(identities.rows).toEqual([
    { organization_id: "org-a" },
    { organization_id: "org-b" },
  ]);
});

it("stores adapter context for deterministic rescans without exposing it through reader views", async () => {
  const id = await writer.query<{ id: string; normalizer_context: unknown }>(
    "SELECT id,normalizer_context FROM agent_session ORDER BY id LIMIT 1",
  );
  const row = id.rows[0];
  if (!row) throw new Error("Fixture session is missing");
  expect(row.normalizer_context).toEqual({});
  await writer.query(
    "UPDATE agent_session SET normalizer_context=$1::jsonb WHERE id=$2",
    [
      JSON.stringify({
        activeLeafId: "leaf",
        transcriptMetadata: { model: "fixture" },
      }),
      row.id,
    ],
  );
  expect(
    (
      await writer.query<{ normalizer_context: unknown }>(
        "SELECT normalizer_context FROM agent_session WHERE id=$1",
        [row.id],
      )
    ).rows[0]?.normalizer_context,
  ).toEqual({ activeLeafId: "leaf", transcriptMetadata: { model: "fixture" } });
  const columns = await readers.read(admin, (client) =>
    client.query<{ column_name: string }>(
      "SELECT column_name FROM api_ro.schema_columns WHERE view_name='sessions'",
    ),
  );
  expect(columns.rows.map((column) => column.column_name)).not.toContain(
    "normalizer_context",
  );
});
