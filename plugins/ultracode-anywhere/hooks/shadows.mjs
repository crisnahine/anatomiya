/**
 * What the agent files on disk say about the three built-in types a markdown
 * file can stand in for.
 *
 * A spawn's effort comes from its agent definition and from nowhere a hook can
 * reach, so the only way to run the Agent-tool fan-out below the session is to
 * write an agent file carrying `effort:` and a copy of that type's built-in
 * prompt. The copy is the cost: it is frozen at the build it was taken from,
 * and an upgrade moves the original while the copy sits there reading the same
 * as ever.
 *
 * Nothing here writes, extracts or repairs anything. It reads what is on disk
 * and answers one question per type, because the answer is the half a person
 * cannot see. Whether the copy is faithful is not knowable from the file; when
 * it was last written, against a build with a timestamp of its own, is.
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, sep } from "node:path";

import { EFFORT_LEVELS } from "./effort.mjs";
import { configDirFor, homeOf, readHead } from "./hook-io.mjs";

/**
 * The built-in types a markdown file can stand in for, in the order they are
 * reported.
 *
 * `claude` is missing on purpose, and not for the reason it looks like. Its
 * definition sets `appendSystemPrompt`, but that field is read where a
 * definition becomes the session's own prompt under `--agent`, and the spawn
 * path never appends, so a copy of it loses nothing here. It is left off
 * because a file named for it changes that other path too, which is a wider
 * blast radius than the three types this reports on.
 */
export const SHADOWABLE = ["general-purpose", "Explore", "Plan"];

/**
 * How much of a file's head is read looking for its frontmatter.
 *
 * A prefix rather than the whole file: frontmatter is a handful of short lines
 * and the copied prompt under it runs to hundreds of kilobytes, and a hook has
 * five seconds for everything. Generous enough that a block which does not
 * close inside it is malformed rather than merely long.
 */
const FRONTMATTER_MOST = 8192;

/** Entries one listing of an agents directory will look at. */
const ENTRIES_MOST = 500;

/**
 * Files whose head this will read across every directory in one call.
 *
 * Each is a small read, and these are directories a person curates by hand, so
 * this never fires on a real setup. It is here because a session can be started
 * anywhere and a hook has five seconds for everything it does.
 */
const FILES_MOST = 200;

/**
 * How many directories up the walk goes before it stops asking.
 *
 * The home directory ends it on an ordinary session and this never fires. It is
 * here for the one that starts outside the home, where nothing else would stop
 * the walk before the filesystem root.
 */
const WALK_MOST = 32;

const FENCE = /^---[ \t]*$/;
const NAME_LINE = /^name:(?=[ \t]|$)[ \t]*(.*)$/;
const DESCRIPTION_LINE = /^description:(?=[ \t]|$)[ \t]*(.*)$/;

// The lookahead is the whole point: YAML wants whitespace after the colon in a
// block mapping, so `effort:medium` is a plain scalar and no key at all. Read
// as one, a file the build takes no effort from was reported as carrying the
// level asked for, which is the wrong direction to be wrong in.
const EFFORT_LINE = /^effort:(?=[ \t]|$)[ \t]*(.*)$/;

/**
 * The one alias the build's effort reader applies before it validates, read off
 * 2.1.251 as `{med:"medium"}`. A file carrying it works, and reading it as some
 * other level would send a reader to change a line that is already right.
 */
const ALIASES = { med: "medium" };

/**
 * The directories an agent name is resolved against, in the order it is tried.
 *
 * Every `.claude/agents` from the working directory up to the home, deepest
 * first, then the user's own. That is the build's order: a repository shipping
 * an agent file is the one a spawn started there reads, and the directory
 * nearest the working one wins among them. `CLAUDE_CONFIG_DIR` moves the user's
 * along with the rest of what Claude Code keeps, and names the configuration
 * directory itself rather than a parent of one.
 *
 * Two sources the build also reads are not asked here and are named in the
 * README instead: a managed settings directory, which outranks everything, and
 * the additional working directories a session was started with.
 */
export function agentDirsFor(env = process.env, cwd = "") {
  const config = configDirFor(env);
  const dirs = [];
  // Only an absolute one. A relative path would be joined and then resolved
  // against whatever directory this hook process is in, which is not the
  // session's, and a Windows path on a posix host is not a path here at all.
  if (isAbsolute(cwd)) for (const dir of upTo(cwd, homeOf(env))) dirs.push(join(dir, ".claude", "agents"));
  if (config) dirs.push(join(config, "agents"));
  return [...new Set(dirs)];
}

/**
 * What each shadowable type's file says, one entry per type in a fixed order.
 *
 * `level` is the one the caller asked about, read off its own switch. A level
 * that is not one of the five is a bug in the caller rather than a state to
 * report, so it answers with nothing at all.
 */
export function shadowsFor({ level, dirs = [], build = null } = {}) {
  if (!EFFORT_LEVELS.includes(level)) return [];
  const built = mtimeOf(build);
  const held = indexIn(dirs);

  return SHADOWABLE.map((type) => {
    const found = held.get(type);
    // No file anywhere claims this name. A file called `Explore.md` whose
    // frontmatter names something else is one of these: it became that other
    // agent and left the built-in alone.
    if (!found) return { type, state: "absent", path: null };

    // Each of the next three is a different line to write, so each is said apart.
    if (!found.described) return { type, state: "refused", path: found.path };
    if (found.level === null) return { type, state: "no-level", path: found.path };
    if (found.level !== level) return { type, state: "other-level", path: found.path };

    if (built === null) return { type, state: "unknown-age", path: found.path };
    return { type, state: found.at < built ? "older" : "current", path: found.path };
  });
}

/**
 * What a session is owed about the files it asked about, or null where it is
 * owed nothing.
 *
 * Silence is the ordinary answer, and it is earned: a line every session saying
 * the setting still works is a line nobody reads by the third one. What is said
 * is what a reader can act on, which is a file to write, a line to add, a line
 * to change, or a copy to take again off the build now installed.
 *
 * An age nothing could read is not among those. The files are there and carry
 * the level, and no move a reader could make would answer the question this
 * could not, so it says nothing rather than passing its own blindness on.
 */
export function shadowLine(level, seen = []) {
  const named = (state) => seen.filter((s) => s.state === state).map((s) => s.type);
  const absent = named("absent");
  const refused = named("refused");
  const noLevel = named("no-level");
  const other = named("other-level");
  const older = named("older");
  if (absent.length + refused.length + noLevel.length + other.length + older.length === 0) return null;

  const clauses = [];
  if (absent.length) clauses.push(`no agent file names ${list(absent)}`);
  if (refused.length) {
    clauses.push(
      `${list(refused)} ${refused.length === 1 ? "has a file the build refuses" : "have files the build refuses"} for want of a description`,
    );
  }
  if (noLevel.length) clauses.push(`${list(noLevel)} ${noLevel.length === 1 ? "names" : "name"} no effort`);
  if (other.length) clauses.push(`${list(other)} ${other.length === 1 ? "carries" : "carry"} another level`);
  if (older.length) {
    const one = older.length === 1;
    // What a timestamp knows and no more: whether the copied prompt actually
    // differs is not knowable from the file.
    clauses.push(
      `${list(older)} ${one ? "was" : "were"} written before the installed build, so whether the ${one ? "prompt it copies" : "prompts they copy"} still ${one ? "matches" : "match"} is unchecked`,
    );
  }

  // The lever names no type, so a line reporting one type does not read as
  // though it were reporting all three.
  return (
    `ULTRACODE_ANYWHERE_SUBAGENT_EFFORT names ${level}, and ${clauses.join("; ")}. ` +
    `A spawn's effort comes from its agent definition and no hook can reach it, so an agent file ` +
    `under \`.claude/agents\` carrying \`name:\` and \`effort: ${level}\` is the only lever, and the ` +
    `plugin README says what such a file cannot carry`
  );
}

/** Names as a person reads them: one, two joined by and, or a list ending in one. */
function list(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Every agent name the given directories define, and the file that defines it.
 *
 * Keyed on the frontmatter `name:` and never on the filename, because that is
 * what the build keys on: it keeps the basename as a label and nothing more. A
 * file called `Explore.md` naming `not-explore` is the agent `not-explore` and
 * leaves the built-in `Explore` alone, and `my-plan.md` naming `Plan` is the
 * file a spawn of `Plan` reads.
 *
 * The first directory to define a name keeps it, and inside one directory the
 * top level comes before a subfolder. Both are the order the build resolves in.
 */
function indexIn(dirs) {
  const held = new Map();
  let read = 0;
  for (const dir of dirs) {
    if (!dir) continue;
    for (const path of markdownIn(dir)) {
      if (read >= FILES_MOST) return held;
      read++;
      const seen = frontmatterIn(path);
      if (!seen.name || held.has(seen.name)) continue;
      const at = mtimeOf(path);
      if (at !== null) held.set(seen.name, { ...seen, path, at });
    }
  }
  return held;
}

/**
 * Every `.md` file in an agents directory, the top level first and subfolders
 * after, which is the order the build resolves a duplicate name in.
 *
 * The build walks the directory rather than opening one path, so a file kept in
 * a subfolder loads. Links are followed, because the build follows them and a
 * dotfiles repository keeps these behind one; one pointing nowhere yields
 * nothing when it is read.
 */
function markdownIn(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  } catch {
    // Nothing there, or a directory this account may not look inside.
    return [];
  }
  const top = [];
  const deeper = [];
  let looked = 0;
  for (const entry of entries) {
    if (looked >= ENTRIES_MOST) break;
    looked++;
    if (!entry.name.endsWith(".md")) continue;
    const parent = entry.parentPath ?? dir;
    (parent === dir ? top : deeper).push(join(parent, entry.name));
  }
  return [...top, ...deeper];
}

/**
 * What a file's frontmatter says: the agent name it claims, the level it names,
 * and whether it carries the description the build requires.
 *
 * The build hands this block to a YAML parser, so what people write in it is
 * what YAML allows: quotes around a value, a comment after it, a byte-order
 * mark from an editor that adds one. This reads the three keys it needs rather
 * than parsing YAML, and forgives those, because reporting a working file as
 * carrying the wrong level is the failure that costs a reader an afternoon.
 */
function frontmatterIn(path) {
  const text = readHead(path, FRONTMATTER_MOST).replace(/^﻿/, "");
  const lines = text.split(/\r?\n/);
  const nothing = { name: null, level: null, described: false };

  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (!FENCE.test(lines[i] ?? "")) return nothing;

  const seen = { name: null, level: null, described: false };
  let described = false;
  let continues = false;
  for (i++; i < lines.length; i++) {
    if (FENCE.test(lines[i])) return seen;

    // A plain value may sit on the lines under its key, indented. Read from
    // the key's own line alone, such a description looked empty and the file
    // was reported as one the build refuses, which is a line to add that is
    // already there.
    if (continues) {
      continues = false;
      if (/^[ \t]+\S/.test(lines[i])) {
        seen.described = true;
        continue;
      }
    }

    const name = NAME_LINE.exec(lines[i]);
    // Kept as written rather than folded: agent names are matched exactly
    // upstream, so `explore` is not `Explore`.
    if (name && seen.name === null) seen.name = unquote(name[1]) || null;

    const effort = EFFORT_LINE.exec(lines[i]);
    if (effort && seen.level === null) seen.level = levelOf(effort[1]);

    // The build refuses a file whose description is absent or not a string, so
    // a block that only names an effort never becomes an agent at all. Read
    // first-wins, as the other two keys are.
    const description = DESCRIPTION_LINE.exec(lines[i]);
    if (description && !described) {
      described = true;
      if (unquote(description[1]) !== "") seen.described = true;
      else continues = true;
    }
  }
  // No closing fence inside the head that was read: either the block is
  // unterminated or it is longer than a frontmatter block has any business
  // being, and a key found in it belongs to nothing either way.
  return nothing;
}

/** An effort value as the build reads one: folded, and through its alias table. */
function levelOf(raw) {
  const text = unquote(raw).toLowerCase();
  if (text === "") return null;
  return ALIASES[text] ?? text;
}

/**
 * A scalar as YAML reads one: quotes taken off, and a comment after it cut.
 *
 * The comment rule is YAML's own, a `#` at the start or after a space, so a
 * hash inside a quoted value survives. Quotes are checked first for the same
 * reason.
 */
function unquote(raw) {
  const text = String(raw ?? "").trim();
  const quoted = /^(["'])(.*)\1[ \t]*(?:#.*)?$/.exec(text);
  if (quoted) return quoted[2];
  return text.replace(/(^|[ \t])#.*$/, "").trim();
}

/**
 * A directory and each of its parents, stopping at `home` or at the root.
 *
 * Deepest first, which is the order the build prefers among them. The bound is
 * the home directory rather than the filesystem root: the build stops there,
 * and a walk that did not would ask about `/.claude/agents` on every session.
 */
function upTo(from, home) {
  // Compared without a trailing separator on either side: `HOME=/home/me/` is
  // the same home as `/home/me`, and a raw compare walked past it to the root.
  const stop = trimEnd(home);
  const seen = [];
  let dir = trimEnd(from);
  // The home itself is not among them. The build breaks there before adding it,
  // so `~/.claude/agents` is reached only as the user directory, and walking
  // into it ranked a file there above the one `CLAUDE_CONFIG_DIR` points at.
  while (dir && dir !== stop && seen.length < WALK_MOST) {
    seen.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return seen;
}

/** A path without the separator a caller left on the end, unless it is the root. */
function trimEnd(path) {
  let text = String(path ?? "");
  while (text.length > 1 && text.endsWith(sep)) text = text.slice(0, -1);
  return text;
}

/** When a path was last written, and null for one nothing can be read about. */
function mtimeOf(path) {
  if (!path) return null;
  try {
    // Followed: a build is reached through a symlink on an ordinary install,
    // and an agent file may be one in a dotfiles setup. The target is the file
    // somebody edits either way.
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}
