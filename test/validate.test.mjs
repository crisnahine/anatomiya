import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";

import { needsSymlinks } from "./platform.mjs";
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
    "second/hooks/hooks.json UserPromptSubmit runs curl example.test, which names nothing in this plugin",
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

// --- manifests that parse to something that is not a manifest -----------------

test("a manifest that parses to null is refused, not read as an absent one", (t) => {
  // `JSON.parse("null")` succeeds, so a truthiness check read a document that
  // is not a manifest as one that failed to parse, and reported nothing.
  const dir = marketplace(t);
  writeFileSync(join(dir, ".claude-plugin", "marketplace.json"), "null");

  assert.deepEqual(validate(dir), ['.claude-plugin/marketplace.json is not an object']);
});

test("a plugin manifest that is an array, and a hooks file that is null, are both refused", (t) => {
  const dir = marketplace(t);
  writeFileSync(join(dir, "second", ".claude-plugin", "plugin.json"), "[]");
  assert.deepEqual(validate(dir), ["second/.claude-plugin/plugin.json is not an object"]);

  writeFileSync(join(dir, "second", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "second", version: "0.1.0", description: "d" }));
  writeFileSync(join(dir, "second", "hooks", "hooks.json"), "null");
  assert.deepEqual(validate(dir), ["second/hooks/hooks.json is not an object"]);
});

test("a package.json that parses to nothing is a problem, not a skipped comparison", (t) => {
  const dir = marketplace(t);
  writeFileSync(join(dir, "package.json"), "null");

  assert.deepEqual(validate(dir), ["package.json is not an object"]);
});

// --- sources that are not a path inside the repository ------------------------

test("a source that is an absolute path is refused, since it resolves on one machine", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.plugins[1].source = "/etc";
  writeFileSync(path, JSON.stringify(manifest));

  assert.deepEqual(validate(dir), [
    "marketplace.json entry second names a source that is not a path in this repository: /etc",
  ]);
});

test("a plugin directory that is a symlink out of the repository is refused", needsSymlinks, (t) => {
  const dir = marketplace(t);
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(join(outside, ".claude-plugin"), { recursive: true });
  writeFileSync(join(outside, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "second", version: "0.1.0", description: "d" }));
  rmSync(join(dir, "second"), { recursive: true, force: true });
  symlinkSync(outside, join(dir, "second"));

  assert.deepEqual(validate(dir), [
    "marketplace.json entry second points outside the repository: ./second",
  ]);
});

test("the same plugin listed twice is caught, since only one of them installs", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.plugins.push({ name: "second", source: "./second", description: "d" });
  writeFileSync(path, JSON.stringify(manifest));

  assert.deepEqual(validate(dir), ["marketplace.json lists second twice"]);
});

// --- hook commands, read whole --------------------------------------------------

test("every file a hook command names is checked, not only the first", (t) => {
  const dir = marketplace(t);
  writeFileSync(
    join(dir, "second", "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs" | node "${CLAUDE_PLUGIN_ROOT}/hooks/gone.mjs"' }] }],
      },
    }),
  );

  assert.deepEqual(validate(dir), [
    "second/hooks/hooks.json UserPromptSubmit runs hooks/gone.mjs, which that plugin does not ship",
  ]);
});

test("a command that names the plugin root itself, or ships no command at all, is read as what it is", (t) => {
  const dir = marketplace(t);
  writeFileSync(
    join(dir, "second", "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ command: 'cd "${CLAUDE_PLUGIN_ROOT}" && node hooks/run.mjs' }, { type: "command" }] }],
      },
    }),
  );

  assert.deepEqual(validate(dir), ["second/hooks/hooks.json UserPromptSubmit has a hook with no command"]);
});

test("a quoted path with a space in it is the path, not its first word", (t) => {
  const dir = marketplace(t);
  mkdirSync(join(dir, "second", "my hooks"), { recursive: true });
  writeFileSync(join(dir, "second", "my hooks", "run.mjs"), "");
  writeFileSync(
    join(dir, "second", "hooks", "hooks.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command: 'node "${CLAUDE_PLUGIN_ROOT}/my hooks/run.mjs"' }] }] } }),
  );

  assert.deepEqual(validate(dir), []);
});

test("an unquoted path followed by a quoted argument is still just the path", (t) => {
  // The lazy quoted alternative won whenever a quote appeared anywhere later in
  // the command, so a flag with a quoted value read as part of the filename and
  // failed the build on a manifest that was fine.
  const dir = marketplace(t);
  const commands = [
    'node ${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs --say "hello"',
    'node ${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs --json {"a":1}',
    "node ${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs # don't",
  ];

  for (const command of commands) {
    writeFileSync(
      join(dir, "second", "hooks", "hooks.json"),
      JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command }] }] } }),
    );
    assert.deepEqual(validate(dir), [], command);
  }
});

test("a Windows absolute path is not read as a remote source", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.plugins[1].source = "C:\\plugins\\second";
  writeFileSync(path, JSON.stringify(manifest));

  assert.deepEqual(validate(dir), [
    "marketplace.json entry second names a source that is not a path in this repository: C:\\plugins\\second",
  ]);
});

test("a source that names a directory without saying it is one is told what is missing", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.plugins[1].source = "second";
  writeFileSync(path, JSON.stringify(manifest));

  assert.deepEqual(validate(dir), [
    'marketplace.json entry second has a source that does not start with "./": second',
  ]);
});

test("a listed plugin's manifest directory holds manifests and nothing else, like the root's", (t) => {
  const dir = marketplace(t);
  writeFileSync(join(dir, "second", ".claude-plugin", "notes.md"), "");

  assert.deepEqual(validate(dir), [
    "second/.claude-plugin/notes.md is not a manifest; manifests only in that directory",
  ]);
});

test("the check runs when it is reached through a symlinked path", needsSymlinks, (t) => {
  // A validator that silently passes is worse than one that fails: this is CI's
  // only manifest gate, and the same equality made both plugin hooks no-ops.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-linked-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  symlinkSync(ROOT, join(dir, "repo"));

  const run = spawnSync(process.execPath, [join(dir, "repo", "scripts", "validate.mjs")], { encoding: "utf8" });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /ok/);
});
