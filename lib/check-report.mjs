import { encode, quotePath, sanitisePath } from "./encode.mjs";
import { listSome, LISTED, RULES_DIR } from "./rules.mjs";

/**
 * The check's answer as something a reader takes: the encoder pass every writer
 * runs behind, and the three writers over it.
 *
 * Apart from the pipeline that produces the record, because the two halves have
 * no call between them in either direction and only one of them needs a parser,
 * a git runner and the whole registry to load. Three of the four readers of the
 * old module wanted a name from this half alone.
 */

// A matched line from a minified file would otherwise be the whole report.
const SNIPPET_CHARS = 100;

/**
 * The drift a report says out loud, below the share that caps severity.
 *
 * Measured on four repositories by walking one commit at a time to the 25%
 * crossing: 5% is about a week of drift on the fastest of them and a fortnight
 * on the next. Below it the line is noise on a map nobody needs to re-pin.
 */
const DRIFT_FLOOR = 0.05;

/**
 * Why a run could not answer in full, as a code rather than as a sentence.
 *
 * The sentence is still there and is what a human reads. The code is what
 * anything else reads: with prose alone, telling "the diff could not be read"
 * from "one file was read from the working tree" is a substring match on
 * wording nobody promised to keep.
 */
export const CAVEATS = Object.freeze({
  MAP_UNREADABLE: "map-unreadable",
  NO_MAP: "no-map",
  NO_BASE_REF: "no-base-ref",
  NO_MERGE_BASE: "no-merge-base",
  NOTHING_EXAMINED: "nothing-examined",
  SHALLOW_NO_HISTORY: "shallow-no-history",
  SHALLOW_UNFETCHED: "shallow-unfetched",
  DIFF_UNREADABLE: "diff-unreadable",
  ADDED_RANGES_UNREADABLE: "added-ranges-unreadable",
  PENDING_UNLISTED: "pending-unlisted",
  PENDING_UNJUDGED: "pending-unjudged",
  READ_FROM_TREE: "read-from-tree",
  FRAMEWORKS_UNKNOWN: "frameworks-unknown",
  CAPABILITIES_UNKNOWN: "capabilities-unknown",
  HEAD_UNREADABLE: "head-unreadable",
  BASE_UNREADABLE: "base-unreadable",
  // One per cause, matching the four sentences `unreadReason` states, because
  // the reader's next move differs for each: a crash is this tool's, rejected
  // syntax is the branch's own code, and the cap is a generated file.
  HEAD_CRASHED: "head-crashed",
  HEAD_REJECTED: "head-rejected",
  HEAD_OVERSIZE: "head-oversize",
  HEAD_UNPARSED: "head-unparsed",
  BASE_UNPARSED: "base-unparsed",
  STRIPPER_MISSING: "stripper-missing",
  OBLIGATIONS_UNCHECKED: "obligations-unchecked",
  RULES_ESCAPED: "rules-escaped",
  RULES_UNLISTED: "rules-unlisted",
  RULES_UNREADABLE: "rules-unreadable",
});

/**
 * The report with every repository-controlled value neutralised: paths,
 * enclosing names, matched source text, and the sentences the run's own
 * caveats quote them in.
 *
 * A pass of its own rather than the renderer's last step, because
 * `JSON.stringify` escapes neither a bidi override nor a zero-width joiner
 * (they are category Cf), so a writer that is not the text renderer would put
 * them into a file unaltered.
 *
 * The claim is the one string left alone: it is this tool's own sentence
 * rather than a repository-controlled value, and the encoder strips the `|`
 * that "defaults are taken with ??, not ||" needs.
 */
export function encodeReport(report) {
  return {
    ...report,
    root: sanitisePath(report.root),
    base: { ...report.base, ref: report.base.ref == null ? null : encode(report.base.ref) },
    staleReason: report.staleReason == null ? null : encode(report.staleReason),
    changed: report.changed.map((row) => encodeRow(row)),
    examined: report.examined.map((row) => encodeRow(row)),
    findings: report.findings.map((f) => encodeFinding(f)),
    counts: { ...report.counts },
    caveats: report.caveats.map((c) => ({ code: c.code, message: encode(c.message) })),
    parse: { ...report.parse },
    semantic: { ...report.semantic },
    // Each of these passes one argument on purpose: `map` hands its callback
    // an index, and `sanitisePath` reads a second argument as the cap.
    foreign: report.foreign.map((name) => sanitisePath(name)),
    unknown: report.unknown.map((name) => sanitisePath(name)),
    rules: { ...report.rules, unreadable: report.rules.unreadable.map((name) => sanitisePath(name)) },
  };
}

// Sanitised rather than quoted, so a writer with a field to put a path in is
// not handed one wrapped in the quoting the text line needs.
function encodeRow(row) {
  return { ...row, path: sanitisePath(row.path), from: row.from == null ? null : sanitisePath(row.from) };
}

function encodeFinding(f) {
  return {
    ...f,
    path: sanitisePath(f.path),
    oldPath: f.oldPath == null ? null : sanitisePath(f.oldPath),
    area: f.area == null ? null : sanitisePath(f.area),
    where: f.where == null ? null : encode(f.where),
    reason: encode(f.reason),
    companion: f.companion == null ? null : sanitisePath(f.companion),
    snippet: f.snippet == null ? null : encode(f.snippet, { max: SNIPPET_CHARS }),
  };
}

/** The report as the terminal shows it. */
export function formatReport(report) {
  return renderText(encodeReport(report));
}

/** The report as the record it is, for a reader that is not a terminal. */
export function formatReportJson(report) {
  return JSON.stringify(encodeReport(report), null, 2) + "\n";
}

const ANNOTATION = { "MUST-FIX": "error", FIX: "warning", NIT: "notice" };

// The companion a producer owes is a field rather than part of the reason, so
// each writer places it: the line a human reads quotes the path, and an
// annotation carrying that line's quoting is quoting nobody asked for.
const reasonFor = (f, place) => (f.companion == null ? f.reason : `${f.reason}; no ${place(f.companion)}`);

/**
 * The report as GitHub workflow commands: one annotation per finding, on the
 * file and line it is about, then what the run could not answer, and the counts
 * as the last line.
 *
 * The counts go out even with nothing to annotate, because a job whose whole
 * output is an empty file reads as one that did not run. The caveats go out for
 * the same reason one line up: counts alone are what a run with no map, no base
 * and no readable diff prints, and that is indistinguishable from a branch that
 * broke nothing.
 */
export function formatReportGithub(report) {
  const r = encodeReport(report);
  const lines = r.findings.map((f) => {
    const props = `file=${escapeProperty(f.path)},line=${f.line},title=${escapeProperty(f.claim)}`;
    return `::${ANNOTATION[f.severity]} ${props}::${escapeMessage(reasonFor(f, (p) => p))}`;
  });
  if (r.stale) lines.push(annotation("stale", `severity capped at FIX: ${r.staleReason}`));
  for (const c of r.caveats) lines.push(annotation(c.code, c.message));
  // Counted rather than listed: the text writer names the files because a human
  // reads them one by one, and a bounded count is the whole signal to a job.
  if (r.foreign.length || r.unknown.length) {
    lines.push(
      annotation(
        "rules",
        `${r.foreign.length} file(s) in ${RULES_DIR} this tool did not write, ` +
          `${r.unknown.length} the map on disk does not name`
      )
    );
  }
  lines.push(`::notice::${r.counts["MUST-FIX"]} MUST-FIX, ${r.counts.FIX} FIX, ${r.counts.NIT} NIT`);
  return lines.join("\n") + "\n";
}

// A warning rather than a notice: every one of these is a reason the run below
// it answered for less than it was asked.
const annotation = (title, message) =>
  `::warning title=${escapeProperty(title)}::${escapeMessage(message)}`;

// The percent first, or every escape below it is escaped a second time.
const escapeMessage = (s) =>
  String(s ?? "").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

// A comma ends a property and a colon ends the property list, so a value
// carrying either would move the rest of the line into the grammar.
const escapeProperty = (s) => escapeMessage(s).replace(/,/g, "%2C").replace(/:/g, "%3A");

/** Every value here is encoded already, so nothing in this function encodes. */
function renderText(report) {
  const lines = [];
  const { base, counts } = report;
  const at = base.sha ? ` (${base.sha.slice(0, 7)})` : "";
  const n = report.changed.length;
  // Compared as sets, not as sizes. `examined` drops what is not source and
  // adds what only the working tree has, so two counts can agree while naming
  // different files, and the header then hides the file a finding is about.
  const same =
    report.examined.length === n && report.examined.every((f, i) => f.path === report.changed[i]?.path);
  const examined = same ? "" : `, ${report.examined.length} examined`;
  lines.push(
    // `||`, not `??`: an empty ref is no ref, and prints as none.
    `base ${base.ref || "none"}${at}, ` +
      `${n} changed file${n === 1 ? "" : "s"}${examined}, ${report.mode}`
  );
  lines.push(`${counts["MUST-FIX"]} MUST-FIX, ${counts.FIX} FIX, ${counts.NIT} NIT`);
  if (report.stale) {
    lines.push(`severity capped at FIX: ${report.staleReason}`);
  }
  // How far the map has moved, below the cliff that caps severity. The share
  // was measured, compared once and thrown away, so nothing was said until the
  // 25% crossing and the reader had no warning it was coming. Past the cliff
  // the line above already says it, and a floor keeps a freshly pinned
  // repository from printing 0% into every context window.
  const drift = report.drift;
  if (!report.stale && drift && drift.share >= DRIFT_FLOOR) {
    lines.push(
      `note: ${drift.changed} of ${drift.mapped} mapped files have changed since the pin ` +
        `(${Math.round(drift.share * 100)}%)`
    );
  }
  for (const c of report.caveats) lines.push(`note: ${c.message}`);
  // Rendered beside the other caveats rather than folded into them, because it
  // is about a whole class of claim rather than about one file.
  if (report.semantic?.claims) {
    const n = report.semantic.claims;
    lines.push(
      `note: ${n} type-checked claim${n === 1 ? " is" : "s are"} stated in the map and not enforced on a branch: ` +
        "the checker is whole-program, so it runs on `anatomiya scan --deep` and not here"
    );
  }

  for (const f of report.findings) {
    lines.push("");
    lines.push(`${f.severity}  ${quotePath(f.path)}:${f.line}  ${String(f.claim ?? "").replace(/\s+/g, " ").trim()}`);
    lines.push(`  ${f.where ? `${f.where}: ` : ""}${reasonFor(f, quotePath)}`);
    if (f.snippet) lines.push(`  ${f.snippet}`);
  }

  listRules(lines, report.foreign, "this tool did not write");
  // Named apart from the above, because the reader's next move differs: one is
  // somebody else's context to read, the other is this tool's own output from a
  // scan whose record is gone, and re-scanning is what clears it.
  listRules(lines, report.unknown, "the map on disk does not name");

  return lines.join("\n") + "\n";
}

/**
 * One group of rule files, bounded.
 *
 * The count is the whole signal past a handful, and this report is read by an
 * agent: a repository holding ten thousand `.md` files in `.claude/rules/`
 * would otherwise spend ten thousand lines of its context saying so.
 */
function listRules(lines, names, what) {
  if (names.length === 0) return;
  const { shown, rest } = listSome(names, LISTED.report);
  lines.push("", `${names.length} file(s) in ${RULES_DIR} ${what}:`);
  for (const name of shown) lines.push(`  ${quotePath(name)}`);
  if (rest) lines.push(`  and ${rest} more`);
}
