import { encode, encodePath } from "./encode.mjs";
import { MISSING_STRIPPER } from "./langs.mjs";
import { kindsLine, plural, renderLayout } from "./render-layout.mjs";
import { statedSide } from "./facts.mjs";
import { globText } from "./areas.mjs";
import { GENERATOR, listSome, LISTED, PREFIX, RULES_DIR } from "./rules.mjs";
import { REGISTRY } from "./registry.mjs";

// The overview loads on every turn, so its area listing is bounded even though
// the number of areas is not. Past this it names only the areas that state
// something and counts the rest.
export const OVERVIEW_AREAS = 200;

/**
 * The line bound every generated file is held to.
 *
 * Measured: a rewritten context file does not re-attach inside a live session,
 * and the change notice the model does get truncates head and tail, so an edit
 * in the middle of a long file reaches the model in neither copy. Forty lines
 * is what fits in one copy.
 *
 * Enforced rather than hoped for: thirteen stated JS claims at three lines each
 * already clear it, and nothing in the reducer knows that. The overview holds
 * it outright. An area file holds it over its body, because the `paths` list is
 * delivery rather than content and a glob dropped to save a line mis-delivers
 * the whole file, so an area whose cover alone runs past the bound keeps every
 * pattern and pays for them on top.
 */
export const MAX_LINES = 40;

// What an area file says even when its `paths` list has eaten the budget: one
// directive block, its exceptions, and the count of what did not fit. The kinds
// line comes out of this too, so a file carrying one floors its body at six.
const MIN_BODY_LINES = 8;

// The kinds line and the blank under it, which the budget gives up rather than
// spends: it is one line, it is the same line in every area, and it is the only
// place the test shape of a directory's siblings is written down.
const KINDS_LINES = 2;

// How many lines a run of blocks comes to. Spelled once because both drop rules
// ask it, and two spellings of one sum is a drift waiting for a block shape to
// grow a line.
const height = (blocks) => blocks.reduce((n, b) => n + b.length, 0);

/**
 * Fit a list of blocks into a line budget, saying how many did not fit.
 *
 * Greedy in order and stopping at the first block that will not fit, rather
 * than skipping ahead to smaller ones: the order is the order the reducer
 * chose, and a listing that silently reorders itself as an area grows is not
 * something a reader can diff against yesterday's.
 *
 * `more` renders the count of what was left out and costs the line it takes.
 * `null` means the caller reports the remainder itself, folded into a number it
 * already has to print.
 */
function fit(blocks, budget, more = null) {
  const kept = fitCount(blocks, budget, more ? 1 : 0);
  const lines = blocks.slice(0, kept).flat();
  // Only when something went. A notice reading "and 0 more not shown here" is
  // a line spent saying nothing, in a file whose whole budget is forty.
  if (more && kept < blocks.length) lines.push(more(blocks.length - kept));
  return lines;
}

/**
 * How many of these blocks survive the budget: the overview's drop rule.
 *
 * `reserve` is the line held back for the notice, or it would be the line that
 * breaks the bound the notice exists to report. An area file does not come
 * through here: it has sentences to name as well as blocks to drop, and that is
 * `settle`.
 */
function fitCount(blocks, budget, reserve = 0) {
  if (height(blocks) <= budget) return blocks.length;
  const room = budget - reserve;
  let used = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (used + blocks[i].length > room) return i;
    used += blocks[i].length;
  }
  return blocks.length;
}

/**
 * The glob is built from a directory name, so it is repository-controlled and
 * goes through the encoder like every other such value (F4). It is emitted
 * JSON-quoted, which is also a valid YAML double-quoted scalar, so a newline in
 * the directory name cannot open a second frontmatter fence.
 *
 * Only the directory half is encoded, and the area record carries the two
 * halves apart so nothing here has to recover them. The tail is a fixed
 * pattern, and passing it through would cost the leading `*`, which the encoder
 * strips as a markdown bullet: the result reads like a working glob and matches
 * nothing.
 *
 * A leading `!` is the matcher's negation marker rather than part of any
 * directory name, so `globText` puts it back outside the encoded half.
 */
function encodeGlob(g) {
  return `"${globText(g, (dir) => encodePath(dir).slice(1, -1))}"`;
}

/**
 * One area file. Kept short on purpose: a rewritten context file does not
 * re-attach inside a live session, and the change notice truncates head and
 * tail, so a long file loses its middle in both copies.
 */
// A stated directive needs authors at or above min(2, repository authors), and
// at or above 2 where the history read was a window, so one author on a stated
// line can only be a one-author repository read from a whole clone.
const hands = (d) => (d.authors === 1 ? "1 author (the repository's only)" : `${d.authors} authors`);

// The author bar is a function of the repository now, so the name alone no
// longer says what was asked for, and git failing is not a team of zero.
const why = (d, gate) =>
  gate === "authors"
    ? `authors ${d.authors} of ${d.authorsRequired}`
    : gate === "history-unread"
      ? "history could not be read"
      : gate;

/**
 * A claim is this tool's own sentence, not a repository-controlled value, so it
 * does not go through F4's encoder: that strips `|` as a table boundary and
 * rendered "defaults are taken with ??, not ||" as "defaults are taken with ??,
 * not" in every JS area of every repository. The one part that is repository
 * text, the base a learned row filled its template with, was encoded where the
 * sentence was built in `claimFor`.
 *
 * Line breaks are still collapsed, because a sentence spanning two lines would
 * put its tail where the counts belong. A test pins the registry to sentences
 * that need nothing more than this.
 */
const claimLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// Keyed off the registry rather than off the record, because both readers of
// the layout have a key and only one of them has the prose. Storing the clause
// would put the same sentence in every area of `facts.json` and let the file the
// writer produced and the block the check measures drift apart.
const NOT_COUNTED = new Map(
  REGISTRY.filter((d) => d.applicabilityPredicate?.notCounted).map((d) => [
    d.key,
    claimLine(d.applicabilityPredicate.notCounted),
  ])
);

/**
 * The form this dimension's predicate declines, where a reader would otherwise
 * take it for a counter-example.
 *
 * Only under a claim that is perfect and names no exception. The `except` list
 * is what teaches a reader that a miss gets named, so a bare `N of N` is read as
 * "there is no counter-example in these files", which is stronger than anything
 * the tool measured. Measured on a front end: `src/components/Calendar` prints
 * 46 of 46 for a claim about prop spreads while a credited file holds
 * `<div {...rest} />` three lines from `<ClickableArea {...rest} />`. Six
 * reviewers filed that as an undercount before the source settled it, and an
 * agent holding only the rule file has no source to settle it with.
 *
 * A claim already carrying an `except` is not the claim that misreads, and the
 * line costs one of forty in every area that states the row, so it is spent
 * where it answers something.
 */
function notCountedLine(d, side, said) {
  if (side.conforming !== d.candidates || side.exceptions.length > 0 || side.more) return null;
  const clause = NOT_COUNTED.get(d.key);
  // Once per file. Nine companion rows share one sentence and two of them reach
  // the same area whenever a repository writes both `_spec.rb` and `_test.rb`,
  // so an `app` area printed it three times and spent three of its forty lines
  // saying one thing. The Ruby and JS routing rows collide the same way in a
  // mixed-language area.
  if (!clause || said.has(clause)) return null;
  said.add(clause);
  return `  not counted: ${clause}`;
}

/**
 * The sites this area holds that the row's classifier held no vote for, as a
 * clause on the counts line rather than a line of its own.
 *
 * A stated `N of N` reads as a population with no counter-example in it, and
 * for the filename row that population is short by every stem spelling none of
 * the classes: the scan votes with a class and the check enforces over the
 * site, so those names leave the count while a new one is still measured
 * against the sentence. `across X of Y files` cannot say it, since it mixes
 * them with the files that are no site at all.
 *
 * It does not say "not counted", though that is what happened to them. Four
 * lines up, `notCountedLine` spends that phrase on forms the predicate declines
 * and the check therefore never enforces, and these names are the opposite: the
 * one population still measured against the sentence at the top severity. Two
 * meanings for one phrase in one file is worse than a longer clause.
 *
 * On the counts line because a line of its own is one of forty. Measured on
 * vscode: six of 500 areas sit at the bound, three of those state this row, and
 * the disclosure pushed a stated directive out of one of them, which also
 * capped that slot at FIX in the check. A disclosure that costs a convention is
 * a bad trade, and this one costs nothing (A41).
 */
function declinedClause(d) {
  const n = d.declined;
  // A record is a file on disk. A count it cannot read is silence rather than
  // `NaN names not counted` in a file every turn loads.
  if (!Number.isInteger(n) || n <= 0) return "";
  return `, ${n} ${n === 1 ? "name" : "names"} spelling no class`;
}

/**
 * How the uncovered count divides, in one place because two surfaces print it.
 *
 * The CLI and the overview drifting apart on the same number is the failure
 * this run has already had twice, once on the wording for a crash and once on
 * this very line.
 */
export function splitUncovered(uncovered, orphaned) {
  const floorBound = Math.min(Math.max(0, orphaned), uncovered);
  return { orphaned: floorBound, barren: uncovered - floorBound };
}

/**
 * The causes that measure the machine rather than the tree.
 *
 * A crash is a SIGKILL off the pool's wall clock or its memory poll, so a busy
 * machine produces one where an idle machine produces none. The overview must
 * be byte-stable between scans of unchanged source, and the line also costs one
 * of the file's forty, so the area listing dropped an entry to pay for it and
 * the fold count moved with it: two lines of the file that loads on every turn,
 * because the machine was busy. The other three are facts about the tree.
 */
export const MACHINE_DEPENDENT = new Set(["crashed"]);

/**
 * The four ways a file goes unexamined, named apart because the reader's next
 * move differs: a crash is this tool's problem, rejected syntax is the file's,
 * and the cap is a generated file nobody writes by hand.
 *
 * Shared for the same reason `splitUncovered` is. Copied, they drifted: the cap
 * read "over the size cap" in the summary and "exceeded" in the overview.
 *
 * `stable` drops the causes that measure the machine, for the one surface that
 * has to read the same between two scans of unchanged source.
 */
export function unexaminedLines(parse, { stable = false } = {}) {
  const lines = [];
  // A count of one reads as one. Seven repositories in a thirty-five
  // repository corpus printed "1 files hold syntax the parser rejected", on the
  // summary and in the file that loads on every turn.
  const line = (n, kind) => `${plural(n, "file")} ${unexaminedPhrase(kind, n)}`;
  for (const kind of ["crashed", "failed", "syntaxErrors", "skipped"]) {
    if (stable && MACHINE_DEPENDENT.has(kind)) continue;
    if (parse[kind]) lines.push(line(parse[kind], kind));
  }
  // Without the stripper every Flow file lands in the count above, and the two
  // facts are otherwise unconnected on screen. The dependency arrived after the
  // plugin did, so a node_modules that predates it produces exactly this state:
  // oxc loads, the retry cannot run, and react loses 286 files silently.
  if (parse.syntaxErrors && parse.missingStripper) {
    lines.push(MISSING_STRIPPER);
  }
  return lines;
}

// The languages `lib/langs.mjs` has no declaration for, checked against
// whatever "## What lives where" already counted by extension (H7). Short and
// closed rather than exhaustive: missing one here means silence about it,
// never a wrong name for it.
const OTHER_LANGUAGE_EXTS = new Set([
  ".java", ".kt", ".kts", ".rs", ".go", ".py", ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hh",
  ".cs", ".swift", ".php", ".scala", ".m", ".mm", ".ex", ".exs", ".pl", ".pm",
]);

/**
 * Files this repository tracks that this map has no language for at all.
 *
 * Taken from the corpus's own tally over every non-source file, because a row
 * about what could not be read is the last place to state a number it cannot
 * stand behind: the roster prints a root's top two extensions and folds the
 * rest away, which held 781 of next.js's 1,016 Rust files.
 *
 * A record written before the corpus carried that tally falls back to the
 * roster and undercounts the same way. Absent rather than zero, so a scan that
 * never counted reads differently from a repository with nothing to count.
 */
export function unreadLanguageFiles(result) {
  const exact = result?.corpus?.otherExts;
  if (exact) return exact.filter(([ext]) => OTHER_LANGUAGE_EXTS.has(ext));

  const totals = new Map();
  for (const root of result?.layout?.roots ?? []) {
    for (const [ext, n] of root.exts) {
      if (OTHER_LANGUAGE_EXTS.has(ext)) totals.set(ext, (totals.get(ext) ?? 0) + n);
    }
  }
  return [...totals].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

// The phrase per cause, so the check can name one file with the sentence the
// summary and the overview use for a count of them. Only one of the four
// carries a present-tense verb, and only that one changes with the number.
const UNEXAMINED = {
  crashed: "crashed the parser",
  failed: "could not be parsed",
  syntaxErrors: "hold syntax the parser rejected",
  skipped: "exceeded the size cap",
};

const UNEXAMINED_ONE = {
  ...UNEXAMINED,
  syntaxErrors: "holds syntax the parser rejected",
};

/**
 * One cause's sentence, agreeing with how many files it is about.
 *
 * The check names a single file and the summary counts them, and the verb is
 * the only word that differs. Read from a table rather than patched with a
 * replace at one call site, since the two surfaces have already drifted once
 * over the wording of the cap.
 */
export const unexaminedPhrase = (kind, n) => (n === 1 ? UNEXAMINED_ONE : UNEXAMINED)[kind];

/**
 * What this area's files reach for, and what the rest of the repository reaches
 * into it for. The counted form of "check before creating": five names with
 * numbers, rather than an index of every export.
 */
function rosterLines(area) {
  const lines = [];
  if (area.imports?.length) {
    const shares = area.imports.map((i) => `${encode(i.module)} (${Math.round((i.files / i.of) * 100)}%)`);
    lines.push(`most files here import: ${shares.join(", ")}`);
  }
  if (area.reused?.length) {
    // The unit is spelled on the first name and read off it by the rest.
    const names = area.reused.map(
      (r, i) => `${encode(r.name)} (${i === 0 ? plural(r.importers, "file") : r.importers})`
    );
    lines.push(`most imported from here: ${names.join(", ")}`);
  }
  return lines;
}

/**
 * One area file's head and its body blocks, in drop order, before the budget.
 *
 * Apart from `renderArea` because the check needs the same layout without the
 * lines: which directives a file had no room to state decides whether the check
 * may enforce them at top severity, and recomputing that from the one rule is
 * the only shape where the two cannot disagree. Every input is in the record,
 * and none of them is the claim text: a directive block's height is its counts
 * line, its exceptions and its blank.
 */
function areaBlocks(area) {
  // Measured: a `paths` key with no pattern under it loads on every turn, which
  // is what the overview is for and what an area file must never do. There is
  // no glob-less area to render, so this is a bug in the caller either way.
  if (!area.globs || area.globs.length === 0) {
    throw new Error(`area has no paths glob, so its file would load on every turn: ${area.path}`);
  }

  const head = [
    "---",
    `generator: ${GENERATOR}`,
    "paths:",
    ...area.globs.map((g) => `  - ${encodeGlob(g)}`),
    "---",
    "",
    `# ${encode(area.path)}  ${area.fileCount} files`,
    "",
  ];

  // A stated inverse prints in the shape a stated claim prints. The sentence is
  // the directive either way, and a marker saying which side it is would spend
  // always-loaded bytes leaking the tool's internals; polarity lives in
  // facts.json, which is what the check reads.
  const sides = area.dimensions.map((d) => [d, statedSide(d)]);
  // A stated side the model writes unprompted is real and enforced, and it is
  // exactly what the model would do here anyway, so it rides with the counts:
  // the directive lines are for what this repository does differently.
  const directives = sides.filter(([d, side]) => side.states !== null && d.matchesDefault !== true);
  const counts = sides.filter(([d, side]) => side.states === null || d.matchesDefault === true);

  const blocks = [];
  // The dimension each block states, parallel to `blocks`, and null for a block
  // that states nothing. A slot the model writes by default is stated too: it
  // rides with the counts and the check enforces it unchanged, so a budget that
  // drops its line leaves the agent nothing at all for a claim they are still
  // held to. A count that states nothing is a threshold nobody can audit from
  // here, which is a different fact with a different fix.
  const keys = [];
  // The sentence each block would have delivered, parallel to `keys` and non-null
  // in exactly the same places. Kept in step with `keys` on purpose: the notice
  // counts what it hid off `keys` and names it off this, and the two disagreeing
  // would print "3 of them stated" above two sentences.
  const claims = [];
  // The clauses this file has already printed, so a sentence shared by several
  // rows costs one line rather than one per row.
  const said = new Set();
  for (const [d, s] of directives) {
    const block = [
      claimLine(s.claim),
      // The files this dimension could have spoken about, which is what the
      // gate divided by. The area's own count is a different number wherever
      // the area holds more than one language or a file nothing was read from,
      // and dividing by it retires the audit C3 exists to provide.
      `  ${s.conforming} of ${d.candidates} sites across ${d.applicability} of ${d.langFileCount} files` +
        declinedClause(d) +
        `, ${hands(d)}` +
        companionAudit(d) +
        (d.precision === "partial" ? "  (partial: some sites are not visible statically)" : ""),
    ];
    const notCounted = notCountedLine(d, s, said);
    if (notCounted) block.push(notCounted);
    for (const e of s.exceptions) {
      block.push(`  except ${encodePath(e.path)}${e.count > 1 ? ` (${e.count} sites)` : ""}`);
    }
    if (s.more) block.push(`  and ${s.more} more`);
    block.push("");
    blocks.push(block);
    keys.push(d.key);
    claims.push(claimLine(s.claim));
  }
  const stated = blocks.length;

  // What the area holds and what it reaches for. Counts rather than directives,
  // so they outlive a suppressed count and give way to a stated one: a
  // directive is what the file exists to deliver, and a description is what
  // makes the next file fit beside the ones already here.
  //
  // The kinds line is taken off the budget rather than entered into it, the way
  // the heading is. Entered, it competed with claim rows and lost in exactly the
  // directories that hold the most of them: on a measured front end the five
  // largest areas were the five missing it, `src/components` at 149 files down
  // to `src/pages/admin` at 41, while all 122 smaller areas kept it. The line
  // hiding there is the one the overview's own directive depends on, because
  // "match sibling test shape" cannot be followed by a reader who was not told
  // what the siblings do. Roster lines stay in the budget: what a file imports
  // is a second reading, not a first one.
  const kinds = area.kinds ? kindsLine(area.kinds) : null;
  // The same room the budget is about to divide, kinds line included. Left at
  // `MAX_LINES - head.length` it asked about two lines the body no longer has,
  // so an area whose cover leaves exactly the floor tried roster lines it could
  // never print.
  const described = MAX_LINES - head.length - (kinds ? KINDS_LINES : 0) >= MIN_BODY_LINES;
  if (described) {
    for (const line of rosterLines(area)) {
      blocks.push([line]);
      keys.push(null);
      claims.push(null);
    }
  }
  const descriptions = blocks.length - stated;

  // A suppressed dimension still prints its counts. That is what makes a wrong
  // threshold cost one sentence instead of a wrong convention, and it is why
  // the gates can be set conservatively.
  //
  // After the stated ones, and dropped before them when the budget runs out: a
  // directive is what the file exists to deliver, and a count is what makes a
  // wrong threshold auditable. Only one of those is worth the last line.
  for (const [d, s] of counts) {
    blocks.push([
      d.matchesDefault === true && s.states !== null
        ? `${claimLine(s.claim)}: ${s.conforming} of ${d.candidates} sites (matches model default)`
        : `${claimLine(s.claim)}: no convention. ` +
          `${s.conforming} of ${d.candidates} sites${companionAudit(d)} (${why(d, s.gate)})`,
    ]);
    keys.push(s.states === null ? null : d.key);
    claims.push(s.states === null ? null : claimLine(s.claim));
  }

  // Taken out of the floor as well as out of the bound, so `head + kinds + body`
  // comes to exactly what `head + body` came to before and no file grew by this.
  // Six body lines still hold one directive block, an exception and the notice,
  // and a reader who has to give up two of those for the line naming what the
  // siblings do is better off by it.
  const budget = Math.max(MIN_BODY_LINES, MAX_LINES - head.length) - (kinds ? KINDS_LINES : 0);
  return { head, blocks, keys, claims, stated, descriptions, kinds, budget };
}

/**
 * What the notice says before listing the sentences it could not print in full.
 *
 * "Also" only where the list is the whole of what was hidden. Where the budget
 * could not even hold the sentences, the count that leads is what the reader
 * needs, or the list reads as complete and is not.
 */
function alsoStatedLead(named, unnamed) {
  if (named === 0) return "";
  // "named below" rather than "stated here": the clause before this one already
  // said how many were stated, and one word in two senses a comma apart is a
  // line a reader has to stop on.
  return unnamed === 0 ? ". Also stated here, without counts:" : `. ${named} of them named below, without counts:`;
}

/**
 * How many blocks fit, and which stated sentences the ones that did not are
 * owed a bare mention of.
 *
 * A stated convention is the strongest thing this tool produces, and a footer
 * that says how many of them you are missing without saying which is the worst
 * of both: the reader knows a directive exists and has nothing to go and look
 * up. Measured on a front end, 36 of 127 areas hid 68 between them. So the
 * sentence is kept even where its counts, its exceptions and its blank cannot
 * be, at a line each instead of the three or more the block wanted.
 *
 * Dropping one more block frees its whole height and costs at most the one line
 * its name takes, so the cost never rises as this walks down and the first fit
 * is the largest one. Never cheaper for a one-line block traded for a one-line
 * name, which is why the walk takes the largest fit rather than the first
 * trade it can make.
 *
 * The check recomputes this from `facts.json`, so everything it reads has to be
 * on that record. That is what keeps the count off the sentences and on the
 * keys.
 */
function settle(blocks, keys, claims, budget) {
  const upTo = (k) => height(blocks.slice(0, k));
  if (upTo(blocks.length) <= budget) return { kept: blocks.length, names: [], unnamed: 0 };

  // Counted off `keys` and never off the sentences. The check recomputes this
  // from the record it stored, and that record carries every slot's key and no
  // slot's prose, so counting the sentences would have the writer reserve lines
  // the check does not and the two disagree about what the agent was handed.
  const named = (k) => keys.flatMap((key, i) => (i >= k && key ? [claims[i] ?? null] : []));

  // Half the body, no more. A sentence with no counts is a directive the reader
  // cannot audit, and an area that spent its whole budget on sentences would
  // have retired the audit that makes a wrong threshold cost one line instead of
  // one convention. Unbounded, a 30-slot area printed no counts at all.
  const cap = Math.max(1, Math.floor(budget / 2));

  // Largest first, because the order is the reducer's and a listing that
  // reorders itself as an area grows is not one a reader can diff against
  // yesterday's. Dropping one more block frees its whole height and costs at
  // most the one line its name takes, so the cost never rises as this walks
  // down and the first fit is the best one.
  for (let kept = blocks.length - 1; kept >= 0; kept--) {
    const hidden = named(kept);
    const names = hidden.slice(0, cap);
    // Reserved per hidden key and rendered per hidden sentence. A record with no
    // prose reserves the line and prints nothing in it, which is a short file
    // rather than a disagreement: the count the check reads is the key count.
    if (upTo(kept) + 1 + names.length <= budget) {
      return { kept, names, unnamed: hidden.length - names.length };
    }
  }

  // Unreachable while the floor holds: at nothing kept the notice and a capped
  // list come to less than half the smallest budget there is. Kept so a future
  // floor cannot turn a bound into a crash.
  return { kept: 0, names: [], unnamed: named(0).length };
}

/**
 * The stated slots this area's file had no room to print, on either partition.
 *
 * `check` reads the record, not the rendered file, so a claim the map never
 * printed was still enforced at the severity that means "the map told you and
 * you are the first to break it". Three slots on a measured repository reached
 * it on a directive sentence that appears nowhere in the file the agent reads,
 * and fifteen more on a counts line that went the same way.
 */
export function droppedDirectives(area) {
  const { blocks, keys, claims, budget } = areaBlocks(area);
  const { kept } = settle(blocks, keys, claims, budget);
  return new Set(keys.slice(kept).filter(Boolean));
}

export function renderArea(area) {
  const { head, blocks, keys, claims, stated, descriptions, kinds, budget } = areaBlocks(area);
  const { kept, names, unnamed } = settle(blocks, keys, claims, budget);

  // The frontmatter is delivery rather than content: the globs are what route
  // this file to a path, and one dropped to save a line would mis-deliver the
  // whole file. So an area spanning enough directories to fill the budget on its
  // `paths` list alone keeps every pattern and still says one thing, rather than
  // arriving nowhere and saying nothing. Measured across 35 repositories: 17
  // hold at least one such area and every one of their bodies came to ten lines
  // or fewer, so what overflows is the routing and never the reading.
  const body = blocks.slice(0, kept).flat();
  if (kept < blocks.length) {
    const dropped = blocks.length - kept;
    // Which kind was dropped, because the two mean opposite things: a lost
    // directive is a convention this file did not deliver, and a lost count is
    // a threshold nobody can audit from here. Folded into one sentence rather
    // than two lines, since the budget is why we are here.
    const kind = droppedKind(blocks.length, keys, stated, descriptions, dropped);
    // Led by what will actually print, reserved by what was hidden. A record
    // carrying keys and no prose reserves its lines and has no sentences to put
    // in them, and a lead ending in a colon over nothing is worse than no lead.
    const printed = names.filter(Boolean);
    body.push(`and ${dropped} more not shown here${kind}${alsoStatedLead(printed.length, unnamed)}`);
    for (const name of printed) body.push(`  ${name}`);
  }

  // Read under the heading: what the area holds is what a reader wants before
  // what it asks of them.
  return [...head, ...(kinds ? [kinds, ""] : []), ...body].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Which of the three kinds the lines that did not fit were. Blocks sit in drop
 * order, directives first and counts last, so the tail is what went.
 *
 * Named apart because the reader's next move differs for each: a lost directive
 * is a convention this file did not deliver, a lost count is a threshold nobody
 * can audit from here, and a lost description is neither.
 */
function droppedKind(total, keys, stated, described, dropped) {
  const first = total - dropped;
  // Off `keys` rather than off the directive partition, because a slot the
  // model writes by default is stated too and rides with the counts: counting
  // the partition read a dropped tail of those as "all of them counts" while
  // the check FIXed them off the same record, on 48 of 72 areas carrying the
  // notice on one measured repository. `droppedDirectives` reads the same
  // array, so the sentence and the enforcement cannot disagree.
  const statedLost = keys.slice(first).filter(Boolean).length;
  const describedLost = Math.max(0, stated + described - Math.max(first, stated));
  if (statedLost === dropped) return ", all of them stated";
  if (describedLost === dropped) return ", all of them descriptions";
  if (statedLost + describedLost === 0) return ", all of them counts";
  const parts = [];
  if (statedLost) parts.push(`${statedLost} of them stated`);
  if (describedLost) parts.push(`${describedLost} of them descriptions`);
  return `, ${parts.join(", ")}`;
}

/**
 * The obligation's companion side, when there is anything to say about it.
 *
 * A ratio of zero means one of two very different things and only this number
 * separates them. Measured on alphagov/whitehall: the app/models area scores 0
 * of 160, and 117 of those models have a test one directory deeper. Silent at
 * zero, so an unmet obligation costs no always-loaded bytes.
 */
function companionAudit(d) {
  const n = d.companionsElsewhere;
  return n ? `, ${n} with a namesake elsewhere in the tree` : "";
}

/**
 * The overview has no `paths` key, so it loads on every turn. It must be
 * byte-stable between scans with no source change: the token economics only
 * work on a cached read, and anything that moves per commit destroys that. So
 * no timestamp, no duration, no counts that drift.
 */
export function renderOverview(result, files) {
  const head = [
    "---",
    `generator: ${GENERATOR}`,
    "---",
    "",
    "# Repository map",
    "",
    "Facts counted from this repository's own code, per directory.",
    "A claim states how many sites conform out of how many were eligible.",
    "",
    "Read a file before editing it: these notes load when you read, not when you grep.",
    // Names the tools the agent already has, and permits saying
    // "unverified", which is the half that keeps a guess from being written down
    // as a fact (docs/research/one-line-that-stops-guessing.md).
    "When unsure what this code does, read it, grep it, or run it instead of guessing, and say what you could not verify.",
    // Conditional on a change being asked for, because removing the equivalent
    // scope guard is measured to move the out-of-scope rate by double digits
    // (docs/research/one-line-that-finishes-in-house-style.md).
    "When a change is asked for, follow what this repository already does and carry it through instead of stopping at a suggestion.",
    "",
  ];

  if (result.suppressAll) {
    head.push("The scan was truncated, so no directive is stated. Counts only.", "");
  }

  // Otherwise this file says nothing is uncovered, on a repository whose source
  // is all sitting there untracked. The corpus is tracked files by design, and
  // the map should say that is why it is empty rather than imply the repository
  // has nothing in it.
  if (result.corpus.untracked) {
    head.push(
      "No tracked source files, so nothing was counted. " +
        `${untrackedSentence(result.corpus.untracked)}; ` +
        "commit and scan again.",
      ""
    );
  }

  // A one-author repository states its only author's practice, so the map says
  // whose practice it is. Stable across scans while the count holds (A5).
  //
  // Not from a window: a `--depth=1` checkout holds one author whatever the
  // team is, and this sentence printed over a repository with fifteen.
  if (result.authors && result.authors.repo === 1 && !result.authors.shallow) {
    head.push("This repository has one author, so every claim below is that author's practice.", "");
  }

  // What was read, where it was not the whole history. Said here as well as on
  // the terminal, from one function, because a count printed by two surfaces
  // drifts (A20).
  const truncated = truncatedHistorySentence(result.authors?.shallow);
  if (truncated) head.push(truncated, "");

  // What the scan could not cover, and how many files this tool generated.
  // Neither grows with the repository, so both are paid before anything else.
  const fixed = overviewTail(result, files);

  // The roster is paid next and shrinks into what is left of the bound, minus
  // the `## Areas` heading and its blank and the lines the two listings below
  // never give up: one sentence per kind of rule file this tool did not write,
  // and one line of areas. Pushed unbudgeted it was head, and `Math.max(2, ...)`
  // has nothing to give back: seven roots on a repository with a full tail put
  // the overview six lines past its bound.
  const listings = otherFiles(files.others, 1).length + 1;
  head.push(...renderLayout(result.layout, MAX_LINES - head.length - fixed.length - 2 - listings));
  head.push(`## Areas (${result.areas.length})`, "");

  // Two listings do grow: the areas, and the rule files this tool did not write.
  // They share whatever is left, and each keeps at least one line, because a
  // budget that starves one of them entirely is a fact the file stops carrying.
  // Budgeting the areas alone was the bug: the other listing was rendered first
  // and unbounded, and a repository with enough of both put the overview eight
  // lines past its bound.
  const room = Math.max(2, MAX_LINES - head.length - fixed.length);
  const others = otherFiles(files.others, Math.max(1, room - 1));
  const listing = areaListing(result, Math.max(1, room - others.length));

  return [...head, ...listing, ...fixed, ...others].join("\n") + "\n";
}

/**
 * The areas that state something, named; the rest counted.
 *
 * An area carrying counts alone still has its own path-scoped file, which loads
 * when a file in it is read, so nothing here is unreachable: the line would buy
 * a directory name and a file count that `ls` already gives. Measured on a
 * 5,489-file Rails repository, 143 of 151 areas stated nothing and 89% of an
 * always-loaded file went on their names.
 */
function areaListing(result, budget) {
  // The same partition the area file makes: a slot the model writes by default
  // is a counts line there, so it must not earn the area a name here.
  const stated = (a) =>
    a.dimensions.filter((d) => statedSide(d).states !== null && d.matchesDefault !== true).length;
  const eligible = result.areas.filter((a) => stated(a) > 0).slice(0, OVERVIEW_AREAS);

  // A trailing count is owed unless every area is named, and an area the budget
  // cuts is as unnamed as one that states nothing: two numbers a reader has to
  // add up is worse than one, and the second would only say which this build
  // cut. Reserved on both causes, because reserving on the first alone put the
  // trailer one line past the bound whenever every area stated something and
  // they still did not all fit.
  const namesEveryArea = eligible.length === result.areas.length && eligible.length <= budget;
  const lines = fit(
    eligible.map((a) => [`- ${encode(a.path)} — ${a.fileCount} files, ${stated(a)} stated`]),
    Math.max(0, namesEveryArea ? budget : budget - 1)
  );

  // "more" only counts against something already named. A repository whose
  // areas all carry counts and state nothing lists none of them, which is the
  // ordinary case before any convention is measured, and "and 3 more areas"
  // under an empty listing reads as three areas withheld on top of three shown.
  const unnamed = result.areas.length - lines.length;
  if (unnamed > 0) {
    const what = unnamed === 1
      ? "area in its own file, loaded when you read one of its files"
      : "areas, each in its own file, loaded when you read one of its files";
    lines.push(lines.length ? `- and ${unnamed} more ${what}` : `- ${unnamed} ${what}`);
  }
  return lines;
}

/**
 * What the scan could not cover, and who wrote the files in `.claude/rules/`.
 */
function overviewTail(result, files) {
  const lines = ["", "## Not covered", ""];

  // Two different facts, and only the first was ever what the sentence said.
  // A file is uncovered because discovery found nowhere to put it, or because
  // the directory it is in became an area and then had nothing counted in it,
  // which is a parse failure or a language this tool has no dimension for. The
  // reader's next move differs, so the two are named apart. Absent `orphaned`
  // means the caller knows of no second cause.
  const { orphaned, barren } = splitUncovered(files.uncovered, files.orphaned ?? files.uncovered);
  const source = (n) => `${n} source file${n === 1 ? "" : "s"} sit${n === 1 ? "s" : ""}`;
  if (orphaned) lines.push(`- ${source(orphaned)} in no area (too few per directory)`);
  if (barren) lines.push(`- ${source(barren)} in a directory nothing was counted in`);
  const unread = unreadLanguageFiles(result);
  if (unread.length) {
    const total = unread.reduce((n, [, count]) => n + count, 0);
    const named = unread.map(([ext, count]) => `${count} ${ext}`).join(", ");
    lines.push(`- ${plural(total, "file")} hold a language this map does not read (${named})`);
  }
  // Dropped in `collect`, before anything counts, so without this row nothing
  // anywhere says they exist: a reader who knows the directory is there sees a
  // map that has never heard of it.
  const generated = result.corpus?.dropped?.generated ?? 0;
  if (generated) lines.push(`- ${plural(generated, "file")} say a generator wrote them, so nothing here is counted from them`);
  lines.push("- memory, GC and I/O behaviour: runtime only, nothing static to count");
  // Stable only: this file is read on every turn and is paid for on a cached
  // read, so a count that moves with machine load may not reach it (A5). The
  // summary prints all four, and the summary is not cached.
  for (const line of unexaminedLines(result.parse, { stable: true })) lines.push(`- ${line}`);
  // Only when it ran and only when it ran badly. A clean tier is the tier
  // working, and the always-loaded file is paid for on every turn.
  const degraded = degradedSemanticSentence(result.semantic);
  if (degraded) lines.push(`- ${degraded}`);

  const generatedCount = result.areas.filter((a) => a.dimensions.length > 0).length + 1;
  lines.push("", `Generated files: ${generatedCount} under ${RULES_DIR}/${PREFIX}*.md`);
  return lines;
}

/**
 * How many source files the working tree holds that no scan can count.
 *
 * One sentence, because the summary and the always-loaded overview both print
 * this count and drifted the moment only one of them learned to agree with it:
 * "1 source file is untracked" on the summary beside "1 source files ... are
 * untracked" in the file that loads every turn.
 */
export const untrackedSentence = (n) =>
  `${plural(n, "source file")} in the working tree ${n === 1 ? "is" : "are"} untracked`;

/**
 * What the history read was, where it was not all of it, or null.
 *
 * `git log` answers on a shallow clone and its answer is true about a window
 * nobody chose, so every author count taken from it is a floor. One sentence
 * for the same reason `untrackedSentence` is one: the overview and the terminal
 * both say it, and a second spelling is a second answer.
 *
 * The date is git's, so it is read only where it is spelled as a date: a
 * committer date is a value the repository sets.
 */
export function truncatedHistorySentence(shallow) {
  if (!shallow) return null;
  const day = /^\d{4}-\d{2}-\d{2}/.exec(shallow.oldest ?? "")?.[0] ?? null;
  const held = [
    shallow.commits === null || shallow.commits === undefined ? null : plural(shallow.commits, "commit"),
    day === null ? null : `since ${day}`,
  ]
    .filter(Boolean)
    .join(" ");
  return `history truncated: shallow clone${held ? `, ${held}` : ""}, so author counts are a floor`;
}

/**
 * What a tier that ran badly cost, or null where it ran clean or never ran.
 *
 * One sentence for the same reason `untrackedSentence` is one: the overview
 * said this and the summary did not, so `--deep` bought 110 slots that all read
 * zero and the terminal the caller was watching never mentioned it. The share
 * and the reason are what the record already holds; the cause is deliberately
 * not named, because a repository whose own types are loose reads the same as
 * one whose checker could not be set up.
 */
export function degradedSemanticSentence(semantic) {
  if (!semantic || semantic.ran !== true || semantic.status !== "degraded") return null;
  const rate = semantic.typedResolutionRate;
  const pct = rate === null || rate === undefined ? "no" : `${Math.round(rate * 100)}% of`;
  return `type-checked claims are counts only: ${pct} type lookups resolved (${semantic.reason})`;
}

const count = (xs, noun) => plural(xs.length, noun);
const was = (xs) => (xs.length === 1 ? "was" : "were");
const they = (xs) => (xs.length === 1 ? "it is" : "they are");

function otherFiles(others, budget) {
  const { foreign = [], unknown = [], unreadable = [] } = others || {};
  if (foreign.length === 0 && unknown.length === 0 && unreadable.length === 0) {
    return ["Any other file there was not written by this tool."];
  }

  // One line each, because the reader's move is the same whichever file it is
  // and this section is paid for on every turn.
  const lines = [];
  if (unknown.length) {
    // Not "scan again to clear them": scanning is what left them alone. Two of
    // the three facts ownership needs is not ownership, so this tool will not
    // remove them, and the overview may not promise a fix it refuses to apply.
    lines.push(
      `${count(unknown, "file")} here ${was(unknown)} written by an earlier scan and ` +
        "not listed in this map; this tool leaves them, so delete them by hand if unwanted."
    );
  }
  if (unreadable.length) {
    lines.push(`${count(unreadable, "file")} here could not be read, so whose ${they(unreadable)} is unknown.`);
  }
  if (foreign.length) {
    // The sentence is owed before any name is, and so is the count of whatever
    // did not fit, so both are paid out of the budget before the names are.
    const room = Math.max(0, budget - lines.length - 1);
    const cap = foreign.length <= room ? room : Math.max(0, room - 1);
    const { shown, rest } = listSome(foreign, Math.min(LISTED.overview, cap));
    lines.push(
      shown.length
        ? "Any other file there was not written by this tool:"
        : `${foreign.length} other file(s) there were not written by this tool.`
    );
    for (const name of shown) lines.push(`- ${encodePath(name)}`);
    if (shown.length && rest) lines.push(`- and ${rest} more`);
  }
  return lines;
}
