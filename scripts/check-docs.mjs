/**
 * Facts the prose states that the code also states, and the sites a new
 * registry key has yet to reach.
 *
 * Every number here drifted at least once: the README claimed 21 dimensions
 * after 31 shipped, and a gate table listed floors the gates had stopped
 * reading. A reader cannot tell a stale number from a true one, and a wrong
 * number in the file that explains the tool is worse than no file.
 *
 * The sites are here for the same reason from the other end: a row's
 * scaffolding is scattered, and two of the sites fail in files an author has
 * never opened. This is the one place that lists all of them.
 *
 * Only mechanically derivable claims are checked. Prose that describes a
 * measurement is left to a human.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { invokedAs } from "./entry.mjs";
import { REL } from "./plugins.mjs";
import { RELEASES, notesFor, tagFor } from "./release.mjs";
import { SEMVER } from "./validate.mjs";
import { CAVEATS } from "../plugins/anatomiya/lib/check-report.mjs";
import { pairingsFor } from "../plugins/anatomiya/lib/pairing.mjs";
import { REGISTRY, rowsForLangs, rowsOfKind } from "../plugins/anatomiya/lib/registry.mjs";
import { EXCLUDE_LINES } from "../plugins/anatomiya/lib/rules.mjs";
import { GATES } from "../plugins/anatomiya/lib/reduce.mjs";
import { PARSE_OUTCOMES } from "../plugins/anatomiya/lib/parse.mjs";
import { ELIGIBLE, REFUSED } from "../test/fixtures/counter-pins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * A file this repository is known to have.
 *
 * A read that throws here takes the whole gate down with a stack in place of
 * the sentence naming the file, and this module is imported by its own test, so
 * one missing document failed that file at load. Every path this reads is
 * checked once up front instead.
 */
const read = (rel) => readFileSync(join(root, rel), "utf8");

/** The same read for a file whose absence is itself one of the claims. */
const readOr = (rel, absent) => {
  try {
    return read(rel);
  } catch {
    return absent;
  }
};

/**
 * A manifest as an object, or the reason it is not one.
 *
 * Both halves through one guard: a file that is not there and a file that does
 * not parse are the same thing to a reader who has to fix it, and either one
 * thrown from here ends the run before it has said which file it was.
 */
const readJson = (rel) => {
  try {
    return { value: JSON.parse(read(rel)), problem: null };
  } catch (err) {
    const missing = err.code === "ENOENT";
    return { value: null, problem: missing ? "is missing, so nothing says what version this plugin is at" : `could not be read: ${err.message}` };
  }
};

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


/**
 * Which of the sites a row owes it has not reached, all of them rather than the
 * first.
 *
 * The row itself is one edit and the rest are scattered: the model-defaults
 * table fails a test that names no remedy, the counter pin fails a gate battery
 * on a count, and the intake row is the decision the key exists because of. An
 * author who missed one reads a failure in a file they have never opened, so
 * every site is asked at once and each answer says what to do about it.
 *
 * The intake row and the counter pin are review gates (G2, C6), so neither
 * remedy is a command to run. Saying a person has not decided yet is the whole
 * job; deciding for them is what the gates exist to stop.
 */
export function sitesOwed(row, { defaults, intake, dropped, eligible, refused }) {
  const owed = [];
  const pin = "test/fixtures/counter-pins.mjs";

  if (!defaults.has(row.key)) {
    owed.push({ site: `${REL.anatomiya}/lib/model-defaults.json`, missing: "no entry", remedy: "run npm run defaults:seed" });
  }

  const written = intake.get(row.key);
  if (!written) {
    owed.push({
      site: "docs/dimension-intake.md",
      missing: "no row",
      remedy: "write one: the glossary entries the key answers, what it is renamed from, and why (G2)",
    });
  } else if (written.status !== "shipped") {
    owed.push({ site: "docs/dimension-intake.md", missing: `a row marked ${written.status}`, remedy: "mark it shipped, or stop shipping it" });
  }
  if (dropped.has(row.key)) {
    owed.push({ site: "docs/dimension-intake.md", missing: "a dropped row as well", remedy: "a key ships or it is dropped, never both" });
  }

  if (typeof row.counterClaim === "string" && !eligible.has(row.key)) {
    owed.push({ site: pin, missing: "no entry in ELIGIBLE", remedy: "pin it there, and measure the counter its own cross-repository spread (C6)" });
  }
  if (row.counterClaim === null && !refused.has(row.key)) {
    owed.push({ site: pin, missing: "no entry in REFUSED", remedy: "pin it there, with the reason its inverse is a defect beside it (C6)" });
  }

  return owed;
}

/**
 * The glossary, as entries.
 *
 * An entry is a bold name alone on a line, the lines under it, and an
 * `_Avoid_` line closing it. A blank line closes one too, which is how an
 * entry that never reached its `_Avoid_` is caught rather than swallowing
 * the entry after it.
 *
 * Only the shape is read here. What an entry means against the code is a
 * human's to check, and eleven of them had drifted before anyone did.
 */
export function readGlossary(text) {
  const terms = new Map();
  const problems = [];
  let open = null;

  const close = () => {
    if (!open) return;
    if (!open.body) problems.push(`${open.name} has no definition under it`);
    if (!open.avoid) problems.push(`${open.name} has no _Avoid_ line, so nothing says which words it displaces`);
    terms.set(open.name, { body: open.body, avoid: open.avoid, line: open.line });
    open = null;
  };

  for (const [i, line] of text.split(/\r?\n/).entries()) {
    // The whole line, so the bold words inside a definition are not entries.
    const named = /^\*\*(.+?)\*\*:\s*$/.exec(line);
    if (named) {
      close();
      const held = terms.get(named[1]);
      if (held) problems.push(`${named[1]} is defined twice, on line ${held.line} and line ${i + 1}`);
      open = { name: named[1], body: "", avoid: null, line: i + 1 };
      continue;
    }
    if (!open) continue;
    if (line.startsWith("_Avoid_:")) {
      open.avoid = line.slice("_Avoid_:".length).trim();
      close();
      continue;
    }
    if (!line.trim()) {
      close();
      continue;
    }
    open.body += (open.body ? "\n" : "") + line;
  }
  close();
  return { terms, problems };
}

/**
 * Every file of this repository git can see, or none where git cannot say.
 *
 * The working tree rather than the index: a file added and not staged is still
 * a file the prose may name, and a gate that reads the index answers about a
 * tree nobody has. Ignored files are left out, since a local working directory
 * is not part of what a reader is sent to.
 */
function repositoryFiles() {
  try {
    return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** A path spelled in prose: backticked, carrying a directory, ending in a suffix a file here has. */
const DOC_PATH = /`([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.(?:mjs|js|ts|json|md|yml|yaml|rb))`/g;

/**
 * Paths a document spells that this repository holds somewhere else now.
 *
 * A relocation moves a file and leaves every sentence naming it pointing at
 * nothing. Absence alone does not say which those are: these documents spell
 * far more paths belonging to the repositories this tool scans than to this
 * one. The tree is the discriminator, so there is no list to keep: a path
 * missing from where it is spelled, whose tail is a file here, is one of ours
 * that moved, and one that matches nothing belongs to the example around it.
 *
 * Read from the document's own directory first, since a document inside a
 * plugin spells that plugin's paths the way the plugin's own manifest does,
 * and a tail two plugins both hold is that shared spelling rather than a move.
 *
 * A bare directory is out of scope, and measured rather than assumed: of the 14
 * this repository spells that are one directory here now, `agents/` and
 * `workflows/` are the plugin contract's own vocabulary and most of the rest
 * name a directory the way `files` and a manifest name it, relative to the
 * plugin. A rule over one-segment names cries wolf, so what a reader gets is
 * this sentence rather than a gate that gets argued with.
 */
const PLUGIN_ROOTS = Object.values(REL);

export function pathsThatMoved(text, docRel, tracked) {
  const from = docRel.includes("/") ? docRel.slice(0, docRel.lastIndexOf("/")) : "";
  const moved = new Map();
  for (const [, spelled] of text.matchAll(DOC_PATH)) {
    if (moved.has(spelled) || tracked.has(spelled)) continue;
    if (from && tracked.has(`${from}/${spelled}`)) continue;
    const now = [...tracked].filter((f) => f.endsWith(`/${spelled}`)).sort();
    if (now.length === 0) continue;
    if (now.length === 1) {
      moved.set(spelled, { spelled, now: now[0], several: false });
      continue;
    }
    // A path both plugins hold is the relative spelling their own manifests
    // use, and the prose that spells it that way means it: "its own
    // `.claude-plugin/plugin.json`" is right for either plugin, and rewriting
    // it to one of them would make it wrong for the other.
    if (now.every((f) => PLUGIN_ROOTS.some((dir) => f === `${dir}/${spelled}`))) continue;
    // Any other tail matching twice is a tail this cannot decide, and passing
    // over it is the silence the rule exists to end: a copy of the repository
    // sitting inside it, a worktree git has stopped tracking or an unpacked
    // archive, gives every moved path a second match and switches the whole
    // check off with nothing said.
    moved.set(spelled, { spelled, now: now.join(", "), several: true });
  }
  return [...moved.values()];
}

// A document that records a past state names the paths that state had, and
// today's path in it would be a claim the measurement never made.
const RECORDS_THE_PAST = [/^docs\/measurements\//, /^docs\/research\//];

// A changelog is both at once, and exempting it whole was the wider half of the
// rule than the reason for it: its released sections are the past, and the
// section the next release ships describes the tree in hand. Each plugin has
// one, so this is the name at any depth rather than the one at the root.
const CHANGELOG = /(^|\/)CHANGELOG\.md$/;

/** The section a changelog's next release ships, or nothing where it has none. */
const UNRELEASED = "## [Unreleased]";

const unreleased = (text) => {
  const start = text.indexOf(UNRELEASED);
  if (start === -1) return "";
  const next = text.indexOf("\n## [", start + 1);
  return next === -1 ? text.slice(start) : text.slice(start, next);
};

/** A parsed value that is a manifest rather than a list or a literal. */
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Every path this gate reads by name, whichever kind of file it is.
 *
 * Checked once, first, because every read below is unguarded on purpose: a
 * guard at each site is a guard somebody forgets, and the two that had one
 * still left four that did not. The list is what makes that safe, so a read
 * added below and not added here is the guard missing again: four were, and
 * each one answered a missing file with a stack rather than the sentence
 * naming it. What no list here can cover is a file the imports above read,
 * `lib/model-defaults.json` among them: those are resolved before the first
 * statement in this module runs, and the sentence for one of those belongs to
 * the module that imports it.
 */
export const READS = [
  "README.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "DECISIONS.md",
  "CONTEXT.md",
  "SECURITY.md",
  "package.json",
  `${REL.anatomiya}/package.json`,
  `${REL.anatomiya}/bin/anatomiya.mjs`,
  "docs/how-it-works.md",
  "docs/why.md",
  "docs/dimension-intake.md",
  "docs/measurements",
];
/**
 * Every claim, run once, and what it found.
 *
 * A function rather than the module's own top level: importing a reader here
 * used to run the whole gate, so the two tests that reach one spawned the
 * binary for `--help`, ran `git ls-files` and read every document before
 * their first assertion. `problems` and `claim` live inside it so a second
 * call answers for itself.
 */
export function checkDocs() {
  const problems = [];
  const claim = (where, ok, detail) => {
    if (!ok) problems.push(`${where}: ${detail}`);
  };

  const absent = READS.filter((rel) => !existsSync(join(root, rel)));
  if (absent.length > 0) {
    for (const rel of absent) problems.push(`${rel}: is missing, and this gate is every claim it makes`);
    return { problems, owed: new Map(), summary: null };
  }

  // --- the dimension registry -------------------------------------------------

  // Obligations and filename rows count here too. A checker blind to a whole
  // dimension class would pass while the README undercounted by nine, which is
  // the drift this script exists to catch.
  const total = REGISTRY.length;
  const js = rowsForLangs(["js"]).length;
  const jsx = rowsForLangs(["jsx"]).length;
  const ruby = rowsForLangs(["ruby"]).length;
  const obligations = rowsOfKind("pairing").length;

  // Section 4 of the walkthrough counts the rows asked of a file, so the
  // obligations are counted apart from them there: they are one question about
  // two paths rather than a question asked of a site.
  const shipping = total - obligations;
  const rubyRows = ruby - pairingsFor(["ruby"]).length;
  const typeChecked = REGISTRY.filter((d) => d.tier === "semantic").length;

  // Prose spells a count of one as a word, and a phrasing nothing parses is a
  // number that drifts in silence, which is what this file is for.
  const NUMERALS = new Map([["one", 1], ["two", 2], ["three", 3]]);
  const counted = (word) => NUMERALS.get(word) ?? Number(word);

  /** The heading a changelog keeps for the next change, spelled once. */

  // A released entry states the number that shipped in it and stays true forever.
  // Reading the whole changelog made every past release a claim about today, so
  // the first number that ever changed would fail three entries that are correct.
  //
  // Its absence is not reported here: the version loop below asks every plugin's
  // changelog for the same heading, and two sentences about one missing heading
  // is one more than a reader needs.
  for (const rel of ["README.md", "docs/how-it-works.md", "CHANGELOG.md"]) {
    const text = rel === "CHANGELOG.md" ? unreleased(read(rel)) : read(rel);
    for (const m of text.matchAll(/(\d+)\s+dimensions/g)) {
      claim(rel, Number(m[1]) === total, `says "${m[1]} dimensions", the registry holds ${total}`);
    }
    for (const m of text.matchAll(/(\d+)\s+for\s+JavaScript(?!\s+and)/g)) {
      claim(rel, Number(m[1]) === js, `says "${m[1]} for JavaScript", the registry holds ${js}`);
    }
    for (const m of text.matchAll(/(\d+)\s+reachable\s+in\s+JSX/g)) {
      claim(rel, Number(m[1]) === jsx, `says "${m[1]} reachable in JSX", the registry holds ${jsx}`);
    }
    for (const m of text.matchAll(/(\d+)\s+for\s+Ruby/g)) {
      claim(rel, Number(m[1]) === ruby, `says "${m[1]} for Ruby", the registry holds ${ruby}`);
    }
    for (const m of text.matchAll(/(\d+)\s+file-to-file obligations/g)) {
      claim(rel, Number(m[1]) === obligations, `says "${m[1]} file-to-file obligations", the registry holds ${obligations}`);
    }
    for (const m of text.matchAll(/(\d+)\s+ship\b/g)) {
      claim(rel, Number(m[1]) === shipping, `says "${m[1]} ship", the registry holds ${shipping} outside the obligations`);
    }
    for (const m of text.matchAll(/(\d+)\s+that speak Ruby/g)) {
      claim(rel, Number(m[1]) === rubyRows, `says "${m[1]} that speak Ruby", the registry holds ${rubyRows} outside the obligations`);
    }
    for (const m of text.matchAll(/plus the (\w+) type-checked rows?/g)) {
      claim(rel, counted(m[1]) === typeChecked, `says "${m[1]} type-checked", the registry holds ${typeChecked}`);
    }
  }

  // A dimension either states its inverse or records that it may not. An absent
  // field is indistinguishable from one nobody classified.
  for (const d of REGISTRY) {
    claim(
      `${REL.anatomiya}/lib/dimensions.mjs`,
      d.counterClaim === null || typeof d.counterClaim === "string",
      `${d.key} has no counterClaim decision, which reads the same as refused`
    );
  }

  // --- the build contract -----------------------------------------------------

  // Three files state this count, and they have disagreed with each other: the
  // table held 55 rows, the README said 55 and CONTRIBUTING said 54. It is the
  // one number in the docs that moves on every substantive change, so all three
  // are read against the table rather than against one another.
  const rows = [...read("DECISIONS.md").matchAll(/^\| [A-H]\d+ \|/gm)].length;
  for (const rel of ["README.md", "docs/why.md", "CONTRIBUTING.md"]) {
    for (const m of read(rel).matchAll(/(\d+)\s+numbered (?:decisions|rows)/g)) {
      claim(rel, Number(m[1]) === rows, `says "${m[1]} numbered", DECISIONS.md holds ${rows} rows`);
    }
  }

  // A row whose cells outnumber the header's is a row whose tail GitHub drops,
  // silently: an unescaped `|` inside a code span splits the cell it sits in, and
  // the Status column falls off the end. Three rows had it at once, one of them a
  // whole `**done**` list. The escape is `\|`, which the file already uses.
  for (const [i, line] of read("DECISIONS.md").split(/\r?\n/).entries()) {
    if (!/^\| [A-H]\d+ \|/.test(line)) continue;
    // No fallback: the filter above took only lines starting `| A1 |`, and one of
    // those holds at least two unescaped pipes.
    const cells = line.match(/(?<!\\)\|/g).length;
    claim(
      "DECISIONS.md",
      cells === 5,
      `row ${/^\| ([A-H]\d+) \|/.exec(line)[1]} on line ${i + 1} has ${cells - 1} cells, not 4: escape a \`|\` inside a code span as \`\\|\``
    );
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
  claim(`${REL.anatomiya}/lib/reduce.mjs`, GATES.minRatio === 0.9, `minRatio is ${GATES.minRatio}, and it is fixed at 0.90 by decision`);

  // Anything the gates stopped reading must stop being described.
  for (const dead of ["minCandidates", "minAuthors", "maxSingleFileShare"]) {
    claim(`${REL.anatomiya}/lib/reduce.mjs`, GATES[dead] === undefined, `${dead} is back in GATES; it was replaced by a repository-relative rule`);
    claim("docs", !gateText.includes(dead), `the docs still name ${dead}, which the gates no longer read`);
  }

  // --- the caveat codes -------------------------------------------------------

  // The codes became a public surface the day `--format json` printed them, so
  // the table documenting them is held to the code in both directions: an
  // undocumented code is a field a CI job cannot branch on, and a documented one
  // that no longer exists is a branch nothing will ever take.
  function caveatSection(text) {
    const start = text.indexOf("### The caveat codes");
    claim("docs/how-it-works.md", start !== -1, "has no ### The caveat codes section to read");
    if (start === -1) return "";
    // To the next heading of either level, so the window is this subsection
    // rather than whatever is written after it. It is the last of section 8
    // today, which is the only reason stopping at the next `##` read the same.
    const next = text.slice(start).search(/\n#{2,3} /);
    return next === -1 ? text.slice(start) : text.slice(start, start + next);
  }

  const codes = new Set(Object.values(CAVEATS));
  const caveatText = caveatSection(read("docs/how-it-works.md"));
  const documented = new Set([...caveatText.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]));
  for (const code of codes) {
    claim("docs/how-it-works.md", documented.has(code), `does not document the caveat code ${code}`);
  }
  for (const code of documented) {
    claim("docs/how-it-works.md", codes.has(code), `documents ${code}, which is not a caveat code`);
  }
  // The prose count is the one thing the two directions above cannot catch: a
  // code added to both the record and the table still leaves the sentence over it
  // stating the old number. A RegExp because the sentence wraps mid-phrase.
  claim(
    "docs/how-it-works.md",
    new RegExp(`There\\s+are ${codes.size}\\.`).test(caveatText),
    `does not say there are ${codes.size} caveat codes`
  );

  // --- what a scan leaves in the working tree ---------------------------------

  // The README spells these by hand, and nothing read them: adding another thing
  // a scan writes without adding its line leaves a reader with a dirty
  // `git status` and a document that says the opposite.
  for (const line of EXCLUDE_LINES) {
    claim("README.md", read("README.md").includes(`'${line}'`), `does not tell a reader to exclude ${line}`);
  }

  // --- the command surface ----------------------------------------------------

  const usage = execFileSync(process.execPath, [join(root, `${REL.anatomiya}/bin/anatomiya.mjs`), "--help"], {
    encoding: "utf8",
  });
  const commands = [...usage.matchAll(/anatomiya\s+(\w+)/g)].map((m) => m[1]);
  const unique = [...new Set(commands)];

  for (const cmd of unique) {
    let file;
    try {
      file = read(`${REL.anatomiya}/commands/${cmd}.md`);
    } catch {
      problems.push(`${REL.anatomiya}/commands/: ${cmd} is in the usage line and has no command file`);
      continue;
    }
    claim(`${REL.anatomiya}/commands/${cmd}.md`, file.trim().length > 0, "is empty");
  }

  const readme = read("README.md");
  for (const cmd of unique) {
    claim("README.md", readme.includes(`/anatomiya:${cmd}`), `does not mention /anatomiya:${cmd}`);
  }

  // --- the glossary -----------------------------------------------------------

  // Shape only. The one claim here that reaches the code is the entry spelling
  // out a closed set the code owns: a sixth parse outcome reaches a reader as a
  // word the glossary does not hold, and nothing else would say so.
  const glossary = readGlossary(read("CONTEXT.md"));
  for (const problem of glossary.problems) claim("CONTEXT.md", false, problem);

  const unexamined = glossary.terms.get("Unexamined");
  claim("CONTEXT.md", unexamined !== undefined, "has no Unexamined entry, which is where a file's outcomes are named");
  if (unexamined) {
    const unnamed = PARSE_OUTCOMES.filter((outcome) => !new RegExp(`\\b${outcome}\\b`).test(unexamined.body));
    claim("CONTEXT.md", unnamed.length === 0, `Unexamined does not name ${unnamed.join(", ")}, which parse.mjs counts a file as`);
  }

  // --- the intake table -------------------------------------------------------

  // A dimension that ships without an intake row is one nobody decided to build:
  // the collapse, the rename and the drop were never asked about it. The README's
  // dimension count has already drifted once, and this is the same failure with a
  // worse consequence, so the table is checked rather than trusted.
  const intake = readIntake(read("docs/dimension-intake.md"));
  for (const p of intake.problems) claim("docs/dimension-intake.md", false, p);

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

  // --- the sites a new registry key has to reach ------------------------------

  const sites = {
    defaults: new Set(Object.keys(JSON.parse(read(`${REL.anatomiya}/lib/model-defaults.json`)))),
    intake: new Map(intake.rows.filter((r) => r.key).map((r) => [r.key, r])),
    dropped: new Set(intake.rows.filter((r) => r.status === "dropped" && r.key).map((r) => r.key)),
    eligible: new Set(ELIGIBLE),
    refused: new Set(REFUSED),
  };

  const owed = new Map();
  for (const row of REGISTRY) {
    const missing = sitesOwed(row, sites);
    if (missing.length) owed.set(row.key, missing);
  }

  // --- runtime dependencies ---------------------------------------------------

  // SECURITY.md said "oxc-parser is the only runtime dependency" for as long as
  // there were two of them. A reader deciding whether to run this on a work
  // repository is reading exactly that sentence, so the set is checked rather
  // than trusted.
  // The plugin's own manifest, not the marketplace's: the root declares the
  // workspaces and no dependency of its own, so read from there the count was
  // zero and every document that names one still said two.
  const deps = Object.keys(JSON.parse(read(`${REL.anatomiya}/package.json`)).dependencies ?? {});
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


  // --- committed documents name paths this repository has ---------------------

  // Moving two plugins under `plugins/` left 68 sentences pointing at files that
  // had gone, in the contributor guide, the security notes and the build
  // contract. Nothing read them, because a number that drifts fails a gate here
  // and a path that drifts failed nothing.
  // Git's list rather than a walk, because the local working directories a tool
  // leaves behind are full of paths that were never this repository's, and
  // because a tree git cannot answer for is not this repository: the gate runs on
  // a checkout, and there is nothing there to check a path against.
  const tracked = new Set(repositoryFiles());
  // The same leak the measurements are checked for, from the other kind of
  // document. A generated one never spells a placeholder, so the shape of a home
  // directory is enough there; a hand-written one does, and `/Users/me/code/app`
  // in the README is how the output is shown to a reader. What may never ship is
  // this machine's own home, which is the one that got into a public repository
  // before: a note written while reading an installed build carried it nine
  // times, and the net under the generated documents did not reach it.
  const HOME = homedir();
  for (const rel of tracked) {
    if (!rel.endsWith(".md") || RECORDS_THE_PAST.some((r) => r.test(rel))) continue;
    const text = read(rel);
    if (HOME && HOME.length > 3) claim(rel, !text.includes(HOME), "carries the path of the machine it was written on");
    for (const { spelled, now, several } of pathsThatMoved(CHANGELOG.test(rel) ? unreleased(text) : text, rel, tracked)) {
      claim(rel, false, several ? `names \`${spelled}\`, which is these files now: ${now}` : `names \`${spelled}\`, which is \`${now}\` now`);
    }
  }

  // --- versions ---------------------------------------------------------------

  // Every plugin the marketplace can release, not only the one at the root: the
  // second plugin's version answered to nothing but semver, so it could move to a
  // number no changelog described and the tag would be the first to say so, after
  // it was pushed. `notesFor` is what the release itself runs, so a version that
  // passes here is one that will tag.
  for (const release of RELEASES) {
    // Read through a guard the rest of this file does not need: every other path
    // here reads a file this repository is known to have, and these two are the
    // ones a release moves. One that is not there, or one that does not parse,
    // threw past the sentence naming it, which is the one thing the author needed.
    const manifest = readJson(release.manifests[0]);
    claim(release.manifests[0], manifest.problem === null, manifest.problem ?? "");

    // Asked whatever the manifest did, so a plugin with two things wrong is told
    // both at once rather than one release at a time. A changelog that is not
    // there is that, rather than one missing a heading.
    const changelog = readOr(release.changelog, null);
    claim(release.changelog, changelog !== null, "is missing, so there is nothing to release this plugin with");
    if (changelog !== null) {
      claim(release.changelog, changelog.includes(UNRELEASED), `has no ${UNRELEASED} heading to write the next change under`);
    }
    // `null` parses, and is not a manifest. Read as "did not parse" it said
    // nothing here and then threw on the summary line, which names no file.
    claim(release.manifests[0], isObject(manifest.value), "parses to something that is not a manifest");
    if (!isObject(manifest.value)) continue;

    // The version has to be there, and be a version, before it can be matched
    // against anything: a field that is not one reaches the tag resolver and the
    // reader is told a namespace is unclaimed while the fault is two files away.
    const version = manifest.value.version;
    claim(release.manifests[0], typeof version === "string", "has no version");
    if (typeof version !== "string") continue;
    claim(release.manifests[0], SEMVER.test(version), `version is not semver: ${version}`);
    if (!SEMVER.test(version)) continue;

    // The heading the link definitions at the bottom point at. `sectionFor` reads
    // the number as a token on any `##` line, so an unbracketed heading is a
    // section to it and the link under it dangles with nothing saying so.
    if (changelog !== null) {
      claim(release.changelog, changelog.includes(`## [${version}]`), `has no "## [${version}]" heading for the version its manifest states`);
    }

    // `notesFor` answers a missing changelog in its own wording, and the author
    // has one file to put back either way.
    if (changelog === null) continue;

    const answered = notesFor(root, tagFor(release, version));
    // Reported against the file the author has to edit: the changelog problems
    // `notesFor` returns are about the changelog, whatever read them. Its
    // sentences name that file, and `claim` names it again, so the leading path
    // comes back off before it is printed under itself.
    const about =
      [release.changelog, ...release.manifests].find((rel) => answered.problem?.startsWith(`${rel} `) || answered.problem?.includes(`${rel} says`)) ??
      release.manifests[0];
    const said = answered.problem?.startsWith(`${about} `) ? answered.problem.slice(about.length + 1) : answered.problem;
    claim(about, answered.problem === null, said ?? "");
  }

  // ----------------------------------------------------------------------------

  // This file exports `readIntake` as well as running as a script, and a bare
  // `process.exit(1)` at module scope would take the test process with it the
  // moment a doc claim failed.

  // Only where nothing failed: the line reads a manifest's version, and a
  // manifest that is not one was already claimed above.
  const summary = problems.length || owed.size ? null :
    `docs match the code: ${total} dimensions (${js} js, ${jsx} jsx, ${ruby} ruby, ${obligations} of them file-to-file obligations), ` +
    `${unique.length} commands, ${codes.size} caveat codes, ${deps.length} runtime dependencies, ` +
    `${intake.rows.length} intake rows, ${RELEASES.map((r) => `${r.plugin} ${JSON.parse(read(r.manifests[0])).version}`).join(" and ")}`;
  return { problems, owed, summary };
}

if (invokedAs(import.meta.url)) {
  const { problems, owed, summary } = checkDocs();
  if (problems.length || owed.size) {
    for (const p of problems) console.error(`::error::${p}`);
    // One line per site, in key order, each naming the file and the move: the
    // list an author works through, and the annotations a pull request shows.
    const unmet = [...owed.values()].flat();
    for (const [key, missing] of owed) {
      for (const m of missing) console.error(`::error::${m.site}: ${key} has ${m.missing}; ${m.remedy}`);
    }
    if (problems.length) console.error(`\n${problems.length} claim(s) in the documentation do not match the code.`);
    if (owed.size) console.error(`\n${owed.size} registry key(s) still owe ${unmet.length} of the sites a row has to reach.`);
    process.exit(1);
  }
  console.log(summary);
}
