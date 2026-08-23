import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { needsPathControl, needsShebang, needsSpawnableNpm, needsSymlinks, needsWindows } from "./platform.mjs";
import { PACK_ARGV, pluginRootsIn, reachableFrom, shipped } from "../scripts/shipped.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * A package whose plugin loads one hook that imports one module.
 *
 * `files` is the whole point, so it is the caller's to set: every case here is
 * about what that list does and does not carry.
 */
function packaged(t, { files, extra = () => {} } = {}) {
  // The plugin sits one level down, so a case that writes a sibling of it
  // writes inside what this removes: one did, under a fixed name in the shared
  // temp root, where it survived every run and two runs collided on it.
  const held = mkdtempSync(join(tmpdir(), "anatomiya-shipped-"));
  t.after(() => rmSync(held, { recursive: true, force: true }));
  const dir = join(held, "plugin");
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", private: true, files }));
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "fixture", version: "1.0.0", description: "d" }));
  mkdirSync(join(dir, "hooks"), { recursive: true });
  writeFileSync(
    join(dir, "hooks", "hooks.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/run.mjs"' }] }] } }),
  );
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "bin", "run.mjs"), `import { work } from "../lib/work.mjs";\nwork();\n`);
  mkdirSync(join(dir, "lib"), { recursive: true });
  writeFileSync(join(dir, "lib", "work.mjs"), `export const work = () => {};\n`);
  extra(dir);
  return dir;
}

test("every plugin this marketplace lists ships what it loads", needsSpawnableNpm, () => {
  // The gate answers about one plugin root, and the repository root is the
  // marketplace: it holds no plugin of its own now, so the question is asked of
  // each directory the marketplace names.
  const roots = pluginRootsIn(ROOT);

  assert.ok(roots.length > 0, "the marketplace lists no plugin this could be asked of");
  for (const root of roots) assert.deepEqual(shipped(root), [], root);
});

test("the manifest the loader reads first has to be in the shipped set", needsSpawnableNpm, (t) => {
  // The one file `files` was narrowed down to a single path, so a typo there
  // ships a plugin with no manifest at all, and npm passes an entry naming a
  // path that does not exist without a word.
  const dir = packaged(t, { files: ["hooks/", "bin/", "lib/"] });

  assert.deepEqual(shipped(dir), [
    "package.json files does not ship .claude-plugin/plugin.json, which the loader reads",
  ]);
});

test("a command in a subdirectory is an entry point like any other", needsSpawnableNpm, (t) => {
  // Commands nest: `commands/ops/deploy.md` is `/plugin:ops:deploy`. A walk one
  // level deep leaves every namespaced command unread.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/", "commands/"],
    extra: (at) => {
      mkdirSync(join(at, "commands", "ops"), { recursive: true });
      writeFileSync(join(at, "commands", "ops", "deploy.md"), 'Run `node "${CLAUDE_PLUGIN_ROOT}/tools/deploy.mjs"`.\n');
      mkdirSync(join(at, "tools"), { recursive: true });
      writeFileSync(join(at, "tools", "deploy.mjs"), "console.log(1);\n");
    },
  });

  assert.deepEqual(shipped(dir), [
    "package.json files does not ship tools/deploy.mjs, which commands/ops/deploy.md reaches",
  ]);
});

// The refusal is the platform's, so it cannot happen anywhere else, and a case
// that asked the platform which sentence to expect ran the success path here
// and called it the refusal: the whole branch could go and it stayed green. The
// posix side is the first case in this file, over the real plugins.
test("a platform that cannot spawn npm is told so rather than failed", needsWindows, () => {
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "shipped.mjs")], { cwd: ROOT, encoding: "utf8" });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /batch file/);
});

test("a module the entry point imports but the shipped set leaves out is named", needsSpawnableNpm, (t) => {
  const dir = packaged(t, { files: [".claude-plugin/plugin.json", "hooks/", "bin/"] });

  assert.deepEqual(shipped(dir), ["package.json files does not ship lib/work.mjs, which hooks/hooks.json reaches"]);
});

test("the hook declaration itself has to be in the shipped set", needsSpawnableNpm, (t) => {
  const dir = packaged(t, { files: [".claude-plugin/plugin.json", "bin/", "lib/"] });

  assert.deepEqual(shipped(dir), ["package.json files does not ship hooks/hooks.json, which the loader reads"]);
});

test("the marketplace manifest belongs to the marketplace, not inside the plugin", needsSpawnableNpm, (t) => {
  const dir = packaged(t, {
    files: [".claude-plugin/", "hooks/", "bin/", "lib/"],
    extra: (at) => writeFileSync(join(at, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "m", owner: {}, plugins: [] })),
  });

  assert.deepEqual(shipped(dir), [
    "package.json files ships .claude-plugin/marketplace.json, which belongs to the marketplace rather than to the plugin",
  ]);
});

test("a commands file is an entry point too, and what it names has to ship", needsSpawnableNpm, (t) => {
  // The agent runs what the command file tells it to, so a path named there is
  // as load-bearing as one in the declaration.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/", "commands/"],
    extra: (at) => {
      mkdirSync(join(at, "commands"), { recursive: true });
      writeFileSync(join(at, "commands", "go.md"), 'Run `node "${CLAUDE_PLUGIN_ROOT}/tools/other.mjs"`.\n');
      mkdirSync(join(at, "tools"), { recursive: true });
      writeFileSync(join(at, "tools", "other.mjs"), "console.log(1);\n");
    },
  });

  assert.deepEqual(shipped(dir), ["package.json files does not ship tools/other.mjs, which commands/go.md reaches"]);
});

test("a package npm cannot read is named, not passed over", needsSpawnableNpm, (t) => {
  // A directory with no `package.json` is a plugin with no list, which is a
  // shape the marketplace allows. One that has a list npm chokes on is not the
  // same thing, and it is the one that has to be said out loud.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-nopkg-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "package.json"), "{not json");

  const problems = shipped(dir);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /could not read what this package ships/);
});

test("the check runs as a command, and refuses with the reason on stderr", needsSpawnableNpm, (t) => {
  const dir = packaged(t, { files: [".claude-plugin/plugin.json", "bin/", "lib/"] });
  const refused = spawnSync(process.execPath, [join(ROOT, "scripts", "shipped.mjs"), dir], { encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /hooks\/hooks\.json/);
});

test("an entry point that is not shipped is named like anything else it reaches", needsSpawnableNpm, (t) => {
  // The two files the loader reads by name have a check of their own above, so
  // they were exempted here. Widening the starting points from those two to all
  // five kinds carried the exemption with it, and every command, skill, agent
  // and mcp file stopped being checked at all: `files` could drop `commands/`
  // whole and the gate still said the shipped set holds what the plugin loads.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/"],
    extra: (at) => {
      mkdirSync(join(at, "commands"), { recursive: true });
      writeFileSync(join(at, "commands", "go.md"), "# go\n");
    },
  });

  assert.deepEqual(shipped(dir), ["package.json files does not ship commands/go.md, which commands/go.md reaches"]);
});

test("a loadable kind the manifest puts somewhere else is read there", needsSpawnableNpm, (t) => {
  // `commands: "./elsewhere"` is a spelling the loader takes and `validate.mjs`
  // checks on purpose. Walking only the conventional directory leaves every
  // file under it unread, and whatever it names unchecked.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/", "elsewhere/"],
    extra: (at) => {
      writeFileSync(
        join(at, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "fixture", version: "1.0.0", description: "d", commands: "./elsewhere" }),
      );
      mkdirSync(join(at, "elsewhere"), { recursive: true });
      writeFileSync(join(at, "elsewhere", "do.md"), 'Run `node "${CLAUDE_PLUGIN_ROOT}/tools/typo.mjs"`.\n');
    },
  });

  assert.deepEqual(shipped(dir), ["elsewhere/do.md names tools/typo.mjs, which this plugin does not have"]);
});

test("a path named in a sentence stops at the sentence, not at the full stop", needsSpawnableNpm, (t) => {
  // Command and skill files are prose, and a path written into one ends where
  // the sentence does. Taking the stop as part of the name reports a file the
  // plugin has as one it does not, which is a gate that cries wolf on a
  // correct tree.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/", "commands/", "tools/"],
    extra: (at) => {
      mkdirSync(join(at, "commands"), { recursive: true });
      writeFileSync(join(at, "commands", "go.md"), "The scanner lives at ${CLAUDE_PLUGIN_ROOT}/tools/scan.mjs.\n");
      mkdirSync(join(at, "tools"), { recursive: true });
      writeFileSync(join(at, "tools", "scan.mjs"), "export const scan = () => {};\n");
    },
  });

  assert.deepEqual(shipped(dir), []);
});

test("a file whose name begins with two dots is inside the plugin, not above it", needsSpawnableNpm, (t) => {
  // `relative()` marks an escape with a leading `..` step, and a prefix test
  // read a file honestly named `..rc` as one: the walk dropped it, and whatever
  // it named went unchecked with the gate still saying the set was complete.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/", "commands/"],
    extra: (at) => {
      mkdirSync(join(at, "commands"), { recursive: true });
      writeFileSync(join(at, "commands", "go.md"), 'Reads `${CLAUDE_PLUGIN_ROOT}/..rc`.\n');
      writeFileSync(join(at, "..rc"), "{}\n");
    },
  });

  assert.deepEqual(shipped(dir), ["package.json files does not ship ..rc, which commands/go.md reaches"]);
});

test("a path an entry point names and the plugin does not have is named", needsSpawnableNpm, (t) => {
  // The other half of the same typo: not a file left out of the shipped set,
  // but a file that is not there at all. A walk that dropped it said nothing.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/", "commands/"],
    extra: (at) => {
      mkdirSync(join(at, "commands"), { recursive: true });
      writeFileSync(join(at, "commands", "go.md"), 'Run `node "${CLAUDE_PLUGIN_ROOT}/tools/typo.mjs"`.\n');
    },
  });

  assert.deepEqual(shipped(dir), ["commands/go.md names tools/typo.mjs, which this plugin does not have"]);
});

test("a skill is an entry point too, and what it names has to ship", needsSpawnableNpm, (t) => {
  // Five kinds, not two: a first pass read the declaration and the commands,
  // so a skill naming a file the plugin did not ship passed without a word.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/", "skills/"],
    extra: (at) => {
      mkdirSync(join(at, "skills", "demo"), { recursive: true });
      writeFileSync(join(at, "skills", "demo", "SKILL.md"), 'Run `node "${CLAUDE_PLUGIN_ROOT}/tools/deep.mjs"`.\n');
      mkdirSync(join(at, "tools"), { recursive: true });
      writeFileSync(join(at, "tools", "deep.mjs"), "console.log(1);\n");
    },
  });

  assert.deepEqual(shipped(dir), ["package.json files does not ship tools/deep.mjs, which skills/demo/SKILL.md reaches"]);
});

test("the pack is read offline, so the gate reaches no registry", () => {
  // Every command in this repository that could reach out says so where it is
  // declared, and this one is read by a test rather than trusted.
  assert.ok(PACK_ARGV.includes("--offline"), PACK_ARGV.join(" "));
  assert.ok(PACK_ARGV.includes("--dry-run"), PACK_ARGV.join(" "));
});

// The list above says what the gate means to run, and the gate spelling its own
// argv at the call site would satisfy it while reaching a registry. So this asks
// npm what it was handed: the stub records its arguments and answers nothing
// this can read, which is the gate's own reported condition and not this case's
// business.
test("and the npm the gate runs is handed that list, not one spelled at the call site", { ...needsShebang, ...needsPathControl }, (t) => {
  const dir = packaged(t, { files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/"] });
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-shipped-npm-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const seen = join(bin, "argv.txt");
  writeFileSync(join(bin, "npm"), `#!/bin/sh\nprintf '%s\\n' "$@" > ${seen}\nprintf 'not json'\n`, { mode: 0o755 });

  spawnSync(process.execPath, [join(ROOT, "scripts", "shipped.mjs"), dir], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  const argv = readFileSync(seen, "utf8").split("\n").filter(Boolean);
  assert.deepEqual(argv, PACK_ARGV, argv.join(" "));
});

test("a file a module resolves rather than imports is reached too", needsSpawnableNpm, (t) => {
  // This repository starts both of its workers that way: `pool.mjs` and
  // `semantic.mjs` resolve a sibling through `new URL` and hand the path to a
  // child process, so nothing imports them and a walk that follows imports
  // alone leaves the two files the tool cannot run without outside the set.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/work.mjs"],
    extra: (at) => {
      writeFileSync(
        join(at, "lib", "work.mjs"),
        [
          `import { fileURLToPath } from "node:url";`,
          `const WORKER = fileURLToPath(new URL("./worker.mjs", import.meta.url));`,
          `export const work = () => WORKER;`,
        ].join("\n"),
      );
      writeFileSync(join(at, "lib", "worker.mjs"), "process.exit(0);\n");
    },
  });

  assert.deepEqual(shipped(dir), ["package.json files does not ship lib/worker.mjs, which hooks/hooks.json reaches"]);
});

test("the walk follows require and import alike, and stops at what it does not own", (t) => {
  const dir = packaged(t, {
    files: ["**"],
    extra: (at) => {
      writeFileSync(
        join(at, "lib", "work.mjs"),
        [
          `import { createRequire } from "node:module";`,
          `import { near } from "./near.mjs";`,
          `const table = createRequire(import.meta.url)("./table.json");`,
          `const late = () => import("./late.mjs");`,
          `import "npm-package";`,
          `export const work = () => [near, table, late];`,
        ].join("\n"),
      );
      writeFileSync(join(at, "lib", "near.mjs"), "export const near = 1;\n");
      writeFileSync(join(at, "lib", "late.mjs"), "export const late = 1;\n");
      writeFileSync(join(at, "lib", "table.json"), "{}\n");
    },
  });

  assert.deepEqual(reachableFrom(dir, ["bin/run.mjs"]).files.sort(), [
    "bin/run.mjs",
    "lib/late.mjs",
    "lib/near.mjs",
    "lib/table.json",
    "lib/work.mjs",
  ]);
});

// --- what a manifest can say, and what a walk may reach ------------------------

test("a kind named as an empty list is a kind the manifest did not move", needsSpawnableNpm, (t) => {
  // `validate.mjs` answers the same key with `declares`, which reads an empty
  // list as naming nothing. Reading it here as a list of no paths dropped the
  // conventional path with it, and the whole kind went unwalked: the hook
  // declaration and everything it reaches stopped being checked at all.
  for (const empty of [[], [42], "", "   "]) {
    const dir = packaged(t, {
      files: [".claude-plugin/plugin.json", "hooks/", "bin/"],
      extra: (at) => {
        writeFileSync(
          join(at, ".claude-plugin", "plugin.json"),
          JSON.stringify({ name: "fixture", version: "1.0.0", description: "d", hooks: empty }),
        );
      },
    });

    assert.deepEqual(
      shipped(dir),
      ["package.json files does not ship lib/work.mjs, which hooks/hooks.json reaches"],
      JSON.stringify(empty),
    );
  }
});

test("a kind pointed outside the plugin is reported, not walked", needsSpawnableNpm, (t) => {
  // The walk reads the body of every file it reaches, and only the references
  // inside those files were held to the root. An entry point was not, so a
  // manifest naming `../` had this gate reading and reporting files belonging
  // to whatever sits beside the plugin.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/"],
    extra: (at) => {
      writeFileSync(
        join(at, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "fixture", version: "1.0.0", description: "d", commands: "../outside" }),
      );
      mkdirSync(join(at, "..", "outside"), { recursive: true });
      writeFileSync(join(at, "..", "outside", "secret.md"), 'Reads `${CLAUDE_PLUGIN_ROOT}/proof.mjs`.\n');
    },
  });

  assert.deepEqual(shipped(dir), [".claude-plugin/plugin.json commands names ../outside, which is not inside this plugin"]);
});

test("a kind named as the plugin root itself is the same refusal", needsSpawnableNpm, (t) => {
  // `.`, `./` and `/` all resolve to the root, and a walk from there makes
  // every file in the repository an entry point, `.git` included. `""` is not
  // among them: a kind named as an empty string names nothing, and the gate
  // falls back to the conventional path, which the case above covers.
  for (const root of [".", "./", "/"]) {
    const dir = packaged(t, {
      files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/"],
      extra: (at) => {
        writeFileSync(
          join(at, ".claude-plugin", "plugin.json"),
          JSON.stringify({ name: "fixture", version: "1.0.0", description: "d", commands: root }),
        );
      },
    });

    assert.deepEqual(
      shipped(dir),
      [`.claude-plugin/plugin.json commands names ${root}, which is not inside this plugin`],
      JSON.stringify(root),
    );
  }
});

test("a manifest that will not parse is said, not fallen back from in silence", needsSpawnableNpm, (t) => {
  // The fallback leaves the gate on the conventional paths, which is silence
  // about every kind the manifest moved. One trailing comma and the check the
  // manifest exists to drive stops running.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/"],
    extra: (at) => writeFileSync(join(at, ".claude-plugin", "plugin.json"), '{"name":"fixture",}'),
  });

  assert.deepEqual(shipped(dir), [
    ".claude-plugin/plugin.json could not be read, so nothing says where this plugin keeps what it loads",
  ]);
});

test("a plugin path the manifest itself names is read like any other", needsSpawnableNpm, (t) => {
  // The manifest is the first file the loader opens and was never an entry
  // point, so an mcp server block written into it named a file nothing checked.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/"],
    extra: (at) => {
      writeFileSync(
        join(at, ".claude-plugin", "plugin.json"),
        JSON.stringify({
          name: "fixture",
          version: "1.0.0",
          description: "d",
          mcpServers: { one: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/mcp/serve.mjs"] } },
        }),
      );
    },
  });

  assert.deepEqual(shipped(dir), [".claude-plugin/plugin.json names mcp/serve.mjs, which this plugin does not have"]);
});

test("the file the loader reads first is the one the manifest names for it", needsSpawnableNpm, (t) => {
  // A manifest may move the declaration, and the two sentences about it were
  // written against the conventional path: the gate named a leftover the loader
  // never opens as the file it reads, and gave the real one a message about
  // itself.
  // The leftover is shipped and the file the manifest names is not, which is
  // the only shape that tells the two apart: shipping both, neither produces a
  // sentence whichever one the gate resolved to.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/hooks.json", "bin/", "lib/"],
    extra: (at) => {
      writeFileSync(
        join(at, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "fixture", version: "1.0.0", description: "d", hooks: "./hooks/other.json" }),
      );
      writeFileSync(join(at, "hooks", "other.json"), readFileSync(join(at, "hooks", "hooks.json"), "utf8"));
    },
  });

  assert.deepEqual(shipped(dir), [
    "package.json files does not ship hooks/other.json, which the loader reads",
  ]);
});

test("a path named at the end of a sentence is tried as written before the stop comes off", needsSpawnableNpm, (t) => {
  // Stripping first renames a file that honestly ends in one of those
  // characters, and reports a directory the plugin does have as one it does
  // not. Asked of the tree in both spellings, each answer is about a path that
  // is really there.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/", "commands/", "docs/", "tools/"],
    extra: (at) => {
      mkdirSync(join(at, "commands"), { recursive: true });
      mkdirSync(join(at, "docs"), { recursive: true });
      mkdirSync(join(at, "tools"), { recursive: true });
      writeFileSync(join(at, "docs", "notes.md!"), "x\n");
      writeFileSync(join(at, "tools", "scan.mjs"), "export const scan = () => {};\n");
      writeFileSync(
        join(at, "commands", "go.md"),
        "Reads `${CLAUDE_PLUGIN_ROOT}/docs/notes.md!` and lives under ${CLAUDE_PLUGIN_ROOT}/tools.\n",
      );
    },
  });

  assert.deepEqual(shipped(dir), []);
});

test("a plugin path named in a file the loader does not start from is still read", needsSpawnableNpm, (t) => {
  // The loader sets `CLAUDE_PLUGIN_ROOT` in the environment of every hook
  // process, so a script under `bin/` naming a sibling that way is naming one
  // for real. Reading the variable only in the files the walk starts from left
  // those references unchecked, and no case said which it was.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/"],
    extra: (at) => {
      writeFileSync(join(at, "bin", "run.mjs"), 'import { work } from "../lib/work.mjs";\nwork(`${CLAUDE_PLUGIN_ROOT}/tools/typo.mjs`);\n');
    },
  });

  assert.deepEqual(shipped(dir), ["bin/run.mjs names tools/typo.mjs, which this plugin does not have"]);
});


test("a command file that is a symlink is walked, and named when the tarball drops it", { ...needsSpawnableNpm, ...needsSymlinks }, (t) => {
  // A `Dirent` for a link is neither a file nor a directory, so the walk passed
  // it over. npm drops it from the tarball too, so the plugin would ship
  // without a command it loads and both halves of this gate said nothing.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/", "commands/"],
    extra: (at) => {
      mkdirSync(join(at, "commands"), { recursive: true });
      mkdirSync(join(at, "elsewhere"), { recursive: true });
      writeFileSync(join(at, "elsewhere", "deploy.md"), "Reads ${CLAUDE_PLUGIN_ROOT}/tools/typo.mjs\n");
      symlinkSync(join(at, "elsewhere", "deploy.md"), join(at, "commands", "deploy.md"));
    },
  });

  assert.deepEqual(shipped(dir), [
    "package.json files does not ship commands/deploy.md, which commands/deploy.md reaches",
    "commands/deploy.md names tools/typo.mjs, which this plugin does not have",
  ]);
});

test("a path with a space in it, quoted the way the loader needs, is one path", needsSpawnableNpm, (t) => {
  // The pattern stops at whitespace, and a hook command is parsed out of JSON
  // before it is read, so the shell quotes are what delimit the path and a
  // space inside them is an ordinary character. Read up to the space, the gate
  // fails on a tree that is correct.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/"],
    extra: (at) => {
      writeFileSync(join(at, "bin", "my tool.mjs"), "export const tool = () => {};\n");
      writeFileSync(
        join(at, "hooks", "hooks.json"),
        JSON.stringify({
          hooks: {
            UserPromptSubmit: [
              { hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/my tool.mjs"' }] },
            ],
          },
        }),
      );
    },
  });

  assert.deepEqual(shipped(dir), []);
});

test("a name npm never ships is not a thing the plugin loads", needsSpawnableNpm, (t) => {
  // A Finder visit to `commands/` leaves a `.DS_Store` there, and every walked
  // directory turned one into an entry point that reaches itself and is never
  // in the tarball. A gate that goes red on a macOS checkout gets turned off.
  const dir = packaged(t, {
    files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/", "commands/"],
    extra: (at) => {
      mkdirSync(join(at, "commands"), { recursive: true });
      writeFileSync(join(at, "commands", "go.md"), "# go\n");
      writeFileSync(join(at, "commands", ".DS_Store"), " junk");
      writeFileSync(join(at, "commands", ".npmignore"), "*.tmp\n");
    },
  });

  assert.deepEqual(shipped(dir), []);
});

test("a manifest pointing a kind at the manifest itself is said once", needsSpawnableNpm, (t) => {
  const dir = packaged(t, {
    files: ["hooks/", "bin/", "lib/"],
    extra: (at) => {
      writeFileSync(
        join(at, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "fixture", version: "1.0.0", description: "d", hooks: "./.claude-plugin/plugin.json" }),
      );
    },
  });

  assert.deepEqual(shipped(dir), [
    "package.json files does not ship .claude-plugin/plugin.json, which the loader reads",
  ]);
});

test("this gate refuses an option it does not know rather than taking it as a directory", () => {
  // A typed flag became the working directory, and the npm spawn then failed
  // for the missing directory with a message about npm not being installed.
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "shipped.mjs"), "--help"], { encoding: "utf8" });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /unknown option: --help/);
});


test("a plugin with no package of its own is still walked for what it names", needsSpawnableNpm, (t) => {
  // The marketplace copies a plugin's whole directory, so a plugin without a
  // `package.json` has no list to hold against what it loads. What it still
  // has is files that name paths, and one naming a path it does not have is
  // broken on install whichever way it shipped. Filtered out for want of a
  // list, the second plugin's own declaration was read by nothing.
  const dir = packaged(t, { files: [".claude-plugin/plugin.json", "hooks/", "bin/", "lib/"] });
  rmSync(join(dir, "package.json"));
  writeFileSync(
    join(dir, "hooks", "hooks.json"),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/gone.mjs"' }] }] } }),
  );

  assert.deepEqual(shipped(dir), ["hooks/hooks.json names bin/gone.mjs, which this plugin does not have"]);
});

test("every plugin the marketplace lists is one this gate answers about", needsSpawnableNpm, () => {
  // Filtered to the plugins with a package of their own, the count was one of
  // two and the guard passed at one. A plugin the marketplace copies is a
  // plugin this has something to say about, list or no list.
  const roots = pluginRootsIn(ROOT);
  const listed = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "marketplace.json"), "utf8")).plugins;

  assert.equal(roots.length, listed.length, `${listed.length} listed, ${roots.length} checked`);
  for (const root of roots) assert.deepEqual(shipped(root), [], root);
});

/** A marketplace listing one plugin that has no package of its own. */
function packageless(t, extra = () => {}) {
  const held = mkdtempSync(join(tmpdir(), "anatomiya-shipped-"));
  t.after(() => rmSync(held, { recursive: true, force: true }));
  mkdirSync(join(held, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(held, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "m", owner: { name: "o" }, plugins: [{ name: "only", source: "./plugins/only", description: "d" }] }),
  );
  const dir = join(held, "plugins", "only");
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "only", version: "1.0.0", description: "d" }));
  extra(dir, held);
  return { held, dir };
}

// A plugin with no `files` list ships its directory whole, so the file that
// belongs to the marketplace goes with it. The list is what the other plugin is
// stopped by, and this one has none.
test("a plugin with no package still may not carry the marketplace's own manifest", (t) => {
  const { dir } = packageless(t, (at) => {
    writeFileSync(join(at, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "m", owner: { name: "o" }, plugins: [] }));
  });

  assert.deepEqual(shipped(dir), [
    ".claude-plugin/marketplace.json belongs to the marketplace rather than to the plugin, and this plugin ships its whole directory",
  ]);
});

test("a plugin with no package and nothing of the marketplace's in it passes", (t) => {
  const { dir } = packageless(t);

  assert.deepEqual(shipped(dir), []);
});

// `validate.mjs` reports the source itself, and this walking a tree outside the
// marketplace would report on files that are nobody's plugin.
test("a marketplace entry whose source leaves the marketplace names no plugin root", (t) => {
  const { held } = packageless(t);
  writeFileSync(
    join(held, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "m", owner: { name: "o" }, plugins: [{ name: "away", source: "../elsewhere", description: "d" }] }),
  );
  mkdirSync(join(held, "..", "elsewhere"), { recursive: true });

  assert.deepEqual(pluginRootsIn(held), []);
});
