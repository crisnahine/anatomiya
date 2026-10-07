import { degradedSemanticSentence, ORPHAN_CAUSES, truncatedHistoryLine, unexaminedLines, untrackedSentence } from "./render.mjs";
import { layoutSummary, plural } from "./render-layout.mjs";
import { statedSide } from "./facts.mjs";
import { encode, encodePath, firstLine, locator } from "./encode.mjs";
import { engineOf } from "./langs.mjs";
import { whyUnread } from "./readiness.mjs";
import { listSome, LISTED, PREFIX, RULES_DIR, SETTINGS_PATH } from "./rules.mjs";
import { formatDelta } from "./baseline.mjs";
import { TARGETS, TARGET_IDS, overviewName } from "./targets.mjs";

/**
 * What a command answered, and the lines that say it.
 *
 * The summary is the facts; the lines are the words. Four readers scrape these
 * lines (the agent through `commands/scan.md`, the corpus harness, the CI
 * smoke greps and the tests), so the wording lives in one module rather than
 * inside the printer that happens to emit it.
 */

// What a written map reaches. The echo hands a running session a changed
// overview on its next prompt or tool call, by its digest (A92), so the
// overview needs no restart. A rewritten context file the session already read
// does not re-attach inside the window (A6), and a new session, a compaction or
// /clear reads every file from disk.
const RUNNING_SESSION =
  "a running session gets the new overview on its next prompt or tool call, and a new session, a compaction or /clear loads the whole map";

// Said once, on the run that does it, because it is a change to a file somebody
// else may also be editing. It cannot repeat: the second scan finds nothing to
// take out and says nothing. A dry run touches nothing, so it says what the
// scan would do, the way its other lines do.
const hookRemoved = (dryRun) =>
  dryRun
    ? `${SETTINGS_PATH} carries a re-delivery hook this tool wrote and Claude Code refuses; it would be taken out`
    : `${SETTINGS_PATH} carried a re-delivery hook this tool wrote and Claude Code refuses; it was taken out`;

// The shape of the two records below, so a reader older than one refuses it
// rather than reading fields that moved. Same rule the facts record carries.
// 2 replaced `hookInstalled` with `hookRemoved`: the scan installed a hook into
// the repository and now only removes the one it used to install. `targets`
// came with no new number: it is a key an older reader never looks for, and it
// is absent wherever that reader's answer would be whole without it.
export const SUMMARY_SCHEMA = 2;

/** Every fact a scan prints, derived once, so nothing derives it twice. */
export function scanSummary(result, plan, { dryRun = false, hook = null } = {}) {
  const slots = result.areas.flatMap((a) => a.dimensions);
  // Through the renderer's own partition, or the summary disagrees with the
  // map: a stated slot the model writes by default renders as a counts line.
  const authorGated = slots.filter((d) => statedSide(d).gate === "authors").length;
  const stated = slots.filter((d) => statedSide(d).states !== null && d.matchesDefault !== true);
  const matching = slots.filter((d) => statedSide(d).states !== null && d.matchesDefault === true);
  const targets = targetSummaries(result, plan);

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
      // Why a pin on disk would not load, which is not the same line as no pin.
      unreadable: result.baseline.unreadable ?? null,
    },
    hookRemoved: hook?.removed === true,
    // The reason the install did not happen, where there is one: a settings file
    // this refused to touch is a thing to say once, not to swallow.
    hookRefused: hook?.refused ?? null,
    truncated: result.corpus.truncated,
    orphaned: plan.orphaned,
    // The two causes named apart, the way the overview names them. One folded
    // number printed beside "N files crashed the parser" invited exactly the
    // reading the overview line was fixed to stop.
    barren: plan.uncovered - plan.orphaned,
    // Tracked files the working tree would not resolve: under a directory the
    // scan may not enter, deleted since the commit, or named in bytes that are
    // not UTF-8. They sat in the escaped count, which nothing prints, and left
    // the scan without a word. Zero from a record written before the count.
    unreadFiles: result.corpus.dropped?.unreadable ?? 0,
    unexamined: unexaminedLines(result.parse),
    // What a tier that ran badly cost, in the overview's own words. The checker
    // added 110 slots that all read zero on a measured repository and the
    // terminal said nothing: the map, the facts store and every area file
    // carried it, and the one surface the caller was watching did not.
    semantic: degradedSemanticSentence(result.semantic),
    historyError: result.authors.error,
    // What was read, where it was not the whole history, from the module that
    // owns the sentence. The claim is the overview's too; the size of the
    // window and what the gate cost are this surface's alone, because the
    // overview owes byte-stability and both of them move on a repository whose
    // source did not.
    // Not beside `historyError`: the probe is a `rev-parse` and answers even
    // where the log itself failed, and a history that could not be read at all
    // is the larger fact. Both lines together said the gate held claims to
    // counts and then named a gate no slot was on.
    historyTruncated: result.authors.error ? null : truncatedHistoryLine(result.authors.shallow, authorGated),
    authorGated,
    rules: {
      foreign: plan.foreign,
      unknown: plan.unknown,
      unreadable: plan.unreadableRules,
      listed: plan.listed,
      replaced: plan.replaced,
    },
    removed: plan.remove.length,
    wrote: plan.write.length,
    // A language read no file of is one of two facts, told apart by whether
    // anything else was read: `blind` is a run that wrote nothing at all, and
    // `uncounted` is one that wrote the rest and left `held` area files alone.
    blind: plan.blind ? plan.unreadable : [],
    uncounted: plan.blind ? [] : plan.unreadable,
    held: plan.held.length,
    dryRun,
    ...(Object.keys(targets).length ? { targets } : {}),
  };
}

/**
 * What the scan did in each other directory the map goes to, by target id.
 *
 * A target this scan found off and left off has no entry, whatever its
 * directory holds: that is somebody else's directory until a scan is asked to
 * write there, and a repository that never named one reads as it did.
 * `state` is the one the scan leaves behind, or would on a dry run.
 */
function targetSummaries(result, plan) {
  // An area that states nothing has no file in any directory, so no target lacks one for it.
  const stated = new Set((plan.result ?? result).areas.filter((a) => a.dimensions.length > 0).map((a) => a.path));
  const out = {};
  for (const [id, t] of Object.entries(plan.targets ?? {})) {
    // Held by a caller nobody is watching, which is why it was held.
    if (t.held) continue;
    const unread = t.state === "unknown";
    const foreign = t.foreign.length + t.unknown.length;
    // One nobody could read is said only where the record names files there.
    const quiet = unread ? t.names.length === 0 : !t.on && t.state === "off" && t.remove.length === 0;
    if (quiet) continue;
    out[id] = {
      state: unread || plan.blind ? t.state : t.on ? "on" : "off",
      dir: t.dir,
      wrote: t.write.length,
      removed: t.remove.length,
      unfiled: t.unfiled.filter((path) => stated.has(path)).length,
      foreign,
      ...(t.unreadableRules.length ? { unreadable: t.unreadableRules } : {}),
      ...(unread ? { reason: t.reason } : {}),
    };
  }
  return out;
}

const UNREAD_ONE = "could not be read, so whose it is was not established";
const UNREAD_MANY = "could not be read, so whose they are was not established";

/** The lines for the other directories, in the targets' own order. */
function targetLines(s) {
  const lines = [];
  for (const id of TARGET_IDS) {
    const t = s.targets?.[id];
    if (!t) continue;
    const { reader } = TARGETS[id];
    const one = (n) => n === 1;
    if (t.wrote) lines.push(`${s.dryRun ? "would write" : "wrote"} ${plural(t.wrote, "file")} under ${t.dir} for ${reader}`);
    if (t.removed) lines.push(`${s.dryRun ? "would remove" : "removed"} ${plural(t.removed, "file")} under ${t.dir}`);
    if (t.removed && t.state === "off") lines.push(s.dryRun ? `${t.dir} would be off` : `${t.dir} is off now`);
    if (t.unfiled) {
      lines.push(
        `${plural(t.unfiled, "area")} ${one(t.unfiled) ? "has" : "have"} no pattern ${reader} can be given, ` +
          `so no file under ${t.dir} covers ${one(t.unfiled) ? "it" : "them"}`
      );
    }
    if (t.foreign) {
      // An entry, since a directory can hold the name, and neither verb claims who wrote it.
      lines.push(
        `${t.dir} holds ${one(t.foreign) ? "1 entry" : `${t.foreign} entries`} named ${PREFIX}* that this scan neither wrote nor removed; ` +
          `${one(t.foreign) ? "it was left as it is" : "they were left as they are"}`
      );
    }
    lines.push(...ruleFileLines(t.unreadable ?? [], UNREAD_ONE, UNREAD_MANY, t.dir));
    if (t.state === "unknown") {
      const remedy = unreadRemedy(id, t);
      lines.push(`${t.dir} could not be read (${t.reason}), so nothing there was written or removed${remedy ? `: ${remedy}, then scan again` : ""}`);
    }
  }
  return lines;
}

/**
 * What a person does about a target that could not be read, from the reason
 * `targetStatus` gave. Null for a reason not known here, which then prints alone.
 */
function unreadRemedy(id, t) {
  const reason = String(t.reason ?? "");
  if (reason.includes(" is a link into the same place as ")) return `point ${RULES_DIR} somewhere else`;
  if (reason.endsWith(" could not be read")) return "make it readable";
  const at = /^(.+) is (?:a link|not a directory|not a file)$/.exec(reason)?.[1];
  if (at === undefined) return null;
  return at === `${t.dir}/${overviewName(TARGETS[id])}` ? `move or delete ${at}` : `make ${at} a directory of this repository`;
}

/** The scan summary as the lines the CLI prints, in the order it prints them. */
export function scanLines(s) {
  const lines = [];

  // The root, because a path argument does not scope the scan: `git rev-parse
  // --show-toplevel` resolves any path inside the repository to its root, so
  // `scan ./packages/api` in a monorepo maps the monorepo. Areas, the pin and
  // the baseline are all repository-anchored, so that is the behaviour they
  // need and the line is what says so.
  //
  // As a locator, as `--format json` prints it: raw, a checkout directory named
  // with a newline forged a line of its own, and through the display encoder
  // its cap and script rule would print a root nobody can `cd` to.
  lines.push(`${plural(s.files, "file")}, ${plural(s.areas, "area")}, ${s.durationMs}ms, root ${locator(s.root)}`);
  const engines = enginesLine(s.engines);
  if (engines) lines.push(engines);
  if (s.untracked)
    lines.push(
      `${untrackedSentence(s.untracked)}. The corpus is tracked files only, so nothing there was counted`
    );
  lines.push(
    `${s.claims.stated} of ${plural(s.claims.total, "claim")} stated` +
      (s.claims.matchingDefault
        ? `, ${s.claims.matchingDefault} ${s.claims.matchingDefault === 1 ? "matches" : "match"} the model default`
        : "") +
      ", the rest print as counts"
  );
  // Beside the claims line, which is the count it explains: a tier that
  // answered nothing is why those slots print as counts.
  if (s.semantic) lines.push(s.semantic);
  if (s.layoutLine) lines.push(s.layoutLine);
  lines.push(baselineLine(s.baseline));
  if (s.truncated)
    lines.push("only part of the corpus was read, so every directive is suppressed and only counts print");
  if (s.orphaned > 0) lines.push(`${plural(s.orphaned, "file")} in no area: ${ORPHAN_CAUSES}`);
  if (s.barren > 0) lines.push(`${plural(s.barren, "file")} in a directory nothing was counted in`);
  if (s.unreadFiles > 0) {
    lines.push(`${plural(s.unreadFiles, "file")} could not be read, so nothing in ${s.unreadFiles === 1 ? "it was" : "them was"} counted`);
  }
  lines.push(...s.unexamined);
  // Its first line, encoded, the way `--format json` already carried it: the
  // stderr runs to several lines, and each one after the first printed as a
  // line of the summary with nothing saying whose it was.
  if (s.historyError)
    lines.push(`history could not be read, so every claim fails the author gate: ${encode(firstLine(s.historyError))}`);
  if (s.historyTruncated) lines.push(s.historyTruncated);
  // Named, not counted. The count was a number the reader then had to go and
  // resolve with `ls`, and the whole point of the line is that these files
  // reach the agent on every turn.
  lines.push(...ruleFileLines(s.rules.foreign, "was not written by this tool", "were not written by this tool"));
  // This tool's own output, from a scan whose record is gone. Two of the three
  // facts ownership needs is not ownership, so it is left where it is.
  lines.push(
    ...ruleFileLines(
      s.rules.unknown,
      "carries our frontmatter but no map names it, so it was left alone",
      "carry our frontmatter but no map names them, so they were left alone"
    )
  );
  // Whose it is was never established, so neither sentence above is true of it.
  lines.push(...ruleFileLines(s.rules.unreadable, UNREAD_ONE, UNREAD_MANY));
  if (!s.rules.listed) lines.push(`${RULES_DIR}/ could not be listed, so nothing in it was examined`);
  // A generated name is ours by construction, so this is not a refusal. It is
  // still the one case where a scan replaces a file somebody wrote by hand.
  lines.push(
    ...ruleFileLines(
      s.rules.replaced,
      ...(s.dryRun
        ? [
            "holds a name this scan writes, so it would be replaced",
            "hold a name this scan writes, so they would be replaced",
          ]
        : ["held a name this scan writes, so it was replaced", "held a name this scan writes, so they were replaced"])
    )
  );
  if (s.removed) {
    const what = s.dryRun ? "would be removed" : "removed";
    lines.push(
      s.removed === 1
        ? `1 area file ${what}: its area is gone or states nothing`
        : `${s.removed} area files ${what}: their area is gone or states nothing`
    );
  }
  // Nothing was written, and the reason is not "this repository has nothing in
  // it". Said before the count, because the count is 0 and reads as the first.
  if (s.blind.length) {
    lines.push(
      `read no ${s.blind.join(" or ")} file at all, so nothing was written and the previous map was left alone`
    );
    lines.push(...blindLines(s.blind, s.engines));
    return lines;
  }
  // A language this run read none of, where it read another: the rest of the
  // map is written, and the areas holding the unread one are the last scan's.
  // Said before the count, which would otherwise read as the whole repository.
  if (s.uncounted?.length) {
    const held = s.held
      ? ` and ${plural(s.held, "area")} holding one ${s.held === 1 ? "was" : "were"} left as the last scan wrote ${s.held === 1 ? "it" : "them"}`
      : "";
    lines.push(`read no ${s.uncounted.join(" or ")} file at all, so none was counted${held}`);
    lines.push(...blindLines(s.uncounted, s.engines));
  }
  lines.push(s.dryRun ? `would write ${plural(s.wrote, "file")}` : `wrote ${plural(s.wrote, "file")}`);
  lines.push(...targetLines(s));
  if (s.hookRemoved) lines.push(hookRemoved(s.dryRun));
  if (s.hookRefused) lines.push(`the map is written, and ${s.hookRefused}`);
  if (!s.dryRun) lines.push(RUNNING_SESSION);
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
 *
 * Paths go out as locators, as `encodeReport` sends them: a reader opens them,
 * and the display encoder's cap and script rule leave nothing to open.
 */
function encodeScan(s) {
  return {
    ...s,
    root: locator(s.root),
    historyError: s.historyError == null ? null : encode(s.historyError),
    rules: {
      ...s.rules,
      foreign: s.rules.foreign.map(locator),
      unknown: s.rules.unknown.map(locator),
      unreadable: s.rules.unreadable.map(locator),
      replaced: s.rules.replaced.map(locator),
    },
    ...(s.targets
      ? { targets: Object.fromEntries(Object.entries(s.targets).map(([id, t]) => [id, t.unreadable ? { ...t, unreadable: t.unreadable.map(locator) } : t])) }
      : {}),
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
 * Why a run read no file of these languages, in each engine's own terms
 * (`whyUnread`). A summary carrying no probe at all keeps the old sentence,
 * which is all it can honestly say.
 */
function blindLines(langs, engines) {
  if (!engines) return ["this is usually a missing interpreter rather than a repository that changed"];
  return [...new Set(langs.map(engineOf))].map((id) => whyUnread(id, engines));
}

/**
 * One group of rule files, encoded and bounded.
 *
 * The names come off the filesystem, so they are repository-controlled like
 * every other value this tool prints: one carrying a newline printed as
 * two raw lines, and `commands/scan.md` tells the agent to report the lines the
 * scanner printed, so a crafted filename could forge one. The cap is the same
 * trade the report and the overview make, for the same reason.
 *
 * `many` is the same sentence for the tail, which counts files and so takes
 * their verb: "and 2 more file(s) ... that was not written" gave one line two
 * numbers.
 */
function ruleFileLines(names, one, many, dir = RULES_DIR) {
  const { shown, rest } = listSome(names, LISTED.report);
  const lines = shown.map((name) => `${encodePath(name)} in ${dir}/ ${one}`);
  if (rest) {
    lines.push(`and ${rest} more ${rest === 1 ? "file" : "files"} in ${dir}/ that ${rest === 1 ? one : many}`);
  }
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
  // A pin is there and this build cannot read it. The unpinned line's pointer
  // at `/anatomiya:pin` is left off: the file may be a conflict to resolve or a
  // newer build's, and nothing on the scan path suggests a re-pin (E5).
  if (b.status === "pin-unreadable")
    return `the pin on disk could not be read because ${b.unreadable}, so claims are measured against the current tree and no finding can exceed FIX`;
  if (b.countsOnly)
    return "no baseline pinned: claims are measured against the current tree, and no finding can exceed FIX. Inside Claude Code the plugin's background refresh pins one when this checkout sits on the tip of origin's default branch with nothing uncommitted, or `/anatomiya:pin` takes one by hand";
  const drift = b.drift === null ? "" : `, ${plural(b.drift, "file")} changed since the pin (measured against ${b.baseRef ? b.baseRef.ref : "the base"})`;
  return `baseline ${b.sha.slice(0, 8)}${drift}`;
}

/** What a pin accepted, and where it put it. */
export function pinSummary({ root = null, previous, next, delta, path, dryRun = false, previousUnreadable = null }) {
  return {
    // The scan's reason: a path argument or an inherited GIT_DIR picks the
    // repository, and the store path alone never said which one was pinned.
    root,
    sha: next.sha,
    previousSha: previous ? previous.sha : null,
    // Why the pin on disk would not load, where there was one: the delta then
    // counts from nothing, which reads exactly like a first pin.
    previousUnreadable,
    areas: next.areas.length,
    delta,
    path,
    dryRun,
  };
}

/** The pin summary as the lines the CLI prints. Facts only, no recommendation. */
export function pinLines(s) {
  const lines = formatDelta(s.delta).split("\n");
  if (s.previousUnreadable) {
    lines.push(
      `the pin on disk could not be read because ${s.previousUnreadable}, so nothing was compared against it ` +
        `and this ${s.dryRun ? "would replace" : "replaced"} it`
    );
  }
  lines.push("");
  const where = s.root ? `${s.path}, root ${locator(s.root)}` : s.path;
  if (s.dryRun) {
    lines.push(`would write ${where}`);
    return lines;
  }
  lines.push(`wrote ${where}`);
  lines.push("run `/anatomiya:scan` to measure the map against it");
  // The scan that follows rewrites every context file. Said here too, because
  // the pin is where a human is told to go and run it.
  lines.push(RUNNING_SESSION);
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
    root: s.root === null ? null : locator(s.root),
    delta: {
      ...s.delta,
      areas: s.delta.areas.map((a) => ({
        ...a,
        path: locator(a.path),
        added: a.added.map(locator),
        removed: a.removed.map(locator),
        movedIn: a.movedIn.map(locator),
        movedOut: a.movedOut.map(locator),
      })),
    },
  };
}
