/**
 * Whether the echo delivers the map on this call: once per 192 KiB of what the
 * model reads, and once per parallel batch of calls (A92).
 *
 * `echoContext` builds what a call delivers, the map under its stamp and its
 * digest, and `echoDue` decides from the digest, the window's transcript and the
 * plugin's data directory alone, so the replay over kept transcripts walks the
 * window the way a call does.
 */
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import { locator } from "./encode.mjs";
import { refreshRecord } from "./facts.mjs";
import { ownMap } from "./hook.mjs";
import { namesIn, readHead, RULES_DIR } from "./rules.mjs";
import { createdAlone, mtimeAge, takeDeadLock } from "./lock.mjs";
import { atomic, quietUnlink } from "./store.mjs";
import { echoEventOf, parsed, transcriptTail, windowBytes } from "./transcript.mjs";

/** How far back a delivery still counts, in bytes the model reads: about 29.9k tokens at the 6.57 per token measured on 2.1.292 to 2.1.296, A92's distance. */
export const ECHO_WINDOW_BYTES = 192 * 1024;

/**
 * How much transcript is read to find a window's worth of those records.
 * Records that count for nothing take room in it too, one prompt snapshot
 * 78,191 bytes. Past it the window counts as run out.
 */
export const ECHO_READ_MOST = 1024 * 1024;

// A batch claim this old is no batch's: its delivery has reached the transcript.
const BATCH_CLAIM_KEPT_MS = 24 * 60 * 60 * 1000;
// A batch claim, its temp file as this build and an older one name it, its lock, a lock token, or a
// token's own token: nothing breaks that one, so a call killed holding it left the lock unbreakable until
// this takes it.
const ECHO_FILE_NAME = /^[0-9a-f]{16}-[0-9a-f]{12}(\.\d+|\.tmp-\d+-[0-9a-f]{16}|\.lock(\.\d+){0,2})?$/;
const BATCH_CLAIMS_LISTED_MOST = 4096;

/**
 * Whether this call delivers the map whose digest is `digest`: true unless the
 * window at `transcript` holds a delivery of it, or a sibling in this call's
 * batch has claimed the delivery under `data`. Anything unreadable delivers.
 */
export function echoDue({ digest, transcript, data }) {
  const tail = transcriptTail(transcript, ECHO_READ_MOST);
  const mark = `digest="${digest}"`;
  const isOurs = (text) => text.includes(mark);
  if (heldIn(tail, isOurs)) return false;
  return batchClaimed(batchClaimPath(data, transcript, digest), transcript, tail, isOurs);
}

/**
 * Whether the window holds a delivery `isOurs` accepts with no compaction
 * after it, or a batch claim at offset `batchClaimAt` that stands in for one
 * not written yet. Only the records after the delivery count toward `window`.
 */
export function heldIn(tail, isOurs, { batchClaimAt = null, window = ECHO_WINDOW_BYTES } = {}) {
  if (tail === null) return false;
  const lines = tail.lines();
  let end = tail.end;
  let counted = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (batchClaimAt !== null && end <= batchClaimAt) return true;
    const bytes = Buffer.byteLength(lines[i]) + (i < lines.length - 1 ? 1 : 0);
    end -= bytes;
    const entry = parsed(lines[i]);
    const event = echoEventOf(entry);
    if (event === "compact") return false;
    if (event?.some(isOurs)) return true;
    counted += windowBytes(lines[i], entry);
    if (counted > window) return false;
  }
  return batchClaimAt !== null && end <= batchClaimAt;
}

/** Where this window's batch claim on this map is kept, or null where the plugin names no data directory. */
function batchClaimPath(data, transcript, digest) {
  if (typeof data !== "string" || !isAbsolute(data) || typeof transcript !== "string") return null;
  return join(data, "echo", `${createHash("sha256").update(transcript).digest("hex").slice(0, 16)}-${digest}`);
}

/** A hook is killed at its 5 s timeout (hooks.json), so this is the longest a live call holds the lock. */
export const LOCK_HELD_MOST_MS = 5000;

// FAT keeps a file's mtime to 2 s, so a live lock can read that much older or newer than it is.
const LOCK_MTIME_SLACK_MS = 2000;

/**
 * Whether this call is the one in its batch that delivers.
 *
 * The calls of a parallel batch run their hooks before any of their records
 * reach the transcript, so each would read the window as empty. The batch
 * claim names the transcript offset its maker read up to, and the others read
 * it as a delivery made there, so it keeps them silent only while that offset is
 * inside the window, judged against the transcript as it is when the batch
 * claim is read. The decision is taken under a lock made with an exclusive
 * create, and a call that finds the lock taken stays silent; the batch claim is
 * replaced by a rename, so no reader sees it half written. Anything that
 * cannot be written or read answers as the transcript alone does.
 */
function batchClaimed(path, transcript, tail, isOurs) {
  if (path === null || tail === null) return true;
  const lock = `${path}.lock`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (!takeLock(lock)) return false;
  } catch {
    return true;
  }
  try {
    const entry = readHead(path, 32);
    const at = entry.kind === "file" && /^\d+\n$/.test(entry.head) ? Number(entry.head) : null;
    // A sibling's batch claim may sit past what this call read; only past the transcript as it is now is stale.
    const now = at !== null && at > tail.end ? (transcriptTail(transcript, ECHO_READ_MOST) ?? tail) : tail;
    if (at !== null && at <= now.end && heldIn(now, isOurs, { batchClaimAt: at })) return false;
    atomic(path, `${now.end}\n`);
  } catch {
    return true;
  } finally {
    // Gone already where a call read it as stale. A holder suspended past the dead-lock age removes whichever
    // lock is there now, and a check before it would only narrow that window.
    quietUnlink(lock);
  }
  sweep(dirname(path), path);
  return true;
}

/**
 * Takes the lock, breaking it once where it outlived any hook; false where another call holds it.
 *
 * A lock whose mtime is within the dead-lock age of the clock, either way, is never broken; a dead one is
 * broken by the call holding the lock token named by its mtime (`takeDeadLock`).
 */
function takeLock(lock) {
  return createdAlone(lock) || takeDeadLock(lock, mtimeAge({ heldMostMs: LOCK_HELD_MOST_MS, slackMs: LOCK_MTIME_SLACK_MS }));
}

/**
 * Takes out batch claims, their temp files, locks, lock tokens and a token's own token older than a day,
 * so they stay bounded however many sessions run.
 */
function sweep(dir, kept) {
  const before = Date.now() - BATCH_CLAIM_KEPT_MS;
  for (const name of namesIn(dir, BATCH_CLAIMS_LISTED_MOST)) {
    const path = join(dir, name);
    if (path === kept || !ECHO_FILE_NAME.test(name)) continue;
    try {
      if (lstatSync(path).mtimeMs < before) unlinkSync(path);
    } catch {
      // Gone already, or not ours to read.
    }
  }
}

/**
 * The map as a hook would deliver it, or null where there is none to deliver or
 * the session's context window already holds this same map (A92).
 *
 * Null rather than a note about the absence: a repository nobody has scanned is
 * the ordinary case, and saying so on every tool call is worse than silence.
 */
export function echoContext(root, { now = new Date(), transcript = null, data = null } = {}) {
  const found = ownMap(root);
  if (found === null) return null;

  // The frontmatter is how the file is delivered, not what it says. A leading
  // BOM and CRLF are both read, the way `isOwned` reads them one module over:
  // a map re-saved on Windows carries both, and a strip that misses them puts
  // `generator: anatomiya` into the echoed body as if it were content.
  const body = found.map.replace(/^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, "").trim();
  if (body === "") return null;

  // Where the counts came from is part of what was delivered, so a worktree
  // scanned after it borrowed hears its own stamp even when the body matches.
  const hash = createHash("sha256").update(body);
  if (found.from !== null) hash.update(`\0${found.from}`);
  // A failed refresh changes what the delivery says, so a window holding the
  // healthy map hears it again. Only the flag is read: the error text is the
  // repository's own and never reaches the context.
  const failed = refreshFailed(found.from ?? found.root);
  if (failed) hash.update("\0refresh-failed");
  const digest = hash.digest("hex").slice(0, 12);
  if (!echoDue({ digest, transcript, data })) return null;

  // The remedy is the plugin's own command, which is the one spelling a model
  // can run: the binary is `anatomiya.mjs` under a directory only the plugin
  // loader knows, and a bare `anatomiya` is on nobody's PATH. Both stamps name
  // where the counts came from, because a call about another checkout's file
  // is answered from that checkout's map (H40), and a session holding two
  // maps that each said only "this repository" could not tell them apart. The
  // digest stays the body's: two maps with one body state the same things.
  const stamp =
    found.from === null
      ? [
          `Counted from this repository's own code at ${locator(found.root)} and re-read just now.`,
          "Where this and the code disagree, the code is right and the map is stale:",
          "run `/anatomiya:scan` rather than believing this.",
        ]
      : [
          `Counted from this repository's main checkout at ${locator(found.from)}, not this worktree, and re-read just now.`,
          `The area files it names are under ${locator(join(found.from, RULES_DIR))}, not in this worktree, so read them there.`,
          "Where this and the code here disagree, the code is right:",
          "run `/anatomiya:scan` in this worktree for its own counts.",
        ];

  // Where the map is borrowed, the refresh that failed is the main checkout's,
  // and a scan here would build this worktree a map of its own instead.
  if (failed) {
    stamp.push(
      found.from === null
        ? "The last automatic refresh of this map failed, so it may be behind the code:"
        : "The last automatic refresh of this map failed in the main checkout, so it may be behind the code:",
      found.from === null
        ? "run `/anatomiya:scan` to rebuild it and see why."
        : "run `/anatomiya:scan` in the main checkout to rebuild it and see why."
    );
  }

  return [
    `<repository-map delivered="${now.toISOString()}" digest="${digest}">`,
    ...stamp,
    "",
    body,
    "</repository-map>",
  ].join("\n");
}

/** Whether the refresh worker's last run in this checkout failed: anything but an explicit `ok: false` reads as no failure. */
const refreshFailed = (root) => refreshRecord(root)?.ok === false;
