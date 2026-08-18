/**
 * The `## What lives where` section, and the same counts wherever else they
 * print: one line per area, and one line on the scan's own summary.
 *
 * Its own module because it is the one block of the map written from the
 * roster rather than from the dimensions. `render.mjs` composes the file and
 * asks for these lines; nothing here knows what an area or a directive is.
 */
import { encode, encodePath } from "./encode.mjs";
import { PRINCIPLES } from "./principles.mjs";
import { RUNNER_LABELS, UNNAMED_RUNNER } from "./test-shape.mjs";

/**
 * A count and its noun, agreeing.
 *
 * Exported because the scan's summary prints the same counts this file does and
 * had its own hardcoded plurals: a thirty-five repository corpus turned up
 * "1 files hold syntax the parser rejected" on seven of them, on the summary
 * and in the file that loads on every turn.
 *
 * Here rather than in `render.mjs`, which imports this module and would have to
 * be imported back: a cycle in `lib/` loads under ESM hoisting and fails later,
 * as a half-initialised binding.
 */
export const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * A directory name printed inside a sentence, without the quotes `encodePath`
 * puts round it. Parsed back rather than sliced, because a quote inside a
 * filename is escaped between them and slicing would leave the backslash.
 *
 * A name the encoder empties, `###` or a setext underline, would render as
 * `- : 30 .ts`, which is a bullet about nothing.
 */
const pathText = (p) => (p === "." ? ROOT_LABEL : JSON.parse(encodePath(p)) || "(unnamed)");

// What a flat repository's one root is called, since "." reads as punctuation.
export const ROOT_LABEL = "(repository root)";

const runnerLabel = (runner) => RUNNER_LABELS[runner] ?? runner;

const specCount = (n, runner) =>
  runner === UNNAMED_RUNNER ? plural(n, "test file") : plural(n, `${runnerLabel(runner)} spec`);

// The tests line spells the unit once, on the group that sets it, and the
// groups after it are read off that one.
const runnerCount = (n, runner) =>
  runner === UNNAMED_RUNNER ? plural(n, "test file") : `${n} ${runnerLabel(runner)}`;

// One clause per runner group, named the way `specCount` names a root line's:
// a root line and an area's kinds line read the same `tests` field.
const testsParts = (tests) =>
  tests.map((t) => `${specCount(t.files, t.runner)}${t.sub ? ` under ${pathText(t.sub)}` : ""}`);

// The count with a test is the subject of the clause, not the denominator
// beside it, so "1 of 504" takes the singular and "2 of 504" does not.
const namesakeVerb = (withTest) => (withTest === 1 ? "has" : "have");

/**
 * How many of a set of files have a test of their own name, in the one spelling
 * the root line, the tests line and an area's kinds line all print.
 *
 * The denominator is nouned on the tests line, which speaks for the whole
 * repository and has to say what it is counting, and bare on the two lines that
 * already named the directory. Only the root line names where the namesakes
 * are; the other two are about the files, not the place.
 *
 * Exported for the same reason `plural` is: the corpus harness reads this
 * clause back off the printed line, and its own copy of the verb went stale.
 */
export const namesakeClause = ({ with: withTest, of, root }, noun = null) =>
  `${withTest} of ${noun === null ? of : plural(of, noun)} ${namesakeVerb(withTest)} a namesake test` +
  (root ? ` under ${pathText(root)}` : "");

// The leftover past the two printed extensions rides along with them, so a
// root line and an area's kinds line spell "and N other" off one expression.
const extText = (r) =>
  r.exts.map(([ext, n]) => `${n} ${encode(ext)}${ext === r.jsxExt ? " (JSX)" : ""}`).join(", ") +
  (r.other ? ` and ${r.other} other` : "");

/**
 * What this area itself holds, from the same counts the roster made over the
 * whole tree.
 *
 * A root line's `and k other` is a leftover over every tracked path under a
 * directory; an area is the narrower set of files a dimension could speak
 * about, so the two leftovers count different populations and the worry was
 * printing one beside the other, where a reader could take them for the same
 * number.
 *
 * That worry is about a root line, and there is none on this line: `rootFacts`
 * is handed the area's own files as `own`, so this line's `other` and the file
 * count in the heading above it are the same population counted twice. Hiding
 * it did not avoid the comparison, it broke the arithmetic the heading and
 * this line owe each other: eslint's `packages/eslint-config-eslint` printed
 * "5 .js, 4 .ts" under a heading of 10 files, the tenth being a `.mts` this
 * line never named.
 */
export function kindsLine(kinds) {
  if (kinds.exts.length === 0) return null;
  const parts = [extText(kinds)];
  // A denominator prints even at zero, so the line always says how many of
  // its own files are tests; above zero it names the runner the way a root
  // line does, rather than summing every group into one bare "test file".
  parts.push(...(kinds.tests.length === 0 ? [plural(0, "test file")] : testsParts(kinds.tests)));
  if (kinds.companions) parts.push(namesakeClause({ ...kinds.companions, root: null }));
  return `kinds: ${parts.join("; ")}`;
}

const LAYOUT_HEADING = "## What lives where";

// A test root names two runners and counts the rest, the way the extension
// clause names two extensions: the third one is not what the line is for.
const RUNNERS_SHOWN = 2;

/** One directory: what it holds, what tests it holds, what has a namesake. */
function rootLine(r) {
  // More than half of it is tests, so its extension counts are the specs
  // themselves and the namesake clause would ask a spec directory for specs.
  //
  // Counted by runner and not by what sits in the directory: whitehall's
  // `test/` holds 766 files of which 538 are minitest specs, and calling all
  // 766 minitest specs disagreed with the tests line two lines below it. The
  // rest are fixtures and support files, and `and k other` is what the
  // extension clause already spells them.
  if (r.testRoot && r.tests.length > 0) {
    const shown = r.tests.slice(0, RUNNERS_SHOWN);
    const rest = r.files - shown.reduce((n, t) => n + t.files, 0);
    const named = shown.map((t) => specCount(t.files, t.runner)).join(", ");
    return `- ${pathText(r.path)}: ${named}${rest ? ` and ${rest} other` : ""}`;
  }

  const parts = [extText(r), ...testsParts(r.tests)];
  if (r.companions) parts.push(namesakeClause(r.companions));
  if (r.helpers) {
    const { siblingModules, stems, inlineFiles } = r.helpers;
    parts.push(`${plural(siblingModules, "sibling module")} named ${stems.map((s) => encode(s)).join("/")}`);
    parts.push(`${plural(inlineFiles, "file")} inline${inlineFiles === 1 ? "s" : ""} a helper`);
  }
  return `- ${pathText(r.path)}: ${parts.join("; ")}`;
}

// At most three groups, then a count: four vitest files beside 102 Cypress
// specs is the denominator this line exists to be, and a fourth runner is not.
const TESTS_GROUPS = 3;

/**
 * One line for the whole repository's tests, and the namesake count of the
 * largest source root that has one.
 *
 * That trailing clause is what makes the line a denominator rather than a
 * total: a repository whose tests are all feature-named e2e specs says out
 * loud that nothing under its biggest directory has a test of its own. The
 * root is named by its top extension, because this tool learns no vocabulary
 * of kinds and "504 components" would be one.
 */
function testsLineText(layout) {
  if (layout.tests.length === 0) return null;

  const shown = layout.tests.slice(0, TESTS_GROUPS);
  // A runner with no directory of its own is spread across the repository, and
  // `under .` was the clause on 28 of the 35 measured repositories.
  const parts = shown.map(
    (g, i) =>
      `${i === 0 ? specCount(g.files, g.runner) : runnerCount(g.files, g.runner)}` +
      (g.root ? ` under ${pathText(g.root)}` : "")
  );
  const rest = layout.tests.length - shown.length;
  if (rest > 0) parts.push(`and ${rest} more`);

  const top = layout.roots.find((r) => !r.testRoot && r.companions && r.exts.length > 0);
  if (top) parts.push(namesakeClause({ ...top.companions, root: null }, `${encode(top.exts[0][0])} file`));
  return `- tests: ${parts.join("; ")}`;
}

/** The directories that did not print, counted where they would have. */
function foldLine(roots, files) {
  if (roots > 0) {
    return `- and ${roots} more ${roots === 1 ? "directory" : "directories"} holding ${plural(files, "file")}`;
  }
  // No directory was folded, so the count is files the floor left behind and
  // "and 0 more directories" would be a number nobody can act on.
  if (files > 0) {
    return `- and ${files} more ${files === 1 ? "file" : "files"} in directories under the floor`;
  }
  return null;
}

// The heading, the blank under it, and the blank that closes the block. Under
// four lines the section cannot say one thing, so it says none of it.
const LAYOUT_FRAME = 3;

/**
 * Where this repository keeps its files, in at most fifteen lines and inside
 * whatever `budget` the rest of the overview leaves.
 *
 * It sits above the area listing because a directory that already holds 504
 * components is what decides where the next one goes, and the names of the
 * areas are the part of this file already established as the one to squeeze.
 * It is still not worth the bound, so it gives way in the order it is read
 * backwards: root lines fold into the count that was already there, then that
 * count goes, and the tests line and the sentences it grounds are what a
 * squeezed section still says. A root line names one directory; the tests line
 * is the denominator for all of them.
 *
 * Counts over an arbitrary subset rendered as a description of the tree is the
 * failure the truncation rule exists for, so a truncated scan says so and
 * counts nothing.
 */
export function renderLayout(layout, budget = Infinity) {
  if (!layout) return [];
  if (budget < LAYOUT_FRAME + 1) return [];
  if (layout.truncated) {
    return [LAYOUT_HEADING, "", "layout: not counted, the scan was truncated", ""];
  }
  if (layout.roots.length === 0 && layout.tests.length === 0) return [];

  // The record stores the keys; the sentences live where their gates do.
  const sentence = new Map(PRINCIPLES.map((p) => [p.key, p.sentence]));
  let said = (layout.principles ?? []).map((k) => sentence.get(k)).filter(Boolean);
  let tests = testsLineText(layout);

  const owed = () => LAYOUT_FRAME + (tests ? 1 : 0) + (said.length > 0 ? 1 + said.length : 0);
  if (owed() > budget) said = [];
  if (owed() > budget) tests = null;
  if (owed() > budget) return [];

  // A root line each, and the line that counts what did not get one.
  const room = budget - owed();
  const already = layout.more.roots > 0 || layout.more.files > 0;
  const whole = layout.roots.length + (already ? 1 : 0);
  const shown = layout.roots.slice(0, whole <= room ? layout.roots.length : Math.max(0, room - 1));
  const gaveWay = layout.roots.slice(shown.length);

  const lines = [LAYOUT_HEADING, ""];
  for (const r of shown) lines.push(rootLine(r));
  const fold = foldLine(
    layout.more.roots + gaveWay.length,
    layout.more.files + gaveWay.reduce((n, r) => n + r.files, 0)
  );
  if (fold && shown.length < room) lines.push(fold);

  if (tests) lines.push(tests);
  if (said.length > 0) lines.push("", ...said);

  lines.push("");
  return lines;
}

/**
 * The scan summary's own line for the layout: how many roots it counted and
 * how many folded away, unbudgeted, because the block on disk can drop lines
 * to its own budget and the terminal is where the whole count still has to
 * show up.
 */
export function layoutSummary(layout, areas = []) {
  if (!layout) return null;
  if (layout.truncated) return "layout: not counted, the scan was truncated";

  const testsPart =
    layout.tests.length === 0
      ? "none"
      : layout.tests
          .map((g) => `${g.files} ${g.runner}${g.root ? ` under ${pathText(g.root)}` : ""}`)
          .join(", ");
  const withImports = areas.filter((a) => a.imports?.length > 0).length;
  const withReuse = areas.filter((a) => a.reused?.length > 0).length;

  return (
    `layout: ${plural(layout.roots.length, "root")}, ${layout.more.roots} folded, tests: ${testsPart}; ` +
    `roster lines: ${plural(withImports, "area")} with imports, ${withReuse} with reuse`
  );
}

