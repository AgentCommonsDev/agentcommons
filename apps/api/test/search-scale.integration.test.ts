import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  refreshSearchCorpus,
  startTraceDatabase,
} from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import { CursorCodec } from "../src/services/cursor.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";
import { SearchService } from "../src/services/search.js";
import { provisionMember, provisionOrganization, releaser } from "./support.js";

// The hosted corpus reached 1.76 M messages in October 2026 and every search with a hit then
// failed at the 256 MiB reader limit: the candidate stage aggregated the latest revision of
// every message in the organization before the text index narrowed anything (ADR 0098). This
// fixture is larger than that corpus, so a search whose cost grows with the corpus fails here.
// Its sessions are longer than the hosted 99th percentile (1,683 messages) and shorter than
// the longest (7,702); `read-memory.integration.test.ts` covers one far longer session.
const SESSIONS = 400;
const PER_SESSION = 5_000;
const MESSAGES = SESSIONS * PER_SESSION;
const REPO = "github.com/acme/scale";
const { defer, release } = releaser();
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let admin: ServiceContext;
let member: ServiceContext;
let search: SearchService;
let sessions: string[];
let fixtures: TraceFixtures;

beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  fixtures = new TraceFixtures(db);
  defer(() => fixtures.close());
  const organization = await provisionOrganization(db, "search-scale");
  admin = organization.context;
  member = (await provisionMember(db, organization.owner, "reader@example.com"))
    .context;
  sessions = [];
  for (let index = 0; index < SESSIONS; index += 1)
    sessions.push(
      (
        await fixtures.sessionFor(admin, {
          visibility: "PUBLIC",
          fields: {
            title: `Scale session ${String(index)}`,
            repo_name: index < SESSIONS / 2 ? REPO : "github.com/acme/other",
            message_count: PER_SESSION,
          },
        })
      ).id,
    );
  // Row n belongs to session n % 400. Every message carries the common token, so a one-word
  // search matches the whole corpus. Rows 7 + 100003k carry the rare token, one in each of
  // twenty sessions; every tenth row is an Edit tool call; message time advances one second
  // per row from 2026-08-01, interleaving the sessions.
  await fixtures.client.command({
    query: `INSERT INTO messages
      (organization_id,session_id,message_id,seq,role,kind,content,tool_name,tool_input,
       search_text,searchable,received_at,revision,generation,deleted,fingerprint)
      SELECT {organization:String},arrayElement({sessions:Array(UUID)},toUInt32(number % {count:UInt64})+1),
        generateUUIDv4(),toUInt32(intDiv(number,{count:UInt64})),
        if(number % 10 = 0,'ASSISTANT','USER'),if(number % 10 = 0,'TOOL_USE','TEXT'),
        concat('scalefixture message ',toString(number)),if(number % 10 = 0,'Edit',NULL),'null',
        concat('scalefixture ',if(number % 100003 = 7,'rareneedle ',''),toString(number)),true,
        toDateTime64('2026-08-01 00:00:00',6)+toIntervalSecond(number),1,0,0,repeat('a',64)
      FROM numbers({messages:UInt64})`,
    query_params: {
      organization: requireCaller(admin).organizationId,
      sessions,
      count: SESSIONS,
      messages: MESSAGES,
    },
    abort_signal: AbortSignal.timeout(120_000),
  });
  await refreshSearchCorpus(db);
  search = new SearchService({
    prisma: db.prisma,
    readers: db.traceReaders,
    audit: db.audit,
    cursors: new CursorCodec("search-scale-fixture-cursor-secret"),
  });
}, 600_000);
afterAll(release);

/**
 * One search as admin and as member, alone and four at once, under the native reader limits.
 * Every session is public, so both readers see the same totals; the pages differ only in
 * `by_teammate` and the caller-bound cursor.
 */
async function underReaderLimits(input: Record<string, unknown>) {
  const pages = [];
  for (const [who, context] of [
    ["admin", admin],
    ["member", member],
  ] as const) {
    const started = performance.now();
    const single = await search.execute(context, input);
    expect(performance.now() - started, `${who} search ms`).toBeLessThan(4000);
    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () => search.execute(context, input)),
    );
    for (const page of concurrent) expect(page.result).toEqual(single.result);
    pages.push(single.result);
  }
  expect(pages[1]?.total).toEqual(pages[0]?.total);
  return pages[0];
}

// @req R-SRCH-22
it("ranks a query matching every message of a corpus larger than the hosted one", async () => {
  const page = await underReaderLimits({ query: "scalefixture", limit: 5 });
  expect(page?.total).toEqual({ sessions: SESSIONS, hits: MESSAGES });
  expect(page?.blocks.length).toBeGreaterThan(0);
  expect(page?.partial).toBeNull();
}, 120_000);

// @req R-SRCH-22
it("narrows a rare query by repository, message time and tool without scanning the corpus", async () => {
  const rare = await underReaderLimits({ query: "rareneedle", limit: 50 });
  expect(rare?.total).toEqual({ sessions: 20, hits: 20 });
  const narrowed = await underReaderLimits({
    query: "scalefixture",
    filters: {
      repo_name: REPO,
      tool_name: "Edit",
      since: "2026-08-01T00:00:00Z",
      until: "2026-08-01T00:01:40Z",
    },
    limit: 50,
  });
  // Rows 0–99 fall in the window and every tenth is an Edit call, each in its own session
  // among the first two hundred, which are REPO's.
  expect(narrowed?.total).toEqual({ sessions: 10, hits: 10 });
}, 120_000);

// @req R-SRCH-22
it("browses the newest message of each filtered session without a query", async () => {
  const page = await underReaderLimits({
    query: "",
    filters: { repo_name: REPO },
    limit: 3,
  });
  expect(page?.total).toEqual({ sessions: SESSIONS / 2, hits: MESSAGES / 2 });
  expect(page?.blocks).toHaveLength(3);
}, 120_000);

// @req R-SRCH-22
it("keeps corpus rows that lack metadata out of time filters until the worker reconcile copies it", async () => {
  const session = sessions[0];
  // An older release publishing while the migration runs writes only the columns it knows,
  // at the published revision, so its rows replace the complete ones.
  await fixtures.client.command({
    query: `INSERT INTO messages_current (organization_id,session_id,message_id,seq,role,kind,searchable,search_terms,revision,deleted)
      SELECT organization_id,session_id,message_id,seq,role,kind,searchable,search_terms,revision,deleted
      FROM messages_current FINAL WHERE session_id={session:UUID}`,
    query_params: { session },
  });
  const input = {
    query: "scalefixture",
    filters: { session_id: session, since: "2026-08-01T00:00:00Z" },
    limit: 1,
  };
  expect((await search.execute(admin, input)).result.total).toEqual({
    sessions: 0,
    hits: 0,
  });
  expect(await db.traces.reconcileCurrentMetadata(200)).toBe(1);
  expect(await db.traces.reconcileCurrentMetadata(200)).toBe(0);
  expect((await search.execute(admin, input)).result.total).toEqual({
    sessions: 1,
    hits: PER_SESSION,
  });
}, 120_000);
