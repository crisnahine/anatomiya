import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { validate } from "../scripts/validate.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * A repository with both manifests, one plugin at the root and one beside it,
 * which is the shape this marketplace has had since the second plugin landed.
 */
function marketplace(t, { second = {}, hooks = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-validate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "anatomiya", version: "1.2.3" }));
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(dir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "anatomiya", version: "1.2.3", description: "d" }),
  );
  writeFileSync(
    join(dir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "anatomiya",
      owner: { name: "crisnahine" },
      plugins: [
        { name: "anatomiya", source: "./", description: "d" },
        { name: "second", source: "./second", description: "d" },
      ],
    }),
  );
  mkdirSync(join(dir, "hooks"), { recursive: true });
  writeFileSync(join(dir, "bin"), "");
  writeFileSync(
    join(dir, "hooks", "hooks.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/bin"' }] }] } }),
  );

  mkdirSync(join(dir, "second", ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(dir, "second", ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "second", version: "0.1.0", description: "d", ...second }),
  );
  if (hooks) {
    mkdirSync(join(dir, "second", "hooks"), { recursive: true });
    writeFileSync(join(dir, "second", "hooks", "run.mjs"), "");
    writeFileSync(
      join(dir, "second", "hooks", "hooks.json"),
      JSON.stringify({
        hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs"' }] }] },
      }),
    );
  }
  return dir;
}

test("this repository's own manifests pass", () => {
  assert.deepEqual(validate(ROOT), []);
});

test("the manifest check runs as a command and says so", () => {
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "validate.mjs")], { encoding: "utf8" });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /ok/);
});

// --- the plugins beside the root one -----------------------------------------

test("a marketplace entry beside the root plugin is read as a plugin, not as a path that exists", (t) => {
  // The only thing checked about a second entry was that its directory was
  // there. A directory with no manifest in it installs as nothing.
  const dir = marketplace(t);
  rmSync(join(dir, "second", ".claude-plugin"), { recursive: true, force: true });

  assert.deepEqual(validate(dir), ["second/.claude-plugin/plugin.json is missing"]);
});

test("a plugin's own manifest has to name that plugin", (t) => {
  const dir = marketplace(t, { second: { name: "renamed" } });

  assert.deepEqual(validate(dir), [
    'marketplace.json entry second points at a plugin named "renamed"',
  ]);
});

test("a plugin's own manifest needs a version and a description", (t) => {
  const dir = marketplace(t, { second: { version: undefined, description: undefined } });

  assert.deepEqual(validate(dir).sort(), [
    "second/.claude-plugin/plugin.json has no description",
    "second/.claude-plugin/plugin.json has no version",
  ]);
});

test("a version that is not semver is caught wherever the plugin lives", (t) => {
  const dir = marketplace(t, { second: { version: "0.1" } });

  assert.deepEqual(validate(dir), ["second/.claude-plugin/plugin.json version is not semver: 0.1"]);
});

test("a second plugin's hook has to name a file that plugin ships", (t) => {
  const dir = marketplace(t);
  rmSync(join(dir, "second", "hooks", "run.mjs"));

  assert.deepEqual(validate(dir), [
    "second/hooks/hooks.json UserPromptSubmit runs hooks/run.mjs, which that plugin does not ship",
  ]);
});

test("a second plugin's hooks.json has to parse", (t) => {
  const dir = marketplace(t);
  writeFileSync(join(dir, "second", "hooks", "hooks.json"), "{not json");

  assert.equal(validate(dir).length, 1);
  assert.match(validate(dir)[0], /second\/hooks\/hooks\.json/);
});

test("a plugin that declares no hooks is fine", (t) => {
  const dir = marketplace(t, { hooks: false });

  assert.deepEqual(validate(dir), []);
});

// --- what the root check already did, still doing it -------------------------

test("a stray file in the manifest directory is still a problem", (t) => {
  const dir = marketplace(t);
  writeFileSync(join(dir, ".claude-plugin", "notes.md"), "");

  assert.deepEqual(validate(dir), [
    ".claude-plugin/notes.md is not a manifest; manifests only in that directory",
  ]);
});

test("the root plugin's version still has to match package.json", (t) => {
  const dir = marketplace(t);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "anatomiya", version: "9.9.9" }));

  assert.deepEqual(validate(dir), ["version drift: package.json 9.9.9, plugin.json 1.2.3"]);
});

test("a marketplace entry pointing outside the repository is refused", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.plugins[1].source = "../elsewhere";
  writeFileSync(path, JSON.stringify(manifest));

  assert.deepEqual(validate(dir), [
    "marketplace.json entry second points outside the repository: ../elsewhere",
  ]);
});


// --- the error paths the check carried over ----------------------------------

test("a manifest that does not parse is named, and nothing after it is guessed at", (t) => {
  const dir = marketplace(t);
  writeFileSync(join(dir, ".claude-plugin", "marketplace.json"), "{oops");

  const problems = validate(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^\.claude-plugin\/marketplace\.json: /);
});

test("a repository with no manifest directory names the directory and both manifests", (t) => {
  // Reported together rather than one at a time: the check runs in CI, and a
  // second red build to learn the second sentence is a second round trip.
  const dir = marketplace(t);
  rmSync(join(dir, ".claude-plugin"), { recursive: true, force: true });

  assert.deepEqual(validate(dir), [
    ".claude-plugin/ is missing",
    ".claude-plugin/plugin.json is missing",
    ".claude-plugin/marketplace.json is missing",
  ]);
});

test("the root plugin's name still has to match package.json", (t) => {
  const dir = marketplace(t);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "renamed", version: "1.2.3" }));

  assert.deepEqual(validate(dir), ["name drift: package.json renamed, plugin.json anatomiya"]);
});

test("an entry with no name and an entry with no source are both caught", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.plugins = [{ source: "./" }, { name: "sourceless" }];
  writeFileSync(path, JSON.stringify(manifest));

  assert.deepEqual(validate(dir), [
    "marketplace.json has a plugin entry with no name",
    "marketplace.json entry sourceless has no source",
  ]);
});

test("an entry naming a directory that is not there is caught before its manifest is read", (t) => {
  const dir = marketplace(t);
  rmSync(join(dir, "second"), { recursive: true, force: true });

  assert.deepEqual(validate(dir), ["marketplace.json entry second points at a missing path ./second"]);
});

test("a marketplace listing no plugins at all is a marketplace that installs nothing", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.plugins = [];
  writeFileSync(path, JSON.stringify(manifest));

  assert.deepEqual(validate(dir), ["marketplace.json lists no plugins"]);
});

test("a hooks file with no hooks block, and an event that is not a list, are both refused", (t) => {
  const dir = marketplace(t);
  writeFileSync(join(dir, "second", "hooks", "hooks.json"), JSON.stringify({ UserPromptSubmit: [] }));
  assert.deepEqual(validate(dir), ["second/hooks/hooks.json has no top-level hooks block, so it loads nothing"]);

  writeFileSync(join(dir, "second", "hooks", "hooks.json"), JSON.stringify({ hooks: { UserPromptSubmit: {} } }));
  assert.deepEqual(validate(dir), ["second/hooks/hooks.json event UserPromptSubmit is not a list"]);
});

test("a hook command that names no file in its plugin is refused", (t) => {
  const dir = marketplace(t);
  writeFileSync(
    join(dir, "second", "hooks", "hooks.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "curl example.test" }] }] } }),
  );

  assert.deepEqual(validate(dir), [
    "second/hooks/hooks.json UserPromptSubmit runs curl example.test, which names no file in this plugin",
  ]);
});

test("the root plugin's own hook file is required, since it is what re-delivers the map", (t) => {
  const dir = marketplace(t);
  rmSync(join(dir, "hooks", "hooks.json"));

  assert.deepEqual(validate(dir), ["hooks/hooks.json is missing, so the map is never re-delivered"]);
});

// --- what the workflow used to check inline -----------------------------------

test("a marketplace with no name and no owner is caught here, not by the loader", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  delete manifest.name;
  delete manifest.owner;
  writeFileSync(path, JSON.stringify(manifest));

  assert.deepEqual(validate(dir).sort(), [
    'marketplace.json has no "name"',
    'marketplace.json has no "owner"',
  ]);
});

test("a path a plugin manifest names has to exist and stay inside that plugin", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.commands = ["./commands", "../outside"];
  writeFileSync(path, JSON.stringify(manifest));

  assert.deepEqual(validate(dir).sort(), [
    ".claude-plugin/plugin.json commands[0] points at a missing path: ./commands",
    ".claude-plugin/plugin.json commands[1] points outside the plugin: ../outside",
  ]);
});

test("a hook may not run a file outside its own plugin", (t) => {
  const dir = marketplace(t);
  writeFileSync(
    join(dir, "second", "hooks", "hooks.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command: 'node "${CLAUDE_PLUGIN_ROOT}/../hooks/hooks.json"' }] }] } }),
  );

  assert.deepEqual(validate(dir), [
    "second/hooks/hooks.json UserPromptSubmit runs ../hooks/hooks.json, which is outside that plugin",
  ]);
});

test("a package.json that is not there is a problem, not a check that quietly stops", (t) => {
  const dir = marketplace(t);
  rmSync(join(dir, "package.json"));

  assert.deepEqual(validate(dir), ["package.json is missing, so no version can be compared against it"]);
});

test("an entry with neither a name nor a source reports both", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.plugins = [{ name: "anatomiya", source: "./" }, {}];
  writeFileSync(path, JSON.stringify(manifest));

  assert.deepEqual(validate(dir), [
    "marketplace.json has a plugin entry with no name",
    "marketplace.json plugins[1] has no source",
  ]);
});

test("a hook command that carries arguments names the file, not the flags", (t) => {
  const dir = marketplace(t);
  writeFileSync(
    join(dir, "second", "hooks", "hooks.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command: "node ${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs --flag" }] }] } }),
  );

  assert.deepEqual(validate(dir), []);
});

test("problems come back as annotations where a workflow is reading them", (t) => {
  const dir = marketplace(t);
  rmSync(join(dir, ".claude-plugin", "plugin.json"));
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "validate.mjs"), dir], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "true" },
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /^::error::/m);
});
