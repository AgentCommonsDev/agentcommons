import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import * as z from "zod";
import { ageInWords } from "../../core/format/age.js";
import { objectSchema, type HookConfig } from "./config.js";
import { hash, readJsonOr, writeAtomic } from "./files.js";
import {
  HARNESSES,
  nativeHookSchema,
  type CliHarness,
  type PreToolPayload,
} from "./harnesses.js";
import { note } from "./paths.js";
import { registrationFile, registrationStatus } from "./registration.js";
import { repositoryAt, repositoryName } from "./repository.js";
import { loadState, statePath, type HookState } from "./state.js";

/** The uploader refreshes a repository's recall cache at most this often (§6.2). */
export const RECALL_REFRESH_MS = 15 * 60_000;
/** Hook mode repeats the generic nudge every this many prompts after the last hint. */
export const RECALL_HINT_EVERY_PROMPTS = 25;
/** Recent root sessions the cache holds per repository; the hints name at most three. */
export const RECALL_RECENT_LIMIT = 10;
const HINT_SESSIONS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
/** Bounds on what hook mode reads and tokenizes (§6.2 budget). */
const MAX_PROMPT_CHARS = 4096;
const MAX_TITLE_CHARS = 100;
/** A cached session names at most this many files, each bounded, so the render stays terse. */
const MAX_RECENT_FILES = 3;
const MAX_FILE_CHARS = 200;
const MAX_END_REASON_CHARS = 40;

/**
 * A cached session preview: the server identity plus the distilled signal the hint surfaces so
 * the agent sees why a session is worth opening — how often it was reused, whether a teammate
 * ran it, its size, how it ended, and the files it touched (§6.2). Loose and `.catch`-defaulted
 * so a cache written by an older bundle, or by a server that does not yet send a field, always
 * reads; a session with no signal renders exactly as a plain title.
 */
const recentSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().nullable(),
  startedAt: z.string(),
  branch: z.string().nullable(),
  reuseCount: z.number().int().nonnegative().catch(0),
  byTeammate: z.boolean().catch(false),
  messageCount: z.number().int().nonnegative().catch(0),
  endReason: z.string().nullable().catch(null),
  files: z.array(z.string()).catch([]),
});
export type RecentSession = z.infer<typeof recentSchema>;
/** v1 caches (a count alone) stay readable until their refresh; v2 adds the recent list. */
const cacheSchema = z.union([
  z.strictObject({
    v: z.literal(1),
    repoName: z.string().min(1),
    sessions: z.number().int().nonnegative(),
    fetchedAt: z.number(),
  }),
  z.strictObject({
    v: z.literal(2),
    repoName: z.string().min(1),
    sessions: z.number().int().nonnegative(),
    fetchedAt: z.number(),
    recent: z.array(recentSchema).max(RECALL_RECENT_LIMIT),
  }),
]);
type RecallCache = z.infer<typeof cacheSchema>;
const registrationSchema = z.enum(["ok", "missing", "placeholder", "unknown"]);
/**
 * The per-session hint state beside the state file, written by hook mode: how many
 * prompts were seen, when the last hint spoke (-1: never), whether the session overview
 * and the repair notice were given, which sessions a prompt hint already named, and the
 * registration verdict, checked at most on the start event and the first prompt.
 */
const counterSchema = z.strictObject({
  v: z.literal(2),
  prompts: z.number().int().nonnegative(),
  lastHintPrompt: z.number().int().min(-1),
  startHinted: z.boolean(),
  repairHinted: z.boolean(),
  registration: registrationSchema.nullable(),
  matched: z.array(z.string()).max(50),
});
type HintCounter = z.infer<typeof counterSchema>;
const emptyCounter: HintCounter = {
  v: 2,
  prompts: 0,
  lastHintPrompt: -1,
  startHinted: false,
  repairHinted: false,
  registration: null,
  matched: [],
};
/** What the list endpoint answers: the caller-visible total and the newest root sessions. */
const listSchema = z.looseObject({
  items: z.array(
    z.looseObject({
      session_id: z.string().min(1),
      title: z.string().nullable(),
      started_at: z.string(),
      branch: z.string().nullable(),
      reuse_count: z.number().int().nonnegative().catch(0),
      by_teammate: z.boolean().catch(false),
      message_count: z.number().int().nonnegative().catch(0),
      end_reason: z.string().nullable().catch(null),
      files: z.array(z.string()).catch([]),
    }),
  ),
  total: z.looseObject({ sessions: z.number().int().nonnegative() }),
});
type GitContext = HookState["context"]["git"];

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
const recentOf = (cache: RecallCache): RecentSession[] =>
  cache.v === 2 ? cache.recent : [];

// ---------------------------------------------------------------------------------------
// Matching a prompt against the cached recent sessions
// ---------------------------------------------------------------------------------------
/** Words that carry no topic; identifiers and paths are never in this list. */
const STOPWORDS = new Set(
  "the and for with that this from are was were has have had not but you your our its into than then when what which how why again still also use using used set make add fix run file files code please should need want like just only some any all one two new now after before does did doing done can could will would error errors issue bug change changes update updated working work correct value wrong right commit ticket reply sentence them they their there here where more most much very let get got take took over under about into onto out off per via etc same other another each every both either neither because while during since until because through between without within along across being been".split(
    " ",
  ),
);
/** Identifiers and paths (an `_`, `/` or `.` inside) are strong evidence; words are weak. */
const weightOf = (term: string): number => (/[_/.]/.test(term) ? 2 : 1);
/** Tokens of a text: paths and identifiers whole, plus their parts, minus stopwords. */
function recallTerms(text: string): Map<string, number> {
  const terms = new Map<string, number>();
  const tokens =
    text
      .slice(0, MAX_PROMPT_CHARS)
      .toLowerCase()
      .match(/[a-z0-9_]+(?:[./-][a-z0-9_]+)*/g) ?? [];
  for (const token of tokens) {
    const parts = token.split(/[./-]/);
    for (const term of parts.length > 1 ? [token, ...parts] : [token])
      if (
        term.length >= 3 &&
        !STOPWORDS.has(term) &&
        !/^\d+$/.test(term) &&
        term !== "js" &&
        term !== "ts"
      )
        terms.set(term, weightOf(term));
  }
  return terms;
}
/**
 * Recent sessions whose title or branch shares two words, or one identifier or path, with
 * the prompt, strongest first, newest first among equals. Titles are the sessions' first
 * prompts, so a task that names the same test, file or component finds the session that
 * worked on it.
 */
export function matchRecent(
  prompt: string,
  recent: readonly RecentSession[],
): RecentSession[] {
  const wanted = recallTerms(prompt);
  if (!wanted.size) return [];
  return recent
    .map((session) => {
      const own = recallTerms(`${session.title ?? ""} ${session.branch ?? ""}`);
      let score = 0;
      for (const [term, weight] of wanted) if (own.has(term)) score += weight;
      return { session, score };
    })
    .filter((item) => item.score >= 2)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.session.startedAt.localeCompare(a.session.startedAt),
    )
    .map((item) => item.session)
    .slice(0, HINT_SESSIONS);
}

// ---------------------------------------------------------------------------------------
// Hint texts
// ---------------------------------------------------------------------------------------
const plural = (count: number, noun: string) =>
  `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
const quoted = (title: string | null) =>
  `"${(title ?? "Untitled session").replaceAll('"', "'")}"`;
/** End reasons that carry no signal; only an unusual end (an error, a clear, a timeout) shows. */
const QUIET_END_REASONS = new Set([
  "",
  "completed",
  "complete",
  "done",
  "normal",
  "end",
  "ended",
  "stop",
  "stopped",
  "finished",
  "success",
  "ok",
]);
const endReasonLabel = (reason: string | null): string | null =>
  reason && !QUIET_END_REASONS.has(reason.toLowerCase().trim())
    ? `ended: ${reason}`
    : null;
/**
 * The distilled reasons a session is worth opening, strongest first: how often it was reused,
 * whether a teammate ran it, its top file, an unusual end, and its age. Empty pieces are
 * dropped, so a session with no signal renders as just its age (as before the distill).
 */
function distillParts(session: RecentSession, now: Date): string[] {
  const parts: string[] = [];
  if (session.reuseCount > 0)
    parts.push(`reused ${String(session.reuseCount)}×`);
  if (session.byTeammate) parts.push("teammate");
  const file = session.files[0];
  if (file) parts.push(file);
  const ended = endReasonLabel(session.endReason);
  if (ended) parts.push(ended);
  parts.push(ageInWords(session.startedAt, now));
  return parts;
}
/** One session as a compact preview: `"title" (reused 3× · teammate · file · age, get id)`. */
const distill = (session: RecentSession, now: Date): string =>
  `${quoted(session.title)} (${distillParts(session, now).join(" · ")}, get ${session.id})`;
/**
 * Recent sessions ordered by what makes one worth opening — reuse, then a teammate's work,
 * then recency. With no signal (an older bundle's cache, or a server that sends none) this is
 * newest-first, exactly the order the overview used before.
 */
export function rankRecent(recent: readonly RecentSession[]): RecentSession[] {
  return [...recent].sort(
    (a, b) =>
      b.reuseCount - a.reuseCount ||
      (b.byTeammate ? 1 : 0) - (a.byTeammate ? 1 : 0) ||
      b.startedAt.localeCompare(a.startedAt),
  );
}
/** The generic nudge: a count and the repository name the hook already knows. */
export function recallHintText(repoName: string, sessions: number): string {
  return `${String(sessions)} prior AgentCommons session${sessions === 1 ? "" : "s"} touch ${repoName}; search them before changing code (search, get, sql over MCP).`;
}
/** The session overview given once, at session start, distilled and ranked by what is worth opening. */
export function startHintText(
  repoName: string,
  sessions: number,
  recent: readonly RecentSession[],
  now: Date,
): string {
  const listed = rankRecent(recent)
    .slice(0, HINT_SESSIONS)
    .map((s) => distill(s, now));
  return `AgentCommons has ${plural(sessions, "indexed session")} on ${repoName}${listed.length ? `; worth opening: ${listed.join("; ")}` : ""}. Before changing code, search them for the test, file or error you were given (search over MCP), then read a hit with get and cite its session_id.`;
}
/** The prompt-specific hint: the cached sessions whose titles match this prompt, distilled. */
export function matchedHintText(
  repoName: string,
  matches: readonly RecentSession[],
  now: Date,
): string {
  return `AgentCommons: ${plural(matches.length, "prior session")} on ${repoName} match this prompt: ${matches.map((s) => distill(s, now)).join("; ")}. Read them with get before changing code; search finds more.`;
}
/** Said once per session instead of any search hint when the harness cannot reach the server. */
export function repairHintText(
  harness: CliHarness,
  status: "missing" | "placeholder",
  file: string | null,
  directory: string,
): string {
  const cause =
    status === "placeholder"
      ? `${file ?? "its MCP configuration"} still carries an unexpanded \${AGENTCOMMONS_API_KEY} placeholder, so the server rejected it`
      : `${file ?? "its MCP configuration"} has no agentcommons entry`;
  return `AgentCommons: the agentcommons MCP server is not available to ${HARNESSES[harness].binary} in this session (${cause}). Tell the user once that the AgentCommons install needs repair: run node ${join(directory, "hook.js")} install, then start a new session. Do not search prior sessions here.`;
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

// ---------------------------------------------------------------------------------------
// Hook mode
// ---------------------------------------------------------------------------------------
/** The per-session hint state that rate-limits the hints, beside the state file. */
export const hintCounterPath = (statePath: string): string =>
  `${statePath}.hint`;
function readCounter(path: string): HintCounter {
  try {
    return readJsonOr(path, counterSchema, emptyCounter);
  } catch {
    return emptyCounter;
  }
}
/** The config home the installer wired (`--config-home`), or the user's home. */
function configHome(directory: string): string {
  const options = z
    .looseObject({
      installOptions: z
        .looseObject({ configHome: z.string().min(1).optional() })
        .optional(),
    })
    .safeParse(readJsonOr(join(directory, "config.json"), objectSchema, {}));
  return options.success
    ? (options.data.installOptions?.configHome ?? homedir())
    : homedir();
}
const promptSchema = z.looseObject({ prompt: z.string().optional() });
/**
 * Hook mode. For an event flagged `hint` in HARNESSES the cached recall data of the
 * session's repository becomes one line of additional context, and nothing else is ever
 * printed. `start` (Claude Code and Gemini `SessionStart`): the session overview, once.
 * `prompt` (`UserPromptSubmit`, `BeforeAgent`): the cached sessions whose titles match
 * the prompt, each named once per session; otherwise the generic nudge on the first
 * prompt of a session that had no overview and then every RECALL_HINT_EVERY_PROMPTS
 * prompts. When the harness's own MCP configuration lacks a usable `agentcommons` entry,
 * the only hint is one repair notice per session, because a hint that names tools the
 * harness does not have is noise. When the uploader wrote the §8.3 block into the
 * repository since the last hinted event, the line saying so rides along once (alone when
 * nothing else is due). Reads a few small files and writes one or two; the uploader fills
 * the cache and writes the repository, so hook mode never touches the network or the tree.
 */
export function promptHint(
  directory: string,
  harness: CliHarness,
  input: unknown,
  statePath: string,
  now = new Date(),
): string | null {
  const event = nativeHookSchema.parse(input);
  const kind = HARNESSES[harness].events[event.hook_event_name]?.hint;
  if (!kind) return null;
  const path = hintCounterPath(statePath);
  const counter = readCounter(path);
  const next: HintCounter = {
    ...counter,
    prompts: kind === "prompt" ? counter.prompts + 1 : counter.prompts,
  };
  const speak = (text: string): string => {
    writeAtomic(path, next);
    return hookContextOutput(event.hook_event_name, text);
  };
  const silent = (): null => {
    if (JSON.stringify(next) !== JSON.stringify(counter))
      writeAtomic(path, next);
    return null;
  };
  // The registration verdict is read at most twice per session: the start event and the
  // first prompt. A repair mid-session is noticed by the next session.
  if (next.registration === null && (kind === "start" || next.prompts <= 1)) {
    next.registration = registrationStatus(harness, configHome(directory));
  }
  if (next.registration === "missing" || next.registration === "placeholder") {
    if (next.repairHinted) return silent();
    next.repairHinted = true;
    return speak(
      repairHintText(
        harness,
        next.registration,
        registrationFile(harness, configHome(directory)),
        directory,
      ),
    );
  }
  // The checkout as it is now, from the root the first drain recorded, else from `cwd`
  // (a session's first event, before any drain): a few small reads, no subprocess.
  const repository = repositoryAt(
    loadState(statePath).context.git?.root ?? event.cwd,
  );
  const hint = ((): string | null => {
    const repoName = repositoryName(repository);
    if (!repoName) return null;
    const cache = readCache(directory, repoName);
    if (!cache || cache.sessions === 0) return null;
    const recent = recentOf(cache);
    if (kind === "start") {
      if (next.startHinted) return null;
      next.startHinted = true;
      next.lastHintPrompt = 0;
      return startHintText(repoName, cache.sessions, recent, now);
    }
    const prompt = promptSchema.safeParse(input).data?.prompt ?? "";
    const matches = matchRecent(prompt, recent).filter(
      (session) => !next.matched.includes(session.id),
    );
    if (matches.length) {
      next.matched = [...next.matched, ...matches.map((s) => s.id)].slice(-50);
      next.lastHintPrompt = next.prompts;
      return matchedHintText(repoName, matches, now);
    }
    const due =
      next.lastHintPrompt < 0 ||
      next.prompts - next.lastHintPrompt >= RECALL_HINT_EVERY_PROMPTS;
    if (!due) return null;
    next.lastHintPrompt = next.prompts;
    return recallHintText(repoName, cache.sessions);
  })();
  return hint ? speak(hint) : silent();
}

// ---------------------------------------------------------------------------------------
// Before-edit recall (hook mode, pre-tool)
// ---------------------------------------------------------------------------------------
/**
 * Keys a harness's edit/write tool carries the target file under (`file_path` for Claude Code
 * and Gemini CLI; `notebook_path` for NotebookEdit), tried in order. `tool_input` is a loose
 * bag, so the path is read defensively and never assumed.
 */
const EDIT_PATH_KEYS = [
  "file_path",
  "notebook_path",
  "path",
  "absolute_path",
  "filePath",
];
/** At most this many files keep their before-edit hint suppressed within one session. */
const EDIT_DEDUP_LIMIT = 500;
const editDedupSchema = z.looseObject({
  v: z.literal(1),
  files: z.array(z.string()).catch([]),
});
type EditDedup = z.infer<typeof editDedupSchema>;
const emptyEditDedup: EditDedup = { v: 1, files: [] };
/** The before-edit dedup set beside the state file: the files already hinted this session. */
export const beforeEditDedupPath = (statePath: string): string =>
  `${statePath}.edits`;
function readEditDedup(path: string): EditDedup {
  try {
    return readJsonOr(path, editDedupSchema, emptyEditDedup);
  } catch {
    return emptyEditDedup;
  }
}
/**
 * A tool's file argument as the repository sees it: resolved against `cwd` (a tool gives an
 * absolute path — Claude Code — or one relative to `cwd` — Gemini CLI), made relative to the
 * repo root, POSIX slashes, no leading `./`; null when it resolves outside the repository.
 * This is the transform the server applies when it stores a session's files, so the two agree
 * and a plain string equality matches.
 */
function repoRelative(
  target: string,
  cwd: string,
  root: string,
): string | null {
  const absolute = isAbsolute(target) ? target : resolve(cwd, target);
  const rel = relative(root, absolute);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    return null;
  return rel.split(sep).join("/");
}
/** The cached file equal to `wanted` (already repository-relative POSIX), or null. */
function matchingFile(wanted: string, files: readonly string[]): string | null {
  for (const file of files)
    if (file.replace(/^\.\//, "") === wanted) return file;
  return null;
}
/** The target file a harness's edit tool names in its pre-tool payload, or null. */
function editTargetPath(
  toolInput: Record<string, unknown> | undefined,
): string | null {
  if (!toolInput) return null;
  for (const key of EDIT_PATH_KEYS) {
    const value = toolInput[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}
/** The one concise line surfaced before an edit to a file a prior session already worked on. */
export function beforeEditHintText(
  file: string,
  session: RecentSession,
  now: Date,
): string {
  const marks: string[] = [];
  if (session.reuseCount > 0)
    marks.push(`reused ${String(session.reuseCount)}×`);
  if (session.byTeammate) marks.push("teammate");
  marks.push(ageInWords(session.startedAt, now));
  return `AgentCommons: a prior session worked on ${file}: ${quoted(session.title)} (${marks.join(" · ")}). Read it with get ${session.id} before editing.`;
}
/**
 * Hook mode, the pre-tool path (§6.4). When the tool is one of the harness's edit/write tools
 * and a cached recall session already worked on the file about to be changed, returns one
 * concise line naming that session, strongest (most reused, a teammate's, largest, newest)
 * first; otherwise null. At most one hint per file per session (a small set beside the state
 * file), and only a file match — never mere same-repository membership, which would fire on
 * every edit. Reads the already-refreshed cache and a couple of small files, never the network,
 * and never throws: any trouble returns null so the tool always runs.
 */
export function beforeEditHint(
  directory: string,
  harness: CliHarness,
  event: PreToolPayload,
  now = new Date(),
): string | null {
  try {
    if (!HARNESSES[harness].editTools.includes(event.tool_name)) return null;
    const target = editTargetPath(event.tool_input);
    if (!target) return null;
    const repo = repositoryAt(event.cwd);
    const repoName = repositoryName(repo);
    if (!repoName) return null;
    const wanted = repoRelative(target, event.cwd, repo.root);
    if (!wanted) return null;
    const cache = readCache(directory, repoName);
    const recent = cache ? recentOf(cache) : [];
    if (!recent.length) return null;
    const best = recent
      .map((session) => ({
        session,
        file: matchingFile(wanted, session.files),
      }))
      .filter(
        (candidate): candidate is { session: RecentSession; file: string } =>
          candidate.file !== null,
      )
      .sort(
        (a, b) =>
          b.session.reuseCount - a.session.reuseCount ||
          (b.session.byTeammate ? 1 : 0) - (a.session.byTeammate ? 1 : 0) ||
          b.session.messageCount - a.session.messageCount ||
          b.session.startedAt.localeCompare(a.session.startedAt),
      )[0];
    if (!best) return null;
    // Dedup on the repository-relative path, so the same file deduplicates whether the tool
    // named it absolutely (Claude Code) or relative to cwd (Gemini CLI).
    const dedupPath = beforeEditDedupPath(
      statePath(directory, harness, event.session_id),
    );
    const dedup = readEditDedup(dedupPath);
    if (dedup.files.includes(wanted)) return null;
    writeAtomic(dedupPath, {
      v: 1,
      files: [...dedup.files, wanted].slice(-EDIT_DEDUP_LIMIT),
    });
    return beforeEditHintText(best.file, best.session, now);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// Upload mode
// ---------------------------------------------------------------------------------------
interface RefreshOptions {
  fetch?: typeof fetch;
  now?: () => number;
}
/**
 * Upload mode only. After a drain, the repository's recall data is fetched from the
 * configured server: one list request, `limit=10`, roots only, newest first, whose
 * `total` is the page's own scan (§7.6), at most every RECALL_REFRESH_MS per repository,
 * cached under `recall/` for hook mode as the count plus the newest sessions' id, title,
 * start time and branch (what the same key already reads). The attempt is recorded before
 * the request so a failing server is asked again only after the interval; failures are
 * logged and ignored and the durability path is never involved. The repository is the
 * checkout at the state's root as it is now (`repositoryAt`); the state's own `remoteUrl`
 * dates from the first drain and is never the
 * name asked for or cached, so a renamed remote takes effect at the next refresh.
 */
export async function refreshRecallHint(
  directory: string,
  config: HookConfig,
  git: GitContext,
  options: RefreshOptions = {},
): Promise<"refreshed" | "current" | "skipped"> {
  const repoName = repositoryName(git ? repositoryAt(git.root) : null);
  if (!repoName) return "skipped";
  const now = options.now?.() ?? Date.now();
  const cache = readCache(directory, repoName);
  if (cache && now - cache.fetchedAt < RECALL_REFRESH_MS) return "current";
  const path = recallCachePath(directory, repoName);
  const write = (sessions: number, recent: RecentSession[]) => {
    writeAtomic(path, { v: 2, repoName, sessions, fetchedAt: now, recent });
  };
  write(cache?.sessions ?? 0, cache ? recentOf(cache) : []);
  try {
    const url = new URL("/api/v1/sessions", config.server);
    url.searchParams.set("limit", String(RECALL_RECENT_LIMIT));
    url.searchParams.set("roots_only", "true");
    // Recall ranking (§7.6): the page is ordered by proven value (reuse_count desc, then
    // recency) and each item carries the distilled fields and a files preview the hint reads.
    url.searchParams.set("recall", "true");
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
    const list = listSchema.parse(await response.json());
    write(
      list.total.sessions,
      list.items.slice(0, RECALL_RECENT_LIMIT).map((item) => ({
        id: item.session_id,
        title:
          item.title === null ? null : item.title.slice(0, MAX_TITLE_CHARS),
        startedAt: item.started_at,
        branch: item.branch,
        reuseCount: item.reuse_count,
        byTeammate: item.by_teammate,
        messageCount: item.message_count,
        endReason:
          item.end_reason === null
            ? null
            : item.end_reason.slice(0, MAX_END_REASON_CHARS),
        files: item.files
          .filter((file) => file.length > 0)
          .slice(0, MAX_RECENT_FILES)
          .map((file) => file.slice(0, MAX_FILE_CHARS)),
      })),
    );
    return "refreshed";
  } catch (error) {
    note(
      directory,
      `Recall hint skipped for ${repoName}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return "skipped";
  }
}
