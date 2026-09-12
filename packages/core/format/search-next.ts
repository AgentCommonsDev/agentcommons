/**
 * What an agent should try when a `search` page cannot answer (§7.2, ADR 0078). Claude
 * Code hands its model the result's `structuredContent`, not the text rendering (ADR
 * 0070), so the step travels as the `next` field of the output and the text form prints
 * the same sentence. One implementation for the service and every adapter.
 */
export interface SearchNextInput {
  query: string;
  filters?: Record<string, unknown> | undefined;
}
const words = (query: string): number =>
  query.trim().split(/\s+/).filter(Boolean).length;
const hasFilters = (filters: SearchNextInput["filters"]): boolean =>
  filters !== undefined && Object.keys(filters).length > 0;
/**
 * The next step for a page with no hit, from the shape of the call that produced it: a
 * long query loses its common words (every word must match), filters are named as the
 * other thing to drop, and the exact repository names come from `repos`. Null for a
 * page with hits.
 */
export function searchNextStep(
  input: SearchNextInput,
  hits: number,
): string | null {
  if (hits > 0) return null;
  if (words(input.query) === 0)
    return "No visible session matches these filters. Widen them; SELECT * FROM repos lists the repositories and their session counts.";
  const parts = ["No indexed message contains every word of the query."];
  if (words(input.query) > 2)
    parts.push(
      "Retry with the 2 rarest words: a test name, identifier, file name or error fragment.",
    );
  if (hasFilters(input.filters))
    parts.push(
      `${words(input.query) > 2 ? "Then" : "Retry without the filters, or"} check them: repo_name is the name as git names the remote (SELECT * FROM repos lists the visible ones).`,
    );
  if (words(input.query) <= 2 && !hasFilters(input.filters))
    parts.push(
      "Try a synonym, the file name or the error text; SELECT title, repo_name, started_at FROM sessions ORDER BY started_at DESC LIMIT 20 shows what is indexed.",
    );
  return parts.join(" ");
}
