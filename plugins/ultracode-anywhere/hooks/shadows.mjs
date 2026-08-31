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
import { lstatSync, statSync } from "node:fs";
import { join } from "node:path";

import { EFFORT_LEVELS } from "./effort.mjs";
import { configDirFor, readOwnFile } from "./hook-io.mjs";

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
 * How much of a file is read looking for its frontmatter.
 *
 * Frontmatter is a handful of short lines and the prompt below it runs to
 * hundreds of kilobytes. The read refuses a file larger than this outright
 * rather than taking a prefix, so a hook's budget does not go on a file that
 * was never a shadow. A real one is comfortably inside it: the largest of the
 * three here is 2.6 KB with its whole prompt.
 */
const FRONTMATTER_MOST = 8192;

/** The fence a frontmatter block opens and closes with, on a line of its own. */
const FENCE = /^---[ \t]*$/;

/** The key a shadow carries the level in, and the value up to the line's end. */
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
  const dirs = [];
  if (cwd) dirs.push(join(cwd, ".claude", "agents"));
  if (config) dirs.push(join(config, "agents"));
  return [...new Set(dirs)];
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
    if (levelIn(found.path) !== level) return { type, state: "other-level", path: found.path };
    if (built === null) return { type, state: "unknown-age", path: found.path };
    return { type, state: found.at < built ? "stale" : "current", path: found.path };
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
  const other = named("other-level");
  const stale = named("stale");
  if (absent.length + other.length + stale.length === 0) return null;

  const clauses = [];
  if (absent.length) clauses.push(`no agent file carries it for ${list(absent)}`);
  if (other.length) clauses.push(`${list(other)} ${other.length === 1 ? "carries" : "carry"} another level`);
  if (stale.length) {
    const one = stale.length === 1;
    clauses.push(
      `${list(stale)} ${one ? "was" : "were"} written before the installed build, so the ${one ? "prompt it copies is" : "prompts they copy are"} behind`,
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

/** The first directory holding a regular file of that name, and its time. */
function findIn(dirs, name) {
  for (const dir of dirs) {
    if (!dir) continue;
    const path = join(dir, name);
    try {
      // `lstat` rather than `stat`: a link standing where a shadow should be is
      // not one, and the read below refuses to follow it either. Answering
      // "absent" says the thing that is true, which is that no shadow of this
      // plugin's kind is there.
      const seen = lstatSync(path);
      if (seen.isFile()) return { path, at: seen.mtimeMs };
    } catch {
      // Nothing there, or a directory this account may not look inside. Both
      // are "no shadow here", and the next directory is still worth asking.
    }
  }
  return null;
}

/** The level a file's frontmatter names, or null where it names none. */
function levelIn(path) {
  // A file too large to be frontmatter reads as nothing rather than as a
  // prefix, so a stray `effort:` far down a copied prompt is never read as the
  // block's own.
  const text = readOwnFile(path, FRONTMATTER_MOST);
  const lines = text.split(/\r?\n/);
  if (!FENCE.test(lines[0] ?? "")) return null;

  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i])) return null;
    const named = EFFORT_LINE.exec(lines[i]);
    if (named) return named[1].trim().toLowerCase();
  }
  // No closing fence inside what was read: the block is unterminated, and a
  // key found in it belongs to nothing.
  return null;
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
