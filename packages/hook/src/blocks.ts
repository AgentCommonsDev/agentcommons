import { existsSync, readFileSync, rmSync } from "node:fs";
import {
  blockText,
  markedBlock,
  type BlockMarkers,
} from "@agentcommons/core/format/install";
import { writeUserFile } from "./files.js";

export type { BlockMarkers };
const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Every marked block in a file, with the text between its markers in group 1. */
const blockPattern = (markers: BlockMarkers): RegExp =>
  new RegExp(
    `\\n?${escapeRegExp(markers.begin)}\\n([\\s\\S]*?)\\n?${escapeRegExp(markers.end)}\\n?`,
    "g",
  );
/**
 * Writes or replaces the marked block, or removes it when `content` is null (a self-update
 * carries new text; uninstall and `guidance --off` remove it). A block already in the file
 * that says the same thing (`blockText`: blank lines and trailing whitespace aside) is left
 * exactly as it is, wherever it sits, so a formatter's layout never starts a rewrite.
 * Otherwise the block is written at the end in `markedBlock`'s prettier-stable layout, one
 * blank line after the user's text and a single final newline; everything outside the
 * markers is the user's and is kept (trailing blank lines before the block collapse to
 * that one), and a file left empty is removed. Returns whether the file changed, so callers
 * know what there is to commit.
 */
export function replaceMarkedBlock(
  path: string,
  markers: BlockMarkers,
  content: string | null,
): boolean {
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (content === null && !original) return false;
  const pattern = blockPattern(markers);
  const present = [...original.matchAll(pattern)];
  if (
    content !== null &&
    present.length === 1 &&
    blockText(present[0]?.[1] ?? "") === blockText(content)
  )
    return false;
  const kept = original.replace(pattern, "");
  if (content === null) {
    if (kept === original) return false;
    if (kept.trim() === "") rmSync(path, { force: true });
    else writeUserFile(path, kept);
    return true;
  }
  const before = kept.replace(/\s+$/, "");
  const next = `${before ? `${before}\n\n` : ""}${markedBlock(markers, content)}\n`;
  if (next === original) return false;
  writeUserFile(path, next);
  return true;
}
