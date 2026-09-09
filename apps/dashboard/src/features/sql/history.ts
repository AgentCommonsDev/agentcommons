export interface HistoryEntry {
  sql: string;
  at: string;
}
const limit = 20;
const storageKey = (organizationId: string) =>
  `agentcommons-sql-history:${organizationId}`;

/** The last queries run in this organization, newest first; storage failures read as empty. */
export function readHistory(organizationId: string): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(organizationId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry: unknown) =>
      typeof entry === "object" &&
      entry !== null &&
      "sql" in entry &&
      "at" in entry &&
      typeof entry.sql === "string" &&
      typeof entry.at === "string"
        ? [{ sql: entry.sql, at: entry.at }]
        : [],
    );
  } catch {
    return [];
  }
}
function write(
  organizationId: string,
  entries: HistoryEntry[],
): HistoryEntry[] {
  try {
    localStorage.setItem(storageKey(organizationId), JSON.stringify(entries));
  } catch {
    /* Private mode or a full store: history is a convenience only. */
  }
  return entries;
}
/** Record a run; an identical query moves to the top instead of repeating. */
export function pushHistory(
  organizationId: string,
  sql: string,
): HistoryEntry[] {
  const trimmed = sql.trim();
  if (!trimmed) return readHistory(organizationId);
  const rest = readHistory(organizationId).filter(
    (entry) => entry.sql !== trimmed,
  );
  return write(
    organizationId,
    [{ sql: trimmed, at: new Date().toISOString() }, ...rest].slice(0, limit),
  );
}
export function clearHistory(organizationId: string): HistoryEntry[] {
  return write(organizationId, []);
}
