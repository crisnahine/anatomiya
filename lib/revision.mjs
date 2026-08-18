/**
 * One path set, read at one commit, on disk where a parser can open it.
 *
 * The baseline and the check both ask this question, and each answered it
 * itself: the baseline wrote a temporary tree and handed back paths, the check
 * read one blob at a time into strings and let the parser write them out again.
 * Two readings of what an unreadable path means, and the check's was serial:
 * 80 of the 88 git processes a 40-file run spawned were `cat-file` waiting on
 * each other.
 *
 * Through disk because the parser runs out of process and takes a path (B5),
 * and `withSource` for the caller that also needs the bytes in hand, since the
 * check quotes snippets and resolves line numbers against them.
 *
 * A path that will not come back is reported rather than thrown on: the caller
 * decides what one missing file means, and for both of them it is one file
 * rather than the whole set.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, resolve as resolvePath, sep } from "node:path";
import { tmpdir } from "node:os";

import { showBlob } from "./git.mjs";
import { language } from "./langs.mjs";

export async function readAtRevision(root, sha, files, { concurrency = 8, withSource = false, maxBytes, timeout } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-revision-"));
  const bounds = {
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(timeout === undefined ? {} : { timeout }),
  };
  const out = [];
  const missing = [];

  await pooled(files, concurrency, async (f) => {
    const abs = underTemp(dir, f?.rel);
    if (!abs) return void missing.push({ rel: f?.rel ?? null, reason: "unsafe path" });

    const blob = await showBlob(root, sha, f.rel, bounds);
    if (!blob.ok) return void missing.push({ rel: f.rel, reason: blob.reason });

    // A file the temporary directory will not take is one path this run did not
    // get, reported like any other. Throwing here would lose the whole set.
    try {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, blob.content);
    } catch {
      return void missing.push({ rel: f.rel, reason: "unwritable" });
    }
    out.push({
      rel: f.rel,
      abs,
      lang: f.lang ?? language(f.rel),
      ...(withSource ? { source: blob.content.toString("utf8") } : {}),
    });
  });

  // Sorted, because the order blobs finish in is the order git answered them
  // and nothing downstream should read anything into it.
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return {
    dir,
    files: out,
    missing,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// Lexical containment only. The destination is a directory this process just
// created and every subdirectory under it is ours, so there is no symlink to
// follow; the corpus reader resolves both sides because it reads paths it did
// not create.
function underTemp(dir, rel) {
  if (typeof rel !== "string" || rel.length === 0) return null;
  const root = resolvePath(dir);
  const full = resolvePath(root, rel);
  return full.startsWith(root + sep) ? full : null;
}

async function pooled(items, size, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(size, queue.length)) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}
