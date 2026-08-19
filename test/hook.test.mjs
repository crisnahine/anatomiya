import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("the walk up stops at the filesystem root rather than running off it", (t) => {
  // A path with no map above it anywhere answers null, and does so without
  // walking forever or throwing at the top.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-hook-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "a", "b", "c"), { recursive: true });

  assert.equal(echoContext(join(dir, "a", "b", "c"), {}), null);
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
