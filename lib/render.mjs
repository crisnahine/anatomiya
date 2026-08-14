import { encode, encodePath } from "./encode.mjs";

export const GENERATOR = "anatomiya";
export const PREFIX = "anatomiya-";

// The overview loads on every turn, so its area listing is bounded even though
// the number of areas is not. Past this it names only the areas that state
// something and counts the rest.
export const OVERVIEW_AREAS = 200;

/**
 * Ownership is the frontmatter key, not the filename.
 *
 * The prefix earns its place for one job only: a single line in the git common
 * dir's `info/exclude` hides every generated file. It is not the ownership
 * test, because a hand-written file can take that name. Removal needs all
 * three: the prefix, the key, and being known to the scan.
 */
export function isOwned(text) {
  // Anchored to the start of the file, not to any line: a hand-written note with
  // a horizontal rule above a line reading `generator: anatomiya` is not
  // frontmatter, and matching it would put that file on the removal list.
  return /^\uFEFF?---\r?\n(?:.*\r?\n)*?generator:[ \t]*anatomiya[ \t]*\r?\n(?:.*\r?\n)*?---[ \t]*(?:\r?\n|$)/.test(
    text || ""
  );
}

/**
 * The glob is built from a directory name, so it is repository-controlled and
 * goes through the encoder like every other such value (F4). It is emitted
 * JSON-quoted, which is also a valid YAML double-quoted scalar, so a newline in
 * the directory name cannot open a second frontmatter fence.
 *
 * Only the directory half is encoded. The pattern tail comes from a fixed
 * extension table, and passing it through would cost the leading `*`, which the
 * encoder strips as a markdown bullet: the result reads like a working glob and
 * matches nothing.
 */
const GLOB_TAIL = /\/?(?:\*\*\/)?\*\.[^/]*$/;

// A leading `!` is the matcher's negation marker, not part of any directory
// name, so it is split off before encoding and put back after: the encoder
// would otherwise see it as the first character of the path.
function encodeGlob(g) {
  const s = String(g ?? "");
  const negated = s.startsWith("!");
  const body = negated ? s.slice(1) : s;
  const tail = body.match(GLOB_TAIL);
  if (!tail) return encodePath(s);
  const dir = body.slice(0, tail.index);
  return `"${negated ? "!" : ""}${dir ? encodePath(dir).slice(1, -1) : ""}${tail[0]}"`;
}

export function areaFilename(area) {
  return `${PREFIX}area-${area.id}.md`;
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
 * not" in every JS area of every repository.
 *
 * Line breaks are still collapsed, because a sentence spanning two lines would
 * put its tail where the counts belong. A test pins the registry to sentences
 * that need nothing more than this.
 */
const claimLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Which of a dimension's two sentences this area is about, with the counts and
 * the exception list that belong to it.
 *
 * Exported so the renderer and the check can never name different sides of the
 * same dimension. A suppressed dimension still picks a side, because "2 of 61
 * sites" reads as a directory with no habit when it has a very strong one that
 * was merely too concentrated to state. An exact tie prefers the claim, which
 * keeps the choice a pure function of the counts (A5).
 *
 * A record written before the inverse existed carries no `states`, and
 * `undefined !== null` would render every suppressed dimension as stated.
 */
export function statedSide(d) {
  const states = d.states ?? (d.directive ? "claim" : null);
  const counter =
    d.counterClaim && (states === "counter" || (states === null && d.candidates - d.conforming > d.conforming));
  return counter
    ? {
        states,
        side: "counter",
        claim: d.counterClaim,
        conforming: d.candidates - d.conforming,
        exceptions: d.counterExceptions || [],
        more: d.moreCounterExceptions || 0,
        gate: d.counterGate,
      }
    : {
        states,
        side: "claim",
        claim: d.claim,
        conforming: d.conforming,
        exceptions: d.exceptions || [],
        more: d.moreExceptions || 0,
        gate: d.gate,
      };
}

export function renderArea(area) {
  // Measured: a `paths` key with no pattern under it loads on every turn, which
  // is what the overview is for and what an area file must never do. There is
  // no glob-less area to render, so this is a bug in the caller either way.
  if (!area.globs || area.globs.length === 0) {
    throw new Error(`area has no paths glob, so its file would load on every turn: ${area.path}`);
  }

  const lines = [
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
  const directives = sides.filter(([, side]) => side.states !== null);
  const counts = sides.filter(([, side]) => side.states === null);

  for (const [d, s] of directives) {
    lines.push(claimLine(s.claim));
    lines.push(
      `  ${s.conforming} of ${d.candidates} sites across ${d.applicability} of ${area.fileCount} files` +
        `, ${hands(d)}` +
        companionAudit(d) +
        (d.precision === "partial" ? "  (partial: some sites are not visible statically)" : "")
    );
    for (const e of s.exceptions) {
      lines.push(`  except ${encodePath(e.path)}${e.count > 1 ? ` (${e.count} sites)` : ""}`);
    }
    if (s.more) lines.push(`  and ${s.more} more`);
    lines.push("");
  }

  // A suppressed dimension still prints its counts. That is what makes a wrong
  // threshold cost one sentence instead of a wrong convention, and it is why
  // the gates can be set conservatively.
  for (const [d, s] of counts) {
    lines.push(
      `${claimLine(s.claim)}: no convention. ` +
        `${s.conforming} of ${d.candidates} sites${companionAudit(d)} (${why(d, s.gate)})`
    );
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
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
  const generatedCount = result.areas.filter((a) => a.dimensions.length > 0).length + 1;
  const lines = [
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
    lines.push("The scan was truncated, so no directive is stated. Counts only.", "");
  }

  // Otherwise this file says nothing is uncovered, on a repository whose source
  // is all sitting there untracked. The corpus is tracked files by design, and
  // the map should say that is why it is empty rather than imply the repository
  // has nothing in it.
  if (result.corpus.untracked) {
    lines.push(
      "No tracked source files, so nothing was counted. " +
        `${result.corpus.untracked} source files in the working tree are untracked; ` +
        "commit them and scan again.",
      ""
    );
  }

  // A one-author repository states its only author's practice, so the map says
  // whose practice it is. Stable across scans while the count holds (A5).
  if (result.authors && result.authors.repo === 1) {
    lines.push("This repository has one author, so every claim below is that author's practice.", "");
  }

  lines.push(`## Areas (${result.areas.length})`, "");
  // The overview is the one file loaded on every turn, so only the areas that
  // state something are named, and the count above is the truth about how many
  // exist. An area carrying counts alone still has its own path-scoped file,
  // which loads when a file in it is read, so nothing here is unreachable: the
  // line would buy a directory name and a file count that `ls` already gives.
  const stated = (a) => a.dimensions.filter((d) => statedSide(d).states !== null).length;
  const listed = result.areas.filter((a) => stated(a) > 0).slice(0, OVERVIEW_AREAS);

  for (const a of listed) {
    lines.push(`- ${encode(a.path)} — ${a.fileCount} files, ${stated(a)} stated`);
  }
  const rest = result.areas.length - listed.length;
  if (rest > 0) lines.push(`- and ${rest} more areas, each in its own file, loaded when you read one of its files`);

  lines.push("", "## Not covered", "");
  // Two different facts, and only the first was ever what the sentence said.
  // A file is uncovered because discovery found nowhere to put it, or because
  // the directory it is in became an area and then had nothing counted in it,
  // which is a parse failure or a language this tool has no dimension for. The
  // reader's next move differs, so the two are named apart. Absent `orphaned`
  // means the caller knows of no second cause.
  const orphaned = files.orphaned ?? files.uncovered;
  const barren = Math.max(0, files.uncovered - orphaned);
  if (orphaned) lines.push(`- ${orphaned} source files sit in no area (too few per directory)`);
  if (barren) lines.push(`- ${barren} source files sit in a directory nothing was counted in`);
  lines.push("- memory, GC and I/O behaviour: runtime only, nothing static to count");
  // Three ways a file goes unexamined, named apart because the reader's next
  // move differs: a crash is this tool's problem, a syntax error is the file's,
  // and the cap is a generated file nobody writes by hand. The same three
  // sentences the CLI prints, so the two surfaces cannot drift.
  if (result.parse.crashed) lines.push(`- ${result.parse.crashed} files crashed the parser`);
  if (result.parse.failed) lines.push(`- ${result.parse.failed} files could not be parsed`);
  if (result.parse.syntaxErrors)
    lines.push(`- ${result.parse.syntaxErrors} files hold syntax the parser rejected`);
  if (result.parse.skipped) lines.push(`- ${result.parse.skipped} files exceeded the size cap`);

  lines.push("", `Generated files: ${generatedCount} under .claude/rules/${PREFIX}*.md`);
  lines.push("Any other file there was not written by this tool.");

  return lines.join("\n") + "\n";
}
