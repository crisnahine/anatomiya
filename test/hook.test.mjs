import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { needsUnreadableDirs } from "./platform.mjs";
import { echoContext, planHook, commitHook, HOOK_COMMAND, SETTINGS_PATH } from "../lib/hook.mjs";

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

test("a repository with no settings of its own is given only what the hook needs", (t) => {
  const dir = mapped(t);

  const plan = planHook(dir);
  commitHook(dir, plan);

  const s = settings(dir);
  assert.deepEqual(Object.keys(s), ["hooks"], "nothing else is invented");
  assert.equal(s.hooks.UserPromptSubmit[0].hooks[0].command, HOOK_COMMAND);
  assert.equal(s.hooks.PostToolUse[0].matcher, "*", "every tool, which is what every move means");
  // A tool call that failed is still a move, and `PostToolUse` fires only when
  // one succeeds: the failure is its own event, so a run of denied edits or
  // failing commands would otherwise be the run that hears the map least.
  assert.equal(s.hooks.PostToolUseFailure[0].matcher, "*");
});

test("settings this did not write are left exactly as they were", (t) => {
  const dir = mapped(t);
  const mine = {
    permissions: { allow: ["Bash(bundle exec rspec:*)"], deny: [], ask: [] },
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "bash ./block-heroku.sh" }] }],
      PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "bash ./fmt.sh" }] }],
    },
  };
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), JSON.stringify(mine, null, 2));

  commitHook(dir, planHook(dir));

  const s = settings(dir);
  assert.deepEqual(s.permissions, mine.permissions, "the permission lists are untouched");
  assert.deepEqual(s.hooks.PreToolUse, mine.hooks.PreToolUse, "another event's hook is untouched");
  assert.equal(s.hooks.PostToolUse[0].hooks[0].command, "bash ./fmt.sh", "and so is a sibling on the same event");
  assert.equal(s.hooks.PostToolUse.length, 2, "ours is added beside it, not over it");
});

test("installing twice adds one hook, not two", (t) => {
  const dir = mapped(t);
  commitHook(dir, planHook(dir));
  commitHook(dir, planHook(dir));

  const s = settings(dir);
  assert.equal(s.hooks.UserPromptSubmit.length, 1);
  assert.equal(s.hooks.PostToolUse.length, 1);
});

test("a settings path that leaves the repository is refused, and the file it pointed at is untouched", (t) => {
  // F2, applied to the one write outside `.claude/rules/`. A tracked
  // `.claude/settings.local.json -> ../../victim.json` survives a clone, and
  // `join` normalises `..` while resolving no link, so the install landed in a
  // file the repository does not own. Verified against a real scan before this
  // test existed: a JSON file two directories up came back with our hooks in it.
  const dir = mapped(t);
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-victim-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const victim = join(outside, "important.json");
  const body = '{ "belongs": "to somebody else" }';
  writeFileSync(victim, body);

  mkdirSync(join(dir, ".claude"), { recursive: true });
  symlinkSync(victim, join(dir, SETTINGS_PATH));

  assert.throws(() => planHook(dir), /outside|escape|left alone/i);
  assert.equal(readFileSync(victim, "utf8"), body, "the file it pointed at is untouched");
});

test("a .claude directory that is a link out of the repository is refused too", (t) => {
  // The link one level up, which is the shape the rules writer was fixed for:
  // one link at `.claude` takes the settings file with it.
  const dir = mapped(t);
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-victim-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));

  rmSync(join(dir, ".claude"), { recursive: true, force: true });
  symlinkSync(outside, join(dir, ".claude"));

  assert.throws(() => planHook(dir), /outside|escape|left alone/i);
  assert.equal(existsSync(join(outside, "settings.local.json")), false, "nothing was created there");
});

test("settings that do not parse are refused, never overwritten", (t) => {
  const dir = mapped(t);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), "{ this is not json");

  assert.throws(() => planHook(dir), /could not be read/);
  assert.equal(readFileSync(join(dir, SETTINGS_PATH), "utf8"), "{ this is not json", "left alone");
});

test("a hooks block that is not an object is refused, not spread into one", (t) => {
  // The top-level object was checked and nothing below it was, so a spread
  // turned whatever it found into indexed keys: `"hooks": "PreToolUse"` became
  // `{"0":"P","1":"r","2":"e",...}` beside the real entries, and the file was
  // written back that way. Refusing is the same rule A25 already states one
  // level up: a writer that reads a shape it does not understand as the shape
  // it expected is a writer that mangles what it could not read.
  for (const hooks of ['"PreToolUse"', "[{\"matcher\":\"Bash\"}]", "42", "null"]) {
    const dir = mapped(t);
    const body = `{"permissions":{"allow":["Bash(x)"]},"hooks":${hooks}}`;
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, SETTINGS_PATH), body);

    if (hooks === "null") {
      // Absent and null are the same statement: no hooks yet.
      commitHook(dir, planHook(dir));
      assert.ok(settings(dir).hooks.PostToolUse, hooks);
      assert.deepEqual(settings(dir).permissions.allow, ["Bash(x)"], hooks);
      continue;
    }
    assert.throws(() => planHook(dir), /hooks/, hooks);
    assert.equal(readFileSync(join(dir, SETTINGS_PATH), "utf8"), body, `${hooks} left alone`);
  }
});

test("an event whose value is not a list is refused, not spread into characters", (t) => {
  const dir = mapped(t);
  const body = '{"hooks":{"PostToolUse":"bash ./fmt.sh"}}';
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), body);

  assert.throws(() => planHook(dir), /PostToolUse/);
  assert.equal(readFileSync(join(dir, SETTINGS_PATH), "utf8"), body, "left alone");
});

test("a plan already satisfied says so and writes nothing", (t) => {
  const dir = mapped(t);
  commitHook(dir, planHook(dir));
  const before = readFileSync(join(dir, SETTINGS_PATH), "utf8");

  const plan = planHook(dir);

  assert.equal(plan.changed, false);
  commitHook(dir, plan);
  assert.equal(readFileSync(join(dir, SETTINGS_PATH), "utf8"), before, "byte-identical");
});

test("the plan is committed to the root it was planned for and no other", (t) => {
  const a = mapped(t);
  const b = mapped(t);
  assert.throws(() => commitHook(b, planHook(a)), /planned for/);
});
