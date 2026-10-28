/**
 * The end-of-turn reuse check: which source lines a turn added, and the one
 * reason that asks for them to be checked against what the repository already
 * has (A91).
 *
 * Its shape, one subagent handed the diff, is the one that passed 24 of 24 hard
 * cases where every wording the model answered inline passed 9 or 10 of 12
 * (`docs/research/one-line-that-finds-the-existing-function.md`). What it asks
 * of a function that does part of the job or falls short came from the misses of
 * the reuse tasks (A123); the repository's own before a package's, and the
 * search a session with no subagent tool runs itself, were never measured apart.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { addedRanges, pendingPaths } from "./changeset.mjs";
import { corpusDrop, isCorpusPath } from "./corpus.mjs";
import { encodePath } from "./encode.mjs";
import { ask, operationUnfinished, unaskedAs, Unasked } from "./git.mjs";
import { isPathTaken } from "./hook.mjs";
import { indexHome } from "./index-home.mjs";
import { INERT_ENGINES, inertLinesOf, REUSE_PARSE_MS } from "./inert.mjs";
import { embeddedIn, engineOf, language } from "./langs.mjs";
import { MAX_FILE_BYTES } from "./limits.mjs";
import { byCode } from "./paths.mjs";
import { readHead, readTail, realpathOf } from "./rules.mjs";
import { blankOutside, scriptBlocks } from "./script-blocks.mjs";
import { markupCodeLines, templateInertLines, templateOf } from "./templates.mjs";
import { finishedCallOf, parsed, sessionStartIn } from "./transcript.mjs";

/** What an ask or a record carries, so a later stop can tell which files it covered. */
export const REUSE_MARK = "anatomiya reuse check";

/** How long one stop's git reads may take together, inside the timeout the hook declares. */
export const REUSE_GIT_MS = 10_000;

// What is left of the stop's git time; a read is asked only while some is, since a timeout of 0 is none.
const leftOf = (gitBy) => Math.ceil(gitBy - performance.now());

const REASON_OPENING = "Before you finish, give one subagent this change's diff";
// How the transcript records a Stop hook's block reason.
const FEEDBACK = "Stop hook feedback:";

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

/** Whether a changed path is one the check reads: source the corpus counts, or a view template. */
const asked = (path) => isCorpusPath(path) || templateOf(path) !== null;

/**
 * The code a component file holds: the lines its script blocks cover and the
 * markup lines whose expression computes inline (`markupCodeLines`), and which
 * of all its lines define nothing callable. No lines where a script never ends.
 *
 * Each block is read with the file blanked around it, since markup that opens
 * a comment would carry it into the script below.
 */
async function componentScript(engine, lang, source, kind, deadline) {
  const { blocks, unterminated } = scriptBlocks(source, kind);
  if (unterminated) return { spans: [], inert: [] };
  const lineAt = (offset) => source.slice(0, offset).split("\n").length;
  const spans = blocks.flatMap((b) => {
    const body = source.slice(b.start, b.end);
    if (body.trim() === "") return [];
    return [{ from: lineAt(b.end - body.trimStart().length), to: lineAt(b.start + body.trimEnd().length) }];
  });
  const views = await Promise.all(blocks.map((b) => inertLinesOf({ engine, lang, source: blankOutside(source, b.start, b.end), deadline })));
  const markup = markupCodeLines(kind, source, deadline);
  const inert = markup.map((asks, i) => !asks && views.every((view) => view[i] !== false));
  const computed = markup.flatMap((asks, i) => (asks ? [{ from: i + 1, to: i + 1 }] : []));
  return { spans: [...spans, ...computed], inert };
}

/** The parts of `hunks` that `spans` cover, one hunk per run of lines however many spans meet in it. */
function clipped(hunks, spans) {
  const parts = hunks
    .flatMap((h) => spans.flatMap((s) => (h.from > s.to || h.to < s.from ? [] : [{ ...h, from: Math.max(h.from, s.from), to: Math.min(h.to, s.to) }])))
    .sort((a, b) => a.from - b.from);
  const runs = [];
  for (const part of parts) {
    const last = runs.at(-1);
    if (last !== undefined && part.from <= last.to + 1) last.to = Math.max(last.to, part.to);
    else runs.push({ ...part });
  }
  return runs;
}

// A name a repository chose is shown as it is only where it cannot carry a
// line break or a quote into the reason the model reads.
const PLAIN_PATH = /^[\w./@+-]+$/;

const tag = (files) => `(${REUSE_MARK} ${files.slice(0, MARKED_MOST).map((f) => f.mark).join(" ")})`;

// The bin this hook runs from, which is the copy whose `find` reads the index this scan's build wrote.
const BIN = fileURLToPath(new URL("../bin/anatomiya.mjs", import.meta.url));
// A UNC path's leading `\\` is one backslash to a shell, so it is not.
const QUOTABLE = /^(?!\\\\)[\w ./@+:\\-]+$/;

/** Whether a shell reads a path inside double quotes back as itself. */
export const quotable = (path) => QUOTABLE.test(path);

/**
 * The command that asks this checkout's code index, or null where no scan wrote
 * one or the path to the bin could not be quoted safely.
 */
export function finderFor(root) {
  if (!quotable(BIN) || indexHome(root) === null) return null;
  // One single-quoted argument, so a shell globs none of the words: `local_url?` is a pattern to zsh.
  return `node "${BIN}" find '<words>'`;
}

/**
 * The measured wording, with the lines these files added and the tag that covers them.
 * `finder` is the command that asks the code index, which takes the grep's place where there is one.
 */
export function reuseReason(files, { finder = null } = {}) {
  const lines = files.flatMap((f) => {
    const shown = PLAIN_PATH.test(f.path) ? f.path : encodePath(f.path);
    return f.hunks.map((h) => `${shown}:${h.from}-${h.to}${h.created ? " (new file)" : ""}`);
  });
  const more = lines.length - LISTED_MOST;
  const list = `${lines.slice(0, LISTED_MOST).join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
  return (
    `${REASON_OPENING} and these added functions: ${list}. ` +
    // Where the scan indexed the repository, the index is the search and grep is left the calls it cannot name:
    // told to do both, a subagent did both, and the turn cost more for the same hits.
    (finder === null
      ? "Have it grep shared and utility modules, files near the change, and code making the same calls, "
      : `Have it run \`${finder}\` in the repository, two or three words with no quote mark for what each added function does, at most three calls, which lists the closest functions by name, doc and path with how many files import each; have it grep only for code making the same calls, `) +
    "then name every existing function that does the same job or part of it. " +
    "For each added function, call the closest one it names, the repository's own before a package's, and delete the copy it replaces. Where one does part of the job, call it for that part. " +
    // A session that named the helper kept a copy where it fell short on one case (A123).
    "Where one falls short on a case this change needs, make the new code fit it, or extend it without changing what it returns to its current callers, and call it. " +
    "If it names none, finish without changing anything. " +
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
export async function pendingChange(root, { since = null, turnStart = null, calls = null, parsing = { deadline: null }, gitBy = performance.now() + REUSE_GIT_MS } = {}) {
  // git names every path from the top of the checkout, which is where a scan
  // writes its record. A record further down came with a copy of another
  // project, and joined against it git's paths name files nobody changed.
  if (!isPathTaken(join(root, ".git"))) return null;
  // Asked beside the status read rather than after it, so fewer reads run in a
  // row against the stop's one deadline. The corpus's own refusals past the
  // path are asked the way `check` asks them: a generated file or a link holds
  // nothing anybody wrote here by hand.
  const timeout = leftOf(gitBy);
  if (timeout <= 0) return null;
  const [pending, gitdir, dropOf] = await Promise.all([
    pendingPaths(root, { timeout, keep: asked }),
    gitDir(root, timeout),
    // The hook reads every checkout of a stop together: one whose attributes git could not be asked for
    // asks nothing, as one whose status git would not give does, and the others are still read.
    corpusDrop(root, { timeout, readAlso: (path) => templateOf(path) !== null }).catch((err) => {
      if (err instanceof Unasked) return null;
      throw err;
    }),
  ]);
  if (gitdir === null || operationUnfinished(gitdir) || pending === null || dropOf === null) return null;
  // One diff from before the turn's first commit to the tree reads what it
  // committed and what it left uncommitted together, so the reads in a row
  // stay two however many commits the turn made.
  const base = turnStart === null ? null : await committedSince(root, gitdir, turnStart, calls, gitBy);
  if (pending.present.length === 0 && base === null) return null;
  const edited = base !== null || pending.present.some((p) => p.status === "M");
  const left = leftOf(gitBy);
  if (edited && left <= 0) return null;
  const ranges = edited ? await addedRanges(root, base ?? "HEAD", null, { timeout: left }) : new Map();
  if (ranges === null) return null;

  // A committed file is in the diff and nowhere in the status, and reads as an
  // edit: its hunks are the lines it added over the turn's base.
  const listed = new Set(pending.present.map((p) => p.path));
  const committed = [...ranges.keys()].filter((path) => !listed.has(path) && asked(path));
  const changed = [...pending.present, ...committed.map((path) => ({ path, status: "M" }))];
  const home = realpathOf(root);
  const files = [];
  for (const { path, status } of changed.sort((a, b) => byCode(a.path, b.path))) {
    if (ONE_OFF.test(path) || dropOf(path) !== null) continue;
    const template = templateOf(path);
    // An engine with no rule cannot tell a function from a comment, so its files ask nothing.
    const lang = template === null ? language(path) : null;
    const engine = lang === null ? null : engineOf(lang);
    if (template === null && !INERT_ENGINES.includes(engine)) continue;
    const entry = readHead(join(root, path), MAX_FILE_BYTES + 1);
    // Past the size the parser skips, or not a file: nothing this reads either.
    if (entry.kind !== "file" || entry.size > MAX_FILE_BYTES) continue;
    if (since !== null && entry.mtimeMs < since) continue;
    if (calls !== null && !inCall(calls, entry.mtimeMs)) continue;
    const added =
      status === "A"
        ? [{ from: 1, to: lineCount(entry.head), created: true }].filter((h) => h.to > 0)
        : (ranges.get(path) ?? []).map(([from, to]) => ({ from, to, created: false }));
    const kind = lang === null ? null : embeddedIn(lang);
    parsing.deadline ??= performance.now() + REUSE_PARSE_MS;
    const script = kind === null ? null : await componentScript(engine, lang, entry.head, kind, parsing.deadline);
    const hunks = script === null ? added : clipped(added, script.spans);
    const inert =
      template !== null
        ? templateInertLines(template, entry.head, parsing.deadline)
        : script === null
          ? await inertLinesOf({ engine, lang, source: entry.head, deadline: parsing.deadline, path })
          : script.inert;
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
async function gitDir(root, timeout) {
  const r = await ask(root, ["rev-parse", "--absolute-git-dir"], "where this checkout's git directory is", { timeout }).catch(unaskedAs(null));
  const dir = r?.code === 0 ? r.stdout.trim() : "";
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
async function committedSince(root, gitdir, turnStart, calls, gitBy) {
  const entries = headMoves(gitdir) ?? (await headMovesFromGit(root, gitBy));
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
async function headMovesFromGit(root, gitBy) {
  // No moves read, so no commit is charged to the turn.
  const timeout = leftOf(gitBy);
  if (timeout <= 0) return null;
  const r = await ask(
    root,
    ["log", "-g", `--max-count=${REFLOG_ASKED}`, "--date=unix", "--format=%H %gd %gs", "HEAD"],
    "how HEAD moved lately",
    { timeout }
  ).catch(unaskedAs(null));
  if (r?.code !== 0) return null;
  const moves = [];
  for (const line of r.stdout.split("\n").reverse()) {
    const entry = /^([0-9a-f]+) [^@]*@\{(\d+)\} (.*)$/.exec(line);
    if (entry === null) continue;
    moves.push({ from: moves.at(-1)?.to ?? null, to: entry[1], seconds: Number(entry[2]), message: entry[3] });
  }
  return moves;
}

const lineCount = (text) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

/**
 * When this session's transcript began, off its head (`sessionStartIn`), or null where it cannot be read.
 *
 * The head grows until it holds a stamp: the first stamped record can be an instructions attachment
 * holding every CLAUDE.md and rules file, measured at 167,656 bytes, with its stamp past the first 64 KiB.
 */
export function sessionStart(transcriptPath) {
  if (typeof transcriptPath !== "string" || transcriptPath === "") return null;
  for (let bytes = TRANSCRIPT_HEAD; ; bytes *= 4) {
    const entry = readHead(transcriptPath, bytes);
    if (entry.kind !== "file") return null;
    const at = sessionStartIn(entry.head);
    if (at !== null || entry.size <= bytes || bytes >= TRANSCRIPT_MOST) return at;
  }
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
  const last = tail.lastIndexOf(FEEDBACK);
  return last !== -1 && tail.indexOf(REASON_OPENING, last) !== -1;
}

/**
 * Whether the turn a stop ends was opened by the result of a subagent launched
 * after this hook's last ask: a search run in the background returns as a task
 * notification, a turn of its own, and what that turn writes is the check's own
 * fix, which the stop records as the stop right after a block does.
 */
export function resumedByReuseIn(tail) {
  if (typeof tail !== "string") return false;
  // The last ask's line, found from the end, so only what follows it is split: the tail runs to 64 MiB.
  let at = tail.length;
  let start = -1;
  // Past a match at the very start there is nothing before it; a search from -1 finds that one again.
  while (start === -1 && at > 0 && (at = tail.lastIndexOf(FEEDBACK, at - 1)) !== -1) {
    const from = tail.lastIndexOf("\n", at) + 1;
    const to = tail.indexOf("\n", at);
    if (tail.slice(from, to === -1 ? tail.length : to).includes(REASON_OPENING)) start = from;
  }
  if (start === -1) return false;
  // The call each entry that opens a turn after the ask reports finished, or null for a person's prompt.
  const opened = [];
  const launched = new Set();
  for (const line of tail.slice(start).split("\n").slice(1)) {
    if (!line.includes("\"user\"") && !line.includes("tool_use") && !line.includes("queued_command")) continue;
    const entry = parsed(line);
    const content = entry?.message?.content;
    if (entry?.type === "assistant") {
      // The subagent tool was `Task` before `Agent`.
      for (const part of Array.isArray(content) ? content : []) if (part?.type === "tool_use" && (part.name === "Agent" || part.name === "Task")) launched.add(part.id);
      continue;
    }
    // A message that arrives while the session works is queued, not a user entry: a prompt asks again, and the
    // check's own result answers it; any other call's result opens nothing.
    if (entry?.type === "attachment" && entry.attachment?.type === "queued_command") {
      const prompt = typeof entry.attachment.prompt === "string" ? entry.attachment.prompt : "";
      const id = finishedCallOf(prompt);
      // A notification that names no call, a forked skill's or a resumed agent's, is no person speaking.
      if (id === null ? !prompt.trimStart().startsWith("<task-notification>") : launched.has(id)) opened.push(id);
      continue;
    }
    if (entry?.type !== "user" || entry.isMeta === true) continue;
    if (Array.isArray(content) && content.some((part) => part?.type === "tool_result")) continue;
    const text = typeof content === "string" ? content : (Array.isArray(content) ? content : []).map((part) => part?.text ?? "").join("\n");
    opened.push(finishedCallOf(text));
  }
  const last = opened.at(-1) ?? null;
  return last !== null && launched.has(last) && !opened.includes(null);
}
