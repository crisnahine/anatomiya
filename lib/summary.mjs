import { unexaminedLines, untrackedSentence } from "./render.mjs";
import { layoutSummary, plural } from "./render-layout.mjs";
import { statedSide } from "./facts.mjs";
import { encode, encodePath, sanitisePath } from "./encode.mjs";
import { engineOf } from "./langs.mjs";
import { remedyFor } from "./readiness.mjs";
import { listSome, LISTED, RULES_DIR } from "./rules.mjs";
import { formatDelta } from "./baseline.mjs";

/**
 * What a command answered, and the lines that say it.
 *
 * The summary is the facts; the lines are the words. Four readers scrape these
 * lines (the agent through `commands/scan.md`, the corpus harness, the CI
 * smoke greps and the tests), so the wording lives in one module rather than
 * inside the printer that happens to emit it.
 */

// Measured: a rewritten context file does not re-attach mid-session.
const RESTART = "a session already running still holds the old map; restart to pick it up";

// The shape of the two records below, so a reader older than one refuses it
// rather than reading fields that moved. Same rule the facts record carries.
export const SUMMARY_SCHEMA = 1;

/** Every fact a scan prints, derived once, so nothing derives it twice. */
export function scanSummary(result, plan, { dryRun = false } = {}) {
  const slots = result.areas.flatMap((a) => a.dimensions);
  // Through the renderer's own partition, or the summary disagrees with the
  // map: a stated slot the model writes by default renders as a counts line.
  const stated = slots.filter((d) => statedSide(d).states !== null && d.matchesDefault !== true);
  const matching = slots.filter((d) => statedSide(d).states !== null && d.matchesDefault === true);

  return {
    files: result.corpus.files,
    areas: result.areas.length,
    durationMs: result.durationMs,
    root: result.root,
    untracked: result.corpus.untracked,
    claims: { stated: stated.length, matchingDefault: matching.length, total: slots.length },
    // Which engines ran and what they are, so a map that moved under unchanged
    // source has somewhere to look before anyone reads the counts.
    engines: result.parse.engines ?? null,
    layoutLine: layoutSummary(result.layout, result.areas),
    baseline: {
      status: result.baseline.status,
      sha: result.baseline.sha,
      drift: result.baseline.drift,
      baseRef: result.baseline.baseRef,
      countsOnly: result.baseline.countsOnly,
    },
    truncated: result.corpus.truncated,
    orphaned: plan.orphaned,
    // The two causes named apart, the way the overview names them. One folded
    // number printed beside "N files crashed the parser" invited exactly the
    // reading the overview line was fixed to stop.
    barren: plan.uncovered - plan.orphaned,
    unexamined: unexaminedLines(result.parse),
    historyError: result.authors.error,
    rules: {
      foreign: plan.foreign,
      unknown: plan.unknown,
      unreadable: plan.unreadableRules,
      listed: plan.listed,
      replaced: plan.replaced,
    },
    removed: plan.remove.length,
    wrote: plan.write.length,
    blind: plan.unreadable,
    dryRun,
  };
}

/** The scan summary as the lines the CLI prints, in the order it prints them. */
export function scanLines(s) {
  const lines = [];

  // The root, because a path argument does not scope the scan: `git rev-parse
  // --show-toplevel` resolves any path inside the repository to its root, so
  // `scan ./packages/api` in a monorepo maps the monorepo. Areas, the pin and
  // the baseline are all repository-anchored, so that is the behaviour they
  // need and the line is what says so.
  lines.push(`${plural(s.files, "file")}, ${plural(s.areas, "area")}, ${s.durationMs}ms, root ${s.root}`);
  const engines = enginesLine(s.engines);
  if (engines) lines.push(engines);
  if (s.untracked)
    lines.push(
      `${untrackedSentence(s.untracked)}. The corpus is tracked files only, so nothing there was counted`
    );
  lines.push(
    `${s.claims.stated} of ${plural(s.claims.total, "claim")} stated` +
      (s.claims.matchingDefault ? `, ${s.claims.matchingDefault} match the model default` : "") +
      ", the rest print as counts"
  );
  if (s.layoutLine) lines.push(s.layoutLine);
  lines.push(baselineLine(s.baseline));
  if (s.truncated)
    lines.push("only part of the corpus was read, so every directive is suppressed and only counts print");
  if (s.orphaned > 0) lines.push(`${plural(s.orphaned, "file")} in no area: too few per directory`);
  if (s.barren > 0) lines.push(`${plural(s.barren, "file")} in a directory nothing was counted in`);
  lines.push(...s.unexamined);
  if (s.historyError)
    lines.push(`history could not be read, so every claim fails the author gate: ${s.historyError}`);
  // Named, not counted. The count was a number the reader then had to go and
  // resolve with `ls`, and the whole point of the line is that these files
  // reach the agent on every turn.
  lines.push(...ruleFileLines(s.rules.foreign, "was not written by this tool"));
  // This tool's own output, from a scan whose record is gone. Two of the three
  // facts ownership needs is not ownership, so it is left where it is.
  lines.push(...ruleFileLines(s.rules.unknown, "carries our frontmatter but no map names it, so it was left alone"));
  // Whose it is was never established, so neither sentence above is true of it.
  lines.push(...ruleFileLines(s.rules.unreadable, "could not be read, so whose it is was not established"));
  if (!s.rules.listed) lines.push(`${RULES_DIR}/ could not be listed, so nothing in it was examined`);
  // A generated name is ours by construction, so this is not a refusal. It is
  // still the one case where a scan replaces a file somebody wrote by hand.
  lines.push(
    ...ruleFileLines(
      s.rules.replaced,
      s.dryRun
        ? "holds a name this scan writes, so it would be replaced"
        : "held a name this scan writes, so it was replaced"
    )
  );
  if (s.removed) {
    const what = s.dryRun ? "would be removed" : "removed";
    lines.push(`${s.removed} area file(s) ${what}: their area is gone or states nothing`);
  }
  // Nothing was written, and the reason is not "this repository has nothing in
  // it". Said before the count, because the count is 0 and reads as the first.
  if (s.blind.length) {
    lines.push(
      `read no ${s.blind.join(" or ")} file at all, so nothing was written and the previous map was left alone`
    );
    lines.push(...blindLines(s));
    return lines;
  }
  lines.push(s.dryRun ? `would write ${plural(s.wrote, "file")}` : `wrote ${plural(s.wrote, "file")}`);
  if (!s.dryRun) lines.push(RESTART);
  return lines;
}

/** The scan summary as the record it is, for a reader that is not a terminal. */
export function scanJson(s) {
  return JSON.stringify({ schema: SUMMARY_SCHEMA, ...encodeScan(s) }, null, 2) + "\n";
}

/**
 * Every repository-controlled value in a scan summary, neutralised.
 *
 * `JSON.stringify` escapes neither a bidi override nor a zero-width joiner
 * (they are category Cf), so a writer that is not the line renderer hands one
 * to whatever reads its stdout unaltered. Run here rather than in
 * `scanSummary`, because the lines encode as they render and a value through
 * the encoder twice is a value quoted twice.
 */
function encodeScan(s) {
  return {
    ...s,
    root: sanitisePath(s.root),
    historyError: s.historyError == null ? null : encode(s.historyError),
    // Each of these passes one argument on purpose: `map` hands its callback an
    // index, and `sanitisePath` reads a second argument as the cap.
    rules: {
      ...s.rules,
      foreign: s.rules.foreign.map((name) => sanitisePath(name)),
      unknown: s.rules.unknown.map((name) => sanitisePath(name)),
      unreadable: s.rules.unreadable.map((name) => sanitisePath(name)),
      replaced: s.rules.replaced.map((name) => sanitisePath(name)),
    },
  };
}

/**
 * Which engines answered, and at what version.
 *
 * Only the ones that said: an engine that ran and reported nothing is the
 * install to look at, and it says so on the blind lines instead of appearing
 * here as a null.
 */
function enginesLine(engines) {
  const known = Object.entries(engines ?? {}).filter(([, e]) => e.version);
  return known.length ? `engines: ${known.map(([id, e]) => `${id} ${e.version}`).join(", ")}` : null;
}

/**
 * Why a run went blind, in the engine's own terms.
 *
 * One sentence used to cover every cause, and it guessed the likeliest: a
 * missing interpreter. Measured with ruby on PATH and no prism, that sentence
 * was wrong and there was no version anywhere on screen to say so. An engine
 * that reported a version ran, so the files are what failed; one that reported
 * none is the install, and its own remedy is the next move. A summary carrying
 * no probe at all keeps the old sentence, which is all it can honestly say.
 */
function blindLines(s) {
  if (!s.engines) return ["this is usually a missing interpreter rather than a repository that changed"];
  return [...new Set(s.blind.map(engineOf))].map((id) => {
    const version = s.engines[id]?.version ?? null;
    return version
      ? `${id} ${version} ran and answered for none of them`
      : `${id} reported no version: ${remedyFor(id)}`;
  });
}

/**
 * One group of rule files, encoded and bounded.
 *
 * The names come off the filesystem, so they are repository-controlled like
 * every other value this tool prints: one carrying a newline printed as
 * two raw lines, and `commands/scan.md` tells the agent to report the lines the
 * scanner printed, so a crafted filename could forge one. The cap is the same
 * trade the report and the overview make, for the same reason.
 */
function ruleFileLines(names, what) {
  const { shown, rest } = listSome(names, LISTED.report);
  const lines = shown.map((name) => `${encodePath(name)} in ${RULES_DIR}/ ${what}`);
  if (rest) lines.push(`and ${rest} more file(s) in ${RULES_DIR}/ that ${what}`);
  return lines;
}

/**
 * Which population the gates read. An unpinned repository states claims off the
 * current tree, which is the weaker guarantee, so it says so rather than
 * reading like a scan measured against an accepted baseline.
 */
function baselineLine(b) {
  if (b.status === "unreachable")
    return `the pinned commit ${b.sha ? b.sha.slice(0, 8) : "?"} is gone from this clone, so every claim dropped to counts`;
  if (b.countsOnly)
    return "no baseline pinned: claims are measured against the current tree, and no finding can exceed FIX. `anatomiya pin` accepts one";
  const drift = b.drift === null ? "" : `, ${plural(b.drift, "file")} changed since ${b.baseRef ? b.baseRef.ref : "the base"}`;
  return `baseline ${b.sha.slice(0, 8)}${drift}`;
}

/** What a pin accepted, and where it put it. */
export function pinSummary({ previous, next, delta, path, dryRun = false }) {
  return {
    sha: next.sha,
    previousSha: previous ? previous.sha : null,
    areas: next.areas.length,
    delta,
    path,
    dryRun,
  };
}

/** The pin summary as the lines the CLI prints. Facts only, no recommendation. */
export function pinLines(s) {
  const lines = [...formatDelta(s.delta).split("\n"), ""];
  if (s.dryRun) {
    lines.push(`would write ${s.path}`);
    return lines;
  }
  lines.push(`wrote ${s.path}`);
  lines.push("run `anatomiya scan` to measure the map against it");
  // The scan that follows rewrites every context file. Said here too, because
  // the pin is where a human is told to go and run it.
  lines.push(RESTART);
  return lines;
}

/** The pin summary as the record it is, for a reader that is not a terminal. */
export function pinJson(s) {
  return JSON.stringify({ schema: SUMMARY_SCHEMA, ...encodePin(s) }, null, 2) + "\n";
}

/**
 * The delta's paths, neutralised, for the same reason `encodeScan` exists.
 *
 * The added list is printed by this writer and by nothing else, so it has no
 * encoded counterpart to fall back on: the line a human reads counts them.
 */
function encodePin(s) {
  return {
    ...s,
    delta: {
      ...s.delta,
      areas: s.delta.areas.map((a) => ({
        ...a,
        path: sanitisePath(a.path),
        added: a.added.map((name) => sanitisePath(name)),
        removed: a.removed.map((name) => sanitisePath(name)),
      })),
    },
  };
}
