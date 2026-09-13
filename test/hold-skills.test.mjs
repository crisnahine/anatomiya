import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { findSkills } from "../plugins/ultracode-anywhere/hooks/hold-skills.mjs";
import { agentText, world, write } from "./hold-fixtures.mjs";
import { needsPosixPaths } from "./platform.mjs";

const names = (found) => found.map((s) => s.fields.name ?? s.file.split(/[\\/]/).pop()).sort();

test("a personal, a project and a plugin skill are each found by the name that invokes them", (t) => {
  const { cfg, plugin, project, env } = world(t);
  write(join(cfg, "skills", "mine", "SKILL.md"), agentText({ name: "mine", description: "d" }));
  write(join(project, ".claude", "skills", "ours", "SKILL.md"), agentText({ name: "ours", description: "d" }));
  write(join(plugin, "skills", "theirs", "SKILL.md"), agentText({ name: "theirs", description: "d" }));

  assert.deepEqual(names(findSkills("mine", { env, root: project })), ["mine"]);
  assert.deepEqual(names(findSkills("/ours", { env, root: project })), ["ours"], "a typed slash is not part of the name");
  assert.deepEqual(names(findSkills("kit:theirs", { env, root: project })), ["theirs"]);
  assert.deepEqual(names(findSkills("theirs", { env, root: project })), ["theirs"], "a bare name finds a plugin's skill too, since refusing over a shared name is safe and missing a fork is not");
  assert.deepEqual(findSkills("nobody", { env, root: project }), []);
});

test("every file that answers to one name comes back, whichever the build would run", (t) => {
  const { cfg, project, env } = world(t);
  write(join(cfg, "skills", "twin", "SKILL.md"), agentText({ name: "twin", description: "personal" }));
  write(join(project, ".claude", "skills", "twin", "SKILL.md"), agentText({ name: "twin", description: "project" }));
  write(join(cfg, "commands", "twin.md"), agentText({ description: "command" }));

  assert.deepEqual(findSkills("twin", { env, root: project }).map((s) => s.fields.description).sort(), ["command", "personal", "project"]);
});

test("nested skill and command folders join with a colon, and a plugin skill also answers to its own name", (t) => {
  const { cfg, plugin, project, env } = world(t);
  write(join(cfg, "commands", "team", "deploy.md"), agentText({ description: "d" }));
  write(join(plugin, "skills", "dir-name", "SKILL.md"), agentText({ name: "heavy", description: "d" }));

  assert.equal(findSkills("team:deploy", { env, root: project }).length, 1);
  assert.equal(findSkills("kit:heavy", { env, root: project }).length, 1);
  assert.equal(findSkills("kit:dir-name", { env, root: project }).length, 1);
});

test("a plugin can keep one SKILL.md at its root, named by its frontmatter", (t) => {
  const { cfg, root, project, env } = world(t);
  const solo = join(root, "solo");
  write(join(solo, "SKILL.md"), agentText({ name: "solo", description: "d" }));
  write(join(cfg, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "solo@m": [{ installPath: solo }] } }));
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "solo@m": true } }));

  assert.equal(findSkills("solo:solo", { env, root: project }).length, 1);
});

test("a skill file with no frontmatter is left out, since nothing in it can fork", (t) => {
  const { cfg, project, env } = world(t);
  write(join(cfg, "skills", "plain", "SKILL.md"), "Just instructions.\n");

  assert.deepEqual(findSkills("plain", { env, root: project }), []);
});

test("a skill in a symlinked directory is found, and a loop there ends", needsPosixPaths, (t) => {
  const { cfg, root, project, env } = world(t);
  write(join(root, "elsewhere", "heavy", "SKILL.md"), agentText({ name: "heavy", description: "d" }));
  mkdirSync(join(cfg, "skills"), { recursive: true });
  symlinkSync(join(root, "elsewhere", "heavy"), join(cfg, "skills", "heavy"));
  symlinkSync(join(cfg, "skills"), join(cfg, "skills", "loop"));

  assert.equal(findSkills("heavy", { env, root: project }).length, 1);
});

test("a personal or project skill also answers to its frontmatter name, since every candidate is checked", (t) => {
  const { cfg, project, env } = world(t);
  write(join(cfg, "skills", "folder", "SKILL.md"), agentText({ name: "named", description: "d" }));

  assert.deepEqual(names(findSkills("named", { env, root: project })), ["named"]);
});
