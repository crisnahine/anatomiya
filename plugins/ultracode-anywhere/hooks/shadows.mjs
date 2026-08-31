/**
 * What a markdown agent file says about itself, for the three built-in types
 * one can stand in for.
 *
 * A spawn's effort comes from its agent definition and from nowhere a hook can
 * reach, so the only way to run the Agent-tool fan-out below the session is to
 * write `.claude/agents/<type>.md` carrying `effort:` and a copy of that type's
 * built-in prompt. The copy is the cost: it is frozen at the build it was taken
 * from, and an upgrade moves the original while the copy sits there reading the
 * same as ever.
 *
 * Nothing here writes, extracts or repairs anything. It reads what is on disk
 * and answers one question per type, because the answer is the half a person
 * cannot see. Whether the copy is faithful is not knowable from the file; when
 * it was last written, against a build with a timestamp of its own, is.
 */
import { statSync } from "node:fs";
import { dirname, join } from "node:path";

import { EFFORT_LEVELS } from "./effort.mjs";
import { configDirFor, homeOf, readHead } from "./hook-io.mjs";

/**
 * The built-in types a markdown file can stand in for, in the order they are
 * reported.
 *
 * `claude` is missing on purpose. Its definition sets `appendSystemPrompt`, so
 * its prompt is added to the base one; a markdown file replaces instead, and
 * the frontmatter has no key that appends. Shadowing it would quietly build a
 * different agent rather than a copy of that one, so it is left alone.
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

/**
 * How many directories up the walk goes before it stops asking.
 *
 * The home directory ends it on an ordinary session and this never fires. It is
 * here for the one that starts outside the home, where nothing else would stop
 * the walk before the filesystem root, and for a path long enough that a stat
 * per segment is worth refusing.
 */
const WALK_MOST = 32;

const FENCE = /^---[ \t]*$/;
const EFFORT_LINE = /^effort:[ \t]*(.*)$/;

/**
 * The directories an agent name is resolved against, in the order it is tried.
 *
 * A project's own comes first: a repository that ships an agent file is the one
 * a spawn started there reads, and reporting on the user's while the project's
 * was in use would describe a file nobody loaded. `CLAUDE_CONFIG_DIR` moves the
 * user's along with the rest of what Claude Code keeps.
 *
 * The same path named twice is asked once, for the session whose working
 * directory is the home directory: two entries there would report one file as
 * two, and the second would always agree with the first.
 */
export function agentDirsFor(env = process.env, cwd = "") {
  const config = configDirFor(env);
  const home = homeOf(env);
  const dirs = [];
  for (const dir of upTo(cwd, home)) dirs.push(join(dir, ".claude", "agents"));
  if (config) dirs.push(join(config, "agents"));
  return [...new Set(dirs)];
}

/**
 * A directory and each of its parents, stopping at `home` or at the root.
 *
 * Deepest first, which is the order the build prefers among them. The bound is
 * the home directory rather than the filesystem root: the build stops there,
 * and a walk that did not would ask about `/.claude/agents` on every session.
 */
function upTo(from, home) {
  const seen = [];
  let dir = from;
  while (dir && seen.length < WALK_MOST) {
    seen.push(dir);
    if (dir === home) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return seen;
}

/**
 * What each shadowable type's file says, one entry per type in a fixed order.
 *
 * `level` is the one the caller asked about, read off its own switch, and an
 * answer is only about that level: a file carrying another is somebody's own
 * and works, it just does not answer this question. A level that is not one of
 * the five is a bug in the caller rather than a state to report, so it answers
 * with nothing at all.
 *
 * `dirs` is asked in the order the build resolves an agent name, and the first
 * directory holding a type is the one that answers for it. Reading a later one
 * would report on a file the spawn never sees.
 */
export function shadowsFor({ level, dirs = [], build = null } = {}) {
  if (!EFFORT_LEVELS.includes(level)) return [];
  const built = mtimeOf(build);
  return SHADOWABLE.map((type) => {
    const found = findIn(dirs, `${type}.md`);
    if (!found) return { type, state: "absent", path: null };

    // Three answers, not two. A file nothing could parse is a different move
    // from one carrying another level: the first is a file to look at, the
    // second is a line to change, and saying the second about the first sends
    // a reader to fix a file that already works.
    const read = frontmatterIn(found.path);
    if (!read.parsed) return { type, state: "unreadable", path: found.path };
    if (read.level !== level) return { type, state: "other-level", path: found.path };

    if (built === null) return { type, state: "unknown-age", path: found.path };
    return { type, state: found.at < built ? "older" : "current", path: found.path };
  });
}

/**
 * What a session is owed about the shadows it asked about, or null where it is
 * owed nothing.
 *
 * Silence is the ordinary answer, and it is earned: a line every session saying
 * the setting still works is a line nobody reads by the third one. What is said
 * is what a reader can act on, which is a file to write, a file to look at, or
 * a file to take again off the build now installed.
 *
 * An age nothing could read is not among those. The files are there and carry
 * the level, and no move a reader could make would answer the question this
 * could not, so it says nothing rather than passing its own blindness on.
 */
export function shadowLine(level, seen = []) {
  const named = (state) => seen.filter((s) => s.state === state).map((s) => s.type);
  const absent = named("absent");
  const unreadable = named("unreadable");
  const other = named("other-level");
  const older = named("older");
  if (absent.length + unreadable.length + other.length + older.length === 0) return null;

  const clauses = [];
  if (absent.length) clauses.push(`no agent file carries it for ${list(absent)}`);
  if (unreadable.length) {
    clauses.push(`${list(unreadable)} ${unreadable.length === 1 ? "has" : "have"} a file with no frontmatter this could read`);
  }
  if (other.length) clauses.push(`${list(other)} ${other.length === 1 ? "carries" : "carry"} another level`);
  if (older.length) {
    const one = older.length === 1;
    // What a timestamp knows and no more. Whether the copied prompt actually
    // differs is not knowable from the file, and an earlier draft said it was.
    clauses.push(
      `${list(older)} ${one ? "was" : "were"} written before the installed build, so whether the ${one ? "prompt it copies" : "prompts they copy"} still ${one ? "matches" : "match"} is unchecked`,
    );
  }

  // The lever names no type, so a line reporting one type does not read as
  // though it were reporting all three.
  return (
    `ULTRACODE_ANYWHERE_SUBAGENT_EFFORT names ${level}, and ${clauses.join("; ")}. ` +
    `A spawn's effort comes from its agent definition and no hook can reach it, so ` +
    `\`.claude/agents/<type>.md\` carrying \`effort: ${level}\` is the only lever, and the plugin ` +
    `README says what such a file cannot carry`
  );
}

/** Names as a person reads them: one, two joined by and, or a list ending in one. */
function list(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The first directory holding a file of that name, and when it was written.
 *
 * A link is followed, because the build follows one and loads the agent behind
 * it, and a dotfiles repository keeps these behind links. Refusing a link
 * reported such a setup as having no agent files at all, every session. The
 * time is the target's for the same reason: the target is the file somebody
 * edits.
 */
function findIn(dirs, name) {
  for (const dir of dirs) {
    if (!dir) continue;
    const path = join(dir, name);
    try {
      const seen = statSync(path);
      if (seen.isFile()) return { path, at: seen.mtimeMs };
    } catch {
      // Nothing there, a link pointing nowhere, or a directory this account
      // may not look inside. All three are "no shadow here", and the next
      // directory is still worth asking.
    }
  }
  return null;
}

/**
 * What a file's frontmatter says: whether there was a block to read at all,
 * and the level it names.
 *
 * The build hands this block to a YAML parser, so what people write in it is
 * what YAML allows: quotes around a value, a comment after it, a byte-order
 * mark from an editor that adds one. This reads the one key it needs rather
 * than parsing YAML, and forgives those three, because reporting a working
 * file as carrying the wrong level is the failure that costs a reader an
 * afternoon.
 */
function frontmatterIn(path) {
  const text = readHead(path, FRONTMATTER_MOST).replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);

  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (!FENCE.test(lines[i] ?? "")) return { parsed: false, level: null };

  for (i++; i < lines.length; i++) {
    if (FENCE.test(lines[i])) return { parsed: true, level: null };
    const named = EFFORT_LINE.exec(lines[i]);
    if (named) return { parsed: true, level: valueOf(named[1]) };
  }
  // No closing fence inside the head that was read: either the block is
  // unterminated or it is longer than a frontmatter block has any business
  // being, and a key found in it belongs to nothing either way.
  return { parsed: false, level: null };
}

/**
 * A scalar as YAML reads one: quotes taken off, and a comment after it cut.
 *
 * The comment rule is YAML's own, a `#` at the start or after a space, so a
 * hash inside the value survives. Quotes are checked first for the same
 * reason.
 */
function valueOf(raw) {
  const text = raw.trim();
  const quoted = /^(["'])(.*)\1[ \t]*(?:#.*)?$/.exec(text);
  if (quoted) return quoted[2].toLowerCase();
  return text.replace(/(^|[ \t])#.*$/, "").trim().toLowerCase();
}

/** When a path was last written, and null for one nothing can be read about. */
function mtimeOf(path) {
  if (!path) return null;
  try {
    // Followed, unlike a shadow: the build is reached through a symlink on an
    // ordinary install, and its target is the file whose age is the question.
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}
