// Regenerates the README screenshots (docs/assets/screenshots) from the real dashboard.
//
// The script builds the dashboard into a private directory, boots the browser fixture
// (scripts/browser-server.mjs: a disposable PostgreSQL and ClickHouse pair behind the real
// API) on a private port, seeds an example team through the public API, captures the screens
// README.md shows in both themes with Playwright Chromium, and writes the scaled captures.
// docs/assets/README.md describes the settings this file implements; AGENTS.md
// ("Screenshots follow the UI") says when to run it.
//
//   node scripts/readme-screenshots.mjs [--out <dir>] [--keep] [--port <n>]
//     [--only home,sessions,session,sql,install] [--themes dark,light] [--skip-build]
//
// --keep leaves the fixture running and keeps the raw captures for inspection. Nothing here
// reads the developer's .env or touches a shared fixture: the port, state file, assets and
// databases are private to one run.
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = createRequire(import.meta.url)("@playwright/test");

// ---- options ------------------------------------------------------------------------------
const SCREENS = ["home", "sessions", "session", "sql", "install"];
const { values: options } = parseArgs({
  options: {
    out: { type: "string" },
    keep: { type: "boolean", default: false },
    port: { type: "string", default: "3700" },
    only: { type: "string" },
    themes: { type: "string", default: "dark,light" },
    "skip-build": { type: "boolean", default: false },
  },
});
const dashboardDir = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = resolve(dashboardDir, "../..");
const outDir = resolve(
  options.out ?? join(repositoryRoot, "docs/assets/screenshots"),
);
const port = Number(options.port);
if (!Number.isInteger(port) || port < 1024 || port > 65532)
  throw new Error(`--port must be a port number, got ${options.port}`);
const screens = (options.only?.split(",") ?? SCREENS).map((name) => {
  if (!SCREENS.includes(name)) throw new Error(`unknown screen ${name}`);
  return name;
});
const themes = options.themes.split(",").map((theme) => {
  if (theme !== "dark" && theme !== "light")
    throw new Error(`unknown theme ${theme}`);
  return theme;
});
const origin = `http://localhost:${String(port)}`;
// Everything private to a run lives under the dashboard's node_modules: the prerender bundle
// resolves react relative to its own path, so the assets must sit inside apps/dashboard.
const workDir = join(dashboardDir, "node_modules/.readme-screenshots");
const distDir = join(workDir, "dist");
const rawDir = join(workDir, `raw-${String(port)}`);
const statePath = join(workDir, `state-${String(port)}.json`);
const fixtureLog = join(workDir, `fixture-${String(port)}.log`);
mkdirSync(workDir, { recursive: true });
mkdirSync(outDir, { recursive: true });
const log = (...parts) => {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ---- 1. build the dashboard into a private directory ---------------------------------------
function build() {
  const run = (file, args, extraEnv = {}) => {
    execFileSync(file, args, {
      cwd: dashboardDir,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, ...extraEnv },
    });
  };
  const vite = join(dashboardDir, "node_modules/.bin/vite");
  log("building the dashboard into", distDir);
  run("node", ["scripts/generate-blog.mjs"]);
  rmSync(distDir, { recursive: true, force: true });
  run(vite, ["build", "--outDir", distDir, "--logLevel", "warn"]);
  run(vite, [
    "build",
    "--ssr",
    "src/entry-server.tsx",
    "--outDir",
    join(distDir, "prerender"),
    "--logLevel",
    "warn",
  ]);
  symlinkSync(
    join(dashboardDir, "node_modules"),
    join(distDir, "node_modules"),
  );
  writeFileSync(join(distDir, "package.json"), '{ "type": "module" }\n');
  run("node", ["scripts/generate-public.mjs"], {
    DASHBOARD_DIST_DIR: pathToFileURL(`${distDir}/`).href,
  });
  if (!existsSync(join(distDir, "logo.png")))
    copyFileSync(
      join(dashboardDir, "public/logo.png"),
      join(distDir, "logo.png"),
    );
}

// ---- 2. boot the browser fixture on the private port ---------------------------------------
async function startFixture() {
  rmSync(statePath, { force: true });
  const logFd = openSync(fixtureLog, "w");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/browser-server.mjs"],
    {
      cwd: dashboardDir,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        DASHBOARD_BROWSER_PORT: String(port),
        DASHBOARD_BROWSER_STATE: statePath,
        DASHBOARD_BROWSER_ASSETS: distDir,
      },
    },
  );
  log("starting the browser fixture on", origin, "(log:", fixtureLog + ")");
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(
        `fixture exited with ${String(child.exitCode)}:\n${readFileSync(fixtureLog, "utf8").slice(-4000)}`,
      );
    const ready = await fetch(`${origin}/ready`).catch(() => null);
    if (ready?.ok && existsSync(statePath)) return child;
    await sleep(2000);
  }
  throw new Error(
    `fixture did not become ready within 10 minutes; see ${fixtureLog}`,
  );
}
async function stopFixture(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = new Promise((done) => child.once("exit", done));
  const timeout = sleep(90_000).then(() => "timeout");
  if ((await Promise.race([exited, timeout])) === "timeout")
    child.kill("SIGKILL");
}

// ---- HTTP helpers --------------------------------------------------------------------------
async function call(method, path, { headers = {}, body, ok = true } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      origin,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (ok && !response.ok)
    throw new Error(`${method} ${path} -> ${String(response.status)} ${text}`);
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, json, text };
}
const cookieHeader = (cookies) =>
  cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

// The API renames neither organizations nor people, and upload receipts are stamped on
// arrival, so names and session end times are set on the fixture's disposable PostgreSQL.
// The container is found by the organization id; statements run through its own psql.
function fixtureDatabase(organizationId) {
  const containers = execFileSync(
    "docker",
    ["ps", "--filter", "ancestor=postgres:16", "--format", "{{.ID}}"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const psql = (id, args, input) =>
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        id,
        "psql",
        "-U",
        "test",
        "-d",
        "test",
        "-v",
        "ON_ERROR_STOP=1",
        ...args,
      ],
      { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] },
    );
  for (const id of containers) {
    try {
      const found = psql(id, [
        "-tAc",
        `SELECT count(*) FROM organization WHERE id = '${organizationId}'`,
      ]).trim();
      if (found === "1") return (statement) => psql(id, ["-q"], statement);
    } catch {
      // Another fixture's database; keep looking.
    }
  }
  throw new Error("the fixture's PostgreSQL container was not found");
}

// ---- 3. seed the example team --------------------------------------------------------------
const sha = (seed) => createHash("sha1").update(seed).digest("hex");
const shortId = (seed) => sha(seed).slice(0, 8);
const people = [
  {
    email: "maya.chen@example.com",
    name: "Maya Chen",
    host: "maya-mbp",
    osUser: "maya",
    platform: "darwin",
    arch: "arm64",
    home: "/Users/maya",
    ip: "10.9.0.11",
  },
  {
    email: "theo.okafor@example.com",
    name: "Theo Okafor",
    host: "theo-thinkpad",
    osUser: "theo",
    platform: "linux",
    arch: "x64",
    home: "/home/theo",
    ip: "10.9.0.12",
  },
  {
    email: "priya.raman@example.com",
    name: "Priya Raman",
    host: "priya-mbp",
    osUser: "priya",
    platform: "darwin",
    arch: "arm64",
    home: "/Users/priya",
    ip: "10.9.0.13",
  },
];
const repos = {
  payments: {
    name: "payments-api",
    remote: "git@github.com:acme/payments-api.git",
  },
  web: { name: "web", remote: "git@github.com:acme/web.git" },
  infra: { name: "infra", remote: "git@github.com:acme/infra.git" },
  mobile: { name: "mobile", remote: "git@github.com:acme/mobile.git" },
};

// Neutral tool vocabulary; each harness builder renders it in its native record shape.
const S = {
  read: (path, result) => ({ tool: "read", args: { path }, result }),
  grep: (pattern, path, result) => ({
    tool: "grep",
    args: { pattern, path },
    result,
  }),
  edit: (path, oldText, newText, result = "Edited 1 location.") => ({
    tool: "edit",
    args: { path, oldText, newText },
    result,
  }),
  write: (path, content, result = "Wrote file.") => ({
    tool: "write",
    args: { path, content },
    result,
  }),
  bash: (command, result) => ({ tool: "bash", args: { command }, result }),
  search: (query, result) => ({ tool: "search", args: { query }, result }),
};
const text = (t) => ({ text: t });
const think = (t) => ({ think: t });

// Chronological scenarios. `reads` names an earlier scenario whose session this one opened
// through the API while live, which is what the reuse metrics measure. `hero` marks the
// session the README's session page shows; it spawns an Explore subagent.
const scenarios = [
  {
    id: "theo-refund-ledger",
    person: 1,
    harness: "CODEX",
    repo: "payments",
    branch: "theo/refund-ledger-async",
    daysAgo: 19,
    hour: 10,
    minute: 12,
    prompt:
      "Make refund ledger writes asynchronous so the POST /refunds handler stops blocking on the ledger service.",
    steps: [
      think(
        "The handler awaits ledger.write inline. Moving it to the outbox keeps the request fast but changes when the ledger row exists.",
      ),
      text("I'll look at the handler and the ledger client first."),
      S.read(
        "src/payments/refunds.py",
        "class RefundService:\n    def create(self, order_id, amount):\n        refund = self.repo.insert(order_id, amount)\n        self.ledger.write(refund)  # ~180ms p95\n        return refund",
      ),
      S.grep(
        "ledger.write",
        "src/",
        "src/payments/refunds.py:41\nsrc/payments/disputes.py:88",
      ),
      S.edit(
        "src/payments/refunds.py",
        "        self.ledger.write(refund)  # ~180ms p95",
        "        self.outbox.enqueue(LedgerWrite(refund.id))",
      ),
      S.bash("pytest tests/payments -q", "84 passed in 11.02s"),
      text(
        "Ledger writes now go through the outbox. Refund rows exist immediately; ledger rows land within the outbox interval (default 500 ms). Tests pass; anything asserting on the ledger right after a refund needs to await the outbox drain.",
      ),
    ],
    commit: { subject: "refunds: move ledger writes to the outbox", files: 2 },
  },
  {
    id: "maya-webhook-retry",
    person: 0,
    harness: "CLAUDE_CODE",
    repo: "payments",
    branch: "maya/webhook-retries",
    daysAgo: 18,
    hour: 14,
    minute: 3,
    prompt:
      "Stripe webhooks that fail with a 5xx from our side are never retried. Add exponential backoff with a dead-letter table.",
    steps: [
      think(
        "Need the current webhook handler, then decide between a job queue and a table. pg-boss is already in the stack.",
      ),
      S.search(
        "stripe webhook retry",
        '1 session: "Stripe webhook idempotency keys" (Priya Raman, 6 weeks ago) — decided to store event ids in webhook_events before processing.',
      ),
      S.read(
        "src/webhooks/stripe.py",
        "@router.post('/webhooks/stripe')\nasync def stripe_webhook(request):\n    event = stripe.Webhook.construct_event(...)\n    await handle(event)\n    return Response(200)",
      ),
      S.edit(
        "src/webhooks/stripe.py",
        "    await handle(event)",
        "    try:\n        await handle(event)\n    except Exception as error:\n        await retries.schedule(event, attempt=1, error=error)",
      ),
      S.write(
        "src/webhooks/retries.py",
        "BACKOFF = [30, 120, 600, 3600, 21600]\n\nasync def schedule(event, attempt, error): ...",
      ),
      S.bash("pytest tests/webhooks -q", "27 passed in 3.40s"),
      text(
        "Failed deliveries are retried 5 times over 6 hours and then land in webhook_dead_letters with the last error. I reused Priya's webhook_events table for idempotency so replays stay safe.",
      ),
    ],
    reads: "theo-refund-ledger",
    commit: {
      subject: "webhooks: retry failed Stripe events with backoff",
      files: 3,
    },
  },
  {
    id: "priya-checkout-a11y",
    person: 2,
    harness: "GEMINI_CLI",
    repo: "web",
    branch: "priya/checkout-a11y",
    daysAgo: 18,
    hour: 16,
    minute: 40,
    prompt:
      "Fix the axe violations on the checkout page: the coupon field has no label and the pay button loses focus outline.",
    steps: [
      S.grep(
        "coupon",
        "src/pages/checkout",
        'src/pages/checkout/Coupon.tsx:18: <input placeholder="Coupon code" />',
      ),
      S.edit(
        "src/pages/checkout/Coupon.tsx",
        '<input placeholder="Coupon code" />',
        '<label htmlFor="coupon">Coupon code</label>\n<input id="coupon" placeholder="SAVE10" />',
      ),
      S.edit(
        "src/pages/checkout/PayButton.tsx",
        "focus:outline-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
      ),
      S.bash("pnpm test:a11y -- checkout", "checkout: 0 violations (was 2)"),
      text(
        "Both violations are gone. The coupon input has a visible label and the pay button keeps a 2px focus ring.",
      ),
    ],
  },
  {
    id: "theo-flaky-ci",
    person: 1,
    harness: "PI",
    repo: "infra",
    branch: "main",
    daysAgo: 17,
    hour: 9,
    minute: 25,
    prompt:
      "Why does the deploy workflow take 14 minutes when the tests take 4? Find the slow step.",
    steps: [
      S.bash(
        "gh run view 8123412 --log | grep -E '^\\S+\\s+\\S+\\s+[0-9:]+' | head -40",
        "build  Set up job  0:04\nbuild  pnpm install  6:52\nbuild  pnpm build  2:10\nbuild  pnpm test  4:01",
      ),
      S.read(
        ".github/workflows/deploy.yml",
        "- uses: actions/setup-node@v4\n  with:\n    node-version: 24\n- run: pnpm install --frozen-lockfile",
      ),
      text(
        "pnpm install runs cold every time: setup-node has no `cache: pnpm`. Adding it should cut about six minutes.",
      ),
      S.edit(
        ".github/workflows/deploy.yml",
        "    node-version: 24",
        "    node-version: 24\n    cache: pnpm",
      ),
      text(
        "Enabled the pnpm store cache in setup-node. Next run should install in under a minute.",
      ),
    ],
  },
  {
    id: "maya-fx-rounding",
    person: 0,
    harness: "CLAUDE_CODE",
    repo: "payments",
    branch: "maya/fx-rounding",
    daysAgo: 16,
    hour: 11,
    minute: 5,
    prompt:
      "Totals in EUR invoices are off by one cent when the order has more than 3 line items. Find where we round.",
    steps: [
      think(
        "Rounding per line item then summing versus rounding the sum. Check the invoice builder.",
      ),
      S.grep(
        "round(",
        "src/invoices/",
        "src/invoices/build.py:52: total += round(line.amount * rate, 2)\nsrc/invoices/build.py:61: return round(total, 2)",
      ),
      S.read(
        "src/invoices/build.py",
        "for line in order.lines:\n    total += round(line.amount * rate, 2)\nreturn round(total, 2)",
      ),
      S.edit(
        "src/invoices/build.py",
        "    total += round(line.amount * rate, 2)",
        "    total += line.amount * rate",
      ),
      S.bash("pytest tests/invoices/test_fx.py -q", "9 passed in 0.88s"),
      text(
        "Line items were rounded before summing, so four or more items could drift by a cent. Totals now round once. Added a regression test with five lines at 0.8623 EUR/USD.",
      ),
    ],
    commit: { subject: "invoices: round FX totals once", files: 2 },
  },
  {
    id: "priya-mobile-crash",
    person: 2,
    harness: "CLAUDE_CODE",
    repo: "mobile",
    branch: "priya/fix-startup-crash",
    daysAgo: 16,
    hour: 15,
    minute: 20,
    prompt:
      "Crashlytics shows NullPointerException in SessionStore.restore on cold start for 0.4% of Android users since 4.12.0. Find it.",
    steps: [
      S.search("SessionStore restore cold start", "No matching sessions."),
      S.read(
        "android/app/src/main/java/com/acme/store/SessionStore.kt",
        "fun restore(): Session {\n    val json = prefs.getString(KEY, null)\n    return gson.fromJson(json, Session::class.java)\n}",
      ),
      S.grep(
        "KEY_SESSION",
        "android/app/src",
        "SessionStore.kt:12\nMigration412.kt:30  // renames the key",
      ),
      S.edit(
        "android/app/src/main/java/com/acme/store/SessionStore.kt",
        "    return gson.fromJson(json, Session::class.java)",
        "    return json?.let { gson.fromJson(it, Session::class.java) } ?: Session.anonymous()",
      ),
      S.bash(
        "./gradlew :app:testDebugUnitTest --tests '*SessionStore*'",
        "BUILD SUCCESSFUL in 41s\n6 tests completed",
      ),
      text(
        "The 4.12.0 migration renamed the preferences key, so users who last opened the app before 4.12 restore null. restore() now falls back to an anonymous session; the migration is left as is because it already ran for most users.",
      ),
    ],
    commit: {
      subject: "session: tolerate missing preferences after 4.12 migration",
      files: 2,
    },
  },
  {
    id: "theo-rate-limit",
    person: 1,
    harness: "CODEX",
    repo: "payments",
    branch: "theo/api-rate-limit",
    daysAgo: 15,
    hour: 13,
    minute: 48,
    prompt:
      "Add per-key rate limiting to the public API: 600 requests per minute, 429 with Retry-After, Redis-backed.",
    steps: [
      think(
        "Sliding window in Redis with a Lua script keeps it atomic. Middleware sits before auth resolution? No, after: keyed by API key.",
      ),
      S.search(
        "rate limit redis",
        '1 session: "Redis connection pooling for the queue" (Maya Chen) — pool lives in src/infra/redis.py.',
      ),
      S.read(
        "src/infra/redis.py",
        "pool = ConnectionPool.from_url(settings.REDIS_URL, max_connections=32)",
      ),
      S.write(
        "src/api/rate_limit.py",
        "WINDOW = 60\nLIMIT = 600\n\nasync def check(key_id): ...",
      ),
      S.edit(
        "src/api/app.py",
        "app.add_middleware(AuthMiddleware)",
        "app.add_middleware(AuthMiddleware)\napp.add_middleware(RateLimitMiddleware)",
      ),
      S.bash("pytest tests/api/test_rate_limit.py -q", "5 passed in 2.13s"),
      text(
        "Rate limiting is in place: sliding window per key in Redis, 429 with Retry-After once 600 requests in 60 seconds are exceeded. Reused the existing pool from Maya's session.",
      ),
    ],
    reads: "maya-webhook-retry",
    commit: { subject: "api: per-key sliding window rate limit", files: 4 },
  },
  {
    id: "maya-search-ranking",
    person: 0,
    harness: "CLAUDE_CODE",
    repo: "web",
    branch: "maya/search-ranking",
    daysAgo: 14,
    hour: 10,
    minute: 30,
    prompt:
      "Product search ranks out-of-stock items above in-stock ones. Boost availability without hiding unavailable products.",
    steps: [
      S.read(
        "src/search/rank.ts",
        "export const score = (hit) => hit.textScore * 1.0 + hit.popularity * 0.2;",
      ),
      S.edit(
        "src/search/rank.ts",
        "export const score = (hit) => hit.textScore * 1.0 + hit.popularity * 0.2;",
        "export const score = (hit) =>\n  hit.textScore * 1.0 + hit.popularity * 0.2 + (hit.inStock ? 0.35 : 0);",
      ),
      S.bash(
        "pnpm vitest run src/search",
        "Test Files  3 passed (3)\nTests  22 passed (22)",
      ),
      text(
        "In-stock hits get a fixed 0.35 boost, enough to move them above equal-text matches without reordering strong text matches. Snapshot tests updated.",
      ),
    ],
  },
  {
    id: "priya-terraform-drift",
    person: 2,
    harness: "GEMINI_CLI",
    repo: "infra",
    branch: "main",
    daysAgo: 14,
    hour: 17,
    minute: 2,
    prompt:
      "terraform plan in prod shows drift on the RDS parameter group. Show me what changed and whether it is safe to apply.",
    steps: [
      S.bash(
        "terraform plan -target=module.rds -no-color | head -60",
        '~ parameter { name = "max_connections" value = "500" -> "1000" }\n~ parameter { name = "log_min_duration_statement" value = "-1" -> "500" }',
      ),
      S.read(
        "modules/rds/parameters.tf",
        "max_connections = 500\nlog_min_duration_statement = -1",
      ),
      text(
        "Someone raised max_connections to 1000 and enabled slow-query logging in the console. The code still says 500 and off. Applying would revert both; 500 connections was the incident cause on the 2nd, so update the code instead.",
      ),
      S.edit(
        "modules/rds/parameters.tf",
        "max_connections = 500",
        "max_connections = 1000",
      ),
      S.edit(
        "modules/rds/parameters.tf",
        "log_min_duration_statement = -1",
        "log_min_duration_statement = 500",
      ),
      text("Code now matches the console change. Plan is clean."),
    ],
  },
  {
    id: "theo-pgboss-upgrade",
    person: 1,
    harness: "CLAUDE_CODE",
    repo: "payments",
    branch: "theo/pg-boss-10",
    daysAgo: 13,
    hour: 9,
    minute: 50,
    prompt:
      "Upgrade pg-boss from 9 to 10 and fix whatever breaks in the worker.",
    steps: [
      S.bash(
        "pnpm add pg-boss@10 && pnpm typecheck",
        "src/worker/index.ts(14,22): error TS2339: Property 'onComplete' does not exist",
      ),
      S.search(
        "pg-boss onComplete",
        '1 session: "Job completion hooks for billing emails" (Maya Chen) — onComplete used to send the receipt after charge.settle.',
      ),
      S.read(
        "src/worker/index.ts",
        "boss.onComplete('charge.settle', async (job) => sendReceipt(job.data.response));",
      ),
      S.edit(
        "src/worker/index.ts",
        "boss.onComplete('charge.settle', async (job) => sendReceipt(job.data.response));",
        "boss.work('charge.settle', async ([job]) => {\n  const response = await settle(job.data);\n  await sendReceipt(response);\n});",
      ),
      S.bash(
        "pnpm typecheck && pnpm vitest run src/worker",
        "Tests  14 passed (14)",
      ),
      text(
        "pg-boss 10 removed onComplete. The receipt now sends inside the settle worker after the charge succeeds. Behavior is the same; the separate completion job is gone.",
      ),
    ],
    reads: "maya-webhook-retry",
    commit: { subject: "worker: upgrade pg-boss to 10", files: 3 },
  },
  {
    id: "maya-ios-deeplink",
    person: 0,
    harness: "PI",
    repo: "mobile",
    branch: "maya/deeplink-orders",
    daysAgo: 12,
    hour: 14,
    minute: 15,
    prompt:
      "Universal links to /orders/:id open the app but land on the home tab. Route them to the order screen.",
    steps: [
      S.grep("onOpenURL", "ios/", "ios/App/AppDelegate.swift:44"),
      S.read("ios/App/Router.swift", 'case "orders": navigate(.ordersList)'),
      S.edit(
        "ios/App/Router.swift",
        'case "orders": navigate(.ordersList)',
        'case "orders":\n    if let id = path.dropFirst().first { navigate(.order(id)) } else { navigate(.ordersList) }',
      ),
      S.bash(
        "xcodebuild test -scheme App -only-testing AppTests/RouterTests | tail -3",
        "Executed 11 tests, with 0 failures",
      ),
      text(
        "Links with an order id now open that order. Bare /orders still shows the list.",
      ),
    ],
  },
  {
    id: "priya-checkout-perf",
    person: 2,
    harness: "CODEX",
    repo: "web",
    branch: "priya/checkout-lcp",
    daysAgo: 12,
    hour: 11,
    minute: 8,
    prompt:
      "Checkout LCP is 4.1s on mobile. Find the biggest contributor and fix it.",
    steps: [
      S.bash(
        "pnpm lighthouse http://localhost:5173/checkout --preset=mobile --quiet",
        "LCP 4.1 s  element: img.hero-product\nRender-blocking: /assets/vendor-3f1.js 812 kB",
      ),
      S.grep(
        "hero-product",
        "src/pages/checkout",
        'src/pages/checkout/Summary.tsx:23: <img className="hero-product" src={product.image} />',
      ),
      S.edit(
        "src/pages/checkout/Summary.tsx",
        '<img className="hero-product" src={product.image} />',
        '<img className="hero-product" src={product.image} fetchPriority="high" width={640} height={640} />',
      ),
      S.edit(
        "vite.config.ts",
        "manualChunks: undefined",
        "manualChunks: { stripe: ['@stripe/stripe-js'], charts: ['echarts'] }",
      ),
      S.bash(
        "pnpm build && pnpm lighthouse http://localhost:4173/checkout --preset=mobile --quiet",
        "LCP 2.3 s",
      ),
      text(
        "LCP dropped from 4.1s to 2.3s: the product image is fetched with high priority and sized, and echarts no longer ships in the checkout bundle.",
      ),
    ],
    commit: {
      subject: "checkout: prioritize hero image and split vendor chunks",
      files: 2,
    },
  },
  {
    id: "theo-audit-export",
    person: 1,
    harness: "CLAUDE_CODE",
    repo: "payments",
    branch: "theo/audit-export",
    daysAgo: 11,
    hour: 16,
    minute: 33,
    prompt:
      "Compliance wants a CSV export of the audit log filtered by date range and actor. Add GET /admin/audit/export.",
    steps: [
      S.search(
        "audit log csv export",
        '1 session: "Streaming CSV for invoice exports" (Theo Okafor) — uses StreamingResponse with a csv.writer over a generator.',
      ),
      S.read(
        "src/exports/invoices.py",
        "def stream_csv(rows):\n    buffer = io.StringIO()\n    writer = csv.writer(buffer)\n    ...",
      ),
      S.write(
        "src/admin/audit_export.py",
        "@router.get('/admin/audit/export')\nasync def export(date_from, date_to, actor=None): return StreamingResponse(stream_csv(rows), media_type='text/csv')",
      ),
      S.bash("pytest tests/admin/test_audit_export.py -q", "4 passed in 1.71s"),
      text(
        "Export streams CSV with the same helper the invoice export uses. Filters: date_from, date_to, actor. Requires the admin role.",
      ),
    ],
    reads: "theo-rate-limit",
    commit: { subject: "admin: audit log CSV export", files: 3 },
  },
  {
    id: "maya-cart-race",
    person: 0,
    harness: "GEMINI_CLI",
    repo: "web",
    branch: "maya/cart-race",
    daysAgo: 10,
    hour: 10,
    minute: 2,
    prompt:
      "Double-clicking Add to cart adds two items. Debounce or make the mutation idempotent, whichever is right.",
    steps: [
      S.read(
        "src/features/cart/useAddToCart.ts",
        "return useMutation({ mutationFn: (sku) => api.post('/cart/items', { sku }) });",
      ),
      text(
        "Debouncing hides the problem on slow networks. Send an idempotency key per click intent instead.",
      ),
      S.edit(
        "src/features/cart/useAddToCart.ts",
        "mutationFn: (sku) => api.post('/cart/items', { sku })",
        "mutationFn: (sku) => api.post('/cart/items', { sku }, { headers: { 'Idempotency-Key': intentId(sku) } })",
      ),
      S.bash("pnpm vitest run src/features/cart", "Tests  9 passed (9)"),
      text(
        "Each add intent carries an Idempotency-Key the API already honors, so repeated clicks collapse to one line item.",
      ),
    ],
  },
  {
    id: "priya-dunning",
    person: 2,
    harness: "CLAUDE_CODE",
    repo: "payments",
    branch: "priya/dunning-emails",
    daysAgo: 10,
    hour: 14,
    minute: 45,
    prompt:
      "Implement dunning: after a failed renewal, email on day 1, 3 and 7, then cancel the subscription.",
    steps: [
      think(
        "Schedule with pg-boss singletonKey per subscription so a successful payment can cancel the chain.",
      ),
      S.search(
        "dunning failed renewal email",
        '2 sessions: "Job completion hooks for billing emails" (Maya Chen), "worker: upgrade pg-boss to 10" (Theo Okafor) — work() replaces onComplete.',
      ),
      S.read(
        "src/worker/index.ts",
        "boss.work('charge.settle', async ([job]) => { ... });",
      ),
      S.write(
        "src/billing/dunning.ts",
        "export const schedule = [1, 3, 7];\nexport async function start(subscriptionId) { ... }",
      ),
      S.edit(
        "src/worker/index.ts",
        "boss.work('charge.settle'",
        "boss.work('dunning.step', dunningStep);\nboss.work('charge.settle'",
      ),
      S.bash("pnpm vitest run src/billing", "Tests  17 passed (17)"),
      text(
        "Dunning steps are pg-boss jobs keyed by subscription. A successful charge cancels the remaining steps; the day-7 step cancels the subscription. Templates reuse the receipt layout.",
      ),
    ],
    reads: "theo-pgboss-upgrade",
    commit: { subject: "billing: dunning schedule with pg-boss", files: 5 },
  },
  {
    id: "theo-k8s-oom",
    person: 1,
    harness: "GEMINI_CLI",
    repo: "infra",
    branch: "main",
    daysAgo: 9,
    hour: 8,
    minute: 55,
    prompt:
      "The api pods restarted 41 times overnight with OOMKilled. Find out why and propose limits.",
    steps: [
      S.bash(
        "kubectl -n prod top pods -l app=api --sort-by=memory | head",
        "api-7c9d-x2k1  480m  1890Mi\napi-7c9d-p0q8  460m  1875Mi",
      ),
      S.read(
        "k8s/api/deployment.yaml",
        "resources:\n  limits:\n    memory: 2Gi\n  requests:\n    memory: 1Gi",
      ),
      S.bash(
        "kubectl -n prod logs api-7c9d-x2k1 --previous | grep -i heap | tail -3",
        "FATAL ERROR: Reached heap limit\n--max-old-space-size not set; default ~1.4GB",
      ),
      text(
        "Node's default heap limit is below the 2Gi container limit, so the process dies before Kubernetes would. Set NODE_OPTIONS=--max-old-space-size=1536 and raise the limit to 2.5Gi until the report cache is bounded.",
      ),
      S.edit("k8s/api/deployment.yaml", "    memory: 2Gi", "    memory: 2.5Gi"),
      text(
        "Proposed change is in the manifest; the heap flag goes in the Dockerfile in a separate PR.",
      ),
    ],
  },
  {
    id: "maya-typed-router",
    person: 0,
    harness: "CODEX",
    repo: "web",
    branch: "maya/typed-routes",
    daysAgo: 9,
    hour: 13,
    minute: 20,
    prompt:
      "Migrate the remaining string routes in src/pages to the typed paths object so broken links fail typecheck.",
    steps: [
      S.grep(
        'to="/',
        "src/pages",
        "src/pages/account.tsx:44\nsrc/pages/orders.tsx:17\nsrc/pages/orders.tsx:98\nsrc/pages/help.tsx:12",
      ),
      S.edit("src/pages/account.tsx", 'to="/orders"', "to={paths.orders}"),
      S.edit(
        "src/pages/orders.tsx",
        "to={`/orders/${order.id}`}",
        "to={paths.order(order.id)}",
      ),
      S.edit(
        "src/pages/help.tsx",
        'to="/support/new"',
        "to={paths.supportNew}",
      ),
      S.bash("pnpm typecheck", "Found 0 errors."),
      text(
        "All four remaining string routes use the typed paths object. Typecheck passes.",
      ),
    ],
    commit: { subject: "pages: use typed route paths everywhere", files: 3 },
  },
  {
    id: "priya-push-tokens",
    person: 2,
    harness: "PI",
    repo: "mobile",
    branch: "priya/push-token-refresh",
    daysAgo: 8,
    hour: 15,
    minute: 5,
    prompt:
      "Push notifications stop after users reinstall. Make sure a refreshed FCM token is sent to the API.",
    steps: [
      S.grep(
        "onNewToken",
        "android/app/src",
        "android/app/src/main/java/com/acme/push/PushService.kt:21",
      ),
      S.read(
        "android/app/src/main/java/com/acme/push/PushService.kt",
        'override fun onNewToken(token: String) {\n    Log.d(TAG, "new token")\n}',
      ),
      S.edit(
        "android/app/src/main/java/com/acme/push/PushService.kt",
        '    Log.d(TAG, "new token")',
        '    Log.d(TAG, "new token")\n    scope.launch { api.registerPushToken(token) }',
      ),
      text(
        "onNewToken now registers the token with the API. Reinstalls get a fresh token and the server replaces the stale one.",
      ),
    ],
  },
  {
    id: "theo-openapi-drift",
    person: 1,
    harness: "CLAUDE_CODE",
    repo: "payments",
    branch: "theo/openapi-check",
    daysAgo: 7,
    hour: 11,
    minute: 40,
    prompt:
      "Add a CI check that fails when openapi.json is out of date with the route schemas.",
    steps: [
      S.read(
        "scripts/generate-openapi.ts",
        "writeFileSync('openapi.json', JSON.stringify(document, null, 2));",
      ),
      S.write(
        "scripts/check-openapi.ts",
        "const current = readFileSync('openapi.json', 'utf8');\nif (current !== render()) { console.error('openapi.json is stale; run pnpm openapi'); process.exit(1); }",
      ),
      S.edit(
        ".github/workflows/ci.yml",
        "      - run: pnpm test",
        "      - run: pnpm test\n      - run: pnpm openapi:check",
      ),
      S.bash("pnpm openapi:check", "openapi.json is current"),
      text(
        "CI now fails on a stale openapi.json with a message that names the fix.",
      ),
    ],
    commit: { subject: "ci: fail on stale openapi.json", files: 3 },
  },
  {
    id: "maya-hero",
    person: 0,
    harness: "CLAUDE_CODE",
    repo: "payments",
    branch: "maya/fix-flaky-refund-test",
    daysAgo: 6,
    hour: 10,
    minute: 18,
    hero: true,
    prompt:
      "test_refund_partial in tests/checkout is flaky on CI since Monday, about one run in five. Find the cause and fix it without weakening the assertion.",
    steps: [
      think(
        "Flaky since Monday, one in five. Something asynchronous. Check whether anyone touched refunds recently before reading the test.",
      ),
      text(
        "I'll check whether a recent session touched refunds, then read the test and the code it exercises.",
      ),
      S.search(
        "refund ledger flaky test_refund_partial",
        '1 session: "Make refund ledger writes asynchronous so the POST /refunds handler stops blocking on the ledger service." (Theo Okafor, 13 days ago, payments-api). Final message: ledger rows land within the outbox interval; tests asserting on the ledger right after a refund need to await the outbox drain.',
      ),
      text(
        "Theo moved ledger writes to the outbox 13 days ago and noted that tests asserting on the ledger right after a refund must await the drain. That matches the symptom. Let me confirm in the test.",
      ),
      S.read(
        "tests/checkout/test_refund.py",
        "def test_refund_partial(client, ledger):\n    order = create_order(client, total=80_00)\n    client.post(f'/refunds', json={'order_id': order.id, 'amount': 30_00})\n    assert ledger.balance(order.id) == 50_00",
      ),
      S.grep(
        "outbox.enqueue",
        "src/",
        "src/payments/refunds.py:41: self.outbox.enqueue(LedgerWrite(refund.id))\nsrc/payments/disputes.py:88: self.outbox.enqueue(LedgerWrite(dispute.refund_id))",
      ),
      {
        tool: "agent",
        args: {
          subagent_type: "Explore",
          description: "Find every ledger write path",
          prompt:
            "Find every place that writes to the refund ledger and report whether each is synchronous or goes through the outbox. Also find any existing test helper that drains the outbox.",
        },
        child: {
          prompt:
            "Find every place that writes to the refund ledger and report whether each is synchronous or goes through the outbox. Also find any existing test helper that drains the outbox.",
          steps: [
            S.grep(
              "ledger.write|outbox.enqueue",
              "src/ tests/",
              "src/payments/refunds.py:41: self.outbox.enqueue(LedgerWrite(refund.id))\nsrc/payments/disputes.py:88: self.outbox.enqueue(LedgerWrite(dispute.refund_id))\nsrc/payments/adjustments.py:19: self.ledger.write(adjustment)\ntests/conftest.py:71: def drain_outbox(outbox):",
            ),
            S.read(
              "tests/conftest.py",
              "@pytest.fixture\ndef drain_outbox(outbox):\n    def _drain():\n        outbox.process_pending()\n    return _drain",
            ),
            S.read(
              "src/payments/adjustments.py",
              "class AdjustmentService:\n    def apply(self, adjustment):\n        self.ledger.write(adjustment)  # synchronous on purpose: adjustments are admin-only",
            ),
          ],
          final:
            "Three ledger write paths:\n\n1. refunds.py:41 — outbox (asynchronous)\n2. disputes.py:88 — outbox (asynchronous)\n3. adjustments.py:19 — synchronous, commented as intentional for admin adjustments\n\nA drain_outbox fixture already exists in tests/conftest.py:71; it calls outbox.process_pending().",
        },
        result:
          "Three ledger write paths:\n\n1. refunds.py:41 — outbox (asynchronous)\n2. disputes.py:88 — outbox (asynchronous)\n3. adjustments.py:19 — synchronous, commented as intentional for admin adjustments\n\nA drain_outbox fixture already exists in tests/conftest.py:71; it calls outbox.process_pending().",
      },
      text(
        "The test reads the ledger before the outbox has drained. The fixture for that already exists, so the fix is to use it rather than to poll or sleep.",
      ),
      S.edit(
        "tests/checkout/test_refund.py",
        "def test_refund_partial(client, ledger):\n    order = create_order(client, total=80_00)\n    client.post(f'/refunds', json={'order_id': order.id, 'amount': 30_00})\n    assert ledger.balance(order.id) == 50_00",
        "def test_refund_partial(client, ledger, drain_outbox):\n    order = create_order(client, total=80_00)\n    client.post(f'/refunds', json={'order_id': order.id, 'amount': 30_00})\n    drain_outbox()\n    assert ledger.balance(order.id) == 50_00",
      ),
      S.bash(
        "for i in $(seq 1 25); do pytest tests/checkout/test_refund.py -q -p no:cacheprovider >/dev/null || echo FAIL $i; done; echo done",
        "done",
      ),
      text(
        "Fixed. The test asserted on the ledger before the outbox drained, which became possible when Theo moved ledger writes to the outbox on the 21st. The test now calls the existing drain_outbox fixture before the assertion; 25 consecutive runs pass and the assertion is unchanged. disputes.py has the same pattern, but its test already drains.",
      ),
    ],
    reads: "theo-refund-ledger",
    commit: {
      subject: "tests: drain the outbox before asserting refund balances",
      files: 1,
    },
  },
  {
    id: "priya-sso-okta",
    person: 2,
    harness: "CLAUDE_CODE",
    repo: "web",
    branch: "priya/okta-sso",
    daysAgo: 5,
    hour: 9,
    minute: 32,
    prompt:
      "Add Okta as an SSO provider next to Google on the login page. The backend already supports generic OIDC.",
    steps: [
      S.search(
        "OIDC provider login button",
        '1 session: "Google sign-in domains allowlist" (Maya Chen) — providers are listed from /api/v1/auth/providers.',
      ),
      S.read(
        "src/pages/login.tsx",
        "{providers.map((p) => <ProviderButton key={p.id} provider={p} />)}",
      ),
      S.read(
        "src/components/ProviderButton.tsx",
        "const icons = { google: GoogleIcon };",
      ),
      S.edit(
        "src/components/ProviderButton.tsx",
        "const icons = { google: GoogleIcon };",
        "const icons = { google: GoogleIcon, okta: OktaIcon };",
      ),
      S.bash("pnpm vitest run src/pages/login", "Tests  6 passed (6)"),
      text(
        "The login page already renders every configured provider; it only lacked an icon for Okta. Added the icon and a test that both buttons render when the API lists both providers.",
      ),
    ],
    reads: "maya-typed-router",
  },
  {
    id: "theo-slow-query",
    person: 1,
    harness: "CODEX",
    repo: "payments",
    branch: "theo/orders-index",
    daysAgo: 5,
    hour: 14,
    minute: 10,
    prompt:
      "GET /orders?customer_id=… takes 2.4s p95 for large customers. Fix the query.",
    steps: [
      S.bash(
        "psql $DATABASE_URL -c \"EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 'c_1' ORDER BY created_at DESC LIMIT 50\"",
        "Sort  (cost=41220.11..) actual time=2311.2\n  ->  Seq Scan on orders  (rows=1830211)",
      ),
      S.grep("orders_customer", "migrations/", "(no matches)"),
      S.write(
        "migrations/0142_orders_customer_created_idx.sql",
        "CREATE INDEX CONCURRENTLY orders_customer_created_idx ON orders (customer_id, created_at DESC);",
      ),
      S.bash(
        'pnpm db:migrate && psql $DATABASE_URL -c "EXPLAIN ANALYZE ..." | tail -2',
        "Index Scan using orders_customer_created_idx  actual time=1.9",
      ),
      text(
        "There was no index covering customer_id with the sort. Added (customer_id, created_at DESC) concurrently; p95 in staging fell from 2.4s to 8ms.",
      ),
    ],
    commit: {
      subject: "db: index orders by customer and created_at",
      files: 1,
    },
  },
  {
    id: "maya-feature-flags",
    person: 0,
    harness: "CLAUDE_CODE",
    repo: "web",
    branch: "maya/flags-cleanup",
    daysAgo: 4,
    hour: 11,
    minute: 55,
    prompt:
      "Remove the new_checkout feature flag; it has been 100% on for two months. Delete the old checkout path.",
    steps: [
      S.grep(
        "new_checkout",
        "src/",
        "src/pages/checkout/index.tsx:9\nsrc/pages/checkout/index.tsx:31\nsrc/lib/flags.ts:14\nsrc/pages/checkout/legacy/*.tsx (11 files)",
      ),
      S.edit(
        "src/pages/checkout/index.tsx",
        "return flags.new_checkout ? <Checkout /> : <LegacyCheckout />;",
        "return <Checkout />;",
      ),
      S.bash(
        "git rm -r src/pages/checkout/legacy && pnpm typecheck && pnpm vitest run",
        "Tests  212 passed (212)",
      ),
      text(
        "Flag and legacy checkout removed: 12 files, about 1,900 lines. Typecheck and tests pass.",
      ),
    ],
    commit: {
      subject: "checkout: remove new_checkout flag and legacy path",
      files: 13,
    },
  },
  {
    id: "priya-metrics-dash",
    person: 2,
    harness: "GEMINI_CLI",
    repo: "infra",
    branch: "main",
    daysAgo: 3,
    hour: 16,
    minute: 12,
    prompt:
      "Add a Grafana panel for webhook retry depth using the new webhook_retries_pending gauge.",
    steps: [
      S.grep(
        "webhook_retries_pending",
        "../payments-api/src",
        "src/webhooks/retries.py:58: PENDING.set(count)",
      ),
      S.read("grafana/dashboards/payments.json", '{ "panels": [ ... ] }'),
      S.edit(
        "grafana/dashboards/payments.json",
        '"panels": [',
        '"panels": [\n    { "type": "timeseries", "title": "Webhook retries pending", "targets": [{ "expr": "webhook_retries_pending" }] },',
      ),
      text(
        "Panel added to the payments dashboard. It shows the gauge Maya added with the retry work.",
      ),
    ],
    reads: "maya-webhook-retry",
  },
  {
    id: "theo-agents-md",
    person: 1,
    harness: "CLAUDE_CODE",
    repo: "payments",
    branch: "main",
    daysAgo: 2,
    hour: 10,
    minute: 5,
    prompt:
      "Update AGENTS.md with what we learned this month: outbox drains in tests, pg-boss 10 work() pattern, rate limit middleware order.",
    steps: [
      S.search(
        "outbox drain test",
        '3 sessions, newest: "tests: drain the outbox before asserting refund balances" (Maya Chen, 4 days ago).',
      ),
      S.search(
        "pg-boss work onComplete",
        '2 sessions, newest: "billing: dunning schedule with pg-boss" (Priya Raman).',
      ),
      S.read("AGENTS.md", "# Working in payments-api\n..."),
      S.edit(
        "AGENTS.md",
        "## Testing",
        "## Testing\n\n- Ledger writes are asynchronous (outbox). Call the `drain_outbox` fixture before asserting on ledger state.\n- pg-boss 10: use `boss.work()`; `onComplete` no longer exists.",
      ),
      text(
        "AGENTS.md now carries the three lessons with links to the sessions they came from.",
      ),
    ],
    reads: "maya-hero",
    commit: {
      subject:
        "docs: record outbox, pg-boss and middleware lessons in AGENTS.md",
      files: 1,
    },
  },
  {
    id: "maya-i18n",
    person: 0,
    harness: "CODEX",
    repo: "web",
    branch: "maya/de-locale",
    daysAgo: 1,
    hour: 13,
    minute: 42,
    prompt:
      "Add the German locale: extract the remaining hardcoded strings on the account pages and wire de.json.",
    steps: [
      S.grep(
        ">[A-Z][a-z]+ [a-z]+<",
        "src/pages/account",
        "src/pages/account/profile.tsx:22: >Display name<\nsrc/pages/account/security.tsx:40: >Change password<",
      ),
      S.edit(
        "src/pages/account/profile.tsx",
        ">Display name<",
        ">{t('account.displayName')}<",
      ),
      S.edit(
        "src/pages/account/security.tsx",
        ">Change password<",
        ">{t('account.changePassword')}<",
      ),
      S.write(
        "src/locales/de.json",
        '{ "account": { "displayName": "Anzeigename", "changePassword": "Passwort ändern" } }',
      ),
      S.bash("pnpm i18n:check", "de: 0 missing keys"),
      text(
        "Account pages are fully externalized and de.json covers every key.",
      ),
    ],
  },
  {
    id: "priya-today",
    person: 2,
    harness: "CLAUDE_CODE",
    repo: "mobile",
    branch: "priya/order-tracking",
    daysAgo: 0,
    hour: -2,
    minute: 10,
    prompt:
      "Show live order tracking on the order screen using the /orders/:id/events stream.",
    steps: [
      S.search(
        "order events stream SSE",
        '1 session: "Universal links to /orders/:id" (Maya Chen) — order screen route is .order(id).',
      ),
      S.read(
        "ios/App/Screens/OrderScreen.swift",
        "struct OrderScreen: View { let order: Order ... }",
      ),
      S.write(
        "ios/App/Services/OrderEvents.swift",
        "final class OrderEvents: ObservableObject { func connect(orderId: String) { ... } }",
      ),
      S.edit(
        "ios/App/Screens/OrderScreen.swift",
        "struct OrderScreen: View { let order: Order",
        "struct OrderScreen: View { let order: Order\n    @StateObject private var events = OrderEvents()",
      ),
      text(
        "The order screen subscribes to the event stream and renders each status change as it arrives. Reconnects with backoff on network loss.",
      ),
    ],
    reads: "maya-ios-deeplink",
  },
];

// ---- clocks and native record builders ------------------------------------------------------
const now = Date.now();
const startOf = (s) => {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - s.daysAgo);
  if (s.hour >= 0) date.setUTCHours(s.hour, s.minute, (s.daysAgo * 7) % 60, 0);
  else date.setTime(now + s.hour * 3_600_000 + s.minute * 60_000);
  return date.getTime();
};
class Clock {
  constructor(start) {
    this.t = start;
  }
  tick(seconds) {
    this.t += seconds * 1000;
    return new Date(this.t).toISOString();
  }
  now() {
    return new Date(this.t).toISOString();
  }
}
const seededRandom = (seed) => {
  let x = parseInt(sha(seed).slice(0, 8), 16);
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
};
const between = (rand, low, high) => Math.floor(low + rand() * (high - low));
const repoRoot = (person, repo) => `${person.home}/src/${repo.name}`;
const abs = (root, path) => (path.startsWith("/") ? path : `${root}/${path}`);
const bashFor = (step, root) => {
  switch (step.tool) {
    case "read":
      return `cat ${abs(root, step.args.path)}`;
    case "grep":
      return `rg -n ${JSON.stringify(step.args.pattern)} ${step.args.path}`;
    case "bash":
      return step.args.command;
    default:
      return "";
  }
};

function claudeRecords(s, person, repo, clock, options = {}) {
  const root = repoRoot(person, repo);
  const base = () => ({
    parentUuid: null,
    isSidechain: options.sidechain ?? false,
    ...(options.agentId ? { agentId: options.agentId } : {}),
    userType: "external",
    entrypoint: "cli",
    cwd: root,
    sessionId: options.sessionId,
    version: "2.1.265",
    gitBranch: s.branch,
  });
  const records = [];
  let parent = null;
  const push = (record) => {
    record.parentUuid = parent;
    parent = record.uuid;
    records.push(record);
  };
  const rand = seededRandom(s.id + (options.agentId ?? ""));
  const usage = () => ({
    input_tokens: between(rand, 3, 40),
    cache_creation_input_tokens: between(rand, 200, 4000),
    cache_read_input_tokens: between(rand, 12000, 48000),
    output_tokens: between(rand, 60, 700),
  });
  const model = options.model ?? "claude-opus-5";
  const assistant = (content) => ({
    ...base(),
    type: "assistant",
    uuid: randomUUID(),
    timestamp: clock.tick(between(rand, 4, 25)),
    message: {
      model,
      id: `msg_${sha(randomUUID()).slice(0, 24)}`,
      type: "message",
      role: "assistant",
      content,
      stop_reason: content.some((c) => c.type === "tool_use")
        ? "tool_use"
        : "end_turn",
      usage: usage(),
    },
  });
  const toolInput = (step) => {
    switch (step.tool) {
      case "read":
        return {
          name: "Read",
          input: { file_path: abs(root, step.args.path) },
        };
      case "grep":
        return {
          name: "Grep",
          input: {
            pattern: step.args.pattern,
            path: abs(root, step.args.path),
            output_mode: "content",
          },
        };
      case "edit":
        return {
          name: "Edit",
          input: {
            file_path: abs(root, step.args.path),
            old_string: step.args.oldText,
            new_string: step.args.newText,
          },
        };
      case "write":
        return {
          name: "Write",
          input: {
            file_path: abs(root, step.args.path),
            content: step.args.content,
          },
        };
      case "bash":
        return {
          name: "Bash",
          input: {
            command: step.args.command,
            description: step.args.command.split(" ").slice(0, 3).join(" "),
          },
        };
      case "search":
        return {
          name: "mcp__agentcommons__search",
          input: { query: step.args.query },
        };
      case "agent":
        return { name: "Agent", input: step.args };
      default:
        throw new Error(step.tool);
    }
  };
  push({
    ...base(),
    type: "user",
    uuid: randomUUID(),
    timestamp: clock.now(),
    message: { role: "user", content: s.prompt },
  });
  const pendingText = [];
  const flushAssistant = (toolBlock) => {
    const content = pendingText.splice(0);
    if (toolBlock) content.push(toolBlock);
    if (content.length) push(assistant(content));
  };
  for (const step of s.steps) {
    if (step.think) {
      pendingText.push({
        type: "thinking",
        thinking: step.think,
        signature: sha(step.think),
      });
      continue;
    }
    if (step.text) {
      pendingText.push({ type: "text", text: step.text });
      continue;
    }
    const id = `toolu_01${sha(randomUUID()).slice(0, 22)}`;
    const { name, input } = toolInput(step);
    flushAssistant({ type: "tool_use", id, name, input });
    const seconds =
      step.tool === "agent"
        ? between(rand, 60, 140)
        : step.tool === "bash"
          ? between(rand, 5, 50)
          : between(rand, 1, 4);
    push({
      ...base(),
      type: "user",
      uuid: randomUUID(),
      timestamp: clock.tick(seconds),
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: id, content: step.result },
        ],
      },
      ...(step.tool === "agent"
        ? {
            toolUseResult: {
              agentId: options.childAgentId,
              agentType: step.args.subagent_type,
              status: "completed",
            },
          }
        : {}),
    });
  }
  flushAssistant(null);
  return records;
}

function codexRecords(s, person, repo, clock) {
  const root = repoRoot(person, repo);
  const rand = seededRandom(s.id);
  const threadId = randomUUID();
  const turnId = randomUUID();
  const records = [];
  const push = (type, payload) => {
    records.push({
      timestamp: clock.tick(between(rand, 2, 20)),
      ordinal: records.length,
      type,
      payload,
    });
  };
  records.push({
    timestamp: clock.now(),
    ordinal: 0,
    type: "session_meta",
    payload: {
      session_id: threadId,
      id: threadId,
      timestamp: clock.now(),
      cwd: root,
      originator: "codex_cli_rs",
      cli_version: "0.153.4",
      source: "cli",
      thread_source: "user",
      model_provider: "openai",
      base_instructions: { text: "You are Codex, an agent based on GPT-6." },
      git: {
        branch: s.branch,
        repository_url: repo.remote,
        commit_hash: sha(s.id).slice(0, 40),
      },
    },
  });
  push("turn_context", {
    turn_id: turnId,
    cwd: root,
    model: "gpt-6-astra",
    approval_policy: "on-request",
    sandbox_policy: { type: "workspace-write" },
  });
  push("response_item", {
    type: "message",
    id: `msg_${randomUUID()}`,
    role: "user",
    content: [{ type: "input_text", text: s.prompt }],
    internal_chat_message_metadata_passthrough: {
      turn_id: turnId,
      create_time: Date.now() / 1000,
      content_item_kinds: ["user.text"],
    },
  });
  let input = 0;
  let output = 0;
  for (const step of s.steps) {
    if (step.think) {
      push("response_item", {
        type: "reasoning",
        id: `rs_${sha(randomUUID()).slice(0, 40)}`,
        summary: [{ type: "summary_text", text: step.think }],
      });
      continue;
    }
    if (step.text) {
      push("response_item", {
        type: "message",
        id: `msg_${sha(randomUUID()).slice(0, 40)}`,
        role: "assistant",
        content: [{ type: "output_text", text: step.text }],
        phase: "commentary",
      });
      continue;
    }
    const callId = `call_${sha(randomUUID()).slice(0, 22)}`;
    if (step.tool === "search") {
      push("response_item", {
        type: "function_call",
        id: `fc_${sha(randomUUID()).slice(0, 40)}`,
        call_id: callId,
        name: "mcp__agentcommons__search",
        arguments: JSON.stringify({ query: step.args.query }),
      });
      push("response_item", {
        type: "function_call_output",
        id: `fco_${randomUUID()}`,
        call_id: callId,
        output: step.result,
      });
    } else if (step.tool === "edit" || step.tool === "write") {
      const path = abs(root, step.args.path);
      const patch =
        step.tool === "edit"
          ? `*** Begin Patch\n*** Update File: ${path}\n@@\n-${step.args.oldText.split("\n").join("\n-")}\n+${step.args.newText.split("\n").join("\n+")}\n*** End Patch`
          : `*** Begin Patch\n*** Add File: ${path}\n+${step.args.content.split("\n").join("\n+")}\n*** End Patch`;
      push("response_item", {
        type: "custom_tool_call",
        id: `ctc_${sha(randomUUID()).slice(0, 40)}`,
        status: "completed",
        call_id: callId,
        name: "apply_patch",
        input: patch,
      });
      push("response_item", {
        type: "custom_tool_call_output",
        id: `ctco_${randomUUID()}`,
        call_id: callId,
        output: [
          {
            type: "input_text",
            text: `Success. Updated the following files:\n${path}`,
          },
        ],
      });
    } else {
      const cmd = bashFor(step, root);
      push("response_item", {
        type: "custom_tool_call",
        id: `ctc_${sha(randomUUID()).slice(0, 40)}`,
        status: "completed",
        call_id: callId,
        name: "exec",
        input: `text(await tools.exec_command({cmd:${JSON.stringify(cmd)},"max_output_tokens":4000}));\n`,
      });
      push("event_msg", {
        type: "item_completed",
        thread_id: threadId,
        turn_id: turnId,
        item: {
          type: "CommandExecution",
          id: `exec-${randomUUID()}`,
          command: ["/bin/bash", "-lc", cmd],
          cwd: `file://${root}`,
          parsed_cmd:
            step.tool === "read"
              ? [
                  {
                    type: "read",
                    cmd,
                    name: step.args.path.split("/").at(-1),
                    path: step.args.path,
                  },
                ]
              : [{ type: "unknown", cmd }],
          status: "completed",
          stdout: step.result,
          exit_code: 0,
        },
      });
      push("response_item", {
        type: "custom_tool_call_output",
        id: `ctco_${randomUUID()}`,
        call_id: callId,
        output: [
          {
            type: "input_text",
            text: "Script completed\nWall time 0.4 seconds\nOutput:\n",
          },
          {
            type: "input_text",
            text: JSON.stringify({
              chunk_id: sha(callId).slice(0, 6),
              exit_code: 0,
              output: step.result,
            }),
          },
        ],
      });
    }
    input += between(rand, 9000, 30000);
    output += between(rand, 80, 600);
  }
  push("event_msg", {
    type: "token_count",
    info: {
      total_token_usage: {
        input_tokens: input,
        cached_input_tokens: Math.floor(input * 0.8),
        output_tokens: output,
        reasoning_output_tokens: Math.floor(output * 0.3),
        total_tokens: input + output,
      },
    },
  });
  return { records, threadId };
}

function geminiRecords(s, person, repo, clock) {
  const root = repoRoot(person, repo);
  const rand = seededRandom(s.id);
  const messages = [];
  const startTime = clock.now();
  messages.push({
    id: randomUUID(),
    timestamp: clock.now(),
    type: "user",
    content: [{ text: s.prompt }],
  });
  let current = null;
  const flush = () => {
    if (current) messages.push(current);
    current = null;
  };
  const open = () => {
    current ??= {
      id: randomUUID(),
      timestamp: clock.tick(between(rand, 3, 15)),
      type: "gemini",
      content: "",
      thoughts: [],
      tokens: {
        input: between(rand, 8000, 30000),
        output: between(rand, 40, 500),
        cached: 0,
        thoughts: between(rand, 50, 400),
        tool: 0,
        total: 0,
      },
      model: "gemini-2.5-pro",
      toolCalls: [],
    };
    return current;
  };
  const nativeTool = (step) => {
    switch (step.tool) {
      case "read":
        return {
          name: "read_file",
          args: { file_path: abs(root, step.args.path) },
        };
      case "grep":
        return {
          name: "grep_search",
          args: { pattern: step.args.pattern, path: abs(root, step.args.path) },
        };
      case "edit":
        return {
          name: "replace",
          args: {
            file_path: abs(root, step.args.path),
            old_string: step.args.oldText,
            new_string: step.args.newText,
          },
        };
      case "write":
        return {
          name: "write_file",
          args: {
            file_path: abs(root, step.args.path),
            content: step.args.content,
          },
        };
      case "bash":
        return {
          name: "run_shell_command",
          args: { command: step.args.command },
        };
      case "search":
        return {
          name: "mcp_agentcommons_search",
          args: { query: step.args.query },
        };
      default:
        throw new Error(step.tool);
    }
  };
  for (const step of s.steps) {
    if (step.think) {
      open().thoughts.push({
        subject: step.think.split(".")[0].slice(0, 40),
        description: step.think,
        timestamp: clock.tick(2),
      });
      continue;
    }
    if (step.text) {
      const message = open();
      if (message.content || message.toolCalls.length) {
        flush();
        open().content = step.text;
      } else message.content = step.text;
      flush();
      continue;
    }
    if (open().content) flush();
    const tool = nativeTool(step);
    const id = `${tool.name}_${String(Date.now())}_${String(messages.length)}`;
    open().toolCalls.push({
      id,
      name: tool.name,
      args: tool.args,
      status: "success",
      timestamp: clock.tick(between(rand, 1, 8)),
      resultDisplay: step.result,
      result: [
        {
          functionResponse: {
            id,
            name: tool.name,
            response: { output: step.result },
          },
        },
      ],
    });
    flush();
  }
  flush();
  for (const message of messages)
    if (message.tokens)
      message.tokens.total =
        message.tokens.input + message.tokens.output + message.tokens.thoughts;
  return {
    messages,
    metadata: {
      sessionId: randomUUID(),
      projectHash: sha(root),
      startTime,
      lastUpdated: clock.now(),
      kind: "main",
    },
  };
}

function piRecords(s, person, repo, clock) {
  const root = repoRoot(person, repo);
  const rand = seededRandom(s.id);
  const sessionId = randomUUID();
  const records = [];
  let parentId = null;
  const push = (record) => {
    record.parentId = parentId;
    parentId = record.id;
    records.push(record);
  };
  records.push({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: clock.now(),
    cwd: root,
  });
  const model = "claude-sonnet-5";
  push({
    type: "model_change",
    id: shortId(randomUUID()),
    timestamp: clock.tick(1),
    provider: "anthropic",
    modelId: model,
  });
  push({
    type: "thinking_level_change",
    id: shortId(randomUUID()),
    timestamp: clock.tick(0),
    thinkingLevel: "medium",
  });
  const message = (content, extra = {}) => ({
    type: "message",
    id: shortId(randomUUID()),
    timestamp: clock.tick(between(rand, 3, 20)),
    message: { ...content, timestamp: clock.t, ...extra },
  });
  push(message({ role: "user", content: [{ type: "text", text: s.prompt }] }));
  const nativeTool = (step) => {
    switch (step.tool) {
      case "read":
        return { name: "read", arguments: { path: abs(root, step.args.path) } };
      case "grep":
        return {
          name: "grep",
          arguments: {
            pattern: step.args.pattern,
            path: abs(root, step.args.path),
          },
        };
      case "edit":
        return {
          name: "edit",
          arguments: {
            path: abs(root, step.args.path),
            oldText: step.args.oldText,
            newText: step.args.newText,
          },
        };
      case "write":
        return {
          name: "write",
          arguments: {
            path: abs(root, step.args.path),
            content: step.args.content,
          },
        };
      case "bash":
        return { name: "bash", arguments: { command: step.args.command } };
      case "search":
        return {
          name: "agentcommons_search",
          arguments: { query: step.args.query },
        };
      default:
        throw new Error(step.tool);
    }
  };
  const pending = [];
  const assistant = (content, stopReason) =>
    message(
      { role: "assistant", content },
      {
        api: "anthropic-messages",
        provider: "anthropic",
        model,
        usage: {
          input: between(rand, 6000, 25000),
          output: between(rand, 40, 500),
          cacheRead: between(rand, 4000, 20000),
          cacheWrite: 0,
        },
        stopReason,
      },
    );
  for (const step of s.steps) {
    if (step.think) {
      pending.push({ type: "thinking", thinking: step.think });
      continue;
    }
    if (step.text) {
      pending.push({ type: "text", text: step.text });
      continue;
    }
    const tool = nativeTool(step);
    const id = `${tool.name}_${String(Date.now())}_${String(records.length)}`;
    push(
      assistant(
        [
          ...pending.splice(0),
          { type: "toolCall", id, name: tool.name, arguments: tool.arguments },
        ],
        "toolUse",
      ),
    );
    push(
      message({
        role: "toolResult",
        toolCallId: id,
        toolName: tool.name,
        content: [{ type: "text", text: step.result }],
        isError: false,
      }),
    );
  }
  if (pending.length) push(assistant(pending.splice(0), "stop"));
  return { records, sessionId, activeLeafId: parentId };
}

async function seed(state) {
  const org = state.embeddings;
  const ownerHeaders = {
    cookie: cookieHeader(org.storageState.cookies),
    "x-forwarded-for": "10.9.0.1",
  };
  const sql = fixtureDatabase(org.organizationId);
  sql(
    `UPDATE organization SET name = 'Acme Engineering', slug = 'acme-engineering' WHERE id = '${org.organizationId}';`,
  );
  // Members are added by the owner, set a password through their setup link and sign in.
  // Each simulated client uses its own forwarded address so the auth rate limit never trips.
  const password = "Readme fixture password 2026!";
  const added = await call("POST", "/api/v1/admin/users", {
    headers: ownerHeaders,
    body: { emails: people.map((person) => person.email), role: "member" },
  });
  for (const [index, person] of people.entries()) {
    const result = added.json.results[index];
    if (result.status !== "added" || !result.setup_url)
      throw new Error(
        `could not add ${person.email}: ${JSON.stringify(result)}`,
      );
    const token = new URL(result.setup_url).pathname.split("/").at(-1);
    await call("POST", "/auth/reset-password", {
      headers: { "x-forwarded-for": person.ip },
      body: { newPassword: password, token },
    });
    sql(
      `UPDATE "user" SET name = '${person.name}' WHERE email = '${person.email}';`,
    );
    const signedIn = await call("POST", "/auth/sign-in/email", {
      headers: { "x-forwarded-for": person.ip },
      body: { email: person.email, password },
    });
    person.cookie = signedIn.response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    person.headers = { cookie: person.cookie, "x-forwarded-for": person.ip };
    const me = await call("GET", "/api/v1/me", { headers: person.headers });
    if (me.json.organization?.id !== org.organizationId)
      throw new Error(`${person.email} is not in the fixture organization`);
    person.userId = me.json.user.id;
    const key = await call("POST", "/api/v1/me/keys", {
      headers: person.headers,
      body: {
        name: person.host,
        permissions: { sessions: ["ingest", "read"] },
      },
    });
    person.key = key.json.key;
    person.keyHeaders = {
      authorization: `Bearer ${person.key}`,
      "x-forwarded-for": person.ip,
    };
    person.installationId = randomUUID();
  }
  const manifest = (await call("GET", "/hook/manifest.json")).json;
  const hook = { sha256: manifest.sha256, extensionSha256: null };
  const piHook = {
    sha256: manifest.sha256,
    extensionSha256: manifest.extensionSha256,
  };

  const envelope = (
    person,
    repo,
    s,
    {
      harness,
      harnessSessionId,
      records,
      behavior,
      nativeEvent,
      keyOf,
      context = {},
      end = null,
      start = null,
      hookIdentity = hook,
    },
  ) => ({
    envelopeVersion: 2,
    hook: hookIdentity,
    harness,
    harnessSessionId,
    behavior,
    nativeEvent,
    start,
    batchId: randomUUID(),
    installationId: person.installationId,
    sentAt: new Date().toISOString(),
    sourcePos: Math.max(0, records.length - 1),
    context: {
      cwd: repoRoot(person, repo),
      installation: {
        hostname: person.host,
        osUser: person.osUser,
        platform: person.platform,
        arch: person.arch,
      },
      git: {
        root: repoRoot(person, repo),
        remoteUrl: repo.remote,
        branch: s.branch,
        head: sha(`${s.id}head`).slice(0, 40),
      },
      parentHint: null,
      ...context,
    },
    records: records.map((record, pos) => ({
      pos,
      sourceVersion: 0,
      key: keyOf(record, pos),
      line: JSON.stringify(record),
    })),
    cursor: `${String(records.length)}:0`,
    end,
  });
  // A later batch continues the cursor of the records already uploaded.
  const continuing = (batch, uploaded) => ({
    ...batch,
    sourcePos: Math.max(0, uploaded - 1),
    cursor: `${String(uploaded)}:0`,
  });
  const endOf = (s, reason) => ({
    reason,
    head: sha(`${s.id}head`).slice(0, 40),
    observedCommits: s.commit
      ? [
          {
            sha: sha(`${s.id}commit`).slice(0, 40),
            subject: s.commit.subject,
            author: people[s.person].name,
            timestamp: new Date(startOf(s) + 25 * 60_000).toISOString(),
          },
        ]
      : [],
    observedDiffStat: s.commit
      ? {
          files: s.commit.files,
          insertions: s.commit.files * 14,
          deletions: s.commit.files * 5,
        }
      : null,
    dirtyFileCount: s.commit ? 0 : 1,
  });
  const ingest = async (person, body) => {
    const result = await call("POST", "/api/v1/ingest", {
      headers: person.keyHeaders,
      body,
    });
    if (result.response.status !== 202)
      throw new Error(
        `ingest ${String(result.response.status)} ${result.text}`,
      );
    return result.json.sessionId;
  };
  const waitPublished = async (sessionId) => {
    for (let attempt = 0; attempt < 90; attempt++) {
      const probe = await call("GET", `/api/v1/sessions/${sessionId}`, {
        headers: ownerHeaders,
        ok: false,
      });
      if (probe.response.ok) return;
      await sleep(1000);
    }
    throw new Error(`session ${sessionId} was not published in time`);
  };
  // Reuse edges are recorded when a live session's key reads another session, so a session
  // that reads earlier work searches and opens it through the API before its end batch.
  const readPrior = async (s, person) => {
    const target = sessionIdByScenario.get(s.reads);
    if (!target) throw new Error(`unknown reads target ${s.reads}`);
    await waitPublished(target);
    const query = s.steps.find((step) => step.tool === "search");
    if (query)
      await call("POST", "/api/v1/search", {
        headers: person.keyHeaders,
        body: { query: query.args.query },
      });
    await call("GET", `/api/v1/sessions/${target}`, {
      headers: person.keyHeaders,
    });
  };
  // Each harness builds its transcript in its native record shape; the loop below only
  // uploads what the builder returns. `agent` marks a Claude Code run that spawned a subagent.
  const harnesses = {
    CLAUDE_CODE: {
      events: ["Stop", "SessionEnd", "prompt_input_exit"],
      hookIdentity: hook,
      keyOf: (record) => record.uuid,
      build(s, person, repo, clock) {
        const harnessSessionId = randomUUID();
        const agentStep = s.steps.find((step) => step.tool === "agent");
        const childAgentId = agentStep ? sha(`${s.id}agent`).slice(0, 7) : null;
        const records = claudeRecords(s, person, repo, clock, {
          sessionId: harnessSessionId,
          childAgentId,
        });
        if (!agentStep) return { harnessSessionId, records, context: {} };
        const callIndex = records.findIndex(
          (record) =>
            record.type === "assistant" &&
            record.message.content.some(
              (c) => c.type === "tool_use" && c.name === "Agent",
            ),
        );
        const childScenario = {
          ...s,
          id: `${s.id}-child`,
          prompt: agentStep.child.prompt,
          steps: [...agentStep.child.steps, text(agentStep.child.final)],
        };
        return {
          harnessSessionId,
          records,
          context: {},
          agent: {
            head: records.slice(0, callIndex + 1),
            tail: records.slice(callIndex + 1),
            childHarnessSessionId: `${harnessSessionId}:agent-${childAgentId}`,
            childRecords: claudeRecords(
              childScenario,
              person,
              repo,
              new Clock(clock.t - 120_000),
              {
                sessionId: harnessSessionId,
                sidechain: true,
                agentId: childAgentId,
                model: "claude-sonnet-5",
              },
            ),
            parentHint: {
              harnessSessionId,
              relation: "SUBAGENT",
              agentId: childAgentId,
              agentType: agentStep.args.subagent_type,
            },
          },
        };
      },
    },
    CODEX: {
      events: ["Stop", "SessionEnd", "exit"],
      hookIdentity: hook,
      keyOf: (record) => String(record.ordinal),
      build(s, person, repo, clock) {
        const { records, threadId } = codexRecords(s, person, repo, clock);
        return { harnessSessionId: threadId, records, context: {} };
      },
    },
    GEMINI_CLI: {
      events: ["AfterAgent", "SessionEnd", "exit"],
      hookIdentity: hook,
      keyOf: (record) => record.id,
      build(s, person, repo, clock) {
        const { messages, metadata } = geminiRecords(s, person, repo, clock);
        return {
          harnessSessionId: metadata.sessionId,
          records: messages,
          context: {
            transcriptMetadata: {
              ...metadata,
              sourceRecordCount: messages.length,
            },
          },
        };
      },
    },
    PI: {
      events: ["agent_end", "session_shutdown", "shutdown"],
      hookIdentity: piHook,
      keyOf: (record) => record.id,
      build(s, person, repo, clock) {
        const { records, sessionId, activeLeafId } = piRecords(
          s,
          person,
          repo,
          clock,
        );
        return {
          harnessSessionId: sessionId,
          records,
          context: {
            activeLeafId,
            transcriptMetadata: { harnessVersion: "0.73.1", entrypoint: "cli" },
          },
        };
      },
    },
  };
  const sessionIdByScenario = new Map();
  let hero = null;
  for (const s of scenarios) {
    const person = people[s.person];
    const repo = repos[s.repo];
    const harness = harnesses[s.harness];
    const [syncEvent, endEvent, endReason] = harness.events;
    const built = harness.build(s, person, repo, new Clock(startOf(s)));
    const batch = (extra) =>
      envelope(person, repo, s, {
        harness: s.harness,
        harnessSessionId: built.harnessSessionId,
        keyOf: harness.keyOf,
        hookIdentity: harness.hookIdentity,
        context: built.context,
        ...extra,
      });
    const total = built.records.length;
    const ended = (records) =>
      batch({
        records,
        behavior: "end",
        nativeEvent: endEvent,
        end: endOf(s, endReason),
      });
    let sessionId;
    if (!built.agent && !s.reads) {
      sessionId = await ingest(person, ended(built.records));
    } else {
      if (built.agent) {
        // The parent uploads up to the Agent call, the child run finishes, then the parent's
        // result record names the child so the transcript nests the run under the call.
        const { head, tail, childHarnessSessionId, childRecords, parentHint } =
          built.agent;
        sessionId = await ingest(
          person,
          batch({ records: head, behavior: "sync", nativeEvent: "PreToolUse" }),
        );
        await ingest(
          person,
          batch({
            harnessSessionId: childHarnessSessionId,
            records: [],
            behavior: "start",
            nativeEvent: "SubagentStart",
            start: { resume: false },
            context: { parentHint },
          }),
        );
        const childSessionId = await ingest(
          person,
          batch({
            harnessSessionId: childHarnessSessionId,
            records: childRecords,
            behavior: "end",
            nativeEvent: "SubagentStop",
            context: { parentHint },
          }),
        );
        const tailBatch = batch({
          records: tail,
          behavior: "sync",
          nativeEvent: "Stop",
        });
        tailBatch.records = tailBatch.records.map((record, index) => ({
          ...record,
          pos: head.length + index,
        }));
        await ingest(person, continuing(tailBatch, total));
        if (s.hero) hero = { sessionId, childSessionId };
      } else {
        sessionId = await ingest(
          person,
          batch({
            records: built.records,
            behavior: "sync",
            nativeEvent: syncEvent,
          }),
        );
      }
      if (s.reads) await readPrior(s, person);
      await ingest(person, continuing(ended([]), total));
    }
    sessionIdByScenario.set(s.id, sessionId);
    log(
      "seeded",
      s.harness.padEnd(10),
      person.name.padEnd(12),
      s.prompt.slice(0, 60),
    );
  }
  if (!hero) throw new Error("no scenario is marked hero");

  // Maya administers the organization; Theo and Priya are members. The role route is keyed
  // by the membership row.
  const members = await call("GET", "/api/v1/admin/users?limit=100", {
    headers: ownerHeaders,
  });
  const maya = members.json.items.find(
    (member) => member.email === people[0].email,
  );
  if (!maya) throw new Error("the admin member is not listed");
  await call("PATCH", `/api/v1/admin/users/${maya.id}/role`, {
    headers: ownerHeaders,
    body: {
      role: "admin",
      reason: "README fixture: one administrator among the example members",
    },
  });

  // Wait until every seeded session is published, then take the fixture's own control
  // session out of the example team: purge it, then drop its control rows so admins do not
  // see a tombstone in the list.
  const expected = scenarios.length + 1;
  let listed;
  for (let attempt = 0; attempt < 120; attempt++) {
    listed = await call("GET", "/api/v1/sessions?limit=100", {
      headers: ownerHeaders,
    });
    const published = listed.json.items.filter(
      (item) => !item.title?.startsWith("Dashboard verification"),
    );
    if (published.length >= expected) break;
    await sleep(2000);
  }
  for (const item of listed.json.items)
    if (item.title?.startsWith("Dashboard verification")) {
      await call("POST", `/api/v1/admin/sessions/${item.session_id}/purge`, {
        headers: ownerHeaders,
        body: {
          reason:
            "Fixture control session; not part of the README example team",
        },
      });
      sql(deleteSessionControl(item.session_id));
    }
  return { ownerHeaders, sql, hero };
}

// Deletes one session's control rows and, through the foreign keys that reference it, the
// rows that depend on them (receipts, admissions, outbox, embeddings and redaction state).
const deleteSessionControl = (sessionId) => `
DO $$
DECLARE dependent record; blocker record;
  control_id constant smallint := (
    SELECT attnum FROM pg_attribute WHERE attrelid = 'trace_session_control'::regclass AND attname = 'id');
BEGIN
  -- Each dependent table references the session through its own column (session_id,
  -- parent_session_id, ...); the constraint names it, so nothing here assumes a column name.
  FOR dependent IN
    SELECT c.conrelid::regclass AS relation, a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = c.conkey[array_position(c.confkey, control_id)]
    WHERE c.contype = 'f' AND c.confrelid = 'trace_session_control'::regclass
      AND c.conrelid <> 'trace_session_control'::regclass
  LOOP
    FOR blocker IN
      SELECT DISTINCT b.conrelid::regclass AS relation
      FROM pg_constraint b
      JOIN pg_attribute a ON a.attrelid = b.conrelid AND a.attname = 'session_id'
      WHERE b.contype = 'f' AND b.confrelid = dependent.relation
        AND b.conrelid <> dependent.relation
    LOOP
      EXECUTE format('DELETE FROM %s WHERE session_id = $1', blocker.relation) USING '${sessionId}'::uuid;
    END LOOP;
    EXECUTE format('DELETE FROM %s WHERE %I = $1', dependent.relation, dependent.column_name) USING '${sessionId}'::uuid;
  END LOOP;
  DELETE FROM trace_session_control WHERE id = '${sessionId}'::uuid;
END $$;
`;

// ---- 4. session durations ------------------------------------------------------------------
// Upload receipts are stamped on arrival, so backdated transcripts would end "now" and show
// multi-day durations. Each session ends a plausible interval after its last message; the
// ClickHouse dictionaries read these control columns live.
async function fixDurations({ ownerHeaders, sql }) {
  const list = await call("GET", "/api/v1/sessions?limit=100", {
    headers: ownerHeaders,
  });
  const statements = [];
  for (const item of list.json.items) {
    const detail = await call("GET", `/api/v1/sessions/${item.session_id}`, {
      headers: ownerHeaders,
    });
    const last = (detail.json.messages ?? [])
      .map((message) => Date.parse(message.timestamp))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    if (!last) continue;
    // The agent finishes within minutes; the person reads the result and closes the session
    // some minutes later. Child runs end shortly after their last message.
    const spread = parseInt(item.session_id.slice(-3), 16);
    const seconds = item.parent_session_id
      ? 20 + (spread % 40)
      : 180 + (spread % 1900);
    const endedAt = new Date(last + seconds * 1000).toISOString();
    statements.push(
      `UPDATE trace_session_control SET ended_at = '${endedAt}', last_activity_at = '${endedAt}' WHERE id = '${item.session_id}' AND status = 'ENDED';`,
    );
  }
  sql(statements.join("\n"));
  log("set end times for", String(statements.length), "sessions");
}

// ---- 5. capture ------------------------------------------------------------------------------
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;
const PAD = 16;
const OUTPUT_WIDTH = {
  home: 2000,
  sessions: 1600,
  session: 1600,
  sql: 1600,
  install: 1600,
};
const INSTALL_ORIGIN = "https://agentcommons.acme.dev";
const SQL_QUERY = [
  "SELECT repo_name, harness, count() AS sessions, uniq(user_email) AS people, sum(tool_call_count) AS tool_calls",
  "FROM sessions",
  "WHERE started_at >= now() - toIntervalDay(30)",
  "GROUP BY repo_name, harness",
  "ORDER BY sessions DESC, repo_name",
].join("\n");
const browserCookies = (person, domain, secure) =>
  person.cookie.split("; ").map((entry) => {
    const equal = entry.indexOf("=");
    return {
      name: entry.slice(0, equal),
      value: entry.slice(equal + 1),
      domain,
      path: "/",
      httpOnly: true,
      secure,
      sameSite: "Lax",
    };
  });
/** The bottom edge of the lowest box that ends above `limit`, or null when none fits. */
const lastFitting = (boxes, limit) => {
  const bottoms = boxes
    .filter((box) => box && box.y + box.height <= limit)
    .map((box) => box.y + box.height);
  return bottoms.length ? Math.max(...bottoms) : null;
};
/** A README must not show a key, even a disposable fixture's: mask every key in the page. */
const maskKeys = (page) =>
  page.evaluate(() => {
    const pattern = /ac_([A-Za-z0-9_-]{4})[A-Za-z0-9_-]{8,}/g;
    const masked = (_, head) => `ac_${head}${"•".repeat(28)}`;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (pattern.test(node.nodeValue ?? ""))
        node.nodeValue = (node.nodeValue ?? "").replace(pattern, masked);
    for (const input of document.querySelectorAll("input, textarea"))
      if (pattern.test(input.value))
        input.value = input.value.replace(pattern, masked);
  });

async function capture({ hero }) {
  mkdirSync(rawDir, { recursive: true });
  const viewers = { admin: people[0], member: people[2] };
  const browser = await chromium.launch();
  const jobs = [];
  const problems = [];
  try {
    for (const theme of themes) {
      const errors = [];
      let context = null;
      let page = null;
      let current = null;
      const newContext = async (extra = {}) => {
        const created = await browser.newContext({
          viewport: VIEWPORT,
          deviceScaleFactor: SCALE,
          colorScheme: theme,
          locale: "en-US",
          timezoneId: "Europe/London",
          reducedMotion: "reduce",
          ...extra,
        });
        await created.addInitScript((value) => {
          localStorage.setItem("agentcommons-theme", value);
        }, theme);
        return created;
      };
      const watch = (target, label) => {
        target.on("pageerror", (error) =>
          errors.push(`${label}: ${error.message}`),
        );
        target.on("console", (message) => {
          if (message.type() === "error")
            errors.push(`${label}: ${message.text()}`);
        });
      };
      // One browser context per role so cookies never mix.
      const as = async (role) => {
        if (current === role) return page;
        await context?.close();
        const viewer = viewers[role];
        context = await newContext({
          extraHTTPHeaders: { "x-forwarded-for": viewer.ip },
        });
        await context.addCookies(browserCookies(viewer, "localhost", false));
        page = await context.newPage();
        watch(page, role);
        current = role;
        return page;
      };
      const box = async (locator) => {
        const bounds = await locator.boundingBox();
        return bounds
          ? {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
            }
          : null;
      };
      const settle = async (target) => {
        await target.evaluate(() => document.fonts.ready);
        await target.waitForFunction(
          () =>
            document.querySelectorAll("table[aria-busy='true']").length === 0,
        );
        await target.waitForTimeout(600);
      };
      /** The sidebar's footer group; row-based cuts stay above it so no link is cut in half. */
      const footerLimit = async (target) => {
        const footer = await box(target.locator("aside .mt-auto").first());
        return Math.min(
          VIEWPORT.height - PAD,
          footer ? footer.y - PAD : Infinity,
        );
      };
      const shot = async (target, name, bottom, { fullPage = false } = {}) => {
        if (bottom === null || !Number.isFinite(bottom)) {
          problems.push(`${name}-${theme}: no element boundary to cut at`);
          return;
        }
        await settle(target);
        await target.evaluate(() => {
          scrollTo(0, 0);
        });
        await maskKeys(target);
        await target.waitForTimeout(200);
        const raw = join(rawDir, `${name}-${theme}.png`);
        await target.screenshot({ path: raw, fullPage });
        jobs.push({
          src: raw,
          dst: join(outDir, `${name}-${theme}.png`),
          bottom: Math.round(bottom * SCALE),
          width: OUTPUT_WIDTH[name],
        });
        log(
          "captured",
          `${name}-${theme}`,
          "cut at",
          String(Math.round(bottom)),
          "css px",
        );
      };

      if (screens.includes("home")) {
        const admin = await as("admin");
        await admin.goto(`${origin}/app`);
        await admin.getByTestId("dashboard-picker").waitFor();
        for (const id of ["sessions_per_day", "harness_share", "reuse_trend"])
          await admin
            .getByTestId(`dashboard-tile-${id}`)
            .locator("canvas")
            .waitFor({ timeout: 60_000 });
        await admin
          .getByText(/^Rendered /)
          .first()
          .waitFor({ timeout: 60_000 });
        await admin.waitForTimeout(1500);
        const tiles = [];
        for (const tile of await admin
          .locator("[data-testid^='dashboard-tile-']")
          .all())
          tiles.push(await box(tile));
        const bottom = lastFitting(tiles, VIEWPORT.height - PAD);
        await shot(admin, "home", bottom === null ? null : bottom + PAD);
      }

      if (screens.includes("sessions")) {
        const admin = await as("admin");
        await admin.goto(`${origin}/app/sessions`);
        await admin.getByTestId("sessions-total").waitFor({ timeout: 30_000 });
        await admin.locator("tbody tr").nth(12).waitFor({ timeout: 30_000 });
        // Show the coding tool column and drop the reuse count so the table fits the width.
        await admin
          .getByRole("button", { name: "Columns", exact: true })
          .click();
        const menu = admin.getByRole("menu");
        await menu
          .getByRole("menuitemcheckbox", { name: "Coding tool", exact: true })
          .click();
        await admin
          .getByRole("menu")
          .getByRole("menuitemcheckbox", {
            name: "Reused by (sessions)",
            exact: true,
          })
          .click();
        await admin.keyboard.press("Escape");
        await admin.getByRole("menu").waitFor({ state: "hidden" });
        await settle(admin);
        const rows = [];
        for (const row of await admin
          .locator("table")
          .first()
          .locator("tbody tr")
          .all())
          rows.push(await box(row));
        const bottom = lastFitting(rows, await footerLimit(admin));
        await shot(admin, "sessions", bottom === null ? null : bottom + 1);
      }

      if (screens.includes("session")) {
        const member = await as("member");
        await member.goto(`${origin}/app/sessions/${hero.sessionId}`);
        await member
          .getByTestId("session-transcript")
          .waitFor({ timeout: 30_000 });
        await member.getByTestId("session-export").waitFor({ timeout: 30_000 });
        const block = member.getByTestId(
          `session-subagent-${hero.childSessionId}`,
        );
        await block.waitFor({ timeout: 30_000 });
        await block.getByRole("button", { expanded: false }).first().click();
        await block
          .getByText("Three ledger write paths", { exact: false })
          .first()
          .waitFor({ timeout: 30_000 });
        await settle(member);
        const bounds = await box(block);
        await shot(
          member,
          "session",
          bounds === null ? null : bounds.y + bounds.height + 20,
          { fullPage: true },
        );
      }

      if (screens.includes("sql")) {
        const member = await as("member");
        await member.goto(`${origin}/app/sql`);
        const status = member.getByTestId("sql-status");
        await status
          .getByText("Ready", { exact: false })
          .waitFor({ timeout: 30_000 });
        const content = member.getByTestId("sql-editor").locator(".cm-content");
        await content.click();
        await member.keyboard.press("ControlOrMeta+A");
        await content.pressSequentially(SQL_QUERY, { delay: 4 });
        await member.keyboard.press("Escape");
        await content.click();
        await member.keyboard.press("ControlOrMeta+Enter");
        const results = member.getByTestId("sql-results");
        await results.locator("tbody tr").first().waitFor({ timeout: 30_000 });
        await status
          .getByText("Ran in", { exact: false })
          .waitFor({ timeout: 30_000 });
        await settle(member);
        const rows = [];
        for (const row of await results.locator("tbody tr").all())
          rows.push(await box(row));
        const bottom = lastFitting(rows, await footerLimit(member));
        await shot(member, "sql", bottom === null ? null : bottom + 1);
      }

      if (screens.includes("install")) {
        // The install command shows the origin the app is served from. Present the fixture
        // behind a deployment-style hostname by proxying that origin to the local server.
        const viewer = viewers.member;
        const shownHost = new URL(INSTALL_ORIGIN).hostname;
        const installContext = await newContext();
        await installContext.addCookies(
          browserCookies(viewer, shownHost, true),
        );
        await installContext.route(`${INSTALL_ORIGIN}/**`, async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (request.headers().accept?.includes("text/event-stream"))
            return route.abort();
          const upstream = await fetch(
            `${origin}${url.pathname}${url.search}`,
            {
              method: request.method(),
              headers: {
                ...Object.fromEntries(
                  Object.entries(request.headers()).filter(([name]) =>
                    ["accept", "content-type", "cookie"].includes(name),
                  ),
                ),
                "x-forwarded-for": viewer.ip,
                origin,
              },
              body: request.postDataBuffer() ?? undefined,
              redirect: "manual",
            },
          );
          const headers = {};
          for (const name of ["content-type", "cache-control"]) {
            const value = upstream.headers.get(name);
            if (value) headers[name] = value;
          }
          return route.fulfill({
            status: upstream.status,
            headers,
            body: Buffer.from(await upstream.arrayBuffer()),
          });
        });
        const install = await installContext.newPage();
        watch(install, "install");
        await install.goto(`${INSTALL_ORIGIN}/app/install`);
        await install
          .getByTestId("install-command")
          .waitFor({ timeout: 30_000 });
        await install
          .getByTestId("install-arrivals")
          .locator("li")
          .first()
          .waitFor({ timeout: 30_000 });
        // Step 1 opens on the create form; the link under it swaps in the picker of existing
        // keys. Pick the member's key so the command fills in; the capture masks it.
        await install
          .getByRole("button", { name: /a key you already have/i })
          .click();
        const picker = install.locator("select").first();
        await picker.waitFor({ timeout: 30_000 });
        await picker.selectOption({ index: 1 });
        await install
          .getByTestId("install-command")
          .getByText(/ac_/)
          .waitFor({ timeout: 30_000 });
        await settle(install);
        const steps = [];
        for (const step of await install.locator("main ol > li").all())
          steps.push(await box(step));
        const command = steps[2];
        await shot(
          install,
          "install",
          command ? command.y + command.height + PAD : null,
          { fullPage: true },
        );
        await installContext.close();
      }

      if (errors.length)
        problems.push(...errors.map((error) => `${theme}: ${error}`));
      await context?.close();
    }
  } finally {
    await browser.close();
  }
  return { jobs, problems };
}

// ---- 6. crop, scale and quantize -----------------------------------------------------------
// Pillow (Lanczos resize, 256-colour median-cut palette with dithering) matches the documented
// provenance. Without it Chromium's canvas resizes the crop and the PNG keeps full colour.
const hasPillow = () => {
  try {
    execFileSync("python3", ["-c", "import PIL"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const PILLOW_SCRIPT = `
import json, sys
from PIL import Image
for job in json.load(sys.stdin):
    image = Image.open(job["src"]).convert("RGB")
    image = image.crop((0, 0, image.width, min(image.height, job["bottom"])))
    scaled = image.resize((job["width"], round(image.height * job["width"] / image.width)), Image.Resampling.LANCZOS)
    scaled.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(job["dst"], optimize=True)
`;
async function finishImages(jobs) {
  if (hasPillow()) {
    execFileSync("python3", ["-c", PILLOW_SCRIPT], {
      input: JSON.stringify(jobs),
      stdio: ["pipe", "inherit", "inherit"],
    });
    return "Pillow";
  }
  console.warn(
    "Pillow is not installed: images are resized by Chromium and not quantized to 256 colours.",
  );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const job of jobs) {
      const dataUrl = await page.evaluate(
        async ([source, bottom, width]) => {
          const image = new Image();
          image.src = source;
          await image.decode();
          const height = Math.min(image.naturalHeight, bottom);
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = Math.round((height * width) / image.naturalWidth);
          const context = canvas.getContext("2d");
          context.imageSmoothingQuality = "high";
          context.drawImage(
            image,
            0,
            0,
            image.naturalWidth,
            height,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          return canvas.toDataURL("image/png");
        },
        [
          `data:image/png;base64,${readFileSync(job.src).toString("base64")}`,
          job.bottom,
          job.width,
        ],
      );
      writeFileSync(
        job.dst,
        Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"),
      );
    }
  } finally {
    await browser.close();
  }
  return "Chromium canvas";
}

// ---- main ------------------------------------------------------------------------------------
let fixture = null;
const teardown = async () => {
  if (fixture && !options.keep) await stopFixture(fixture);
};
process.once("SIGINT", () => {
  void teardown().then(() => process.exit(130));
});
try {
  if (
    !options["skip-build"] ||
    !existsSync(join(distDir, "prerender/entry-server.js"))
  )
    build();
  fixture = await startFixture();
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const seeded = await seed(state);
  await fixDurations(seeded);
  const { jobs, problems } = await capture(seeded);
  const finisher = await finishImages(jobs);
  for (const job of jobs) {
    const bytes = readFileSync(job.dst).length;
    log("wrote", job.dst, `${String(Math.round(bytes / 1024))} KB`);
  }
  log("images finished with", finisher);
  if (problems.length) {
    console.error("Problems during capture:");
    for (const problem of problems) console.error(" -", problem);
    process.exitCode = 1;
  }
  if (options.keep)
    log(
      "fixture kept at",
      origin,
      "state:",
      statePath,
      "raw captures:",
      rawDir,
    );
  else rmSync(rawDir, { recursive: true, force: true });
} finally {
  await teardown();
}
