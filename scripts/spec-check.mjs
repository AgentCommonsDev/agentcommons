#!/usr/bin/env node
// Spec traceability check. No dependencies. Node >= 20.
//   node scripts/spec-check.mjs            # exit 1 if any requirement lacks a test
//   node scripts/spec-check.mjs --report   # print the table, always exit 0
// Requirements: docs/REQUIREMENTS.md rows "| R-AREA-NN | text | §x.y | verification |".
// Tests reference an ID anywhere in a test file as "@req R-AREA-NN".
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const report = process.argv.includes("--report");
const reqPath = join(root, "docs/REQUIREMENTS.md");
const specPath = join(root, "docs/SPEC.md");

const reqText = readFileSync(reqPath, "utf8");
const spec = readFileSync(specPath, "utf8");
const sections = new Set(
  [...spec.matchAll(/^#{2,3}\s+(\d+(?:\.\d+)?)\.?\s/gm)]
    .map((m) => m[1])
    .concat(
      [...spec.matchAll(/^##\s+Appendix\s+([A-Z])\./gm)].map(
        (m) => "Appendix " + m[1],
      ),
    ),
);

// Read the final two cells from the right: inline code in a requirement can contain
// a pipe (e.g. the bitwise search-rank flags), which is not a section delimiter.
const rows = [
  ...reqText.matchAll(
    /^\|\s*(R-[A-Z]+-\d{2})\s*\|\s*(.*)\s*\|\s*([^|]*)\s*\|\s*([^|]*)\s*\|\s*$/gm,
  ),
].map((m) => ({ id: m[1], text: m[2], section: m[3], verify: m[4] }));
if (rows.length === 0) {
  console.error("no requirements found in docs/REQUIREMENTS.md");
  process.exit(2);
}

const dupes = rows.map((r) => r.id).filter((id, i, a) => a.indexOf(id) !== i);
const badSections = rows.filter((r) => {
  const refs = [
    ...r.section.matchAll(/§(\d+(?:\.\d+)?)|Appendix ([A-Z])/g),
  ].map((m) => m[1] ?? "Appendix " + m[2]);
  return refs.length === 0 || refs.some((ref) => !sections.has(ref));
});

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith("."))
      continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(test|spec|e2e)\.[cm]?[jt]sx?$/.test(name)) yield p;
  }
}
const covered = new Map(rows.map((r) => [r.id, []]));
const unknownRefs = [];
for (const dir of ["apps", "packages", "infra", "e2e"]) {
  for (const file of walk(join(root, dir))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/@req\s+(R-[A-Z]+-\d{2})/g)) {
      const rel = relative(root, file);
      if (covered.has(m[1])) {
        const files = covered.get(m[1]);
        if (!files.includes(rel)) files.push(rel);
      } else unknownRefs.push({ id: m[1], file: rel });
    }
  }
}

const missing = rows.filter((r) => covered.get(r.id).length === 0);
const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad("ID", 11) + pad("tests", 6) + pad("section", 14) + "requirement",
);
for (const r of rows)
  console.log(
    pad(r.id, 11) +
      pad(covered.get(r.id).length, 6) +
      pad(r.section, 14) +
      r.text.slice(0, 90),
  );
console.log(
  `\n${rows.length} requirements, ${rows.length - missing.length} covered, ${missing.length} uncovered`,
);
if (dupes.length)
  console.log("duplicate IDs: " + [...new Set(dupes)].join(", "));
if (badSections.length)
  console.log(
    "requirements citing missing spec sections: " +
      badSections.map((r) => `${r.id} (${r.section})`).join(", "),
  );
if (unknownRefs.length)
  console.log(
    "tests citing unknown IDs: " +
      unknownRefs.map((u) => `${u.id} in ${u.file}`).join(", "),
  );

const failed =
  missing.length > 0 ||
  dupes.length > 0 ||
  badSections.length > 0 ||
  unknownRefs.length > 0;
process.exit(report ? 0 : failed ? 1 : 0);
