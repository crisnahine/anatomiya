/**
 * Facts the prose states that the code also states.
 *
 * Every number here drifted at least once: the README claimed 21 dimensions
 * after 31 shipped, and a gate table listed floors the gates had stopped
 * reading. A reader cannot tell a stale number from a true one, and a wrong
 * number in the file that explains the tool is worse than no file.
 *
 * Only mechanically derivable claims are checked. Prose that describes a
 * measurement is left to a human.
 */
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import { dimensionsFor } from "../lib/dimensions.mjs";
import { pairingsFor } from "../lib/pairing.mjs";
import { REGISTRY, rowsOfKind } from "../lib/registry.mjs";
import { GATES } from "../lib/reduce.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const problems = [];

/**
 * The intake table, as rows.
 *
 * Markdown rather than JSON because the table is read by people in a pull
 * request far more often than by this parser, and a decision nobody reads is a
 * decision that gets made twice.
 */
export function readIntake(text) {
  const rows = [];
  const problems = [];
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex((l) => /^\|\s*key\s*\|/.test(l));
  if (header === -1) {
    problems.push("docs/dimension-intake.md has no table header row");
    return { rows, problems };
  }

  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 5) {
      problems.push(`intake row has ${cells.length} cells, not 5: ${line.slice(0, 60)}`);
      continue;
    }
    const [key, absorbs, renamedFrom, status, why] = cells;
    if (!["shipped", "planned", "dropped"].includes(status)) {
      problems.push(`intake row ${key} has status "${status}"`);
      continue;
    }
    rows.push({
      key: key === "-" ? null : key,
      absorbs: absorbs === "-" || absorbs === "" ? [] : absorbs.split(";").map((x) => x.trim()).filter(Boolean),
      renamedFrom,
      status,
      why,
    });
  }

  return { rows, problems };
}


function claim(where, ok, detail) {
  if (!ok) problems.push(`${where}: ${detail}`);
}

// --- the dimension registry -------------------------------------------------

// Obligations and filename rows count here too. A checker blind to a whole
// dimension class would pass while the README undercounted by nine, which is
// the drift this script exists to catch.
const corpusFor = (lang) => rowsOfKind("corpus").filter((d) => d.langs.includes(lang)).length;
const total = REGISTRY.length;
const js = dimensionsFor(["js"]).length + pairingsFor(["js"]).length + corpusFor("js");
const jsx = dimensionsFor(["jsx"]).length + pairingsFor(["jsx"]).length + corpusFor("jsx");
const ruby = dimensionsFor(["ruby"]).length + pairingsFor(["ruby"]).length + corpusFor("ruby");
const obligations = rowsOfKind("pairing").length;

// A released entry states the number that shipped in it and stays true forever.
// Reading the whole changelog made every past release a claim about today, so
// the first number that ever changed would fail three entries that are correct.
const unreleased = (text) => {
  const start = text.indexOf("## [Unreleased]");
  // Returning an empty section would skip every claim below without failing,
  // which is a clean report for a file nothing read.
  claim("CHANGELOG.md", start !== -1, "has no ## [Unreleased] heading to read");
  if (start === -1) return "";
  const next = text.indexOf("\n## [", start + 1);
  return next === -1 ? text.slice(start) : text.slice(start, next);
};

for (const rel of ["README.md", "docs/how-it-works.md", "CHANGELOG.md"]) {
  const text = rel === "CHANGELOG.md" ? unreleased(read(rel)) : read(rel);
  for (const m of text.matchAll(/(\d+)\s+dimensions/g)) {
    claim(`${rel}`, Number(m[1]) === total, `says "${m[1]} dimensions", the registry holds ${total}`);
  }
  for (const m of text.matchAll(/(\d+)\s+for\s+JavaScript(?!\s+and)/g)) {
    claim(rel, Number(m[1]) === js, `says "${m[1]} for JavaScript", dimensionsFor(["js"]) is ${js}`);
  }
  for (const m of text.matchAll(/(\d+)\s+reachable\s+in\s+JSX/g)) {
    claim(rel, Number(m[1]) === jsx, `says "${m[1]} reachable in JSX", dimensionsFor(["jsx"]) is ${jsx}`);
  }
  for (const m of text.matchAll(/(\d+)\s+for\s+Ruby/g)) {
    claim(rel, Number(m[1]) === ruby, `says "${m[1]} for Ruby", dimensionsFor(["ruby"]) is ${ruby}`);
  }
  for (const m of text.matchAll(/(\d+)\s+file-to-file obligations/g)) {
    claim(rel, Number(m[1]) === obligations, `says "${m[1]} file-to-file obligations", the registry holds ${obligations}`);
  }
}

// A dimension either states its inverse or records that it may not. An absent
// field is indistinguishable from one nobody classified.
for (const d of REGISTRY) {
  claim(
    "lib/dimensions.mjs",
    d.counterClaim === null || typeof d.counterClaim === "string",
    `${d.key} has no counterClaim decision, which reads the same as refused`
  );
}

// --- the build contract -----------------------------------------------------

// Three files state this count and all three have been wrong at once: the table
// held 55 rows while the README said 55 and CONTRIBUTING said 54. It is the one
// number in the docs that moves on every substantive change.
const rows = [...read("DECISIONS.md").matchAll(/^\| [A-H]\d+ \|/gm)].length;
for (const rel of ["README.md", "docs/why.md", "CONTRIBUTING.md"]) {
  for (const m of read(rel).matchAll(/(\d+)\s+numbered (?:decisions|rows)/g)) {
    claim(rel, Number(m[1]) === rows, `says "${m[1]} numbered", DECISIONS.md holds ${rows} rows`);
  }
}

// A row number appearing twice is a row nobody can cite.
const ids = [...read("DECISIONS.md").matchAll(/^\| ([A-H]\d+) \|/gm)].map((m) => m[1]);
claim("DECISIONS.md", new Set(ids).size === ids.length, "two rows share a number");

// --- the gate table ---------------------------------------------------------

const gateText = read("README.md") + read("docs/how-it-works.md");
claim(
  "docs",
  /\b0\.90\b/.test(gateText),
  "no document states the 0.90 bar, which is the one number that never moves"
);
claim("lib/reduce.mjs", GATES.minRatio === 0.9, `minRatio is ${GATES.minRatio}, and it is fixed at 0.90 by decision`);

// Anything the gates stopped reading must stop being described.
for (const dead of ["minCandidates", "minAuthors", "maxSingleFileShare"]) {
  claim("lib/reduce.mjs", GATES[dead] === undefined, `${dead} is back in GATES; it was replaced by a repository-relative rule`);
  claim("docs", !gateText.includes(dead), `the docs still name ${dead}, which the gates no longer read`);
}

// --- the command surface ----------------------------------------------------

const usage = execFileSync(process.execPath, [join(root, "bin/anatomiya.mjs"), "--help"], {
  encoding: "utf8",
});
const commands = [...usage.matchAll(/anatomiya\s+(\w+)/g)].map((m) => m[1]);
const unique = [...new Set(commands)];

for (const cmd of unique) {
  let file;
  try {
    file = read(`commands/${cmd}.md`);
  } catch {
    problems.push(`commands/: ${cmd} is in the usage line and has no command file`);
    continue;
  }
  claim(`commands/${cmd}.md`, file.trim().length > 0, "is empty");
}

const readme = read("README.md");
for (const cmd of unique) {
  claim("README.md", readme.includes(`/anatomiya:${cmd}`), `does not mention /anatomiya:${cmd}`);
}

// --- the intake table -------------------------------------------------------

// A dimension that ships without an intake row is one nobody decided to build:
// the collapse, the rename and the drop were never asked about it. The README's
// dimension count has already drifted once, and this is the same failure with a
// worse consequence, so the table is checked rather than trusted.
const intake = readIntake(read("docs/dimension-intake.md"));
for (const p of intake.problems) claim("docs/dimension-intake.md", false, p);

const intakeByKey = new Map(intake.rows.filter((r) => r.key).map((r) => [r.key, r]));
const droppedKeys = new Set(intake.rows.filter((r) => r.status === "dropped" && r.key).map((r) => r.key));
for (const d of REGISTRY) {
  const row = intakeByKey.get(d.key);
  claim("docs/dimension-intake.md", !!row, `${d.key} ships and has no intake row`);
  if (row) {
    claim("docs/dimension-intake.md", row.status === "shipped", `${d.key} ships and its intake row says ${row.status}`);
  }
  claim("docs/dimension-intake.md", !droppedKeys.has(d.key), `${d.key} ships and is also marked dropped`);
}

// Two rows claiming one entry print the same three numbers twice under two
// names, which is the duplication the collapse exists to stop.
const absorbedBy = new Map();
for (const r of intake.rows) {
  for (const entry of r.absorbs) {
    const previous = absorbedBy.get(entry);
    claim("docs/dimension-intake.md", previous === undefined, `"${entry}" is absorbed by both ${previous} and ${r.key ?? "a dropped row"}`);
    absorbedBy.set(entry, r.key ?? "a dropped row");
  }
}

// --- runtime dependencies ---------------------------------------------------

// SECURITY.md said "oxc-parser is the only runtime dependency" for as long as
// there were two of them. A reader deciding whether to run this on a work
// repository is reading exactly that sentence, so the set is checked rather
// than trusted.
const deps = Object.keys(JSON.parse(read("package.json")).dependencies ?? {});
for (const doc of ["SECURITY.md", "README.md"]) {
  const text = read(doc);
  for (const dep of deps) claim(doc, text.includes(dep), `does not name the runtime dependency ${dep}`);
  claim(doc, !/only runtime dependency/.test(text), `says "only runtime dependency" with ${deps.length} of them`);
}

// --- committed documents carry no local path --------------------------------

// The first A/B result committed here carried /Users/<name>/Documents/... into
// a public repository, in its title and in its table. Where a clone sat on the
// machine that ran something is not part of the record, and nobody else can
// check it. Measurements are generated, so the generator was fixed too; this is
// the net under it.
for (const rel of readdirSync(join(root, "docs/measurements")).filter((f) => f.endsWith(".md"))) {
  const text = read(join("docs/measurements", rel));
  const hit = text.match(/\/Users\/[^\s/]+|\/home\/[^\s/]+|[A-Z]:\\Users\\[^\s\\]+/);
  claim(`docs/measurements/${rel}`, !hit, `carries the local path ${hit ? hit[0] : ""}`);
}

// --- versions ---------------------------------------------------------------

const pkg = JSON.parse(read("package.json"));
const plugin = JSON.parse(read(".claude-plugin/plugin.json"));
claim("package.json", pkg.version === plugin.version, `${pkg.version} against plugin.json ${plugin.version}`);
claim("CHANGELOG.md", read("CHANGELOG.md").includes(`## [${pkg.version}]`), `has no section for ${pkg.version}`);

// ----------------------------------------------------------------------------

// This file exports `readIntake` as well as running as a script, and a bare
// `process.exit(1)` at module scope would take the test process with it the
// moment a doc claim failed.
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry && problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\n${problems.length} claim(s) in the documentation do not match the code.`);
  process.exit(1);
}
if (isEntry)
  console.log(
  `docs match the code: ${total} dimensions (${js} js, ${jsx} jsx, ${ruby} ruby, ${obligations} of them file-to-file obligations), ` +
    `${unique.length} commands, ${deps.length} runtime dependencies, ${intake.rows.length} intake rows, version ${pkg.version}`
);
