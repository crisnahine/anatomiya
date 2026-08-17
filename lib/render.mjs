import { encode, encodePath } from "./encode.mjs";
import { kindsLine, plural, renderLayout } from "./render-layout.mjs";
import { statedSide } from "./facts.mjs";
import { globText } from "./areas.mjs";
import { GENERATOR, listSome, LISTED, PREFIX, RULES_DIR } from "./rules.mjs";

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
// directive block, its exceptions, and the count of what did not fit.
const MIN_BODY_LINES = 8;

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
  if (blocks.reduce((n, b) => n + b.length, 0) <= budget) return blocks.flat();

  // One line back for the notice, or it is the line that breaks the bound it
  // exists to report.
  const room = more ? budget - 1 : budget;
  const lines = [];
  let dropped = 0;
  for (const block of blocks) {
    if (dropped === 0 && lines.length + block.length <= room) lines.push(...block);
    else dropped++;
  }
  if (more) lines.push(more(dropped));
  return lines;
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
// A stated directive needs authors at or above min(2, repository authors), so
// one author on a stated line can only be a one-author repository.
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
 * The four ways a file goes unexamined, named apart because the reader's next
 * move differs: a crash is this tool's problem, rejected syntax is the file's,
 * and the cap is a generated file nobody writes by hand.
 *
 * Shared for the same reason `splitUncovered` is. Copied, they drifted: the cap
 * read "over the size cap" in the summary and "exceeded" in the overview.
 */
export function unexaminedLines(parse) {
  const lines = [];
  // A count of one reads as one. Seven repositories in a thirty-five
  // repository corpus printed "1 files hold syntax the parser rejected", on the
  // summary and in the file that loads on every turn.
  const line = (n, kind) => `${plural(n, "file")} ${unexaminedPhrase(kind, n)}`;
  for (const kind of ["crashed", "failed", "syntaxErrors", "skipped"]) {
    if (parse[kind]) lines.push(line(parse[kind], kind));
  }
  // Without the stripper every Flow file lands in the count above, and the two
  // facts are otherwise unconnected on screen. The dependency arrived after the
  // plugin did, so a node_modules that predates it produces exactly this state:
  // oxc loads, the retry cannot run, and react loses 286 files silently.
  if (parse.syntaxErrors && parse.missingStripper) {
    lines.push("flow-remove-types is not installed, so a file written in Flow is rejected rather than read");
  }
  return lines;
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

export function renderArea(area) {
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
  for (const [d, s] of directives) {
    const block = [
      claimLine(s.claim),
      // The files this dimension could have spoken about, which is what the
      // gate divided by. The area's own count is a different number wherever
      // the area holds more than one language or a file nothing was read from,
      // and dividing by it retires the audit C3 exists to provide.
      `  ${s.conforming} of ${d.candidates} sites across ${d.applicability} of ${d.langFileCount} files` +
        `, ${hands(d)}` +
        companionAudit(d) +
        (d.precision === "partial" ? "  (partial: some sites are not visible statically)" : ""),
    ];
    for (const e of s.exceptions) {
      block.push(`  except ${encodePath(e.path)}${e.count > 1 ? ` (${e.count} sites)` : ""}`);
    }
    if (s.more) block.push(`  and ${s.more} more`);
    block.push("");
    blocks.push(block);
  }
  const stated = blocks.length;

  // What the area holds and what it reaches for. Counts rather than directives,
  // so they outlive a suppressed count and give way to a stated one: a
  // directive is what the file exists to deliver, and a description is what
  // makes the next file fit beside the ones already here.
  //
  // Offered only where the bound still has the room: `MIN_BODY_LINES` is the
  // floor that keeps an area whose `paths` list ate the budget saying one
  // thing, and it is already allowed to run the file past `MAX_LINES` to do it.
  // A description of the area may not add to that, so thirty globs cost the
  // kinds line rather than the bound.
  const described = MAX_LINES - head.length >= MIN_BODY_LINES;
  const kinds = described && area.kinds ? kindsLine(area.kinds) : null;
  if (kinds) blocks.push([kinds, ""]);
  if (described) {
    for (const line of rosterLines(area)) blocks.push([line]);
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
  }

  // The frontmatter is delivery rather than content: the globs are what route
  // this file to a path, and one dropped to save a line would mis-deliver the
  // whole file. So an area spanning enough directories to fill the budget on its
  // `paths` list alone keeps every pattern and still says one thing, rather than
  // arriving nowhere and saying nothing. Measured across 35 repositories: 17
  // hold at least one such area and every one of their bodies came to ten lines
  // or fewer, so what overflows is the routing and never the reading.
  const body = fit(blocks, Math.max(MIN_BODY_LINES, MAX_LINES - head.length), (dropped) =>
    // Which kind was dropped, because the two mean opposite things: a lost
    // directive is a convention this file did not deliver, and a lost count is
    // a threshold nobody can audit from here. Folded into one sentence rather
    // than two lines, since the budget is why we are here.
    `and ${dropped} more not shown here${droppedKind(blocks.length, stated, descriptions, dropped)}`
  );

  // Read under the heading, budgeted after the directives. `fit` has one order
  // and it is the drop order, because the line that gives way first is the one
  // worth the least, and where a surviving line prints is a separate question:
  // what the area holds is what a reader wants before what it asks of them.
  const at = kinds ? body.indexOf(kinds) : -1;
  if (at > 0) {
    body.splice(at, 2);
    body.unshift(kinds, "");
  }
  return [...head, ...body].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Which of the three kinds the lines that did not fit were. Blocks sit in drop
 * order, directives first and counts last, so the tail is what went.
 *
 * Named apart because the reader's next move differs for each: a lost directive
 * is a convention this file did not deliver, a lost count is a threshold nobody
 * can audit from here, and a lost description is neither.
 */
function droppedKind(total, stated, described, dropped) {
  const first = total - dropped;
  const statedLost = Math.max(0, stated - first);
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
  if (result.authors && result.authors.repo === 1) {
    head.push("This repository has one author, so every claim below is that author's practice.", "");
  }

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
  lines.push("- memory, GC and I/O behaviour: runtime only, nothing static to count");
  for (const line of unexaminedLines(result.parse)) lines.push(`- ${line}`);
  // Only when it ran and only when it ran badly. A clean tier is the tier
  // working, and the always-loaded file is paid for on every turn.
  if (result.semantic?.ran && result.semantic.status === "degraded") {
    const rate = result.semantic.typedResolutionRate;
    const pct = rate === null ? "no" : `${Math.round(rate * 100)}% of`;
    lines.push(`- type-checked claims are counts only: ${pct} type lookups resolved (${result.semantic.reason})`);
  }

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
