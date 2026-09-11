/**
 * The recall bench corpus (ADR 0070): one small service repository, six decisions a
 * hooked seed session records, and six ordinary tasks whose repository no longer holds
 * the decision. Every task has two repository conditions: `squashed` (one import commit,
 * the repository cannot answer) and `available` (the seed session's fix commit is still in
 * `git log`, the production reality).
 */
export type History = "squashed" | "available";
export interface BenchTask {
  id: string;
  /** Files of the repository the seed session starts from (evidence included). */
  seed: Record<string, string>;
  /** The scripted decision the seed session performs; the marker finds its session later. */
  seedPrompt: string;
  /** Files rewritten for the task repository (evidence gone, value regressed); null deletes. */
  regression: Record<string, string | null>;
  /** Commit message of the regression in the `available` condition; a neutral chore. */
  regressionMessage: string;
  /** The ordinary task. Never mentions AgentCommons, prior sessions or the value. */
  taskPrompt: string;
  /** Whether the finished task repository carries the seed decision. */
  usedDecision(files: Record<string, string | null>): boolean;
  /** Files `usedDecision` reads. */
  outcomeFiles: string[];
  /** Files `seedRecorded` reads after the seed session, to confirm the decision was made. */
  seedFiles: string[];
  seedRecorded(files: Record<string, string | null>): boolean;
}
export const REMOTE = "https://github.com/acme/orders-api.git";
export const REPO_NAME = "github.com/acme/orders-api";

const packageJson = `${JSON.stringify(
  {
    name: "orders-api",
    private: true,
    type: "module",
    scripts: { test: "node --test test/" },
    dependencies: { zod: "^4.0.0" },
  },
  null,
  2,
)}\n`;
const readme = `# orders-api

Order intake service. Run the tests with \`npm test\`.
`;
const base: Record<string, string> = {
  "package.json": packageJson,
  "README.md": readme,
  ".gitignore": "node_modules\n",
};

const cacheSrc = `/** In-memory cache with a per-entry time to live. */
export class TtlCache {
  #entries = new Map();
  constructor({ ttlMs = 1000 } = {}) {
    this.ttlMs = ttlMs;
  }
  set(key, value) {
    this.#entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }
}
`;
const cacheTestFlaky = `import { test } from "node:test";
import assert from "node:assert/strict";
import { TtlCache } from "../src/cache.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("returns a value before it expires", () => {
  const cache = new TtlCache({ ttlMs: 50 });
  cache.set("a", 1);
  assert.equal(cache.get("a"), 1);
});

test("expires entries after ttl", async () => {
  const cache = new TtlCache({ ttlMs: 20 });
  cache.set("a", 1);
  await sleep(25);
  assert.equal(cache.get("a"), undefined);
});
`;
/** The seed session's fix, then a later commit added a sleeping test again (the regression). */
const cacheSrcFixed = `/** In-memory cache with a per-entry time to live. */
export class TtlCache {
  #entries = new Map();
  constructor({ ttlMs = 1000, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
  }
  set(key, value) {
    this.#entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }
  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    entry.expiresAt = this.now() + this.ttlMs;
    return entry.value;
  }
}
`;
const cacheTestRegressed = `import { test } from "node:test";
import assert from "node:assert/strict";
import { TtlCache } from "../src/cache.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** A clock the test advances by hand. */
const fakeClock = () => {
  let time = 1_000_000;
  const now = () => time;
  now.advance = (ms) => {
    time += ms;
  };
  return now;
};

test("returns a value before it expires", () => {
  const cache = new TtlCache({ ttlMs: 50 });
  cache.set("a", 1);
  assert.equal(cache.get("a"), 1);
});

test("expires entries after ttl", () => {
  const now = fakeClock();
  const cache = new TtlCache({ ttlMs: 20, now });
  cache.set("a", 1);
  now.advance(25);
  assert.equal(cache.get("a"), undefined);
});

test("refreshes expiry on access", async () => {
  const cache = new TtlCache({ ttlMs: 30 });
  cache.set("a", 1);
  await sleep(20);
  assert.equal(cache.get("a"), 1);
  await sleep(20);
  assert.equal(cache.get("a"), 1);
  await sleep(35);
  assert.equal(cache.get("a"), undefined);
});
`;

const paymentsSeed = `/** Payments provider client. */
export class PaymentsClient {
  constructor({ baseUrl, fetch: fetchImpl = fetch }) {
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
  }
  async charge(order) {
    const response = await this.fetch(\`\${this.baseUrl}/charges\`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: order.id, amount: order.total }),
    });
    if (!response.ok) throw new Error(\`charge failed: \${response.status}\`);
    return response.json();
  }
}
`;
const paymentsIncident = `# Incident review: double charges on 2026-08-19

## What happened

The payments provider returned HTTP 503 for eleven minutes. Our client retried blindly and
eleven orders were charged twice, because the retried requests carried no idempotency key.

## What the provider told us

- Retry only on HTTP 503 and on connection resets (ECONNRESET). Never retry a 429: it counts
  against the rate budget and the provider will extend the block.
- Send an \`Idempotency-Key\` header on every attempt; use the order id.
- Their recommended policy: at most 3 attempts, backing off 100 ms then 200 ms.

## Decision

Implement exactly that policy in the payments client. Any other outbound client that needs
retries copies this policy.
`;
const notificationsSrc = `/** Webhook notifications to the fulfilment partner. */
export class NotificationsClient {
  constructor({ baseUrl, fetch: fetchImpl = fetch }) {
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
  }
  async notify(event) {
    const response = await this.fetch(\`\${this.baseUrl}/events\`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!response.ok) throw new Error(\`notify failed: \${response.status}\`);
  }
}
`;
const paymentsSdk = `import { PaymentsClient as SdkClient } from "@acme/payments-sdk";

/** Payments provider client: the SDK owns transport, retries and idempotency. */
export class PaymentsClient {
  constructor({ baseUrl, fetch: fetchImpl = fetch }) {
    this.sdk = new SdkClient({ baseUrl, fetch: fetchImpl });
  }
  charge(order) {
    return this.sdk.charge({ orderId: order.id, amount: order.total });
  }
}
`;

const inventorySeed = `/** Inventory service lookups. */
export const INVENTORY_TIMEOUT_MS = 2000;

export async function lookupStock(sku, { fetch: fetchImpl = fetch } = {}) {
  const response = await fetchImpl(\`https://inventory.internal/stock/\${sku}\`, {
    signal: AbortSignal.timeout(INVENTORY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(\`stock lookup failed: \${response.status}\`);
  return response.json();
}
`;
const inventoryLog = `inventory.internal latency, 24 h sample (2026-09-03)
p50 900 ms
p95 4200 ms
p99 7800 ms
max 9100 ms
2000 ms client timeouts: 341, all between 02:00 and 03:30 during the nightly catalog rebuild
`;
const runbook = `# Checkout runbook

## Inventory lookups

The checkout page budget is 8 s end to end; the inventory call is the only remote call on
that path, so its client timeout may use the whole budget. During the nightly catalog
rebuild (02:00 to 03:30 UTC) inventory latency rises to a p99 of about 7.8 s.
`;
const inventoryRegressed = `/** Inventory service lookups. */
export const INVENTORY_TIMEOUT_MS = 3000;

export async function lookupStock(sku, { fetch: fetchImpl = fetch } = {}) {
  const response = await fetchImpl(\`https://inventory.internal/stock/\${sku}\`, {
    signal: AbortSignal.timeout(INVENTORY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(\`stock lookup failed: \${response.status}\`);
  return response.json();
}
`;

const configSeed = `import { readFile } from "node:fs/promises";

/** Loads the service configuration file. */
export async function loadConfig(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
`;
const configAdr = `# ADR 0003: Validate configuration with zod

Date: 2026-07-02. Status: accepted.

## Context

Two outages came from configuration files with a misspelled key that the loader accepted.
We compared ajv (JSON Schema) and zod.

## Decision

Validate every loaded configuration with **zod**, with strict objects (unknown keys are
errors) and the failing path in the error message. Not ajv: keeping a JSON Schema document
in step with the code drifted twice, and zod gives us inferred types for free. zod is
already a dependency of the dashboard.
`;
const configRegressed = `import { readFile } from "node:fs/promises";

/** Loads the service configuration file. */
export async function loadConfig(path) {
  return validate(JSON.parse(await readFile(path, "utf8")));
}

/** TODO: validation was dropped in the loader refactor; restore it. */
export function validate(config) {
  return config;
}
`;

const exportSeed = `/** Streams orders to CSV in pages. */
export async function exportOrders(store, { pageSize = 100 } = {}) {
  const total = await store.count();
  const lines = ["id,total"];
  let offset = 0;
  while (offset < total - 1) {
    const rows = await store.page(offset, pageSize);
    for (const row of rows) lines.push(\`\${row.id},\${row.total}\`);
    offset += rows.length;
    if (rows.length === 0) break;
  }
  return lines.join("\\n") + "\\n";
}
`;
const exportTestSeed = `import { test } from "node:test";
import assert from "node:assert/strict";
import { exportOrders } from "../src/export.js";

const store = (rows) => ({
  count: async () => rows.length,
  page: async (offset, size) => rows.slice(offset, offset + size),
});

test("exports every row", async () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, total: i * 10 }));
  const csv = await exportOrders(store(rows), { pageSize: 3 });
  assert.equal(csv.trim().split("\\n").length, 8);
});
`;
const exportRegressed = `/** Streams orders to CSV in pages. */
export async function exportOrders(store, { pageSize = 100 } = {}) {
  const total = await store.count();
  const pageCount = Math.ceil(total / pageSize);
  const lines = ["id,total"];
  for (let page = 0; page < pageCount - 1; page++) {
    const rows = await store.page(page * pageSize, pageSize);
    for (const row of rows) lines.push(\`\${row.id},\${row.total}\`);
  }
  return lines.join("\\n") + "\\n";
}
`;
const exportTestRegressed = `import { test } from "node:test";
import assert from "node:assert/strict";
import { exportOrders } from "../src/export.js";

const store = (rows) => ({
  count: async () => rows.length,
  page: async (offset, size) => rows.slice(offset, offset + size),
});

test("writes a header", async () => {
  const csv = await exportOrders(store([]), { pageSize: 3 });
  assert.equal(csv, "id,total\\n");
});
`;

const storageSeed = `import { S3Client } from "@aws-sdk/client-s3";

/** Uploads bucket client. */
export const uploads = new S3Client({ region: "us-east-1" });
export const UPLOADS_BUCKET = "acme-orders-uploads";
`;
const residency = `# Data residency

Contract clause 4.2 with our EU customers: order documents stay in the European Union.
The uploads bucket \`acme-orders-uploads\` therefore lives in **eu-central-1** (Frankfurt),
and every client that touches it must be configured for that region. A client configured
for another region gets a 301 PermanentRedirect from S3.
`;
const storageRegressed = `import { S3Client } from "@aws-sdk/client-s3";

/** Uploads bucket client. */
export const uploads = new S3Client({ region: "us-east-1" });
export const UPLOADS_BUCKET = "acme-orders-uploads";
`;

const has = (text: string | null | undefined, ...needles: string[]) =>
  typeof text === "string" && needles.every((needle) => text.includes(needle));

export const benchTasks: BenchTask[] = [
  {
    id: "cache",
    seedFiles: ["src/cache.js", "test/cache.test.js"],
    seedRecorded: (files) =>
      has(files["src/cache.js"], "now") &&
      !/await sleep/.test(files["test/cache.test.js"] ?? ""),
    seed: {
      ...base,
      "src/cache.js": cacheSrc,
      "test/cache.test.js": cacheTestFlaky,
    },
    seedPrompt:
      "Read test/cache.test.js and src/cache.js. The test 'expires entries after ttl' is flaky on CI because it sleeps on real timers. Fix it by giving TtlCache an injectable clock option `now` (default Date.now) and make the test drive a fake clock instead of sleeping; also make get() refresh the entry's expiry on access. Run node --test test/cache.test.js. Then run: git add -A && git commit -m \"test: fake clock for the TTL cache test\". Reply with what you changed in one sentence.",
    regression: {
      "src/cache.js": cacheSrcFixed,
      "test/cache.test.js": cacheTestRegressed,
    },
    regressionMessage: "test: cover expiry refresh on access",
    taskPrompt:
      "test/cache.test.js is flaky again on CI: the 'refreshes expiry on access' case times out intermittently. Make it deterministic, run node --test test/cache.test.js, and commit with git add -A && git commit -m \"test: deterministic expiry refresh test\". Reply with what you changed in one sentence.",
    outcomeFiles: ["test/cache.test.js"],
    usedDecision: (files) =>
      has(files["test/cache.test.js"], "now") &&
      !/refreshes expiry on access[\s\S]*await sleep/.test(
        files["test/cache.test.js"] ?? "",
      ),
  },
  {
    id: "retry",
    seedFiles: ["src/payments.js"],
    seedRecorded: (files) =>
      has(files["src/payments.js"], "503", "ECONNRESET") &&
      /Idempotency-Key/i.test(files["src/payments.js"] ?? ""),
    seed: {
      ...base,
      "src/payments.js": paymentsSeed,
      "src/notifications.js": notificationsSrc,
      "docs/incidents/2026-08-payments.md": paymentsIncident,
    },
    seedPrompt:
      'Read docs/incidents/2026-08-payments.md and src/payments.js. Add retries to the payments client following the incident review exactly: at most 3 attempts, backing off 100 ms then 200 ms, retry only HTTP 503 and ECONNRESET, never 429, and send an Idempotency-Key header set to the order id on every attempt. Then run: git add -A && git commit -m "fix: retry payments the way the provider requires". Reply with the policy in one sentence.',
    regression: {
      "src/payments.js": paymentsSdk,
      "docs/incidents/2026-08-payments.md": null,
      "docs/README.md": "Incident reviews live in the company wiki.\n",
      "package.json": `${JSON.stringify(
        {
          name: "orders-api",
          private: true,
          type: "module",
          scripts: { test: "node --test test/" },
          dependencies: { "@acme/payments-sdk": "^2.1.0", zod: "^4.0.0" },
        },
        null,
        2,
      )}\n`,
    },
    regressionMessage: "chore: move the payments client onto the SDK",
    taskPrompt:
      'Notifications to the fulfilment partner fail during their brief outages. Add retries to src/notifications.js with the same retry policy the team uses for the payments client, then run: git add -A && git commit -m "fix: retry notifications". Reply with the policy you applied in one sentence.',
    outcomeFiles: ["src/notifications.js"],
    usedDecision: (files) =>
      has(files["src/notifications.js"], "503", "ECONNRESET") &&
      /Idempotency-Key/i.test(files["src/notifications.js"] ?? "") &&
      /\b3\b/.test(files["src/notifications.js"] ?? "") &&
      /100/.test(files["src/notifications.js"] ?? "") &&
      /200/.test(files["src/notifications.js"] ?? ""),
  },
  {
    id: "timeout",
    seedFiles: ["src/inventory.js"],
    seedRecorded: (files) =>
      /INVENTORY_TIMEOUT_MS\s*=\s*8000\b/.test(files["src/inventory.js"] ?? ""),
    seed: {
      ...base,
      "src/inventory.js": inventorySeed,
      "logs/inventory-latency.txt": inventoryLog,
      "docs/runbook.md": runbook,
    },
    seedPrompt:
      'Read logs/inventory-latency.txt, docs/runbook.md and src/inventory.js. Set INVENTORY_TIMEOUT_MS to the value the log and the runbook justify: the measured p99 is 7.8 s and the checkout budget is 8 s, so use 8000 and say why in a code comment. Then run: git add -A && git commit -m "fix: allow 8 s for inventory lookups". Reply with the value and the reason in one sentence.',
    regression: {
      "src/inventory.js": inventoryRegressed,
      "logs/inventory-latency.txt": null,
      "docs/runbook.md": null,
    },
    regressionMessage: "chore: tighten client timeouts",
    taskPrompt:
      'Inventory lookups time out during the nightly catalog rebuild again; src/inventory.js has the wrong INVENTORY_TIMEOUT_MS. Set the correct value, run: git add -A && git commit -m "fix: restore the inventory timeout", and reply with the value you set.',
    outcomeFiles: ["src/inventory.js"],
    usedDecision: (files) =>
      /INVENTORY_TIMEOUT_MS\s*=\s*8000\b/.test(files["src/inventory.js"] ?? ""),
  },
  {
    id: "validation",
    seedFiles: ["src/config.js"],
    seedRecorded: (files) =>
      /from\s+["']zod["']/.test(files["src/config.js"] ?? ""),
    seed: {
      ...base,
      "src/config.js": configSeed,
      "docs/adr/0003-config-validation.md": configAdr,
    },
    seedPrompt:
      'Read docs/adr/0003-config-validation.md and src/config.js. Add validation of the loaded configuration with the library the ADR chose (zod): a strict object with the keys port (number), databaseUrl (string) and logLevel (one of debug, info, warn, error), rejecting unknown keys and reporting the failing path. Then run: git add -A && git commit -m "feat: validate config with zod per ADR 0003". Reply with the library and the reason in one sentence.',
    regression: {
      "src/config.js": configRegressed,
      "docs/adr/0003-config-validation.md": null,
    },
    regressionMessage: "refactor: extract config loading",
    taskPrompt:
      'src/config.js accepts any configuration file. Restore proper validation of the loaded config (port, databaseUrl, logLevel; unknown keys rejected; the failing path in the error) the way this team validates configuration, then run: git add -A && git commit -m "fix: validate the config file again". Reply with the library you used and why in one sentence.',
    outcomeFiles: ["src/config.js"],
    usedDecision: (files) =>
      /from\s+["']zod["']/.test(files["src/config.js"] ?? "") &&
      !/ajv/i.test(files["src/config.js"] ?? ""),
  },
  {
    id: "export",
    seedFiles: ["src/export.js"],
    seedRecorded: (files) => !/total - 1/.test(files["src/export.js"] ?? ""),
    seed: {
      ...base,
      "src/export.js": exportSeed,
      "test/export.test.js": exportTestSeed,
    },
    seedPrompt:
      'Run node --test test/export.test.js. The CSV export drops the last row; find the root cause in src/export.js (the page loop stops one row early: its condition compares the offset with total - 1) and fix it so every row is exported. Then run: git add -A && git commit -m "fix: export the final row". Reply with the root cause in one sentence.',
    regression: {
      "src/export.js": exportRegressed,
      "test/export.test.js": exportTestRegressed,
    },
    regressionMessage: "refactor: page the export by page number",
    taskPrompt:
      'Customers report the CSV export is missing the last order again. Find and fix the cause in src/export.js, add a regression test to test/export.test.js, run node --test test/export.test.js, then run: git add -A && git commit -m "fix: export every row". Reply with the root cause in one sentence.',
    outcomeFiles: ["src/export.js", "test/export.test.js"],
    usedDecision: (files) =>
      !/pageCount - 1/.test(files["src/export.js"] ?? "") &&
      !/total - 1/.test(files["src/export.js"] ?? ""),
  },
  {
    id: "region",
    seedFiles: ["src/storage.js"],
    seedRecorded: (files) => has(files["src/storage.js"], "eu-central-1"),
    seed: {
      ...base,
      "src/storage.js": storageSeed,
      "docs/compliance/residency.md": residency,
    },
    seedPrompt:
      'Read docs/compliance/residency.md and src/storage.js. Set the uploads client region to the one the residency requirement mandates (eu-central-1) and cite the contract clause in a comment. Then run: git add -A && git commit -m "fix: uploads bucket is in eu-central-1". Reply with the region and the reason in one sentence.',
    regression: {
      "src/storage.js": storageRegressed,
      "docs/compliance/residency.md": null,
    },
    regressionMessage: "chore: consolidate AWS client configuration",
    taskPrompt:
      'Uploads fail with 301 PermanentRedirect from S3 since the AWS configuration change. Fix src/storage.js so uploads to the acme-orders-uploads bucket work, run: git add -A && git commit -m "fix: uploads bucket region", and reply with the region you set.',
    outcomeFiles: ["src/storage.js"],
    usedDecision: (files) => has(files["src/storage.js"], "eu-central-1"),
  },
];
