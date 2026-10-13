/**
 * The end-of-turn reuse check: which source lines a turn added, and the one
 * reason that asks for them to be checked against what the repository already
 * has (A91).
 *
 * The wording is the one that passed 24 of 24 hard cases where every wording
 * the model answered inline passed 9 or 10 of 12, and it is held word for word
 * because that measurement is the only reason it is here
 * (`docs/research/one-line-that-finds-the-existing-function.md`).
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

import { addedRanges, pendingPaths } from "./changeset.mjs";
import { corpusDrop, isCorpusPath } from "./corpus.mjs";
import { encodePath } from "./encode.mjs";
import { gitBuffered, operationUnfinished, Unasked } from "./git.mjs";
import { isPathTaken } from "./hook.mjs";
import { INERT_ENGINES, inertLinesOf, REUSE_PARSE_MS } from "./inert.mjs";
import { embeddedIn, engineOf, language } from "./langs.mjs";
import { MAX_FILE_BYTES } from "./limits.mjs";
import { byCode } from "./paths.mjs";
import { readHead, readTail, realpathOf } from "./rules.mjs";
import { blankOutside, scriptBlocks } from "./script-blocks.mjs";
import { sessionStartIn } from "./transcript.mjs";

/** What an ask or a record carries, so a later stop can tell which files it covered. */
export const REUSE_MARK = "anatomiya reuse check";

/** How long each git read may take, inside the timeout the hook declares. */
export const REUSE_GIT_MS = 5000;

const REASON_OPENING = "Before you finish, give one subagent this change's diff";

// The reason points at the change and the subagent reads the diff itself, so a
// long list buys nothing but tokens on every block.
const LISTED_MOST = 20;

// Enough for any turn a person would call one change, and a bound on the tag.
const MARKED_MOST = 200;

// This session's own asks sit at the end of its transcript, and its first
// entry at the start.
export const TRANSCRIPT_MOST = 64 * 1024 * 1024;
const TRANSCRIPT_HEAD = 64 * 1024;

// A turn's commits are the last lines of the reflog, and one kept for years
// runs to megabytes.
const REFLOG_TAIL = 256 * 1024;

// `<old> <new> <name> <email> <seconds> <zone>\t<message>`.
const REFLOG_ENTRY = /^([0-9a-f]+) ([0-9a-f]+) .*> (\d+) [+-]\d{4}\t(.*)$/;

// What `git commit` writes, and `--amend`, whose parent is the commit it
// replaced. `commit (initial)` and `commit (merge)` are left out on purpose.
const OWN_COMMIT = /^commit(?: \(amend\))?: /;

const MARKS_READ = new RegExp(`${REUSE_MARK} ((?:[0-9a-f]{12} ?)+)\\)`, "g");

// A migration is a numbered one-off that restates the framework's calls by
// design and that nothing calls, and a schema dump is written by the migrations.
// Only the file right under the directory: measured on the corpus, code nested
// deeper under a `migrations` segment (angular's schematics, prisma's
// `core/migrations`, openproject's `db/migrate/tables`) is ordinary library code.
export const ONE_OFF = /(^|\/)(\w+_)?(migrate|migrations)\/\d+[_-][^/]*$|(^|\/)db\/(\w+_)?schema\.rb$/;

/**
 * The script a component file holds: the lines its blocks cover, and which of
 * all its lines define nothing callable. No lines where a script never ends.
 *
 * Each block is read with the file blanked around it, since markup that opens
 * a comment would carry it into the script below.
 */
async function componentScript(engine, lang, source, kind, deadline) {
  const { blocks, unterminated } = scriptBlocks(source, kind);
  const lineAt = (offset) => source.slice(0, offset).split("\n").length;
  const spans = (unterminated ? [] : blocks).flatMap((b) => {
    const body = source.slice(b.start, b.end);
    if (body.trim() === "") return [];
    return [{ from: lineAt(b.end - body.trimStart().length), to: lineAt(b.start + body.trimEnd().length) }];
  });
  const views = await Promise.all(blocks.map((b) => inertLinesOf({ engine, lang, source: blankOutside(source, b.start, b.end), deadline })));
  return { spans, inert: views[0]?.map((_, i) => views.every((view) => view[i])) ?? [] };
}

const clipped = (hunks, spans) =>
  hunks.flatMap((h) =>
    spans.flatMap((s) => (h.from > s.to || h.to < s.from ? [] : [{ ...h, from: Math.max(h.from, s.from), to: Math.min(h.to, s.to) }]))
  );

// A name a repository chose is shown as it is only where it cannot carry a
// line break or a quote into the reason the model reads.
const PLAIN_PATH = /^[\w./@+-]+$/;

const tag = (files) => `(${REUSE_MARK} ${files.slice(0, MARKED_MOST).map((f) => f.mark).join(" ")})`;

/** The measured wording, with the lines these files added and the tag that covers them. */
export function reuseReason(files) {
  const lines = files.flatMap((f) => {
    const shown = PLAIN_PATH.test(f.path) ? f.path : encodePath(f.path);
    return f.hunks.map((h) => `${shown}:${h.from}-${h.to}${h.created ? " (new file)" : ""}`);
  });
  const more = lines.length - LISTED_MOST;
  const list = `${lines.slice(0, LISTED_MOST).join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
  return (
    `${REASON_OPENING} and these added functions: ${list}. ` +
    "Have it grep shared and utility modules, files near the change, and code making the same calls, then name any existing function that does the same job. " +
    "Call each named function and delete the copy it replaces. If it names none, finish without changing anything. " +
    // Last, so the measured wording above is unchanged where the tool exists.
    "If this session has no subagent tool, run that search yourself.\n" +
    tag(files)
  );
}

/** What the stop after a check says, which is also what keeps those files from being asked about again. */
export function reuseRecord(files) {
  return `anatomiya checked ${files.length} changed ${files.length === 1 ? "file" : "files"} for existing functions ${tag(files)}`;
}

/**
 * Each changed source file with the lines the working tree adds over HEAD, or
 * null where there are none or git would not say.
 *
 * A file's mark is taken over its content rather than its line numbers, since
 * two different edits can land on the same lines, and per file, so an edit to
 * one file does not make every other one look new. `since` leaves out a file
 * last written before that moment, and `calls` one last written outside every
 * one of the session's tool calls: either is work the session did not do.
 * Nothing is read while a merge or the like is unfinished, which is another
 * branch's. A migration, a schema dump and a file the corpus refuses
 * (generated, or a link) have no function anybody would reuse, and are left
 * out, and so is a hunk whose every added line provably defines nothing
 * callable.
 *
 * `parsing` holds the deadline every file a rule reads in the stop shares, set
 * at the first one: the hook reads every checkout of a stop against one budget.
 *
 * `turnStart` adds what this turn committed: a turn told to write and commit
 * leaves the tree clean, and read against HEAD alone its work was never asked
 * about. The commits are found in the reflog rather than in state this writes,
 * since a marker file would be one more change `git status` reports (A91).
 */
export async function pendingChange(root, { since = null, turnStart = null, calls = null, parsing = { deadline: null } } = {}) {
  // git names every path from the top of the checkout, which is where a scan
  // writes its record. A record further down came with a copy of another
  // project, and joined against it git's paths name files nobody changed.
  if (!isPathTaken(join(root, ".git"))) return null;
  // Asked beside the status read rather than after it, so the hook still makes
  // two git reads in a row inside the time it declares. The corpus's own
  // refusals past the path are asked the way `check` asks them: a generated
  // file or a link holds nothing anybody wrote here by hand.
  const [pending, gitdir, dropOf] = await Promise.all([
    pendingPaths(root, { timeout: REUSE_GIT_MS }),
    gitDir(root),
    // The hook reads every checkout of a stop together: one whose attributes git could not be asked for
    // asks nothing, as one whose status git would not give does, and the others are still read.
    corpusDrop(root, { timeout: REUSE_GIT_MS }).catch((err) => {
      if (err instanceof Unasked) return null;
      throw err;
    }),
  ]);
  if (gitdir === null || operationUnfinished(gitdir) || pending === null || dropOf === null) return null;
  // One diff from before the turn's first commit to the tree reads what it
  // committed and what it left uncommitted together, so the reads in a row
  // stay two however many commits the turn made.
  const base = turnStart === null ? null : await committedSince(root, gitdir, turnStart, calls);
  if (pending.present.length === 0 && base === null) return null;
  const edited = base !== null || pending.present.some((p) => p.status === "M");
  const ranges = edited ? await addedRanges(root, base ?? "HEAD", null, { timeout: REUSE_GIT_MS }) : new Map();
  if (ranges === null) return null;

  // A committed file is in the diff and nowhere in the status, and reads as an
  // edit: its hunks are the lines it added over the turn's base.
  const listed = new Set(pending.present.map((p) => p.path));
  const committed = [...ranges.keys()].filter((path) => !listed.has(path) && isCorpusPath(path));
  const changed = [...pending.present, ...committed.map((path) => ({ path, status: "M" }))];
  const home = realpathOf(root);
  const files = [];
  for (const { path, status } of changed.sort((a, b) => byCode(a.path, b.path))) {
    if (ONE_OFF.test(path) || dropOf(path) !== null) continue;
    // An engine with no rule cannot tell a function from a comment, so its files ask nothing.
    const lang = language(path);
    const engine = engineOf(lang);
    if (!INERT_ENGINES.includes(engine)) continue;
    const entry = readHead(join(root, path), MAX_FILE_BYTES + 1);
    // Past the size the parser skips, or not a file: nothing this reads either.
    if (entry.kind !== "file" || entry.size > MAX_FILE_BYTES) continue;
    if (since !== null && entry.mtimeMs < since) continue;
    if (calls !== null && !inCall(calls, entry.mtimeMs)) continue;
    const added =
      status === "A"
        ? [{ from: 1, to: lineCount(entry.head), created: true }].filter((h) => h.to > 0)
        : (ranges.get(path) ?? []).map(([from, to]) => ({ from, to, created: false }));
    const kind = embeddedIn(lang);
    parsing.deadline ??= performance.now() + REUSE_PARSE_MS;
    const script = kind === null ? null : await componentScript(engine, lang, entry.head, kind, parsing.deadline);
    const hunks = script === null ? added : clipped(added, script.spans);
    const inert = script === null ? await inertLinesOf({ engine, lang, source: entry.head, deadline: parsing.deadline }) : script.inert;
    // A missing runtime or grammar reads nothing, and a file nothing read asks nothing.
    if (inert === null) continue;
    // A line past the end of what was read is one nobody read, so its hunk asks.
    const read = lineCount(entry.head);
    const defining = hunks.filter((h) => h.to > read || !inert.slice(h.from - 1, h.to).every(Boolean));
    if (defining.length === 0) continue;
    // Over the checkout too: a sibling repository's copy of a file is another file.
    const mark = createHash("sha256").update(`${home}\0${path}\0`).update(entry.head).digest("hex").slice(0, 12);
    files.push({ path, mark, hunks: defining });
  }
  return files.length > 0 ? files : null;
}

/**
 * This checkout's git directory, or null where git will not name one.
 *
 * It says whether a merge, a pick, a revert or a rebase is waiting to be
 * finished, and it holds the reflog. A git directory nobody can name asks
 * nothing: the status read beside this one fails the same way.
 */
async function gitDir(root) {
  const r = await gitBuffered(root, ["rev-parse", "--absolute-git-dir"], { timeout: REUSE_GIT_MS });
  const dir = r.ok ? r.stdout.trim() : "";
  return dir === "" ? null : dir;
}

/**
 * The commit this turn's own commits were made on top of, or null where the
 * turn committed nothing it can be charged with.
 *
 * `logs/HEAD` records every move of HEAD with the second it happened. Only the
 * commits made after the turn's last checkout, pull, reset, merge or rebase
 * are its own, since each of those brings in work nobody in this session
 * wrote. A first commit has no parent to diff from and a merge commit holds
 * the other side's work, so either ends the run the way a move does, and so
 * does a commit made outside every tool call of the session's, which the
 * reflog cannot tell from one another session made.
 *
 * Read off the file where there is one, which costs no git read. The reftable
 * backend keeps no `logs/`, and there the same entries are asked of git: read
 * off the file alone, a turn that committed everything it wrote was never
 * asked about on reftable.
 */
async function committedSince(root, gitdir, turnStart, calls) {
  const entries = headMoves(gitdir) ?? (await headMovesFromGit(root));
  if (entries === null) return null;
  let run = null;
  for (const { from, to, seconds, message } of entries) {
    // A second the reflog recorded is the turn's if any part of it is.
    if ((seconds + 1) * 1000 <= turnStart) continue;
    if (!OWN_COMMIT.test(message) || (calls !== null && !inCall(calls, seconds * 1000))) run = null;
    else if (from === null || run === null || run.to !== from) run = from === null ? null : { from, to };
    else run.to = to;
  }
  return run === null ? null : run.from;
}

/** HEAD's moves, oldest first, off `logs/HEAD`; null where there is no such file. */
function headMoves(gitdir) {
  const log = readTail(join(gitdir, "logs", "HEAD"), REFLOG_TAIL);
  if (log === null) return null;
  const moves = [];
  for (const line of log.split("\n")) {
    const entry = REFLOG_ENTRY.exec(line);
    if (entry !== null) moves.push({ from: entry[1], to: entry[2], seconds: Number(entry[3]), message: entry[4] });
  }
  return moves;
}

// How far back git is asked, where there is no file to read the tail of. A
// turn's commits are the newest entries.
const REFLOG_ASKED = 256;

/**
 * The same moves asked of git, oldest first. Git names each entry's new commit
 * and not the one it moved from, which is the entry before it; the oldest one
 * asked has no such entry and cannot start a run.
 */
async function headMovesFromGit(root) {
  const r = await gitBuffered(
    root,
    ["log", "-g", `--max-count=${REFLOG_ASKED}`, "--date=unix", "--format=%H %gd %gs", "HEAD"],
    { timeout: REUSE_GIT_MS }
  );
  if (!r.ok) return null;
  const moves = [];
  for (const line of r.stdout.split("\n").reverse()) {
    const entry = /^([0-9a-f]+) [^@]*@\{(\d+)\} (.*)$/.exec(line);
    if (entry === null) continue;
    moves.push({ from: moves.at(-1)?.to ?? null, to: entry[1], seconds: Number(entry[2]), message: entry[3] });
  }
  return moves;
}

const lineCount = (text) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

/** When this session's transcript began, off its head (`sessionStartIn`), or null where it cannot be read. */
export function sessionStart(transcriptPath) {
  if (typeof transcriptPath !== "string" || transcriptPath === "") return null;
  const entry = readHead(transcriptPath, TRANSCRIPT_HEAD);
  return entry.kind === "file" ? sessionStartIn(entry.head) : null;
}

/**
 * Whether a moment falls inside one of the session's calls, widened a second
 * each side: some filesystems and the reflog keep whole seconds.
 */
const inCall = (calls, ms) => calls.some((c) => c.from - 1000 <= ms && ms <= c.to + 1000);

/**
 * The marks a transcript's tail already holds, from an ask or a record.
 *
 * Anything but text, which is what an unreadable transcript's tail is, holds
 * none: the worst that costs is one more search, where a mark read that was
 * never there would skip a file nobody checked.
 */
export function askedMarksIn(tail) {
  const marks = new Set();
  if (typeof tail !== "string") return marks;
  for (const [, list] of tail.matchAll(MARKS_READ)) {
    for (const mark of list.trim().split(" ")) marks.add(mark);
  }
  return marks;
}

/**
 * Whether the last block a transcript's tail holds at a stop was this hook's own.
 *
 * `stop_hook_active` says some hook continued the turn, not which one, and
 * recording after another hook's block would mark a file checked that no search
 * read.
 */
export function continuedByReuseIn(tail) {
  if (typeof tail !== "string") return false;
  const last = tail.lastIndexOf("Stop hook feedback:");
  return last !== -1 && tail.indexOf(REASON_OPENING, last) !== -1;
}
