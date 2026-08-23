import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, execFileSync } from "node:child_process";

import { needsPosixSpecialFiles, needsUnreadableDirs } from "./platform.mjs";
import { echoContext, planRemoval, commitRemoval, HOOK_COMMAND, PAYLOAD_WAIT_MS, SETTINGS_PATH } from "../plugins/anatomiya/lib/hook.mjs";
import { HEAD_BYTES } from "../plugins/anatomiya/lib/rules.mjs";
import { ANATOMIYA } from "../scripts/plugins.mjs";

/** The three entries 0.2.4 through 0.2.6 wrote into a scanned repository. */
const OLD_SETTINGS = {
  hooks: {
    UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo' }] }],
    PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo' }] }],
    PostToolUseFailure: [{ matcher: "*", hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo' }] }],
  },
};

/** A repository with a map already written, the state a scan leaves behind. */
function mapped(t, body = "---\ngenerator: anatomiya\n---\n\n# Repository map\n\n- lib: 3 .mjs\n") {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-hook-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".claude", "rules"), { recursive: true });
  writeFileSync(join(dir, ".claude", "rules", "anatomiya-overview.md"), body);
  return dir;
}

const settings = (dir) => JSON.parse(readFileSync(join(dir, SETTINGS_PATH), "utf8"));

// --- what the hook says ------------------------------------------------------

test("the echoed map is stamped with the moment it was read", (t) => {
  const dir = mapped(t);
  const now = new Date("2026-08-19T04:20:00Z");

  const out = echoContext(dir, { now });

  assert.match(out, /delivered="2026-08-19T04:20:00\.000Z"/);
  assert.match(out, /# Repository map/);
  assert.doesNotMatch(out, /generator: anatomiya/, "the frontmatter is delivery metadata, not content");
});

test("the map is found from anywhere inside the repository, not only from its root", (t) => {
  // A hook fires with the session's own working directory, which is wherever
  // the model happens to be, and the map is written once at the root. Joining
  // the two without walking up answered `{}` from one directory down, silently,
  // for the rest of the session. Walked rather than asked of git: this runs on
  // every tool call, and a subprocess per call to learn a path is a subprocess
  // per call.
  const dir = mapped(t);
  mkdirSync(join(dir, "src", "deep", "deeper"), { recursive: true });

  assert.match(echoContext(join(dir, "src", "deep", "deeper"), {}), /# Repository map/);
  assert.match(echoContext(join(dir, "src"), {}), /# Repository map/);
});

test("the walk stops at a repository boundary: a worktree or submodule below the scanned checkout gets nothing", (t) => {
  // A worktree and a submodule both mark their root with a `.git` file, and the
  // hook fires with the session's cwd, which may be inside either. The walk
  // crossed that marker and served the enclosing checkout's map, stamped as
  // re-read just now, into a session whose branch the counts never described.
  // Probed with `git worktree add` inside the checkout (Claude Code's own
  // `.claude/worktrees/` layout): the main checkout's map came back every time.
  const dir = mapped(t);
  const wt = join(dir, ".claude", "worktrees", "w");
  mkdirSync(join(wt, "src"), { recursive: true });
  writeFileSync(join(wt, ".git"), "gitdir: /elsewhere\n");

  assert.equal(echoContext(wt, {}), null);
  assert.equal(echoContext(join(wt, "src"), {}), null);
});

test("the walk stops at a repository boundary: a nested repository gets nothing, not the parent's map", (t) => {
  // An independent repository nested below the scanned one carries a `.git`
  // directory, the other shape of the same boundary. The walk crossed it too,
  // so the nested repo's sessions were handed the parent's counts.
  const dir = mapped(t);
  mkdirSync(join(dir, "nested", ".git"), { recursive: true });
  mkdirSync(join(dir, "nested", "src"));

  assert.equal(echoContext(join(dir, "nested", "src"), {}), null);
});

test("the checkout that owns the map still answers from anywhere below its root", (t) => {
  // The boundary stop must not eat the ordinary case: a scanned checkout holds
  // its marker at the same level its map is found at, so the map has to win
  // there before the boundary is consulted. Both shapes of the marker, since a
  // scanned worktree's own is the file one.
  for (const [name, mark] of [
    ["directory", (dir) => mkdirSync(join(dir, ".git"))],
    ["file", (dir) => writeFileSync(join(dir, ".git"), "gitdir: /elsewhere\n")],
  ]) {
    const dir = mapped(t);
    mark(dir);
    mkdirSync(join(dir, "src", "deep"), { recursive: true });

    assert.match(echoContext(dir, {}), /# Repository map/, name);
    assert.match(echoContext(join(dir, "src", "deep"), {}), /# Repository map/, name);
  }
});

test("a nested repository that was scanned answers with its own map, not the one above it", (t) => {
  // The other side of the boundary: the stop is what a nested checkout hears
  // when nobody scanned it, and its own map is what it hears when somebody did.
  const dir = mapped(t);
  mkdirSync(join(dir, ".git"));
  const nested = join(dir, "nested");
  mkdirSync(join(nested, ".git"), { recursive: true });
  mkdirSync(join(nested, ".claude", "rules"), { recursive: true });
  writeFileSync(
    join(nested, ".claude", "rules", "anatomiya-overview.md"),
    "---\ngenerator: anatomiya\n---\n\n# Nested map\n"
  );
  mkdirSync(join(nested, "src"));

  assert.match(echoContext(nested, {}), /# Nested map/, "the nearest map wins, not the parent's");
  assert.match(echoContext(join(nested, "src"), {}), /# Nested map/, "and from below its own root too");
});

test("a boundary marker that is a broken link is still a boundary", (t) => {
  // `existsSync` follows a link, so a `.git` pointing at a target that has gone
  // answered no-marker and the walk crossed into the enclosing checkout's map:
  // the failure this stop exists to prevent, through a rarer door. A worktree
  // whose repository moved leaves exactly that shape.
  const dir = mapped(t);
  const wt = join(dir, "wt");
  mkdirSync(wt);
  symlinkSync(join(dir, "gone"), join(wt, ".git"));

  assert.equal(echoContext(wt, {}), null);
});

test("a working directory reached through a link is read where it really is", (t) => {
  // `resolve` normalises `..` and follows no link, so a session whose cwd
  // reaches the checkout through a link walked the link's own parents instead
  // of the repository's: the boundary is stepped around entirely, and a map
  // above the link's location is served for code that is not under it. Same
  // reasoning F2 already applies to the settings write one function down.
  const dir = mapped(t);
  const real = mkdtempSync(join(tmpdir(), "anatomiya-real-"));
  t.after(() => rmSync(real, { recursive: true, force: true }));
  mkdirSync(join(real, ".git"));
  mkdirSync(join(real, "src"));
  symlinkSync(join(real, "src"), join(dir, "link"));

  assert.equal(echoContext(join(dir, "link"), {}), null, "the link's parents are not the code's");
});

test("a level this cannot read is a boundary, not a thrown hook", needsUnreadableDirs, (t) => {
  // `existsSync` answered false for a path it may not look at; `lstat` refuses
  // with EACCES, and nothing between here and the process catches it, so the
  // hook exited 1 with a stack on its way out, which is the one thing a hook
  // must never do. Two answers cover it, because they cover different levels:
  // the start of the walk cannot be resolved, and a level reached later cannot
  // be looked at. Either alone answers this fixture; what is pinned here is the
  // guarantee rather than which of them delivered it.
  const dir = mapped(t);
  const locked = join(dir, "locked");
  mkdirSync(join(locked, "inner"), { recursive: true });
  chmodSync(locked, 0o000);

  // Restored here rather than in an `after`: the fixture registers its own
  // removal first, and a directory nobody may read cannot be removed.
  try {
    // Two levels, because each answer covers one of them and the other is
    // where it never runs. Below the denial the walk cannot resolve its own
    // start; at the denial it resolves, and asking for the marker is what
    // refuses.
    assert.equal(echoContext(join(locked, "inner"), {}), null, "below the level nobody may read");
    assert.equal(echoContext(locked, {}), null, "and at it, where the marker is what refuses");
  } finally {
    chmodSync(locked, 0o755);
  }
});

test("a working directory that will not resolve answers no map, rather than one from the path it was spelled", (t) => {
  // The lexical spelling of an unresolvable path still has parents, and one of
  // them here holds a map. Walking it would deliver counts for code the cwd is
  // not under, which is the hole this closes from the other side: the reader
  // cannot say where it is, so it cannot say the map above is about it.
  const dir = mapped(t);
  symlinkSync(join(dir, "nowhere"), join(dir, "broken"));

  assert.equal(echoContext(join(dir, "broken", "deep"), {}), null);
});

test("the walk up stops at the filesystem root rather than running off it", (t) => {
  // A path with no map above it anywhere answers null, and does so without
  // walking forever or throwing at the top.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-hook-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "a", "b", "c"), { recursive: true });

  assert.equal(echoContext(join(dir, "a", "b", "c"), {}), null);
});

test("the frontmatter comes off however the file's line endings are written", (t) => {
  // `isOwned` in rules.mjs already reads a leading BOM and CRLF, because a map
  // written or re-saved on Windows has both. This strip did not, so the
  // delivery metadata leaked into the echoed body as content.
  for (const [name, body] of [
    ["CRLF", "---\r\ngenerator: anatomiya\r\n---\r\n\r\n# Repository map\r\n"],
    ["BOM", "﻿---\ngenerator: anatomiya\n---\n\n# Repository map\n"],
    ["BOM and CRLF", "﻿---\r\ngenerator: anatomiya\r\n---\r\n\r\n# Repository map\r\n"],
  ]) {
    const dir = mapped(t, body);
    const out = echoContext(dir, {});
    assert.doesNotMatch(out, /generator: anatomiya/, name);
    assert.match(out, /# Repository map/, name);
  }
});

test("a file at our path this tool did not write is not echoed", (t) => {
  // The writer refuses to touch a file it does not own and the check reports
  // one, while the read path went by filename alone: anything at that exact
  // path reached the model on every turn. It matters more now that the hook is
  // the plugin's and runs in every session rather than only in a scanned one.
  const dir = mapped(t, "---\ngenerator: somebody-else\n---\n\n# not ours\n");

  assert.equal(echoContext(dir), null);
});

test("a map with no frontmatter at all is not echoed either", (t) => {
  const dir = mapped(t, "# Repository map\n\n- lib: 3 .mjs\n");

  assert.equal(echoContext(dir), null);
});

test("a map past the size a rule file may be is not echoed", (t) => {
  // Ownership is a frontmatter test, so a file carrying our key and five
  // megabytes of anything else passed it and all five megabytes went into the
  // model's context, on every prompt and every tool call. `HEAD_BYTES` is the
  // size this repository already decided a rule file may be, measured off its
  // own longest cover; past it the file is not one this tool wrote.
  const dir = mapped(t);
  const path = join(dir, ".claude", "rules", "anatomiya-overview.md");
  writeFileSync(path, `---\ngenerator: anatomiya\n---\n\n# Repository map\n\n${"x".repeat(HEAD_BYTES)}\n`);

  assert.equal(echoContext(dir), null);
});

test("a map filling the cap exactly is still echoed", (t) => {
  // The boundary in the direction that matters: a real map is kilobytes, and a
  // cap that refused one at its own edge is a map that vanishes for a reason
  // nobody can see.
  const dir = mapped(t);
  const head = "---\ngenerator: anatomiya\n---\n\n";
  writeFileSync(join(dir, ".claude", "rules", "anatomiya-overview.md"), head + "x".repeat(HEAD_BYTES - head.length));

  assert.match(echoContext(dir), /<repository-map delivered="/);
});

test("a named pipe at the map's path answers nothing rather than blocking", (t) => {
  // The read runs on every turn and every tool call, so a path that never
  // returns is a session that never returns: measured, the read on a fifo there
  // never came back at all. Run as a process with a budget, because a
  // synchronous call that hangs cannot be failed from inside this one.
  const dir = mapped(t);
  const path = join(dir, ".claude", "rules", "anatomiya-overview.md");
  rmSync(path);
  execFileSync("mkfifo", [path]);

  const run = spawnSync(process.execPath, [fileURLToPath(new URL("../plugins/anatomiya/bin/anatomiya.mjs", import.meta.url)), "echo"], {
    cwd: dir,
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit" }),
    encoding: "utf8",
    timeout: 10_000,
  });

  assert.equal(run.signal, null, "it came back on its own");
  assert.equal(run.status, 0);
  assert.deepEqual(JSON.parse(run.stdout), {});
});

test("a foreign map below the root does not hide the real one above it", (t) => {
  // The walk committed to the first file it found and only then asked whose it
  // was, so a hand-written file in a subdirectory silenced the repository's own
  // map for every session under that directory. Whose it is decides whether the
  // walk stops, not only whether it answers.
  const dir = mapped(t);
  const below = join(dir, "sub");
  mkdirSync(join(below, ".claude", "rules"), { recursive: true });
  writeFileSync(join(below, ".claude", "rules", "anatomiya-overview.md"), "---\ngenerator: nobody\n---\n\n# theirs\n");

  assert.match(echoContext(below), /# Repository map/, "the root's map, walked past the foreign one");
});

test("a repository with no map echoes nothing rather than an empty map", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-hook-"));
  assert.equal(echoContext(dir, {}), null);
  rmSync(dir, { recursive: true, force: true });
});

test("the echo says the code outranks it, because a stale map is the failure it has", (t) => {
  const dir = mapped(t);
  const out = echoContext(dir, {});
  assert.match(out, /the code is right and the map is stale/);
  assert.match(out, /anatomiya scan/);
});

// --- what it writes ----------------------------------------------------------

// --- where the hook is declared ---------------------------------------------

test("the plugin declares the hook itself, in the one file the variable works in", () => {
  // `${CLAUDE_PLUGIN_ROOT}` is substituted only for hooks a plugin declares in
  // its own `hooks/hooks.json`. Written into a repository's settings it is not
  // substituted at all: Claude Code refuses the hook by name on every prompt
  // and every tool call, which is worse than no hook, and it shipped that way
  // in 0.2.4 through 0.2.6.
  const declared = JSON.parse(readFileSync(new URL("../plugins/anatomiya/hooks/hooks.json", import.meta.url), "utf8"));

  // The top-level key is not decoration: without it the file loads nothing and
  // says nothing about it.
  assert.deepEqual(Object.keys(declared), ["hooks"]);
  assert.deepEqual(Object.keys(declared.hooks).sort(), ["PostToolUse", "PostToolUseFailure", "UserPromptSubmit"]);

  for (const [event, groups] of Object.entries(declared.hooks)) {
    assert.ok(Array.isArray(groups) && groups.length === 1, event);
    assert.deepEqual(groups[0].hooks.map((h) => h.type), ["command"], event);
    assert.equal(groups[0].hooks[0].command, HOOK_COMMAND, event);
  }
});

test("the declared command runs a file this plugin actually ships", () => {
  // The whole defect was a command nothing resolved. The path inside it is
  // checked here rather than trusted, against the tree this test runs in.
  const declared = JSON.parse(readFileSync(new URL("../plugins/anatomiya/hooks/hooks.json", import.meta.url), "utf8"));
  const command = declared.hooks.UserPromptSubmit[0].hooks[0].command;
  const target = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"']+)/.exec(command);

  assert.ok(target, command);
  // Resolved against the plugin's own root, which is what the loader
  // substitutes the variable for.
  assert.ok(existsSync(join(ANATOMIYA, target[1])), target[1]);
});

test("the declared command, run the way the loader runs it, echoes the map", (t) => {
  // The one end-to-end this can do without a session: substitute the variable
  // the loader substitutes, run the command it declares, and read what comes
  // back. Every other test here calls the function directly, which is exactly
  // why the broken declaration shipped three times.
  const dir = mapped(t);
  const declared = JSON.parse(readFileSync(new URL("../plugins/anatomiya/hooks/hooks.json", import.meta.url), "utf8"));
  const root = ANATOMIYA.replace(/\/$/, "");
  const command = declared.hooks.UserPromptSubmit[0].hooks[0].command.replace("${CLAUDE_PLUGIN_ROOT}", root);

  const run = spawnSync(command, {
    cwd: dir,
    shell: true,
    // `node --test` has no per-case timeout of its own, so a hook that never
    // answers holds this file open with nothing said about which case.
    timeout: 10_000,
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit" }),
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.signal === null ? run.stderr : `killed by ${run.signal}: the hook did not answer`);
  const answer = JSON.parse(run.stdout);
  assert.equal(answer.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(answer.hookSpecificOutput.additionalContext, /<repository-map delivered="/);
  assert.match(answer.hookSpecificOutput.additionalContext, /# Repository map/);
});

test("the same command in a repository with no map answers an empty object", (t) => {
  // A plugin hook runs in every session, so this is the answer most of the time
  // and it has to cost nothing and disturb nothing.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-nomap-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const declared = JSON.parse(readFileSync(new URL("../plugins/anatomiya/hooks/hooks.json", import.meta.url), "utf8"));
  const root = ANATOMIYA.replace(/\/$/, "");
  const command = declared.hooks.PostToolUse[0].hooks[0].command.replace("${CLAUDE_PLUGIN_ROOT}", root);

  const run = spawnSync(command, {
    cwd: dir,
    shell: true,
    // `node --test` has no per-case timeout of its own, so a hook that never
    // answers holds this file open with nothing said about which case.
    timeout: 10_000,
    input: JSON.stringify({ hook_event_name: "PostToolUse" }),
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.signal === null ? run.stderr : `killed by ${run.signal}: the hook did not answer`);
  assert.deepEqual(JSON.parse(run.stdout), {});
});

// --- what a scan does to a repository that carries the old one ---------------

test("the hook an older version wrote is taken out, and the file with it when nothing is left", (t) => {
  // 0.2.4 through 0.2.6 wrote this, and Claude Code refuses it by name on every
  // prompt and every tool call. An upgrade has to unbreak the repositories the
  // older version broke, or the fix reaches only repositories nobody scanned.
  const dir = mapped(t);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), JSON.stringify(OLD_SETTINGS, null, 2));

  const plan = planRemoval(dir);
  commitRemoval(dir, plan);

  assert.equal(plan.changed, true);
  assert.equal(existsSync(join(dir, SETTINGS_PATH)), false, "the file held nothing else");
});

test("settings this did not write are left exactly as they were", (t) => {
  const dir = mapped(t);
  const mine = {
    permissions: { allow: ["Bash(bundle exec rspec:*)"], deny: [], ask: [] },
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "bash ./block-heroku.sh" }] }],
      PostToolUse: [
        { matcher: "Edit", hooks: [{ type: "command", command: "bash ./fmt.sh" }] },
        { matcher: "*", hooks: [{ type: "command", command: HOOK_COMMAND }] },
      ],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: HOOK_COMMAND }] }],
    },
  };
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), JSON.stringify(mine, null, 2));

  commitRemoval(dir, planRemoval(dir));

  const s = settings(dir);
  assert.deepEqual(s.permissions, mine.permissions, "the permission lists are untouched");
  assert.deepEqual(s.hooks.PreToolUse, mine.hooks.PreToolUse, "another event's hook is untouched");
  assert.equal(s.hooks.PostToolUse.length, 1, "ours goes and the sibling stays");
  assert.equal(s.hooks.PostToolUse[0].hooks[0].command, "bash ./fmt.sh");
  assert.equal("UserPromptSubmit" in s.hooks, false, "an event holding only ours goes with it");
});

test("a repository with no settings of its own is left without one", (t) => {
  const dir = mapped(t);

  const plan = planRemoval(dir);
  commitRemoval(dir, plan);

  assert.equal(plan.changed, false);
  assert.equal(existsSync(join(dir, SETTINGS_PATH)), false, "nothing is created to then be emptied");
});

test("taking it out twice is the same as taking it out once", (t) => {
  const dir = mapped(t);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), JSON.stringify({ permissions: { allow: [] }, ...OLD_SETTINGS }, null, 2));

  commitRemoval(dir, planRemoval(dir));
  const after = readFileSync(join(dir, SETTINGS_PATH), "utf8");
  const again = planRemoval(dir);

  assert.equal(again.changed, false);
  commitRemoval(dir, again);
  assert.equal(readFileSync(join(dir, SETTINGS_PATH), "utf8"), after, "byte-identical");
});

test("a command that names this tool is ours however it was spelled", (t) => {
  // The removal has to reach what an older version wrote, not only what this
  // one would write, and the quoting around the path has changed once already.
  const dir = mapped(t);
  const spellings = [
    'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo',
    "node ${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs echo",
    'node "/Users/somebody/.claude/plugins/cache/crisnahine/anatomiya/0.2.5/bin/anatomiya.mjs" echo',
  ];
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(
    join(dir, SETTINGS_PATH),
    JSON.stringify({ hooks: { UserPromptSubmit: spellings.map((command) => ({ hooks: [{ type: "command", command }] })) } })
  );

  commitRemoval(dir, planRemoval(dir));

  assert.equal(existsSync(join(dir, SETTINGS_PATH)), false, "every spelling of ours went");
});

test("a settings path that leaves the repository is refused, and the file it pointed at is untouched", (t) => {
  // F2, applied to the file this no longer writes but still has to clean. A
  // tracked `.claude/settings.local.json -> ../../victim.json` survives a
  // clone, and `join` normalises `..` while resolving no link, so a rewrite
  // here would land in a file the repository does not own.
  const dir = mapped(t);
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-victim-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const victim = join(outside, "important.json");
  const body = JSON.stringify(OLD_SETTINGS);
  writeFileSync(victim, body);

  mkdirSync(join(dir, ".claude"), { recursive: true });
  symlinkSync(victim, join(dir, SETTINGS_PATH));

  assert.throws(() => planRemoval(dir), /outside|escape|left alone/i);
  assert.equal(readFileSync(victim, "utf8"), body, "the file it pointed at is untouched");
});

test("a .claude directory that is a link out of the repository is refused too", (t) => {
  const dir = mapped(t);
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-victim-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "settings.local.json"), JSON.stringify(OLD_SETTINGS));

  rmSync(join(dir, ".claude"), { recursive: true, force: true });
  symlinkSync(outside, join(dir, ".claude"));

  assert.throws(() => planRemoval(dir), /outside|escape|left alone/i);
  assert.ok(existsSync(join(outside, "settings.local.json")), "nothing there was removed");
});

test("settings that do not parse are refused, never rewritten", (t) => {
  const dir = mapped(t);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), "{ this is not json");

  assert.throws(() => planRemoval(dir), /could not be read/);
  assert.equal(readFileSync(join(dir, SETTINGS_PATH), "utf8"), "{ this is not json", "left alone");
});

test("a hooks block that is not an object is refused, not spread into one", (t) => {
  // A25's rule, on the reading side: a writer that reads a shape it does not
  // understand as the shape it expected is a writer that mangles it.
  for (const hooks of ['"PreToolUse"', '[{"matcher":"Bash"}]', "42"]) {
    const dir = mapped(t);
    const body = `{"permissions":{"allow":["Bash(x)"]},"hooks":${hooks}}`;
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, SETTINGS_PATH), body);

    assert.throws(() => planRemoval(dir), /hooks/, hooks);
    assert.equal(readFileSync(join(dir, SETTINGS_PATH), "utf8"), body, `${hooks} left alone`);
  }
});

test("a file that holds no hooks at all is nothing to change", (t) => {
  const dir = mapped(t);
  const body = '{"permissions":{"allow":["Bash(x)"]},"hooks":null}';
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), body);

  const plan = planRemoval(dir);

  assert.equal(plan.changed, false);
  commitRemoval(dir, plan);
  assert.equal(readFileSync(join(dir, SETTINGS_PATH), "utf8"), body, "left alone");
});

test("an event whose value is not a list is refused, not spread into characters", (t) => {
  const dir = mapped(t);
  const body = '{"hooks":{"PostToolUse":"bash ./fmt.sh"}}';
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), body);

  assert.throws(() => planRemoval(dir), /PostToolUse/);
  assert.equal(readFileSync(join(dir, SETTINGS_PATH), "utf8"), body, "left alone");
});

test("the plan is committed to the root it was planned for and no other", (t) => {
  const a = mapped(t);
  const b = mapped(t);
  assert.throws(() => commitRemoval(b, planRemoval(a)), /planned for/);
});

// --- what the hook survives --------------------------------------------------

const ECHO = fileURLToPath(new URL("../plugins/anatomiya/bin/anatomiya.mjs", import.meta.url));

/** The timeout the declaration asks Claude Code for, in milliseconds. */
const DECLARED =
  JSON.parse(readFileSync(new URL("../plugins/anatomiya/hooks/hooks.json", import.meta.url), "utf8")).hooks.UserPromptSubmit[0].hooks[0].timeout * 1000;

/**
 * A close, or a failure that names the wait rather than hanging the file.
 *
 * `node --test` has no per-case timeout of its own, so a hook that never
 * answers takes the whole run with it and says nothing about which case. The
 * child is killed on the way out: left running, it holds its pipes open and the
 * run hangs after the case has already been reported, which is the failure this
 * is here to avoid, one step later.
 */
async function within({ child, closed }, ms) {
  let timer;
  const raced = await Promise.race([
    closed,
    new Promise((r) => { timer = setTimeout(() => r("hung"), ms); }),
  ]);
  clearTimeout(timer);
  if (raced === "hung") child.kill("SIGKILL");
  assert.notEqual(raced, "hung", `the hook had not answered after ${ms}ms`);
  return raced;
}

/** The hook as a process, with its two pipes under the test's control. */
function hookProcess(dir) {
  const child = spawn(process.execPath, [ECHO, "echo"], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.on("error", () => {});
  return { child, closed: new Promise((r) => child.on("close", (code) => r({ code, stderr }))) };
}

test("the hook exits 0 when its reader goes away before it answers", async (t) => {
  // A hook that fails is worse than a hook nobody read: a non-zero exit
  // interrupts the run it exists to help, on every turn and every tool call for
  // the life of that session. The ordering is forced rather than timed, since
  // the hook cannot write before it has read the payload.
  const dir = mapped(t);

  // Three times, because the forcing is an argument and not a measurement: if
  // the read ever did finish before the destroy landed, once would be a pass
  // and the defect would come back as a flake nobody could place.
  for (let i = 0; i < 3; i++) {
    const hook = hookProcess(dir);
    const { child } = hook;
    child.stdout.on("error", () => {});
    child.stdout.destroy();
    child.stdin.end(JSON.stringify({ hook_event_name: "UserPromptSubmit" }));

    const { code, stderr } = await within(hook, 8000);
    assert.equal(code, 0, stderr);
  }
});

test("the hook gives up on a payload that never arrives", async (t) => {
  // A caller that opens the pipe and writes nothing held an unbounded read for
  // as long as it kept the handle. The bound is the hook's own and well under
  // the five seconds the declaration asks Claude Code for.
  const dir = mapped(t);
  const hook = hookProcess(dir);
  const { child } = hook;
  child.stdout.resume();

  const started = Date.now();
  let timer;
  const raced = await Promise.race([
    hook.closed,
    new Promise((r) => { timer = setTimeout(() => r("hung"), DECLARED); }),
  ]);
  clearTimeout(timer);
  if (raced === "hung") child.kill("SIGKILL");

  assert.notEqual(raced, "hung", `the hook was still waiting on an empty pipe after the ${DECLARED}ms it declares`);
  assert.equal(raced.code, 0, raced.stderr);
  // Against the hook's own bound, not the declaration: the race above already
  // caps at the declaration, so measuring against it was an assertion nothing
  // could fail. The slack is process start and module load, which a cold run
  // pays. The bound itself is held to the declaration by the case below, since
  // read from the module this alone would move with whatever it was set to.
  const elapsed = Date.now() - started;
  assert.ok(elapsed < PAYLOAD_WAIT_MS + 1500, `the hook's own bound is ${PAYLOAD_WAIT_MS}ms and it answered after ${elapsed}ms`);
});

// Two numbers, each read from where it lives: what the hook gives itself and
// what the declaration asks Claude Code for. The one has to leave room for the
// other, or a read that ends in time is a hook that answers too late anyway,
// and the elapsed check above cannot see it because it reads the same constant.
test("the payload read gives itself less than half the timeout the declaration asks for", () => {
  assert.ok(
    PAYLOAD_WAIT_MS * 2 <= DECLARED,
    `the read waits ${PAYLOAD_WAIT_MS}ms of the ${DECLARED}ms declared, leaving ${DECLARED - PAYLOAD_WAIT_MS}ms for everything else`
  );
});

test("a payload that arrived whole is answered even when the pipe stays open", async (t) => {
  // The bound exists for a caller that says nothing, not for one that said
  // everything and did not close the handle. Throwing away what arrived costs
  // that turn its map for no reason, and the second plugin's copy of the same
  // bound keeps what it has.
  const dir = mapped(t);
  const hook = hookProcess(dir);
  const { child } = hook;
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stdin.write(JSON.stringify({ hook_event_name: "UserPromptSubmit" }));

  const { code, stderr } = await within(hook, 8000);
  child.stdin.destroy();

  assert.equal(code, 0, stderr);
  assert.match(JSON.parse(stdout).hookSpecificOutput.additionalContext, /# Repository map/);
});

test("half a payload is still not a payload, however long the pipe stays open", async (t) => {
  const dir = mapped(t);
  const hook = hookProcess(dir);
  const { child } = hook;
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stdin.write('{"hook_event_name":"UserProm');

  const { code, stderr } = await within(hook, 8000);
  child.stdin.destroy();

  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), {});
});

test("a payload past the cap is answered rather than read whole", async (t) => {
  // Whatever the far end sends, the hook pays for a megabyte of it at most: it
  // runs on every tool call, and the writer decides the size.
  const dir = mapped(t);
  const hook = hookProcess(dir);
  const { child } = hook;
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stdin.end(`{"hook_event_name":"UserPromptSubmit","pad":"${"x".repeat(3 * 1024 * 1024)}"}`);

  const { code, stderr } = await within(hook, 8000);
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), {}, "an oversize payload is not the event it claims to be");
});


test("a settings path that is not a file is refused rather than opened and waited on", needsPosixSpecialFiles, (t) => {
  // `readFileSync` types nothing and waits for a writer, and this runs on every
  // scan, so a fifo left at that path holds the command for ever with nothing
  // printed. The module's own `readHead` opens with O_NONBLOCK and stats the
  // handle before a byte is read, which is the rule the docstring above states
  // and this one read did not follow.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-settings-fifo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  execFileSync("mkfifo", [join(dir, SETTINGS_PATH)]);

  // Driven in a child with a bound, because the read is synchronous: an
  // unbounded open stops this process's event loop, so a case that waits in
  // place takes the whole file down before it can assert anything, and the
  // reporter never flushes the cases that already passed.
  const script = `import { planRemoval } from ${JSON.stringify(new URL("../plugins/anatomiya/lib/hook.mjs", import.meta.url).href)};
    try { planRemoval(${JSON.stringify(dir)}); process.stdout.write("no refusal"); }
    catch (err) { process.stdout.write(err.message); }`;

  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 8000 });

  assert.equal(run.signal, null, `still waiting on the fifo after 8 seconds: killed by ${run.signal}`);
  assert.match(run.stdout, /could not be read/, run.stdout || run.stderr);
});

test("a settings file larger than the cap is refused, not read whole", (t) => {
  // The read had no bound at all, so whatever sits at that path is the cost of
  // every scan. Everything else this module reads goes through one cap.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-settings-big-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), `{"pad":"${"x".repeat(2 * 1024 * 1024)}"}`);

  assert.throws(() => planRemoval(dir), /could not be read/);
});
