import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { AGENTS_DIR, frontmatterIn } from "../scripts/workflow-lint.mjs";
import { EFFORT_LEVELS } from "../plugins/ultracode-anywhere/hooks/effort.mjs";
import { carriedBy, cliPath } from "../plugins/ultracode-anywhere/hooks/upstream.mjs";
import { ULTRACODE } from "../scripts/plugins.mjs";

/**
 * Tools that change something outside the agent's own transcript.
 *
 * Write, Edit and NotebookEdit were never the whole of it. A captured spawn
 * keeps every name below, so a stage told to read could open a worktree,
 * schedule a run, stop somebody else's, or message another session, and none of
 * it shows up in the report a reader judges the stage by.
 */
const REACHES_PAST_ITSELF = [
  "EnterWorktree",
  "ExitWorktree",
  "DesignSync",
  "CronCreate",
  "CronDelete",
  "PushNotification",
  "SendMessage",
  "TaskStop",
];

const dir = join(ULTRACODE, AGENTS_DIR);
const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
const read = (file) => frontmatterIn(readFileSync(join(dir, file), "utf8"));

test("the plugin ships agent types at all, since the workflows spawn them by name", () => {
  assert.ok(files.length > 0, `no agent files under ${dir}`);
});

for (const file of files) {
  test(`${file} declares the two keys the build requires of a plugin agent`, () => {
    const front = read(file);
    assert.ok(front, "no frontmatter block");
    assert.equal(typeof front.name, "string");
    assert.ok(front.name.length > 0, "name must be a non-empty string");
    // A plugin agent with no description is refused by the loader, which means
    // a workflow naming it fails with "agent type not found" mid-run.
    assert.equal(typeof front.description, "string");
    assert.ok(front.description.length > 0, "description must be a non-empty string");
  });

  test(`${file} is named for the agent it declares`, () => {
    // The build keys an agent on its frontmatter name and keeps the filename
    // only as a label, so the two drifting apart is invisible until a spawn
    // names the file and gets nothing.
    assert.equal(read(file).name, file.replace(/\.md$/, ""));
  });

  test(`${file} names an effort the build accepts, or names none at all`, () => {
    const { effort } = read(file);
    if (effort === null) return;
    assert.ok(EFFORT_LEVELS.includes(effort), `${effort} is no effort level`);
  });

  test(`${file} sets nothing the build ignores for a plugin agent`, () => {
    // These three are honoured for a project agent and warned about for a
    // plugin one, so a file setting them reads as controlling something it
    // does not control.
    const front = read(file);
    for (const key of ["permissionMode", "hooks", "mcpServers"]) {
      assert.equal(front[key], undefined, `${key} is ignored for a plugin agent`);
    }
  });

  test(`${file} names no tools key, which would swallow the deny list`, () => {
    // Measured on 2.1.269, against the schema's own description of itself: the
    // resolver applies the denies first and then looks a `tools` name up in
    // what survived, so a name in both lists is dropped through an empty
    // statement, counted as neither invalid nor unavailable. Nothing warns. A
    // `tools` key here would leave the deny list below reading as though it
    // still decided something.
    assert.equal(read(file).tools, null);
  });

  test(`${file} cannot reach past its own transcript`, () => {
    const { disallowedTools } = read(file);
    for (const tool of REACHES_PAST_ITSELF) {
      assert.ok(disallowedTools.includes(tool), `${tool} must be refused`);
    }
  });

  test(`${file} cannot write to the tree it is reading`, () => {
    // A reviewing agent that can edit will edit: one told to check that a test
    // catches a defect reverted the working tree to find out.
    const { disallowedTools } = read(file);
    assert.ok(Array.isArray(disallowedTools), "disallowedTools must be a list");
    for (const tool of ["Write", "Edit", "NotebookEdit"]) {
      assert.ok(disallowedTools.includes(tool), `${tool} must be refused`);
    }
  });
}

test("every name the agents deny is one this build carries", async (t) => {
  // The per-file test above reads the list back, not the tool pool, so it
  // passes on a misspelling as happily as on a real name, and a name no build
  // carries removes nothing. A skip where none is installed: a machine without
  // a build is not evidence that a tool went away.
  const cli = cliPath();
  if (!cli) return t.skip("no Claude Code build on this machine to read");
  const denied = [...new Set(files.flatMap((file) => read(file).disallowedTools ?? []))];
  const found = carriedBy(cli, denied);
  if (found === null) return t.skip("the installed build could not be read");

  assert.deepEqual(
    denied.filter((name) => !found.has(name)),
    [],
    `no tool of that name in ${cli}`,
  );
});

test("the agent that checks another stage's work names no effort, so it runs at the session's", () => {
  // The whole depth argument rests on the checking stage not being the cheap
  // one. Naming a level here would pin it below a session set higher.
  assert.equal(read("verifier.md").effort, null);
});

test("the wide stages name a level, so a fan-out does not cost what the session costs", () => {
  for (const file of ["finder.md", "reader.md"]) {
    assert.equal(read(file).effort, "medium", file);
  }
});
