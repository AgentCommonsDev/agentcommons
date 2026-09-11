import { join } from "node:path";
import * as z from "zod";
import { repositoryIdentity } from "../../core/metadata/repository.js";
import type { HookConfig } from "./config.js";
import { hash, readJsonOr, writeAtomic } from "./files.js";
import { HARNESSES, nativeHookSchema, type CliHarness } from "./harnesses.js";
import { note } from "./paths.js";
import { loadState, type HookState } from "./state.js";

/** The uploader refreshes a repository's indexed-session count at most this often (§6.2). */
export const RECALL_REFRESH_MS = 15 * 60_000;
/** Hook mode hints on the first prompt that has a cached count, then every this many prompts. */
export const RECALL_HINT_EVERY_PROMPTS = 25;
const REQUEST_TIMEOUT_MS = 10_000;
const cacheSchema = z.strictObject({
  v: z.literal(1),
  repoName: z.string().min(1),
  sessions: z.number().int().nonnegative(),
  fetchedAt: z.number(),
});
type RecallCache = z.infer<typeof cacheSchema>;
const counterSchema = z.strictObject({
  v: z.literal(1),
  prompts: z.number().int().nonnegative(),
  hintedAt: z.number().int().nonnegative(),
});
type HintCounter = z.infer<typeof counterSchema>;
/** Only the total is read from the list response; the page itself is one row. */
const totalSchema = z.looseObject({
  total: z.looseObject({ sessions: z.number().int().nonnegative() }),
});
type GitContext = HookState["context"]["git"];

/** The server's `repo_name` for this session's remote, so the cache key and the list filter agree. */
function repositoryName(git: GitContext): string | null {
  return git ? repositoryIdentity(git.remoteUrl).repoName : null;
}
/** One small file per repository under the data directory, keyed by the hashed repository name. */
export function recallCachePath(directory: string, repoName: string): string {
  return join(directory, "recall", `${hash(repoName)}.json`);
}
function readCache(directory: string, repoName: string): RecallCache | null {
  try {
    return readJsonOr(recallCachePath(directory, repoName), cacheSchema, null);
  } catch {
    return null;
  }
}
/** The one line the agent sees: a count and the repository name the hook already knows. */
export function recallHintText(repoName: string, sessions: number): string {
  return `${String(sessions)} prior AgentCommons session${sessions === 1 ? "" : "s"} touch ${repoName}; search them before changing code (search, get, sql over MCP).`;
}
/** The stdout JSON every hinted harness reads as model context (Appendix A). */
export function hookContextOutput(
  hookEventName: string,
  additionalContext: string,
): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName, additionalContext },
  });
}
/** The per-session prompt counter that rate-limits the hint, beside the state file. */
export const hintCounterPath = (statePath: string): string =>
  `${statePath}.hint`;
function readCounter(path: string): HintCounter {
  try {
    return readJsonOr(path, counterSchema, { v: 1, prompts: 0, hintedAt: 0 });
  } catch {
    return { v: 1, prompts: 0, hintedAt: 0 };
  }
}
/**
 * Hook mode. For an event flagged `hint` in HARNESSES, the cached count of indexed sessions
 * for the session's repository becomes one line of additional context: on the first hinted
 * prompt that finds a count, then every RECALL_HINT_EVERY_PROMPTS prompts, so it stays a
 * nudge. Reads two small JSON files and writes one; the uploader fills the cache, so hook
 * mode never touches the network. Nothing is returned before the uploader has recorded the
 * session's git context or when the repository has no indexed sessions.
 */
export function promptHint(
  directory: string,
  harness: CliHarness,
  input: unknown,
  statePath: string,
): string | null {
  const event = nativeHookSchema.parse(input);
  if (!HARNESSES[harness].events[event.hook_event_name]?.hint) return null;
  const repoName = repositoryName(loadState(statePath).context.git);
  if (!repoName) return null;
  const cache = readCache(directory, repoName);
  if (!cache || cache.sessions === 0) return null;
  const path = hintCounterPath(statePath);
  const counter = readCounter(path);
  const prompts = counter.prompts + 1;
  const due =
    counter.hintedAt === 0 ||
    prompts - counter.hintedAt >= RECALL_HINT_EVERY_PROMPTS;
  writeAtomic(path, {
    v: 1,
    prompts,
    hintedAt: due ? prompts : counter.hintedAt,
  });
  return due
    ? hookContextOutput(
        event.hook_event_name,
        recallHintText(repoName, cache.sessions),
      )
    : null;
}
interface RefreshOptions {
  fetch?: typeof fetch;
  now?: () => number;
}
/**
 * Upload mode only. After a drain, the number of indexed sessions for the session's
 * repository is fetched from the configured server, one list request with `limit=1` whose
 * `total` is a single scan, at most every RECALL_REFRESH_MS per repository, and cached
 * under `recall/` for hook mode. The attempt is recorded before the request so a failing
 * server is asked again only after the interval; failures are logged and ignored and the
 * durability path is never involved.
 */
export async function refreshRecallHint(
  directory: string,
  config: HookConfig,
  git: GitContext,
  options: RefreshOptions = {},
): Promise<"refreshed" | "current" | "skipped"> {
  const repoName = repositoryName(git);
  if (!repoName) return "skipped";
  const now = options.now?.() ?? Date.now();
  const cache = readCache(directory, repoName);
  if (cache && now - cache.fetchedAt < RECALL_REFRESH_MS) return "current";
  const path = recallCachePath(directory, repoName);
  const write = (sessions: number) => {
    writeAtomic(path, { v: 1, repoName, sessions, fetchedAt: now });
  };
  write(cache?.sessions ?? 0);
  try {
    const url = new URL("/api/v1/sessions", config.server);
    url.searchParams.set("limit", "1");
    url.searchParams.set("filters", JSON.stringify({ repo_name: repoName }));
    const response = await (options.fetch ?? fetch)(url, {
      headers: {
        authorization: `Bearer ${config.key}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `The session list returned HTTP ${String(response.status)}.`,
      );
    }
    write(totalSchema.parse(await response.json()).total.sessions);
    return "refreshed";
  } catch (error) {
    note(
      directory,
      `Recall hint skipped for ${repoName}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return "skipped";
  }
}
