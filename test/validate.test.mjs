import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";

import { needsPosixPermissions, needsSymlinks } from "./platform.mjs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { validate } from "../scripts/validate.mjs";
import { REL } from "../scripts/plugins.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * A marketplace with two plugins under `plugins/`, which is the shape this
 * repository has had since neither of them sat at its root.
 */
function marketplace(t, { second = {}, hooks = true, commands = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-validate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // The shape this marketplace has: no plugin at the root, one directory per
  // plugin under `plugins/`, and the root carrying the marketplace manifest and
  // the package that declares them as workspaces.
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "crisnahine", version: "1.2.3", workspaces: ["plugins/*"] }));
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(dir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "anatomiya",
      owner: { name: "crisnahine" },
      plugins: [
        { name: "anatomiya", source: `./${REL.anatomiya}`, description: "d" },
        { name: "second", source: "./plugins/second", description: "d" },
      ],
    }),
  );

  mkdirSync(join(dir, REL.anatomiya, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(dir, REL.anatomiya, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "anatomiya", version: "1.2.3", description: "d" }),
  );
  mkdirSync(join(dir, REL.anatomiya, "hooks"), { recursive: true });
  writeFileSync(join(dir, REL.anatomiya, "bin"), "");
  writeFileSync(
    join(dir, REL.anatomiya, "hooks", "hooks.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/bin"' }] }] } }),
  );

  mkdirSync(join(dir, "plugins", "second", ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(dir, "plugins", "second", ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "second", version: "0.1.0", description: "d", ...second }),
  );
  if (hooks) {
    mkdirSync(join(dir, "plugins", "second", "hooks"), { recursive: true });
    writeFileSync(join(dir, "plugins", "second", "hooks", "run.mjs"), "");
    writeFileSync(
      join(dir, "plugins", "second", "hooks", "hooks.json"),
      JSON.stringify({
        hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs"' }] }] },
      }),
    );
  }
  if (commands) {
    mkdirSync(join(dir, "plugins", "second", "commands"), { recursive: true });
    writeFileSync(join(dir, "plugins", "second", "commands", "do.md"), "# do\n");
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

// --- the plugins the marketplace lists ----------------------------------------

test("a marketplace entry is read as a plugin, not as a path that exists", (t) => {
  // The only thing checked about a second entry was that its directory was
  // there. A directory with no manifest in it installs as nothing.
  const dir = marketplace(t);
  rmSync(join(dir, "plugins", "second", ".claude-plugin"), { recursive: true, force: true });

  assert.deepEqual(validate(dir), ["plugins/second/.claude-plugin/plugin.json is missing"]);
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
    "plugins/second/.claude-plugin/plugin.json has no description",
    "plugins/second/.claude-plugin/plugin.json has no version",
  ]);
});

test("a version that is not semver is caught wherever the plugin lives", (t) => {
  const dir = marketplace(t, { second: { version: "0.1" } });

  assert.deepEqual(validate(dir), ["plugins/second/.claude-plugin/plugin.json version is not semver: 0.1"]);
});

test("a second plugin's hook has to name a file that plugin ships", (t) => {
  const dir = marketplace(t);
  rmSync(join(dir, "plugins", "second", "hooks", "run.mjs"));

  assert.deepEqual(validate(dir), [
    "plugins/second/hooks/hooks.json UserPromptSubmit runs hooks/run.mjs, which that plugin does not ship",
  ]);
});

test("a second plugin's hooks.json has to parse", (t) => {
  const dir = marketplace(t);
  writeFileSync(join(dir, "plugins", "second", "hooks", "hooks.json"), "{not json");

  assert.equal(validate(dir).length, 1);
  assert.match(validate(dir)[0], /second\/hooks\/hooks\.json/);
});

test("a plugin that declares no hooks but ships commands is fine", (t) => {
  // Hooks are one of five things a plugin can be. Requiring them of every
  // plugin would refuse a perfectly good commands-only one.
  const dir = marketplace(t, { hooks: false, commands: true });

  assert.deepEqual(validate(dir), []);
});

test("a listed plugin that would install as nothing is a problem", (t) => {
  // The second plugin is its hooks. Delete the declaration and it installs
  // with a name, a version and no behaviour, which nothing else here notices:
  // the hook check runs on it, and then returns without a word because the
  // file it was going to read is not there.
  const dir = marketplace(t, { hooks: false });

  assert.deepEqual(validate(dir), [
    "marketplace.json entry second installs as nothing: no hooks, commands, agents, skills or mcpServers",
  ]);
});

test("a declaration that parses and declares no hook installs nothing", (t) => {
  // A file with bytes in it is not a file that declares a hook, and this is the
  // shape the loader reads as an empty one rather than as a broken one.
  const dir = marketplace(t);
  writeFileSync(join(dir, "plugins", "second", "hooks", "hooks.json"), JSON.stringify({ hooks: {} }));

  assert.deepEqual(validate(dir), [
    "marketplace.json entry second installs as nothing: no hooks, commands, agents, skills or mcpServers",
  ]);
});

test("an event declared with an empty group installs nothing either", (t) => {
  const dir = marketplace(t);
  writeFileSync(join(dir, "plugins", "second", "hooks", "hooks.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [] }] } }));

  assert.deepEqual(validate(dir), [
    "marketplace.json entry second installs as nothing: no hooks, commands, agents, skills or mcpServers",
  ]);
});

test("a manifest key that is present and empty names nothing", (t) => {
  // `commands: []` and `commands: ""` are a key with no value behind it, and a
  // truthiness test read the empty array as behaviour the plugin installs.
  for (const empty of [[], "", {}]) {
    const dir = marketplace(t, { hooks: false, second: { commands: empty } });

    assert.deepEqual(validate(dir), [
      "marketplace.json entry second installs as nothing: no hooks, commands, agents, skills or mcpServers",
    ], JSON.stringify(empty));
  }
});

test("a commands directory holding only an empty directory installs nothing", (t) => {
  // Commands nest, so the walk has to reach a file rather than count entries.
  const dir = marketplace(t, { hooks: false });
  mkdirSync(join(dir, "plugins", "second", "commands", "ops"), { recursive: true });

  assert.deepEqual(validate(dir), [
    "marketplace.json entry second installs as nothing: no hooks, commands, agents, skills or mcpServers",
  ]);
});

test("a commands file with no bytes in it installs nothing, and one with bytes does", (t) => {
  // A directory holding a file is not a directory holding a command: a name
  // that was touched and never written is what a half-finished change leaves
  // behind, and the loader reads no command out of it.
  const dir = marketplace(t, { hooks: false });
  const path = join(dir, "plugins", "second", "commands", "go.md");
  mkdirSync(join(dir, "plugins", "second", "commands"), { recursive: true });
  writeFileSync(path, "");

  assert.deepEqual(validate(dir), [
    "marketplace.json entry second installs as nothing: no hooks, commands, agents, skills or mcpServers",
  ]);

  writeFileSync(path, "# go\n");
  assert.deepEqual(validate(dir), []);
});

test("a skill is one of the five, and one is enough", (t) => {
  const dir = marketplace(t, { hooks: false });
  mkdirSync(join(dir, "plugins", "second", "skills", "demo"), { recursive: true });
  writeFileSync(join(dir, "plugins", "second", "skills", "demo", "SKILL.md"), "# demo\n");

  assert.deepEqual(validate(dir), []);
});

test("a plugin that names its commands directory in the manifest is fine", (t) => {
  // The loader takes either spelling, so the check has to as well.
  const dir = marketplace(t, { hooks: false, second: { commands: "./elsewhere" } });
  mkdirSync(join(dir, "plugins", "second", "elsewhere"), { recursive: true });
  writeFileSync(join(dir, "plugins", "second", "elsewhere", "do.md"), "# do\n");

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

test("a plugin's package manifest has to agree with its plugin manifest", (t) => {
  // One release moves both and a tag reads both. Checked where the two files
  // are, which is inside the plugin: the repository root holds neither now.
  const dir = marketplace(t);
  writeFileSync(join(dir, REL.anatomiya, "package.json"), JSON.stringify({ name: "anatomiya", version: "9.9.9" }));

  assert.deepEqual(validate(dir), [
    `version drift: package.json 9.9.9, ${REL.anatomiya}/.claude-plugin/plugin.json 1.2.3`,
  ]);
});

test("a marketplace entry pointing outside the repository is refused, whichever way it is spelled", (t) => {
  // The loader's schema refuses a source that does not start with "./", so a
  // "../" spelling never installs, even one that re-enters the repository; one
  // that starts with "./" and then steps out is caught by its traversal guard.
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const refused = (source, sentence) => {
    manifest.plugins[1].source = source;
    writeFileSync(path, JSON.stringify(manifest));
    assert.deepEqual(validate(dir), [sentence], source);
  };

  refused("../elsewhere", 'marketplace.json entry second has a source that does not start with "./": ../elsewhere');
  refused(`../${basename(dir)}/second`, `marketplace.json entry second has a source that does not start with "./": ../${basename(dir)}/second`);
  refused("./../elsewhere", "marketplace.json entry second points outside the repository: ./../elsewhere");
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

  // Only the marketplace manifest belongs at the root now: each plugin carries
  // its own, in its own directory, and the loop reads them there.
  assert.deepEqual(validate(dir), [
    ".claude-plugin/ is missing",
    ".claude-plugin/marketplace.json is missing",
  ]);
});

test("a plugin that declares dependencies and ships no lockfile installs none of them", (t) => {
  // Measured on Claude Code 2.1.251: the installer reads the plugin root with a
  // non-recursive `readdir`, and runs `npm ci --ignore-scripts` only where a
  // `package.json` and one of `bun.lock`, `bun.lockb`, `npm-shrinkwrap.json` or
  // `package-lock.json` sit together. A root with the manifest and no lockfile
  // is passed over and nothing is logged, so the plugin installs with none of
  // its dependencies and the first command that needs one refuses.
  const dir = marketplace(t);
  writeFileSync(
    join(dir, REL.anatomiya, "package.json"),
    JSON.stringify({ name: "anatomiya", version: "1.2.3", dependencies: { "oxc-parser": "^0.144.0" } }),
  );

  const problems = validate(dir);

  assert.deepEqual(problems, [
    `${REL.anatomiya}: package.json declares dependencies and no lockfile sits beside it, so an install runs nothing`,
  ]);
});

test("a plugin with a lockfile beside its manifest is installed by the loader", (t) => {
  const dir = marketplace(t);
  writeFileSync(
    join(dir, REL.anatomiya, "package.json"),
    JSON.stringify({ name: "anatomiya", version: "1.2.3", dependencies: { "oxc-parser": "^0.144.0" } }),
  );
  writeFileSync(join(dir, REL.anatomiya, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));

  assert.deepEqual(validate(dir), []);
});

test("a lockfile the loader does not support is named rather than counted", (t) => {
  // The build refuses yarn and pnpm by name, because their resolution-time
  // hooks run around the `--ignore-scripts` the install is given. A repository
  // that put one there has a lockfile and still installs nothing, so the
  // refusal has to say which file it looked at and would not take. Told only
  // that no lockfile sits there, a maintainer looking straight at one has been
  // sent to check the one thing that is not wrong.
  const dir = marketplace(t);
  writeFileSync(
    join(dir, REL.anatomiya, "package.json"),
    JSON.stringify({ name: "anatomiya", version: "1.2.3", dependencies: { "oxc-parser": "^0.144.0" } }),
  );
  writeFileSync(join(dir, REL.anatomiya, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

  assert.deepEqual(validate(dir), [
    `${REL.anatomiya}: pnpm-lock.yaml is not a lockfile an install reads, so it runs nothing; use npm or bun`,
  ]);
});

test("a plugin's lockfile resolves what the marketplace's own lockfile resolves", (t) => {
  // Two lockfiles for one dependency set: the marketplace root's, which is what
  // CI installs and every test here runs against, and the plugin's, which is
  // what Claude Code installs for whoever adds the plugin. Left to drift, the
  // suite passes against one version of a parser and users get another, and
  // nothing anywhere says so.
  const dir = marketplace(t);
  writeFileSync(
    join(dir, REL.anatomiya, "package.json"),
    JSON.stringify({ name: "anatomiya", version: "1.2.3", dependencies: { "oxc-parser": "^0.144.0" } }),
  );
  writeFileSync(
    join(dir, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/oxc-parser": { version: "0.144.2" } } }),
  );
  writeFileSync(
    join(dir, REL.anatomiya, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/oxc-parser": { version: "0.144.9" } } }),
  );

  assert.deepEqual(validate(dir), [
    `${REL.anatomiya}/package-lock.json: node_modules/oxc-parser resolves to 0.144.9, and package-lock.json resolves it to 0.144.2`,
  ]);
});

test("the resolution compared against is the one the plugin would get, hoisted or not", (t) => {
  // npm writes a package it could not hoist under the workspace that needed it,
  // and the copy at the top then belongs to the other consumer. Compared
  // against that one, a plugin shipping the version it is actually meant to
  // have is reported as drifted, and the fix would be to break it.
  const dir = marketplace(t);
  writeFileSync(
    join(dir, REL.anatomiya, "package.json"),
    JSON.stringify({ name: "anatomiya", version: "1.2.3", dependencies: { "oxc-parser": "^0.144.0" } }),
  );
  writeFileSync(
    join(dir, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/oxc-parser": { version: "0.144.0" },
        [`${REL.anatomiya}/node_modules/oxc-parser`]: { version: "0.144.7" },
      },
    }),
  );
  writeFileSync(
    join(dir, REL.anatomiya, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/oxc-parser": { version: "0.144.7" } } }),
  );

  assert.deepEqual(validate(dir), []);
});

test("a package the marketplace's lockfile never names is the plugin's own to resolve", (t) => {
  // The root holds two plugins and installs both, so anything only one of them
  // needs is absent from the other's tree rather than in disagreement with it.
  const dir = marketplace(t);
  writeFileSync(
    join(dir, REL.anatomiya, "package.json"),
    JSON.stringify({ name: "anatomiya", version: "1.2.3", dependencies: { "oxc-parser": "^0.144.0" } }),
  );
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": {} } }));
  writeFileSync(
    join(dir, REL.anatomiya, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/oxc-parser": { version: "0.144.9" } } }),
  );

  assert.deepEqual(validate(dir), []);
});

test("a peer dependency is a dependency the install would have to resolve", (t) => {
  // `npm ci` installs peers, so a plugin declaring only those still needs a
  // lockfile and still installs nothing without one. Read off the manifest
  // rather than off the two keys anybody happened to use first.
  const dir = marketplace(t);
  writeFileSync(
    join(dir, REL.anatomiya, "package.json"),
    JSON.stringify({ name: "anatomiya", version: "1.2.3", peerDependencies: { "oxc-parser": "^0.144.0" } }),
  );

  assert.deepEqual(validate(dir), [
    `${REL.anatomiya}: package.json declares dependencies and no lockfile sits beside it, so an install runs nothing`,
  ]);
});

test("a dependency block that is not a block still declares a dependency", (t) => {
  // `dependencies: "oops"` is a manifest npm refuses, and this read it as a
  // plugin with nothing to install: the shape test filtered it out and an empty
  // list answers that every block is empty. A gate that passes a manifest
  // nobody can install is a gate gone quiet.
  const dir = marketplace(t);
  writeFileSync(
    join(dir, REL.anatomiya, "package.json"),
    JSON.stringify({ name: "anatomiya", version: "1.2.3", dependencies: "oops" }),
  );

  assert.deepEqual(validate(dir), [
    `${REL.anatomiya}: package.json declares dependencies and no lockfile sits beside it, so an install runs nothing`,
  ]);
});

test("a plugin that declares no dependencies needs no lockfile", (t) => {
  // Two shapes, and the fixture used to have neither: with no `package.json` at
  // all the reader stops one guard earlier, so the branch this names never ran
  // and dropping it left the case green. A manifest declaring an empty block is
  // the one that reaches it.
  const dir = marketplace(t);
  writeFileSync(
    join(dir, REL.anatomiya, "package.json"),
    JSON.stringify({ name: "anatomiya", version: "1.2.3", dependencies: {}, optionalDependencies: {} }),
  );

  assert.deepEqual(validate(dir), []);
});

test("a plugin's package manifest has to carry its name too", (t) => {
  const dir = marketplace(t);
  writeFileSync(join(dir, REL.anatomiya, "package.json"), JSON.stringify({ name: "renamed", version: "1.2.3" }));

  assert.deepEqual(validate(dir), [
    `name drift: package.json renamed, ${REL.anatomiya}/.claude-plugin/plugin.json anatomiya`,
  ]);
});

test("an entry with no name and an entry with no source are both caught", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.plugins = [{ source: "./" }, { name: "sourceless" }];
  writeFileSync(path, JSON.stringify(manifest));

  // The list is replaced whole, so the plugin whose hooks are required is no
  // longer on it, which this says too.
  assert.deepEqual(validate(dir), [
    "marketplace.json has a plugin entry with no name",
    "marketplace.json entry sourceless has no source",
    "marketplace.json lists no usable plugin called anatomiya, whose hooks were never read as a result",
  ]);
});

test("an entry naming a directory that is not there is caught before its manifest is read", (t) => {
  const dir = marketplace(t);
  rmSync(join(dir, "plugins", "second"), { recursive: true, force: true });

  assert.deepEqual(validate(dir), ["marketplace.json entry second points at a missing path ./plugins/second"]);
});

test("a marketplace listing no plugins at all is a marketplace that installs nothing", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.plugins = [];
  writeFileSync(path, JSON.stringify(manifest));

  assert.deepEqual(validate(dir), [
    "marketplace.json lists no plugins",
    "marketplace.json lists no usable plugin called anatomiya, whose hooks were never read as a result",
  ]);
});

test("a hooks file with no hooks block, and an event that is not a list, are both refused", (t) => {
  const dir = marketplace(t);
  writeFileSync(join(dir, "plugins", "second", "hooks", "hooks.json"), JSON.stringify({ UserPromptSubmit: [] }));
  assert.deepEqual(validate(dir), ["plugins/second/hooks/hooks.json has no top-level hooks block, so it loads nothing"]);

  writeFileSync(join(dir, "plugins", "second", "hooks", "hooks.json"), JSON.stringify({ hooks: { UserPromptSubmit: {} } }));
  assert.deepEqual(validate(dir), ["plugins/second/hooks/hooks.json event UserPromptSubmit is not a list"]);
});

test("a hook command that names no file in its plugin is refused", (t) => {
  const dir = marketplace(t);
  writeFileSync(
    join(dir, "plugins", "second", "hooks", "hooks.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "curl example.test" }] }] } }),
  );

  assert.deepEqual(validate(dir), [
    "plugins/second/hooks/hooks.json UserPromptSubmit runs curl example.test, which names nothing in this plugin",
  ]);
});

test("anatomiya's own hook file is required, since it is what re-delivers the map", (t) => {
  // Required of the plugin that owns it and of no other, named on the
  // marketplace rather than inferred from a position in the tree.
  const dir = marketplace(t);
  rmSync(join(dir, REL.anatomiya, "hooks", "hooks.json"));

  assert.deepEqual(validate(dir), [
    `${REL.anatomiya}/hooks/hooks.json is missing, so the map is never re-delivered`,
  ]);
});

test("a declaration that declares no hook is the same silence as no file", (t) => {
  // The file is what was checked for, and a file is not a hook: emptied to a
  // top-level block with nothing in it, the map is never re-delivered and both
  // gates said the manifests and the hooks were fine. The check that asks
  // whether a plugin installs anything is not asked of a plugin whose
  // declaration was just reported missing, so nothing else catches this.
  const dir = marketplace(t);
  const path = join(dir, REL.anatomiya, "hooks", "hooks.json");

  writeFileSync(path, JSON.stringify({ hooks: {} }));
  assert.deepEqual(validate(dir), [`${REL.anatomiya}/hooks/hooks.json declares no hook, so the map is never re-delivered`]);

  // An event with no group under it is the same nothing spelled longer.
  writeFileSync(path, JSON.stringify({ hooks: { UserPromptSubmit: [] } }));
  assert.deepEqual(validate(dir), [`${REL.anatomiya}/hooks/hooks.json declares no hook, so the map is never re-delivered`]);

  // And a group whose own list is empty is the last way to spell it.
  writeFileSync(path, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [] }] } }));
  assert.deepEqual(validate(dir), [`${REL.anatomiya}/hooks/hooks.json declares no hook, so the map is never re-delivered`]);
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
  const path = join(dir, REL.anatomiya, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.commands = ["./commands", "../outside"];
  writeFileSync(path, JSON.stringify(manifest));

  assert.deepEqual(validate(dir).sort(), [
    `${REL.anatomiya}/.claude-plugin/plugin.json commands[0] points at a missing path: ./commands`,
    `${REL.anatomiya}/.claude-plugin/plugin.json commands[1] points outside the plugin: ../outside`,
  ]);
});

test("a hook may not run a file outside its own plugin", (t) => {
  const dir = marketplace(t);
  writeFileSync(
    join(dir, "plugins", "second", "hooks", "hooks.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/../hooks/hooks.json"' }] }] } }),
  );

  assert.deepEqual(validate(dir), [
    "plugins/second/hooks/hooks.json UserPromptSubmit runs ../hooks/hooks.json, which is outside that plugin",
  ]);
});

test("a package.json that is not there is a problem, not a check that quietly stops", (t) => {
  const dir = marketplace(t);
  rmSync(join(dir, "package.json"));

  assert.deepEqual(validate(dir), ["package.json is missing, and it is what declares the plugins as workspaces"]);
});

test("an entry with neither a name nor a source reports both", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.plugins = [{ name: "anatomiya", source: `./${REL.anatomiya}` }, {}];
  writeFileSync(path, JSON.stringify(manifest));

  assert.deepEqual(validate(dir), [
    "marketplace.json has a plugin entry with no name",
    "marketplace.json plugins[1] has no source",
  ]);
});

test("a hook command that carries arguments names the file, not the flags", (t) => {
  const dir = marketplace(t);
  writeFileSync(
    join(dir, "plugins", "second", "hooks", "hooks.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "node ${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs --flag" }] }] } }),
  );

  assert.deepEqual(validate(dir), []);
});

test("problems come back as annotations where a workflow is reading them", (t) => {
  const dir = marketplace(t);
  rmSync(join(dir, REL.anatomiya, ".claude-plugin", "plugin.json"));
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
  writeFileSync(join(dir, "plugins", "second", ".claude-plugin", "plugin.json"), "[]");
  assert.deepEqual(validate(dir), ["plugins/second/.claude-plugin/plugin.json is not an object"]);

  writeFileSync(join(dir, "plugins", "second", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "second", version: "0.1.0", description: "d" }));
  writeFileSync(join(dir, "plugins", "second", "hooks", "hooks.json"), "null");
  assert.deepEqual(validate(dir), ["plugins/second/hooks/hooks.json is not an object"]);
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
  rmSync(join(dir, "plugins", "second"), { recursive: true, force: true });
  symlinkSync(outside, join(dir, "plugins", "second"));

  assert.deepEqual(validate(dir), [
    "marketplace.json entry second points outside the repository: ./plugins/second",
  ]);
});

test("the same plugin listed twice is caught, since only one of them installs", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.plugins.push({ name: "second", source: "./plugins/second", description: "d" });
  writeFileSync(path, JSON.stringify(manifest));

  assert.deepEqual(validate(dir), ["marketplace.json lists second twice"]);
});

// --- hook commands, read whole --------------------------------------------------

test("every file a hook command names is checked, not only the first", (t) => {
  const dir = marketplace(t);
  writeFileSync(
    join(dir, "plugins", "second", "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs" | node "${CLAUDE_PLUGIN_ROOT}/hooks/gone.mjs"' }] }],
      },
    }),
  );

  assert.deepEqual(validate(dir), [
    "plugins/second/hooks/hooks.json UserPromptSubmit runs hooks/gone.mjs, which that plugin does not ship",
  ]);
});

test("a command that names the plugin root itself, or ships no command at all, is read as what it is", (t) => {
  const dir = marketplace(t);
  writeFileSync(
    join(dir, "plugins", "second", "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: 'cd "${CLAUDE_PLUGIN_ROOT}" && node hooks/run.mjs' }, { type: "command" }] }],
      },
    }),
  );

  assert.deepEqual(validate(dir), ["plugins/second/hooks/hooks.json UserPromptSubmit has a hook with no command"]);
});

test("a quoted path with a space in it is the path, not its first word", (t) => {
  const dir = marketplace(t);
  mkdirSync(join(dir, "plugins", "second", "my hooks"), { recursive: true });
  writeFileSync(join(dir, "plugins", "second", "my hooks", "run.mjs"), "");
  writeFileSync(
    join(dir, "plugins", "second", "hooks", "hooks.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/my hooks/run.mjs"' }] }] } }),
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
      join(dir, "plugins", "second", "hooks", "hooks.json"),
      JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command }] }] } }),
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

test("a listed plugin's manifest directory holds manifests and nothing else", (t) => {
  const dir = marketplace(t);
  writeFileSync(join(dir, "plugins", "second", ".claude-plugin", "notes.md"), "");

  assert.deepEqual(validate(dir), [
    "plugins/second/.claude-plugin/notes.md is not a manifest; manifests only in that directory",
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

// --- what the loader accepts and this refused ----------------------------------

test("a source that is an object naming a remote is somebody else's repository, not a missing path", (t) => {
  // The marketplace schema allows `source: { source: "github", repo: "a/b" }`,
  // and read as a string it became "[object Object]" and failed the build.
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const listed = JSON.parse(readFileSync(path, "utf8"));
  listed.plugins.push({ name: "remote", source: { source: "github", repo: "someone/plugin" }, description: "d" });
  writeFileSync(path, JSON.stringify(listed));

  assert.deepEqual(validate(dir), []);
});

test("a hook that is a prompt rather than a command names no file, and is not refused for it", (t) => {
  const dir = marketplace(t);
  writeFileSync(
    join(dir, "plugins", "second", "hooks", "hooks.json"),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "prompt", prompt: "Say what is left undone." }] }] } }),
  );

  assert.deepEqual(validate(dir), []);
});

test("a manifest directory that is a file is reported, not thrown over", (t) => {
  const dir = marketplace(t);
  rmSync(join(dir, "plugins", "second", ".claude-plugin"), { recursive: true, force: true });
  writeFileSync(join(dir, "plugins", "second", ".claude-plugin"), "");

  assert.deepEqual(validate(dir), ["plugins/second/.claude-plugin is not a directory"]);

  rmSync(join(dir, ".claude-plugin"), { recursive: true, force: true });
  writeFileSync(join(dir, ".claude-plugin"), "");
  assert.equal(validate(dir).includes(".claude-plugin is not a directory"), true);
});

test("a source that wanders and still resolves inside the repository installs, and passes", (t) => {
  // The loader's install path is a traversal guard: `./second/../second` and a
  // name that merely carries two dots both resolve inside and install. Its
  // marketplace validator skips such entries from its own checks, which read
  // as the loader refusing them; it does not.
  const dir = marketplace(t);
  cpSync(join(dir, "plugins", "second"), join(dir, "..dotty"), { recursive: true });
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const listed = JSON.parse(readFileSync(path, "utf8"));
  for (const source of ["./..dotty", "./plugins/second/../second", "./plugins/second/."]) {
    listed.plugins[1].source = source;
    writeFileSync(path, JSON.stringify(listed));
    assert.deepEqual(validate(dir), [], source);
  }
});

test("a source of a bare dot is the marketplace itself, which holds no plugin", (t) => {
  // The loader takes it and installs the whole repository. Nothing here is a
  // plugin any more, so what it would install is a directory with no manifest,
  // and that is what this says rather than passing it as the plugin it once
  // was.
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const listed = JSON.parse(readFileSync(path, "utf8"));
  listed.plugins[0].source = ".";
  writeFileSync(path, JSON.stringify(listed));

  assert.deepEqual(validate(dir), [
    ".claude-plugin/plugin.json is missing",
    "marketplace.json lists no usable plugin called anatomiya, whose hooks were never read as a result",
  ]);
});

test("a declared path or a hook file whose name starts with two dots is inside its plugin", (t) => {
  // `relative()` answers `..cmds` for such a name, and a prefix test on ".."
  // read it as a step out of the plugin.
  const dir = marketplace(t, { second: { commands: "./..cmds" } });
  mkdirSync(join(dir, "plugins", "second", "..cmds"));
  writeFileSync(join(dir, "plugins", "second", "hooks", "..run.mjs"), "");
  writeFileSync(
    join(dir, "plugins", "second", "hooks", "hooks.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/..run.mjs"' }] }] } }),
  );

  assert.deepEqual(validate(dir), []);
});

test("a version with noise after the third number is not semver, wherever it starts", (t) => {
  assert.deepEqual(validate(marketplace(t, { second: { version: "1.0.0garbage" } })), [
    "plugins/second/.claude-plugin/plugin.json version is not semver: 1.0.0garbage",
  ]);
  assert.deepEqual(validate(marketplace(t, { second: { version: "1.0.0-beta.1" } })), [], "a pre-release is semver");
});

test("a plugin manifest with no name is told it has none, not that it names somebody else", (t) => {
  const dir = marketplace(t, { second: { name: undefined } });

  assert.deepEqual(validate(dir), ["plugins/second/.claude-plugin/plugin.json has no name"]);
});

test("a hook command that names a directory names nothing the loader can run", (t) => {
  const dir = marketplace(t);
  writeFileSync(
    join(dir, "plugins", "second", "hooks", "hooks.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks"' }] }] } }),
  );

  assert.deepEqual(validate(dir), ["plugins/second/hooks/hooks.json UserPromptSubmit runs hooks, which that plugin does not ship"]);
});

test("the same name listed twice is caught whatever the second entry's source is", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const listed = JSON.parse(readFileSync(path, "utf8"));
  listed.plugins.push({ name: "second", source: { source: "github", repo: "someone/second" }, description: "d" });
  writeFileSync(path, JSON.stringify(listed));

  assert.deepEqual(validate(dir), ["marketplace.json lists second twice"]);
});

test("an object source names a kind the loader knows, or it installs nothing", (t) => {
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const listed = JSON.parse(readFileSync(path, "utf8"));
  listed.plugins.push({ name: "local", source: { source: "local", path: "./x" }, description: "d" });
  listed.plugins.push({ name: "kindless", source: {}, description: "d" });
  listed.plugins.push({ name: "numbered", source: 42, description: "d" });
  writeFileSync(path, JSON.stringify(listed));

  assert.deepEqual(validate(dir), [
    'marketplace.json entry local names a source of kind "local", which the loader does not know',
    "marketplace.json entry kindless names a source with no kind",
    "marketplace.json entry numbered names a source that is not a path in this repository: 42",
  ]);
});

test("a hook with no type, or a type the loader does not know, drops its event and is refused", (t) => {
  // Every hook kind the loader accepts is a literal `type`. An entry without
  // one, or with one it does not know, fails the whole event's load in silence.
  const dir = marketplace(t);
  const hooks = (hook) =>
    writeFileSync(join(dir, "plugins", "second", "hooks", "hooks.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [hook] }] } }));

  hooks({ command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs"' });
  assert.deepEqual(validate(dir), ["plugins/second/hooks/hooks.json UserPromptSubmit has a hook with no type, so the loader drops the event"]);
  hooks({ type: "Command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs"' });
  assert.deepEqual(validate(dir), ['plugins/second/hooks/hooks.json UserPromptSubmit has a hook of type "Command", which the loader does not know']);
  hooks("not even an object");
  assert.deepEqual(validate(dir), ["plugins/second/hooks/hooks.json UserPromptSubmit has a hook with no type, so the loader drops the event"]);
});

test("the exec form names its files in args, and those are the files checked", (t) => {
  const dir = marketplace(t);
  const hooks = (hook) =>
    writeFileSync(join(dir, "plugins", "second", "hooks", "hooks.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [hook] }] } }));

  hooks({ type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs", "--quiet"] });
  assert.deepEqual(validate(dir), []);
  hooks({ type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/hooks/gone.mjs"] });
  assert.deepEqual(validate(dir), ["plugins/second/hooks/hooks.json UserPromptSubmit runs hooks/gone.mjs, which that plugin does not ship"]);
});

test("a link out of the repository is refused wherever a manifest or a hook reaches through one", needsSymlinks, (t) => {
  // The plugin directory was checked through its real path. Its manifest
  // directory, the files its hooks run and the paths its manifest names were
  // not, and each passed while pointing at a file the repository does not hold.
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "run.mjs"), "");
  mkdirSync(join(outside, "cmds"));
  mkdirSync(join(outside, "manifests"));
  writeFileSync(join(outside, "manifests", "plugin.json"), JSON.stringify({ name: "second", version: "0.1.0", description: "d" }));

  const dir = marketplace(t, { second: { commands: "./cmds" } });
  rmSync(join(dir, "plugins", "second", "hooks", "run.mjs"));
  symlinkSync(join(outside, "run.mjs"), join(dir, "plugins", "second", "hooks", "run.mjs"));
  symlinkSync(join(outside, "cmds"), join(dir, "plugins", "second", "cmds"));

  assert.deepEqual(validate(dir).sort(), [
    "plugins/second/.claude-plugin/plugin.json commands points outside the plugin: ./cmds",
    "plugins/second/hooks/hooks.json UserPromptSubmit runs hooks/run.mjs, which is outside that plugin",
  ]);

  rmSync(join(dir, "plugins", "second", ".claude-plugin"), { recursive: true, force: true });
  symlinkSync(join(outside, "manifests"), join(dir, "plugins", "second", ".claude-plugin"));
  assert.deepEqual(validate(dir), ["plugins/second/.claude-plugin is a link out of the repository"]);
});

test("a leading zero is not semver, in the version or in a pre-release number", (t) => {
  assert.deepEqual(validate(marketplace(t, { second: { version: "01.0.0" } })), ["plugins/second/.claude-plugin/plugin.json version is not semver: 01.0.0"]);
  assert.deepEqual(validate(marketplace(t, { second: { version: "1.0.0-01" } })), ["plugins/second/.claude-plugin/plugin.json version is not semver: 1.0.0-01"]);
});

test("a manifest directory that cannot be listed is named with the reason, not with a stack", needsPosixPermissions, (t) => {
  const dir = marketplace(t);
  chmodSync(join(dir, "plugins", "second", ".claude-plugin"), 0o000);
  const said = validate(dir);
  chmodSync(join(dir, "plugins", "second", ".claude-plugin"), 0o700);

  assert.deepEqual(said, ["plugins/second/.claude-plugin: EACCES"]);
});


test("a plugin that moves its hook declaration is checked where it moved it", (t) => {
  // `LOADABLE`'s own docstring calls the conventional path "where the loader
  // looks when the manifest does not", and `installsNothing` honours the
  // manifest key. Only the hook check read the convention whatever the manifest
  // said, so it refused a plugin for a file it does not need and left the hooks
  // it does declare unchecked.
  const dir = marketplace(t);
  const moved = join(dir, "plugins", "second", "hooks", "other.json");
  writeFileSync(moved, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/gone.mjs"' }] }] } }));
  rmSync(join(dir, "plugins", "second", "hooks", "hooks.json"));
  const path = join(dir, "plugins", "second", ".claude-plugin", "plugin.json");
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), hooks: "./hooks/other.json" }));

  assert.deepEqual(validate(dir), [
    "plugins/second/hooks/other.json UserPromptSubmit runs hooks/gone.mjs, which that plugin does not ship",
  ]);
});


test("the required declaration is read where that plugin's manifest says it is", (t) => {
  // The other half of the same defect, and no fixture could reach it: only the
  // plugin whose hooks are required is held to `required`, and the case above
  // uses the other one, where a missing declaration is allowed. Read at the
  // convention whatever the manifest says, this refused that plugin for a file
  // it does not need while the declaration it does name went unchecked.
  const dir = marketplace(t);
  const moved = join(dir, REL.anatomiya, "hooks", "other.json");
  writeFileSync(moved, readFileSync(join(dir, REL.anatomiya, "hooks", "hooks.json"), "utf8"));
  rmSync(join(dir, REL.anatomiya, "hooks", "hooks.json"));
  const path = join(dir, REL.anatomiya, ".claude-plugin", "plugin.json");
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), hooks: "./hooks/other.json" }));

  assert.deepEqual(validate(dir), [], "the plugin was refused for a file its manifest does not name");

  // And what it does name is what is checked: emptied, the map is never
  // re-delivered and this is the one plugin that must say so.
  writeFileSync(moved, JSON.stringify({ hooks: {} }));
  assert.deepEqual(validate(dir), [`${REL.anatomiya}/hooks/other.json declares no hook, so the map is never re-delivered`]);
});


test("every plugin whose hooks are required is one the marketplace lists", (t) => {
  // The requirement is keyed on the entry name, and nothing held the two in
  // step: renamed on the marketplace, the plugin whose hook re-delivers the map
  // stopped being asked for one and the gate said the hooks were fine.
  const dir = marketplace(t);
  const path = join(dir, ".claude-plugin", "marketplace.json");
  const listed = JSON.parse(readFileSync(path, "utf8"));
  listed.plugins[0].name = "anatomiya-scanner";
  writeFileSync(path, JSON.stringify(listed));
  writeFileSync(
    join(dir, REL.anatomiya, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "anatomiya-scanner", version: "1.2.3", description: "d" }),
  );
  rmSync(join(dir, REL.anatomiya, "hooks", "hooks.json"));

  // Two sentences and two causes: the marketplace no longer names the plugin
  // whose hooks are required, and the one it renamed to installs nothing.
  assert.deepEqual(validate(dir), [
    "marketplace.json entry anatomiya-scanner installs as nothing: no hooks, commands, agents, skills or mcpServers",
    "marketplace.json lists no usable plugin called anatomiya, whose hooks were never read as a result",
  ]);
});


test("a required declaration that was never reached is said, not left to the next round trip", (t) => {
  // The check asked whether the marketplace named the plugin, and every one of
  // these names it. What none of them does is get as far as reading its hooks:
  // the loop gives up on the entry first, so the missing declaration goes
  // unmentioned and is still there once the sentence that did print is fixed.
  const shapes = {
    "a source that points nowhere": (dir, listed) => {
      listed[0].source = "./plugins/gone";
    },
    "a manifest of its own that is missing": (dir) => {
      rmSync(join(dir, REL.anatomiya, ".claude-plugin", "plugin.json"));
    },
    "no source at all": (dir, listed) => {
      delete listed[0].source;
    },
    "a source that is not a path": (dir, listed) => {
      listed[0].source = 42;
    },
  };

  for (const [what, break_] of Object.entries(shapes)) {
    const dir = marketplace(t);
    const path = join(dir, ".claude-plugin", "marketplace.json");
    const listed = JSON.parse(readFileSync(path, "utf8"));
    rmSync(join(dir, REL.anatomiya, "hooks", "hooks.json"));
    break_(dir, listed.plugins);
    writeFileSync(path, JSON.stringify(listed));

    const said = validate(dir);

    assert.ok(
      said.some((problem) => problem.includes("whose hooks were never read")),
      `${what}: ${said.join(" | ")}`,
    );
  }
});

// --- the paths a manifest names by hand ---------------------------------------

test("a declared path without a leading ./ is checked, because the loader resolves it the same way", (t) => {
  const dir = marketplace(t, { second: { hooks: "hooks/gone.json" } });

  assert.deepEqual(validate(dir), ["plugins/second/.claude-plugin/plugin.json hooks points at a missing path: hooks/gone.json"]);
});

// The loader substitutes it and this cannot, so resolving it here would report
// a path nothing ever opens.
test("a declared path carrying the plugin-root variable is left to the loader", (t) => {
  const dir = marketplace(t, { second: { hooks: "${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json" } });

  assert.deepEqual(validate(dir), []);
});

test("a hooks path that leaves the plugin is said once, and the foreign file is not then read as a declaration", (t) => {
  const dir = marketplace(t, { second: { hooks: "../../outside/foreign.json" } });
  mkdirSync(join(dir, "outside"), { recursive: true });
  writeFileSync(join(dir, "outside", "foreign.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "node nope.mjs" }] }] } }));

  assert.deepEqual(validate(dir), ["plugins/second/.claude-plugin/plugin.json hooks points outside the plugin: ../../outside/foreign.json"]);
});

test("every hooks file a manifest lists is read, not the first one", (t) => {
  const dir = marketplace(t, { second: { hooks: ["./hooks/hooks.json", "./hooks/more.json"] } });
  writeFileSync(
    join(dir, "plugins", "second", "hooks", "more.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/gone.mjs"' }] }] } }),
  );

  assert.deepEqual(validate(dir), ["plugins/second/hooks/more.json UserPromptSubmit runs hooks/gone.mjs, which that plugin does not ship"]);
});
