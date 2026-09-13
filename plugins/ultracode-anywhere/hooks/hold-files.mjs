/**
 * The walks and writes the spawn hold makes over the user's own configuration.
 */
import { mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { homeOf, readIfFile } from "./hook-io.mjs";

/**
 * Every file under `dir` whose name ends in `ext`, at any depth, in name order.
 *
 * A symlinked directory is followed, since a dotfiles repository keeps agent
 * folders behind one, and each real directory is read once, so a link back up
 * the tree is read no deeper.
 */
export function filesIn(dir, ext, seen = new Set()) {
  let entries;
  try {
    const real = realpathSync(dir);
    if (seen.has(real)) return [];
    seen.add(real);
    entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDir = statSync(path).isDirectory();
      } catch {
        return [];
      }
    }
    if (isDir) return filesIn(path, ext, seen);
    return entry.name.endsWith(ext) ? [path] : [];
  });
}

/**
 * `<dir>/<...leaf>` for `from` and each directory above it, nearest first.
 *
 * It stops below the home directory: that directory's `.claude` is the user
 * tier, which the build reads as the user's own and never as a project's.
 */
export function ancestors(from, leaf, env = process.env) {
  const home = homeOf(env) ? resolve(homeOf(env)) : "";
  const found = [];
  for (let dir = resolve(from); dir !== home; dir = dirname(dir)) {
    found.push(join(dir, ...leaf));
    if (dir === dirname(dir)) break;
  }
  return found;
}

/** Whether `from` sits inside a git work tree, which a worktree needs. */
export function inGitRepo(from, env = process.env) {
  return ancestors(from, [".git"], env).some((path) => {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * A file replaced whole. The new text is written beside it and renamed over, so
 * a reader sees the old text or the new one and never part of either.
 */
export function writeWhole(path, text) {
  // For this account alone: the counters and the upkeep lock refuse a state directory anyone else can read.
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const beside = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(beside, text);
  renameSync(beside, path);
}

/** Whether a process is still running. One this account may not signal is running too. */
export function processRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/** A message's first line with no control characters, at most 200 long, since it is repeated into a session. */
export function plainLine(value) {
  return String(value ?? "")
    .split(/[\r\n\u2028\u2029]/)[0]
    .replace(/\p{C}/gu, "")
    .slice(0, 200)
    .replace(/\p{Cs}/gu, "");
}

/** Removes the files in `dir` last written more than `keepMs` before `now`. */
export function pruneOlder(dir, keepMs, now = Date.now()) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    try {
      if (now - statSync(join(dir, name)).mtimeMs > keepMs) rmSync(join(dir, name));
    } catch {
      // Another run removed it first.
    }
  }
}

/** A JSON file's value, or `fallback` for anything that is not a readable JSON file of at most `most` bytes. */
export function readJson(path, fallback, most = undefined) {
  try {
    return JSON.parse(readIfFile(path, most));
  } catch {
    return fallback;
  }
}
