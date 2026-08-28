/**
 * This tool's whole side of the hook contract: the payload read off stdin, the
 * map put back in front of the model after every step, the one object written
 * back, and the settings entry an older version arranged.
 *
 * The always-loaded channel already carries the overview once per turn (H1),
 * and this does not replace it: "What is deliberately not built" refuses a hook
 * as the delivery channel, and the 10-to-40% adherence that refusal cites was
 * measured on a hook *instead of* the always-loaded file. This is a hook *on
 * top of* it. The channel that scored 100% keeps carrying the map, and what
 * this adds is recency and a timestamp, so a long run cannot drift away from a
 * fact it was given hundreds of tool calls ago, and a copy that has gone stale
 * reads as stale rather than as the current answer.
 *
 * Written to `settings.local.json` rather than `settings.json`: A1 keeps this
 * tool's writes inside `.claude/rules/` so a writer bug cannot destroy a file
 * somebody maintains by hand, and a repository's `settings.json` holds its
 * permission lists and its other hooks. The local file is Claude Code's own
 * per-developer scope, it is git-ignored, and it matches where the map already
 * lives: yours, on this machine, not committed.
 */
import { existsSync, lstatSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { HEAD_BYTES, isOwned, OVERVIEW_FILE, RULES_DIR, SETTINGS_PATH, readHead, realpathOrNull, resolveInside } from "./rules.mjs";
import { FACTS_PATH, schemaProblem } from "./facts.mjs";

export { SETTINGS_PATH };

// `${CLAUDE_PLUGIN_ROOT}` is the plugin's own directory, and it is substituted
// only for a hook the plugin declares in `hooks/hooks.json`. Written into a
// repository's own settings it is not substituted at all: Claude Code refuses
// the hook by name, on every prompt and every tool call, for the life of that
// session. So the declaration lives in `hooks/hooks.json` beside this, and the
// string is exported for the test that holds the two in step.
export const HOOK_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo';

/** The write-time half, declared on `PreToolUse` and answering for one path. */
export const NOTICE_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" notice';

// What an older version wrote, whichever way it spelled the path. The removal
// has to reach every spelling that ever shipped rather than only the one this
// build would write, and the quoting has already changed once.
// `echo` and no other verb, because the sweep may only take out what a version
// of this tool put there: 0.2.4 through 0.2.6 wrote that one and nothing has
// written a settings hook since, so matching `notice` here would delete one a
// person installed by hand. A whole group goes at a time, so one sharing a
// group with the old entry still goes with it; what that installer wrote was a
// group of its own, which is what keeps the path narrow rather than closed.
const isOurCommand = (command) => /anatomiya\.mjs"?\s+echo\b/.test(String(command ?? ""));

/**
 * Whether anything is already at a path, a broken link and a path that cannot
 * be looked at both counted as taken.
 *
 * Those answer together because they fail the same way. `existsSync` swallowed
 * every error and said no, walking straight past a level it could not see;
 * `lstat` suppresses only ENOENT and throws the rest, and nothing between here
 * and the process catches it. Unreadable answering "taken" is the quiet
 * direction on both readers: the walk stops rather than claiming a map above,
 * and the notice says nothing rather than calling a file new.
 */
export function isPathTaken(path) {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
}

function isBoundary(at) {
  return isPathTaken(join(at, ".git"));
}

/**
 * The nearest map at or above a directory, or null where there is none.
 *
 * A hook fires with the session's own working directory, which is wherever the
 * model happens to be, and the map is written once at the repository root.
 * Walked rather than asked of `git rev-parse`, which is what every other
 * command does: this runs on every tool call, and a subprocess per call to
 * learn a path already on disk is a subprocess per call. `dirname` is its own
 * fixed point at the filesystem root, which is what ends the loop.
 *
 * The walk ends at a boundary, so a worktree, a submodule or a nested
 * repository hears nothing rather than the enclosing checkout's map, against a
 * branch those counts never described. Anything named `.git` is one, which is
 * the cheap side of asking the filesystem instead of git on every tool call.
 *
 * The starting directory is resolved through its links rather than around them,
 * which is F2's reasoning arriving at the read side: `resolve` normalises `..`
 * and follows no link, so a cwd reached through one walked the link's own
 * parents and stepped around every boundary beneath it. A cwd that will not
 * resolve answers no map, since a reader that cannot say where it is cannot say
 * the map above it is about the code there.
 */
function ownMap(from) {
  let at = realpathOrNull(resolve(from));
  if (at === null) return null;
  for (;;) {
    const map = readOwned(join(at, RULES_DIR, OVERVIEW_FILE));
    if (map !== null) return map;
    if (isBoundary(at)) return null;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/**
 * The file's text, when this tool wrote it and it is no larger than one of ours.
 *
 * Through `readHead` rather than a plain read, because this runs on every turn
 * and every tool call and the path is whatever is sitting there: a named pipe
 * never returns at all, which is a session that never returns, and a file
 * carrying our frontmatter and five megabytes of anything else went into the
 * model's context whole. `readHead` opens non-blocking, types the shape before
 * reading a byte, and stops at the size this repository already decided a rule
 * file may be. One byte past the cap is enough to know the file is over it.
 *
 * Whose it is decides whether the walk stops here, not only whether it answers:
 * a hand-written file in a subdirectory used to silence the repository's own
 * map for every session under it.
 */
function readOwned(path) {
  const entry = readHead(path, HEAD_BYTES + 1);
  if (entry.kind !== "file" || Buffer.byteLength(entry.head) > HEAD_BYTES) return null;
  return isOwned(entry.head) ? entry.head : null;
}

/**
 * How much of a record this reads before deciding it is not one of ours.
 *
 * Not `HEAD_BYTES`, which sizes a rule file: the record is the whole count of a
 * repository, and the largest this tool has written is 9,957,450 bytes, on
 * microsoft/vscode. A megabyte would have gone silent on exactly the
 * repositories where a directory nobody read is easiest to miss. The cap is
 * there for the shape a rule file cap is there for, a path holding something
 * nobody wrote, and only such a file ever pays it.
 */
const FACTS_MOST = 64 * 1024 * 1024;

/**
 * The layout this repository recorded, walked up from here, or null.
 *
 * The same walk `ownMap` makes and stopping at the same boundary, so a hook
 * fired inside one checkout never answers out of another one's counts. Read
 * rather than parsed loosely: a record this cannot read is one it says nothing
 * about, which is the only safe answer on a path that runs per tool call.
 *
 * Through `readHead` for the reason `readOwned` is: a plain read blocks for
 * ever on a fifo and takes whatever size it finds, and this runs before every
 * write rather than once per scan.
 */
export function ownLayout(from) {
  let at = realpathOrNull(resolve(from));
  if (at === null) return null;
  for (;;) {
    // F2 again, and the reason `readFacts` already asks it: `join` resolves no
    // link, so a tracked `.claude/anatomiya -> /tmp/x` had a directory outside
    // the repository deciding what a write inside it was judged against.
    const path = resolveInside(at, FACTS_PATH);
    const layout = path === null ? null : readLayout(path);
    if (layout !== null) return { root: at, layout };
    if (isBoundary(at)) return null;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/**
 * The layout inside a record, or null for anything that is not one.
 *
 * Held to the same schema gate `readFacts` applies, and for its reason: fields
 * move between versions, and a record read against a shape this build does not
 * know enforces a convention nobody stated. Without it `check` named the schema
 * and enforced nothing while the notice, one command over, spoke off the same
 * file.
 */
function readLayout(path) {
  const entry = readHead(path, FACTS_MOST + 1);
  if (entry.kind !== "file" || Buffer.byteLength(entry.head) > FACTS_MOST) return null;
  try {
    const parsed = JSON.parse(entry.head);
    return schemaProblem(parsed) === null ? (parsed.layout ?? null) : null;
  } catch {
    // No record here, or one nobody can read. Both mean keep walking.
    return null;
  }
}

/**
 * Where each tool spells the path it is about to write.
 *
 * Measured on 2.1.250: `Write` and `Edit` carry `file_path`, `NotebookEdit`
 * carries `notebook_path`. A hook reading one key sees nothing on the other
 * tool and says nothing about it, which is the quietest way to be wrong.
 *
 * A notebook cannot produce a notice today, since `.ipynb` is not one of the
 * extensions a test file is held to. It is read anyway: which key a tool spells
 * its target with is a fact about the wire, not about what a rule does with it,
 * and the day that extension is counted the hook already covers the tool.
 */
const TARGET_KEY = { Write: "file_path", Edit: "file_path", NotebookEdit: "notebook_path" };

/**
 * A path with the part of it that exists resolved through its links, and the
 * rest left as it was spelled.
 *
 * `realpath` refuses a path that is not there, which is every path this is
 * asked about: the write has not happened yet. So the nearest ancestor that
 * does exist is resolved and the tail put back. Resolving one side only is what
 * this is here to stop: the root arrives already resolved, and a payload
 * carrying `/tmp/x` against a root reading `/private/tmp/x` looked like another
 * repository's file, so the hook said nothing at all.
 */
function resolveLinks(path) {
  const here = realpathOrNull(path);
  if (here !== null) return here;
  const up = dirname(path);
  return up === path ? path : join(resolveLinks(up), basename(path));
}

/**
 * Whether a directory under this repository already holds a file the caller
 * calls a test.
 *
 * A directory that is not there holds nothing, which is the ordinary answer for
 * a path a change is inventing. Anything else that goes wrong answers that it
 * does hold one, because this decides whether a finding is printed and a
 * directory nobody could list is not evidence that it is empty (C33): a
 * `spec/mailers` at mode 111, with a sibling spec in it the whole time, was
 * reported as holding no other test.
 */
export function holdsTestIn(root, isTest) {
  return (dir) => {
    let names;
    try {
      names = readdirSync(join(root, dir));
    } catch (err) {
      return err.code !== "ENOENT";
    }
    return names.some((name) => isTest(dir ? `${dir}/${name}` : name));
  };
}

/**
 * The path this call is about, relative to the repository, or null.
 *
 * Null for anything that lands outside, which is the safe direction: this
 * repository has nothing to say about another one's file. The containment test
 * is a segment test rather than a prefix one, so a file named `..keep` beside
 * the root is inside it.
 */
export function targetIn(payload, root) {
  const key = TARGET_KEY[payload?.tool_name];
  const raw = key ? payload?.tool_input?.[key] : null;
  if (typeof raw !== "string" || !raw || !isAbsolute(raw)) return null;
  const rel = relative(resolveLinks(resolve(root)), resolveLinks(resolve(raw)));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split("\\").join("/");
}

/**
 * The map as a hook would deliver it, or null where there is none to deliver.
 *
 * Null rather than a note about the absence: a repository nobody has scanned is
 * the ordinary case, and saying so on every tool call is worse than silence.
 */
export function echoContext(root, { now = new Date() } = {}) {
  const map = ownMap(root);
  if (map === null) return null;

  // The frontmatter is how the file is delivered, not what it says. A leading
  // BOM and CRLF are both read, the way `isOwned` reads them one module over:
  // a map re-saved on Windows carries both, and a strip that misses them puts
  // `generator: anatomiya` into the echoed body as if it were content.
  const body = map.replace(/^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, "").trim();
  if (body === "") return null;

  return [
    `<repository-map delivered="${now.toISOString()}">`,
    "Counted from this repository's own code and re-read just now.",
    "Where this and the code disagree, the code is right and the map is stale:",
    "run `anatomiya scan .` rather than believing this.",
    "",
    body,
    "</repository-map>",
  ].join("\n");
}

/** A payload longer than this is not one of ours, and reading on costs the turn. */
const PAYLOAD_MOST = 1024 * 1024;

/** How long to wait for a payload before answering without one. */
/**
 * How long the payload read waits before answering with nothing.
 *
 * Exported because it is half of a contract with two halves: this is what the
 * hook gives itself, and `hooks.json` declares what Claude Code will wait for.
 * A test that can read only the declaration cannot tell the two apart, and the
 * one that tried measured the answer against the outer bound, which the race it
 * was inside had already capped.
 */
export const PAYLOAD_WAIT_MS = 2000;

/**
 * The first `most` units of a string, without splitting a character in half.
 *
 * A cap counts UTF-16 units and a surrogate pair is two of them, so a cut at
 * the boundary halves one. The second plugin holds the same function for the
 * same reason, since a plugin may not run a file outside its own root.
 */
function cutAt(text, most) {
  if (text.length <= most) return text;
  const cut = text.slice(0, most);
  const last = cut.charCodeAt(most - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** A payload as an object, and an empty one for anything that will not parse. */
function asPayload(text) {
  try {
    const value = JSON.parse(text || "{}");
    return value !== null && typeof value === "object" ? value : {};
  } catch {
    // Unparseable is the same answer as absent: the caller has nothing to say
    // either way, and throwing would exit non-zero, which is the one outcome a
    // hook must not have.
    return {};
  }
}

/**
 * The hook event on stdin, or an empty object where there is none to read.
 *
 * Bounded and timed out, because this runs on every tool call and a hook that
 * waits on a pipe nobody writes to holds the whole session there for the
 * timeout the declaration asks for.
 *
 * What has arrived by the bound is read rather than thrown away. Discarding it
 * costs the turn its map for a payload that was already complete and whose
 * writer had simply not closed the handle, and the second plugin's copy of the
 * same bound keeps what it has.
 */
export function readPayload() {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    // Resolving the promise is not enough to end the process: an open stdin is
    // a live handle, so a harness that opens the pipe and writes nothing kept
    // this alive for as long as it held it, measured at 8 seconds against the
    // 2 this claims. The bound has to release the handle, not just answer.
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.pause();
      process.stdin.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => done(asPayload(data)), PAYLOAD_WAIT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
      // At the cap, the first megabyte is kept and read. Thrown away instead, a
      // whole payload followed by padding cost that turn its map, and the
      // second plugin's copy of this bound kept it: two spellings of one
      // contract answering different things for one payload.
      if (data.length >= PAYLOAD_MOST) done(asPayload(cutAt(data, PAYLOAD_MOST)));
    });
    process.stdin.on("error", () => done(asPayload(data)));
    process.stdin.on("end", () => done(asPayload(data)));
  });
}

/**
 * One JSON object on stdout, whatever the reader does with it.
 *
 * A reader that goes away mid-write raises EPIPE on the stream rather than from
 * the call, so a try/catch around this never saw it and node turned it into an
 * uncaught exception and exit 1: the one outcome a hook must not have, on every
 * turn and every tool call for the life of that session. The listener is what
 * makes the error ordinary, and it is added once however often this is called.
 */
export function respond(value) {
  if (process.stdout.listenerCount("error") === 0) process.stdout.on("error", () => {});
  try {
    process.stdout.write(JSON.stringify(value));
  } catch {
    // A stream already destroyed raises from the call rather than on itself,
    // which the listener above cannot make ordinary. Whichever way it arrives,
    // a hook that cannot be read is not a hook that failed.
  }
}

/** Whether a hook group is one of ours, by the command it runs. */
const isOurs = (group) => (Array.isArray(group?.hooks) ? group.hooks : []).some((h) => isOurCommand(h?.command));

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The shape a value has to have before it is merged into, or the reason it does
 * not.
 *
 * Spreading is what makes this necessary rather than optional: `{...someString}`
 * is `{"0":"P","1":"r",...}` and `[..."fmt.sh"]` is a list of characters, so a
 * settings file holding the wrong type one level down was rewritten into
 * indexed keys rather than refused. Same rule the top level already applies,
 * applied at every level a spread reaches.
 */
const mustBe = (ok, what, where) => {
  if (!ok) throw new Error(`${SETTINGS_PATH} has ${where} as ${what}, so it was left alone`);
};

/**
 * What taking the old hook out would change, without changing it (A19).
 *
 * Settings that do not parse are refused rather than replaced. The file holds
 * permission lists and other people's hooks, and a writer that treats
 * unreadable as absent is a writer that deletes them.
 */
export function planRemoval(root) {
  // F2, and the reason it is asked here rather than assumed: `join` normalises
  // `..` and resolves no link, so a tracked `settings.local.json -> ../../x`,
  // or one link at `.claude`, put a rewrite in a file the repository does not
  // own. Both survive a clone.
  const path = resolveInside(root, SETTINGS_PATH);
  if (path === null) {
    throw new Error(`${SETTINGS_PATH} resolves outside the repository, so it was left alone`);
  }
  if (!existsSync(path)) return { root, path, changed: false, settings: null, empty: false };

  // Through the same reader as everything else this module opens, rather than a
  // bare `readFileSync`: that types nothing and bounds nothing, so a fifo left
  // at this path held every scan for ever with nothing printed, and a large
  // file at it was the cost of every scan. `readHead` opens with O_NONBLOCK,
  // stats the handle it opened rather than the path, and stops at the cap.
  const entry = readHead(path, HEAD_BYTES + 1);
  if (entry.kind !== "file") {
    throw new Error(`${SETTINGS_PATH} could not be read as a file, so it was left alone`);
  }
  if (Buffer.byteLength(entry.head) > HEAD_BYTES) {
    throw new Error(`${SETTINGS_PATH} could not be read: it is larger than the ${HEAD_BYTES} bytes this reads`);
  }
  // A byte-order mark is not a malformed file, it is a file an editor wrote.
  const raw = entry.head.replace(/^\ufeff/, "");
  let settings;
  try {
    settings = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch (err) {
    throw new Error(`${SETTINGS_PATH} could not be read as JSON, so it was left alone: ${err.message}`);
  }
  if (!isPlainObject(settings)) {
    throw new Error(`${SETTINGS_PATH} could not be read as a settings object, so it was left alone`);
  }

  // Null and absent say the same thing here, no hooks at all, and neither holds
  // one of ours. Anything else is a shape this cannot read without inventing.
  mustBe(settings.hooks == null || isPlainObject(settings.hooks), "something other than a block", "hooks");
  if (settings.hooks == null) return { root, path, changed: false, settings, empty: false };

  const hooks = {};
  let changed = false;
  for (const [event, groups] of Object.entries(settings.hooks)) {
    mustBe(Array.isArray(groups), "something other than a list", event);
    const kept = groups.filter((g) => !isOurs(g));
    if (kept.length !== groups.length) changed = true;
    // An event holding only ours goes with it, rather than staying as an empty
    // list nobody wrote and nothing reads.
    if (kept.length > 0) hooks[event] = kept;
  }
  if (!changed) return { root, path, changed: false, settings, empty: false };

  const rest = { ...settings };
  if (Object.keys(hooks).length > 0) rest.hooks = hooks;
  else delete rest.hooks;
  return { root, path, changed: true, settings: rest, empty: Object.keys(rest).length === 0 };
}

/** Perform the plan, on the root it was planned for and no other (A19). */
export function commitRemoval(root, plan) {
  if (root !== plan.root) {
    throw new Error(`the plan was planned for ${plan.root}, so nothing was written to ${root}`);
  }
  if (!plan.changed) return plan;

  // A file this tool created and that now holds nothing else goes entirely: a
  // `{}` left behind is a file somebody has to wonder about.
  if (plan.empty) unlinkSync(plan.path);
  else writeFileSync(plan.path, `${JSON.stringify(plan.settings, null, 2)}\n`);
  return plan;
}

/**
 * Take out what an older version installed, and report what was there.
 *
 * A refusal is an answer rather than a throw, the way the install this replaces
 * refused: the map is the product, and a settings file this will not touch must
 * not take a scan that already wrote the whole map down with it. A dry run
 * changes nothing but still says what it found, because the whole point of one
 * is to be told.
 */
export function removeStaleHook(root, { dryRun = false } = {}) {
  try {
    const plan = planRemoval(root);
    if (!dryRun) commitRemoval(root, plan);
    return { removed: plan.changed, refused: null };
  } catch (err) {
    return { removed: false, refused: err.message };
  }
}
