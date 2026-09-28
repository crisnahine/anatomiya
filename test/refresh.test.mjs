import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { runScan } from "../plugins/anatomiya/lib/commands.mjs";
import { loadPin, PIN_PATH } from "../plugins/anatomiya/lib/baseline.mjs";
import { EXCLUDE_LINES } from "../plugins/anatomiya/lib/rules.mjs";
import { refreshRepository, runRefresh, REFRESH_STATE } from "../plugins/anatomiya/lib/refresh.mjs";

const OVERVIEW = join(".claude", "rules", "anatomiya-overview.md");

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString().trim();
}

// The README's own exclude lines, so the map stays out of every commit the way
// it does in a repository set up as documented.
function exclude(dir) {
  writeFileSync(join(dir, ".git", "info", "exclude"), EXCLUDE_LINES.join("\n") + "\n");
}

function init(dir) {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t.test");
  git(dir, "config", "user.name", "T");
  git(dir, "config", "commit.gpgsign", "false");
  exclude(dir);
}

function source(dir, area, count) {
  mkdirSync(join(dir, area), { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, area, `f${i}.ts`), `export const a${i} = ${i}\n`);
  }
}

function commit(dir, message) {
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", message);
  return git(dir, "rev-parse", "HEAD");
}

/** A committed repository with one area, already scanned: a map of its own. */
async function scanned(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "anatomiya-refresh-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  init(dir);
  source(dir, "src", 8);
  commit(dir, "init");
  await runScan(dir);
  return dir;
}

/** A clone of a repository with a remote default branch, scanned, sitting on its tip. */
async function cloned(t) {
  const origin = realpathSync(mkdtempSync(join(tmpdir(), "anatomiya-refresh-origin-")));
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "anatomiya-refresh-clone-")));
  t.after(() => {
    rmSync(origin, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });
  init(origin);
  source(origin, "src", 8);
  commit(origin, "init");
  rmSync(dir, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", origin, dir], { stdio: "pipe" });
  git(dir, "config", "user.email", "t@t.test");
  git(dir, "config", "user.name", "T");
  git(dir, "config", "commit.gpgsign", "false");
  exclude(dir);
  await runScan(dir);
  return { origin, dir };
}

function recorder() {
  const started = [];
  return { started, start: (root) => started.push(root) };
}

/* --- the hook: what Claude Code sees --- */

test("a directory with no map of its own is answered with nothing, and nothing is started", async (t) => {
  // A plugin hook runs in every session for every directory, so its scoping is
  // its own (A24): a repository nobody scanned is never scanned behind its back.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "anatomiya-refresh-none-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  init(dir);
  source(dir, "src", 8);
  commit(dir, "init");
  const { started, start } = recorder();

  assert.deepEqual(runRefresh(dir, { hook_event_name: "SessionStart", cwd: dir }, { start }), {});
  assert.deepEqual(started, []);
  assert.equal(existsSync(join(dir, ".claude")), false, "nothing was created");
});

test("a checkout with its own map answers a session start with the git files to watch, and starts one refresh", async (t) => {
  const dir = await scanned(t);
  const { started, start } = recorder();

  const out = runRefresh(dir, { hook_event_name: "SessionStart", cwd: dir, source: "startup" }, { start });

  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  // Absolute, because the watcher joins nothing onto them. The reflog is
  // appended on every move of HEAD, a commit or a pull included; HEAD itself
  // changes only when the branch does.
  assert.deepEqual(out.hookSpecificOutput.watchPaths, [join(dir, ".git", "logs", "HEAD"), join(dir, ".git", "HEAD")]);
  assert.deepEqual(started, [dir]);
});

test("a watched file changing starts a refresh and names the watch again; any other event is silence", async (t) => {
  const dir = await scanned(t);
  const { started, start } = recorder();

  const out = runRefresh(dir, { hook_event_name: "FileChanged", cwd: dir, file_path: join(dir, ".git", "logs", "HEAD"), event: "change" }, { start });

  // Named again because the watch list is one list shared by every hook, and
  // the last to answer replaces it.
  assert.equal(out.hookSpecificOutput.hookEventName, "FileChanged");
  assert.equal(out.hookSpecificOutput.watchPaths.length, 2);
  assert.deepEqual(started, [dir]);

  for (const event of ["UserPromptSubmit", "PostToolUse", "Stop", undefined]) {
    assert.deepEqual(runRefresh(dir, { hook_event_name: event, cwd: dir }, { start }), {}, String(event));
  }
  assert.equal(started.length, 1);
});

test("a linked worktree with no map of its own is not refreshed through its main checkout's", async (t) => {
  // The hooks read the main checkout's map there, labelled as borrowed. A scan
  // run for it would write a map of the worktree's own, which nobody asked for.
  const dir = await scanned(t);
  const wt = join(realpathSync(mkdtempSync(join(tmpdir(), "anatomiya-refresh-wt-"))), "wt");
  t.after(() => rmSync(join(wt, ".."), { recursive: true, force: true }));
  git(dir, "worktree", "add", "-q", wt);
  const { started, start } = recorder();

  assert.deepEqual(runRefresh(wt, { hook_event_name: "SessionStart", cwd: wt }, { start }), {});
  assert.deepEqual(started, []);
});

test("a linked worktree with a map of its own watches its own HEAD", async (t) => {
  const dir = await scanned(t);
  const wt = join(realpathSync(mkdtempSync(join(tmpdir(), "anatomiya-refresh-wt-"))), "wt");
  t.after(() => rmSync(join(wt, ".."), { recursive: true, force: true }));
  git(dir, "worktree", "add", "-q", wt);
  await runScan(wt);
  const { started, start } = recorder();

  const out = runRefresh(wt, { hook_event_name: "SessionStart", cwd: wt }, { start });

  const own = join(dir, ".git", "worktrees", "wt");
  assert.deepEqual(out.hookSpecificOutput.watchPaths, [join(own, "logs", "HEAD"), join(own, "HEAD")]);
  assert.deepEqual(started, [wt]);
});

/* --- the worker: what happens to the repository --- */

test("a checkout that has not moved since the last refresh is left alone", async (t) => {
  const dir = await scanned(t);
  let scans = 0;
  const scan = async (root) => {
    scans++;
    return runScan(root);
  };

  assert.equal((await refreshRepository(dir, { scan })).reason, "scanned");
  assert.equal((await refreshRepository(dir, { scan })).reason, "current");
  assert.equal(scans, 1);
});

test("a moved HEAD is scanned again, and the map on disk is the new one", async (t) => {
  const dir = await scanned(t);
  await refreshRepository(dir);
  const before = readFileSync(join(dir, OVERVIEW), "utf8");

  source(dir, "lib/services", 8);
  commit(dir, "a second area");
  const r = await refreshRepository(dir);

  assert.equal(r.reason, "scanned");
  assert.notEqual(readFileSync(join(dir, OVERVIEW), "utf8"), before);
  assert.match(readFileSync(join(dir, OVERVIEW), "utf8"), /lib\/services/);
});

test("a refresh already running is not started twice", async (t) => {
  const dir = await scanned(t);
  // This process is alive, so its lock is live.
  writeFileSync(join(dir, ".claude", "anatomiya", "refresh.lock"), JSON.stringify({ pid: process.pid, at: Date.now() }));

  assert.equal((await refreshRepository(dir)).reason, "busy");
});

test("a lock left behind by a process that is gone is taken over", async (t) => {
  const dir = await scanned(t);
  writeFileSync(join(dir, ".claude", "anatomiya", "refresh.lock"), JSON.stringify({ pid: 2 ** 22 + 7, at: Date.now() }));

  assert.equal((await refreshRepository(dir)).reason, "scanned");
  assert.equal(existsSync(join(dir, ".claude", "anatomiya", "refresh.lock")), false, "and released after");
});

test("a merge, rebase or other operation git has not finished is left to finish", async (t) => {
  const dir = await scanned(t);
  writeFileSync(join(dir, ".git", "MERGE_HEAD"), `${git(dir, "rev-parse", "HEAD")}\n`);

  assert.equal((await refreshRepository(dir)).reason, "git-busy");
});

test("a map the repository tracks is never rewritten behind its back", async (t) => {
  // Committed maps travel with each branch already, and a rewrite would put a
  // change in `git status` that nobody made.
  const dir = await scanned(t);
  git(dir, "add", "-f", ".claude");
  git(dir, "commit", "-qm", "commit the map");

  assert.equal((await refreshRepository(dir)).reason, "tracked");
});

test("a map built with the type checker is refreshed with the checker it was built with", async (t) => {
  // Skipping it left `--deep` users running the scan by hand after every
  // checkout, and rescanning without the checker would drop the claims it
  // added. The mode the person chose is the mode it keeps (B7: never unasked).
  const dir = await scanned(t);
  const factsPath = join(dir, ".claude", "anatomiya", "facts.json");
  const facts = JSON.parse(readFileSync(factsPath, "utf8"));
  facts.semantic = { ...facts.semantic, ran: true };
  writeFileSync(factsPath, JSON.stringify(facts));
  const calls = [];
  const scan = async (root, options) => {
    calls.push(options);
  };

  assert.equal((await refreshRepository(dir, { scan })).reason, "scanned");
  assert.deepEqual(calls, [{ deep: true }]);
});

test("a map built without the checker is refreshed without it", async (t) => {
  const dir = await scanned(t);
  const calls = [];
  await refreshRepository(dir, { scan: async (root, options) => calls.push(options) });
  assert.deepEqual(calls, [{ deep: false }]);
});

test("a rescan that fails keeps the previous map, and the same state is not tried again", async (t) => {
  const dir = await scanned(t);
  source(dir, "lib/services", 8);
  commit(dir, "a second area");
  const before = readFileSync(join(dir, OVERVIEW), "utf8");
  let scans = 0;
  const scan = async () => {
    scans++;
    throw new Error("prism is not installed for this ruby");
  };

  const r = await refreshRepository(dir, { scan });

  assert.equal(r.reason, "failed");
  assert.equal(readFileSync(join(dir, OVERVIEW), "utf8"), before);
  const state = JSON.parse(readFileSync(join(dir, REFRESH_STATE), "utf8"));
  assert.equal(state.ok, false);
  assert.match(state.error, /prism is not installed/);
  assert.equal((await refreshRepository(dir, { scan })).reason, "failed-before");
  assert.equal(scans, 1);
});

/* --- the pin: moved only onto what the remote default branch already holds --- */

test("the pin follows the remote default branch when the checkout sits on its tip with nothing uncommitted", async (t) => {
  const { dir } = await cloned(t);

  const r = await refreshRepository(dir);

  assert.equal(r.pinned, true);
  assert.equal(loadPin(dir).sha, git(dir, "rev-parse", "HEAD"));
});

test("a feature branch is never pinned", async (t) => {
  const { dir } = await cloned(t);
  git(dir, "checkout", "-q", "-b", "feature");
  source(dir, "lib/agent", 8);
  commit(dir, "the branch's own code");

  const r = await refreshRepository(dir);

  assert.equal(r.pinned, false);
  assert.equal(existsSync(join(dir, PIN_PATH)), false);
});

test("commits the remote does not hold are never pinned", async (t) => {
  const { dir } = await cloned(t);
  source(dir, "lib/agent", 8);
  commit(dir, "committed on main, not pushed");

  assert.equal((await refreshRepository(dir)).pinned, false);
  assert.equal(existsSync(join(dir, PIN_PATH)), false);
});

test("uncommitted edits are never pinned", async (t) => {
  const { dir } = await cloned(t);
  writeFileSync(join(dir, "src", "f0.ts"), "export const a0 = 'edited'\n");

  assert.equal((await refreshRepository(dir)).pinned, false);
  assert.equal(existsSync(join(dir, PIN_PATH)), false);
});

test("a repository with no remote is never pinned automatically", async (t) => {
  // Nothing there says which commits anybody accepted, so the pin stays the
  // human's command (E5).
  const dir = await scanned(t);

  assert.equal((await refreshRepository(dir)).pinned, false);
  assert.equal(existsSync(join(dir, PIN_PATH)), false);
});

test("the pin moves forward with the remote, and the map is rebuilt against it", async (t) => {
  const { origin, dir } = await cloned(t);
  await refreshRepository(dir);
  const first = loadPin(dir).sha;

  source(origin, "lib/services", 8);
  commit(origin, "merged upstream");
  git(dir, "pull", "-q", "--ff-only");
  const r = await refreshRepository(dir);

  assert.equal(r.pinned, true);
  const second = loadPin(dir).sha;
  assert.notEqual(second, first);
  assert.equal(second, git(dir, "rev-parse", "HEAD"));
  // The stamp covers the pin's bytes, so a scan that ran before the pin moved
  // is not the one left on disk.
  assert.ok(statSync(join(dir, OVERVIEW)).mtimeMs >= statSync(join(dir, PIN_PATH)).mtimeMs);
});

/* --- end to end, through the declared hook --- */

test("the hook the plugin declares starts a real worker that brings the map up to date", async (t) => {
  const dir = await scanned(t);
  source(dir, "lib/services", 8);
  commit(dir, "a second area");
  const declared = JSON.parse(readFileSync(new URL("../plugins/anatomiya/hooks/hooks.json", import.meta.url), "utf8"));
  const root = new URL("../plugins/anatomiya", import.meta.url).pathname;

  for (const event of ["SessionStart", "FileChanged"]) {
    const [group] = declared.hooks[event];
    // Session start takes every source. FileChanged is matched on `HEAD`, the
    // basename both watches share: a plugin's matcher adds nothing to the watch
    // list, and without one the group ran for every other plugin's file.
    assert.equal(group.matcher, event === "FileChanged" ? "HEAD" : undefined, event);
    assert.equal(group.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" refresh', event);
  }

  const command = declared.hooks.SessionStart[0].hooks[0].command.replaceAll("${CLAUDE_PLUGIN_ROOT}", root);
  const started = Date.now();
  const out = execFileSync("sh", ["-c", command], {
    cwd: dir,
    input: JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd: dir }),
  }).toString();
  // The hook returns before the scan: a detached worker with its pipes closed
  // is what keeps a session's first response from waiting on it.
  assert.ok(Date.now() - started < 5000, "the hook answered within its timeout");
  assert.equal(JSON.parse(out).hookSpecificOutput.watchPaths[0], join(dir, ".git", "logs", "HEAD"));

  const state = join(dir, REFRESH_STATE);
  for (let i = 0; i < 200 && !existsSync(state); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(JSON.parse(readFileSync(state, "utf8")).ok, true);
  assert.match(readFileSync(join(dir, OVERVIEW), "utf8"), /lib\/services/);
  // And the lock is gone once the worker is: poll, since it releases in a finally.
  for (let i = 0; i < 50 && existsSync(join(dir, ".claude", "anatomiya", "refresh.lock")); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(existsSync(join(dir, ".claude", "anatomiya", "refresh.lock")), false);
});

test("a tip this clone pushed itself is not pinned until the remote moves past it", async (t) => {
  // Pushed is not reviewed: a session can run `git push` itself, and a pin
  // that followed that tip accepted the agent's own commits as the population
  // every gate reads (E5). Git records how the remote-tracking ref moved, and
  // `update by push` is this clone's own work; a fetch or a pull is the team's.
  const { origin, dir } = await cloned(t);
  await refreshRepository(dir);
  const first = loadPin(dir).sha;
  git(origin, "config", "receive.denyCurrentBranch", "updateInstead");
  source(dir, "lib/agent", 8);
  commit(dir, "the agent's own work");
  git(dir, "-c", "push.negotiate=false", "push", "-q", "origin", "HEAD:main");

  assert.equal((await refreshRepository(dir)).pinned, false);
  assert.equal(loadPin(dir).sha, first);

  source(origin, "lib/merged", 8);
  commit(origin, "a teammate's merge");
  git(dir, "pull", "-q", "--no-rebase");
  assert.equal((await refreshRepository(dir)).pinned, true, "a fetched tip is the team's");
  assert.equal(loadPin(dir).sha, git(dir, "rev-parse", "HEAD"));
});

test("a pin the repository commits is never rewritten behind its back", async (t) => {
  // A committed pin can never name the commit that holds it, so following the
  // tip would rewrite a tracked file on every refresh and leave a change in
  // `git status` nobody made, the state E11 says a pin is never taken from.
  const { origin, dir } = await cloned(t);
  await refreshRepository(dir);
  git(dir, "add", "-f", PIN_PATH);
  git(dir, "commit", "-qm", "commit the pin");
  git(origin, "config", "receive.denyCurrentBranch", "updateInstead");
  source(origin, "lib/merged", 8);
  commit(origin, "a teammate's merge");
  git(dir, "pull", "-q", "--no-rebase");
  const before = readFileSync(join(dir, PIN_PATH), "utf8");

  assert.equal((await refreshRepository(dir)).reason, "tracked");
  assert.equal(readFileSync(join(dir, PIN_PATH), "utf8"), before);
  assert.equal(git(dir, "status", "--porcelain", "--untracked-files=no"), "");
});

test("a remote-tracking ref moved by hand is not followed, only one a fetch moved", async (t) => {
  // `git update-ref refs/remotes/origin/main HEAD` needs no network and no
  // review, and moved the pin onto an unpushed commit. Only a move git records
  // as a clone, a fetch or a pull is the remote's own.
  const { dir } = await cloned(t);
  await refreshRepository(dir);
  const first = loadPin(dir).sha;
  source(dir, "lib/agent", 8);
  commit(dir, "never pushed");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");

  assert.equal((await refreshRepository(dir)).pinned, false);
  assert.equal(loadPin(dir).sha, first);
});

test("an automatic pin records what it accepted, for a person to read", async (t) => {
  const { origin, dir } = await cloned(t);
  await refreshRepository(dir);
  source(origin, "lib/merged", 8);
  commit(origin, "a teammate's merge");
  git(dir, "pull", "-q", "--no-rebase");

  await refreshRepository(dir);

  const state = JSON.parse(readFileSync(join(dir, REFRESH_STATE), "utf8"));
  assert.equal(state.pinned.to, git(dir, "rev-parse", "HEAD"));
  assert.equal(state.pinned.addedFiles, 8);
  assert.equal(state.pinned.removedFiles, 0);
});

test("a changed file that is not one of this hook's watches starts nothing and replaces no watch", async (t) => {
  // The watch list is one list: a FileChanged group with no matcher ran for
  // another plugin's `.envrc`, and answering watchPaths there replaced that
  // plugin's watch with ours.
  const dir = await scanned(t);
  const { started, start } = recorder();

  assert.deepEqual(runRefresh(dir, { hook_event_name: "FileChanged", cwd: dir, file_path: join(dir, ".envrc"), event: "change" }, { start }), {});
  assert.deepEqual(started, []);
  const declared = JSON.parse(readFileSync(new URL("../plugins/anatomiya/hooks/hooks.json", import.meta.url), "utf8"));
  assert.equal(declared.hooks.FileChanged[0].matcher, "HEAD", "matched on the basename both watches share");
});

test("a rescan that failed is tried again once enough time has passed", async (t) => {
  // A failure can be the machine's rather than the checkout's: a temp directory
  // removed under a worker, a fork refused under load. Held for ever against the
  // same stamp, one bad moment stopped every refresh until the next commit.
  const dir = await scanned(t);
  source(dir, "lib/services", 8);
  commit(dir, "a second area");
  assert.equal((await refreshRepository(dir, { scan: async () => { throw new Error("EAGAIN"); } })).reason, "failed");
  assert.equal((await refreshRepository(dir)).reason, "failed-before", "not straight away");

  const statePath = join(dir, REFRESH_STATE);
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  writeFileSync(statePath, JSON.stringify({ ...state, at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }));

  assert.equal((await refreshRepository(dir)).reason, "scanned");
});
