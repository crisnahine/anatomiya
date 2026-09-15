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
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { addedRanges, pendingPaths } from "./check.mjs";
import { encodePath } from "./encode.mjs";
import { MAX_FILE_BYTES } from "./limits.mjs";
import { byCode } from "./paths.mjs";
import { readHead } from "./rules.mjs";

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
const TRANSCRIPT_MOST = 64 * 1024 * 1024;
const TRANSCRIPT_HEAD = 64 * 1024;

const MARKS_READ = new RegExp(`${REUSE_MARK} ((?:[0-9a-f]{12} ?)+)\\)`, "g");

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
    "Call each named function and delete the copy it replaces. If it names none, finish without changing anything.\n" +
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
 * last written before that moment, which is work the session did not do.
 */
export async function pendingChange(root, { since = null } = {}) {
  const pending = await pendingPaths(root, { timeout: REUSE_GIT_MS });
  if (pending === null || pending.present.length === 0) return null;
  const edited = pending.present.some((p) => p.status === "M");
  const ranges = edited ? await addedRanges(root, "HEAD", null, { timeout: REUSE_GIT_MS }) : new Map();
  if (ranges === null) return null;

  const files = [];
  for (const { path, status } of [...pending.present].sort((a, b) => byCode(a.path, b.path))) {
    const entry = readHead(join(root, path), MAX_FILE_BYTES + 1);
    // Past the size the parser skips, or not a file: nothing this reads either.
    if (entry.kind !== "file" || Buffer.byteLength(entry.head) > MAX_FILE_BYTES) continue;
    if (since !== null && entry.mtimeMs < since) continue;
    const hunks =
      status === "A"
        ? [{ from: 1, to: lineCount(entry.head), created: true }].filter((h) => h.to > 0)
        : (ranges.get(path) ?? []).map(([from, to]) => ({ from, to, created: false }));
    if (hunks.length === 0) continue;
    const mark = createHash("sha256").update(`${path}\0`).update(entry.head).digest("hex").slice(0, 12);
    files.push({ path, mark, hunks });
  }
  return files.length > 0 ? files : null;
}

const lineCount = (text) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

/**
 * The moment this session's transcript began, or null where it cannot be read.
 *
 * Its first entry carrying a timestamp, which 2.1.272 writes before the first
 * prompt is answered.
 */
export function sessionStart(transcriptPath) {
  if (typeof transcriptPath !== "string" || transcriptPath === "") return null;
  const entry = readHead(transcriptPath, TRANSCRIPT_HEAD);
  if (entry.kind !== "file") return null;
  for (const line of entry.head.split("\n")) {
    const at = /"timestamp":"([^"]+)"/.exec(line);
    const ms = at ? Date.parse(at[1]) : NaN;
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/**
 * The marks this session's transcript already holds, from an ask or a record.
 *
 * A transcript that cannot be read holds none: the worst that costs is one more
 * search, where a mark read that was never there would skip a file nobody checked.
 */
export function askedMarks(transcriptPath) {
  const marks = new Set();
  const tail = readTail(transcriptPath);
  if (tail === null) return marks;
  for (const [, list] of tail.matchAll(MARKS_READ)) {
    for (const mark of list.trim().split(" ")) marks.add(mark);
  }
  return marks;
}

/**
 * Whether the last block this session saw at a stop was this hook's own.
 *
 * `stop_hook_active` says some hook continued the turn, not which one, and
 * recording after another hook's block would mark a file checked that no search
 * read.
 */
export function continuedByReuse(transcriptPath) {
  const tail = readTail(transcriptPath);
  if (tail === null) return false;
  const last = tail.lastIndexOf("Stop hook feedback:");
  return last !== -1 && tail.indexOf(REASON_OPENING, last) !== -1;
}

/** The last bytes of a regular file, typed on the handle they are read from, or null. */
function readTail(path) {
  if (typeof path !== "string" || path === "") return null;
  let fd;
  try {
    // The same open `readHead` makes, for its reason: a fifo would block a plain
    // open, and a stat of the path before opening it types a different file.
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;
    const want = Math.min(TRANSCRIPT_MOST, stat.size);
    const buf = Buffer.alloc(want);
    const read = readSync(fd, buf, 0, want, stat.size - want);
    return buf.subarray(0, read).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
