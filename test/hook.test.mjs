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
