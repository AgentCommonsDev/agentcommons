import { existsSync, readFileSync, rmSync } from "node:fs";
import { writeUserFile } from "./files.js";

/** Delimits the one block AgentCommons owns inside a file the user owns. */
export interface BlockMarkers {
  begin: string;
  end: string;
}
const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Writes or replaces the marked block in place, or removes it when `content` is null
 * (a self-update carries new text; uninstall and `guidance --off` remove it). Everything
 * outside the markers is the user's and is kept byte for byte; a file left empty is
 * removed. Returns whether the file changed, so callers know what there is to commit.
 */
export function replaceMarkedBlock(
  path: string,
  markers: BlockMarkers,
  content: string | null,
): boolean {
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (content === null && !original) return false;
  const kept = original.replace(
    new RegExp(
      `\\n?${escapeRegExp(markers.begin)}\\n[\\s\\S]*?${escapeRegExp(markers.end)}\\n?`,
      "g",
    ),
    "",
  );
  if (content === null) {
    if (kept === original) return false;
    if (kept.trim() === "") rmSync(path, { force: true });
    else writeUserFile(path, kept);
    return true;
  }
  const separator =
    kept === "" || kept.endsWith("\n\n")
      ? ""
      : kept.endsWith("\n")
        ? "\n"
        : "\n\n";
  const next = `${kept}${separator}${markers.begin}\n${content}\n${markers.end}\n`;
  if (next === original) return false;
  writeUserFile(path, next);
  return true;
}
