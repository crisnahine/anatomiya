import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { needsRuby } from "./ruby-available.mjs";
import { needsShebang } from "./platform.mjs";
import { installWithoutStripper } from "./no-stripper.mjs";
import { installWithoutDependencies } from "./plugin-install.mjs";
import { REL } from "../scripts/plugins.mjs";
import { ENGINES } from "../plugins/anatomiya/lib/langs.mjs";
import { installProblem, olderThan, pluginRoot, readiness, readinessLines, remedyFor } from "../plugins/anatomiya/lib/readiness.mjs";

/** A directory on PATH holding one stub interpreter, so a probe meets a Ruby that is not this one. */
function stubInterpreter(t, body) {
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-readiness-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, "ruby"), body, { mode: 0o755 });
  return { PATH: bin };
}

test("the plugin root is the directory holding this package's own manifest", () => {
  const root = pluginRoot();

  assert.ok(existsSync(join(root, "package.json")), `no manifest beside lib/: ${root}`);
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name, "anatomiya");
});

test("the node engine's remedy spells the directory to run it in", () => {
  // "the plugin directory" was the whole sentence, and a user standing in their
  // own repository has no way to know which directory that is.
  const remedy = remedyFor("oxc");

  assert.ok(remedy.includes(pluginRoot()), remedy);
  // The command that installs, rather than the npm line it runs: the flags that
  // make that install safe live in one place and are not a person's to retype.
  assert.match(remedy, /bin\/anatomiya\.mjs setup/);
  assert.doesNotMatch(remedy, /npm/);
});

test("the interpreter engine's remedy names the interpreter and never npm", () => {
  // Measured: a scan with no ruby on PATH exited 1 with `spawn ruby ENOENT` and
  // told the reader to run npm, which cannot install an interpreter.
  const remedy = remedyFor("prism");

  assert.match(remedy, /3\.4/);
  assert.doesNotMatch(remedy, /npm/);
});

test("an engine nobody declares has no remedy to hand out", () => {
  assert.throws(() => remedyFor("treesitter"), /treesitter/);
});

test("the node engine answers present, with the version its own manifest states", async () => {
  const rows = await readiness({ engines: ["oxc"] });
  const oxc = rows.find((r) => r.extra === null);

  assert.equal(oxc.engine, "oxc");
  assert.equal(oxc.present, true);
  assert.match(oxc.version, /^\d+\.\d+\.\d+/);
  assert.equal(oxc.ok, true);
  assert.equal(oxc.reason, null);
});

test("an engine's extras are probed the same way and reported apart from it", async () => {
  // A stripper that is absent costs one dialect; an engine that is absent costs
  // the run. Folding them into one row would lose that difference.
  const rows = await readiness({ engines: ["oxc"] });

  const stripper = rows.find((r) => r.extra === ENGINES.oxc.extras[0].module);
  assert.equal(stripper.engine, "oxc");
  assert.equal(stripper.present, true);
  assert.equal(stripper.ok, true);
  assert.equal(stripper.remedy, remedyFor("oxc"));
});

test("an extra that is not installed is the row that says so, and the engine still answers", (t) => {
  // A node_modules older than the stripper is a real install shape rather than
  // a hypothetical: the dependency arrived after the plugin did. Probed out of
  // process because what is under test is module resolution, and an in-process
  // fake resolves the same either way.
  const home = installWithoutStripper(t);
  const script = `
    import { readiness } from ${JSON.stringify(pathToFileURL(join(home, "lib", "readiness.mjs")).href)};
    process.stdout.write(JSON.stringify(await readiness({ engines: ["oxc"] })));
  `;

  const rows = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }));

  assert.equal(rows.find((r) => r.extra === null).present, true, "the parser is there");
  const stripper = rows.find((r) => r.extra === ENGINES.oxc.extras[0].module);
  assert.equal(stripper.present, false);
  assert.equal(stripper.ok, false);
});

test("the install this command exists for reports why, not a null", (t) => {
  // An install that did not run leaves the plugin's own code with nothing
  // beside it, and the first doctor a user runs there read `oxc absent: null`.
  // Probed out of process for the reason above: module resolution is the thing
  // under test, and an in-process fake resolves the same either way.
  const home = installWithoutDependencies(t);
  const script = `
    import { readiness, readinessLines } from ${JSON.stringify(pathToFileURL(join(home, "lib", "readiness.mjs")).href)};
    const rows = await readiness({ engines: ["oxc"] });
    process.stdout.write(JSON.stringify({ rows, lines: readinessLines(rows) }));
  `;

  const { rows, lines } = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" })
  );

  const oxc = rows.find((r) => r.extra === null);
  assert.equal(oxc.present, false);
  assert.equal(typeof oxc.reason, "string");
  assert.ok(oxc.reason.includes(ENGINES.oxc.module), oxc.reason);
  for (const line of lines) assert.doesNotMatch(line, /null/, line);
});

test("an interpreter that is not on PATH is absent, and carries the remedy that installs it", async () => {
  const rows = await readiness({ engines: ["prism"], env: { PATH: "" } });

  assert.equal(rows.length, 1, "an interpreter engine declares no extras");
  assert.deepEqual(rows[0], {
    engine: "prism",
    extra: null,
    present: false,
    version: null,
    floor: ENGINES.prism.floor,
    ok: false,
    reason: "ruby is not on PATH",
    remedy: remedyFor("prism"),
  });
});

test("an interpreter without the library is present and still not ready", needsShebang, async (t) => {
  // The measured second half: ruby 2.6 runs and ships no prism, so every Ruby
  // file was charged as a crash with nothing on screen naming the library.
  const env = stubInterpreter(t, "#!/bin/sh\necho 'cannot load such file -- prism' >&2\nexit 1\n");

  const [row] = await readiness({ engines: ["prism"], env });

  assert.equal(row.present, true, "the interpreter ran");
  assert.equal(row.version, null);
  assert.equal(row.ok, false);
  assert.equal(row.reason, "prism is not installed for this ruby");
});

test("a library older than the floor names both numbers", needsShebang, async (t) => {
  // prism 0.19 spells the fields the dimensions read differently: nothing
  // raises and every count comes back zero, which is the one failure a version
  // check exists to catch.
  const env = stubInterpreter(t, "#!/bin/sh\nprintf 0.19.0\n");

  const [row] = await readiness({ engines: ["prism"], env });

  assert.equal(row.present, true);
  assert.equal(row.version, "0.19.0");
  assert.equal(row.ok, false);
  // Both numbers by substring rather than by a regex built from one of them:
  // escaping only the dots leaves every other metacharacter live, which is a
  // sanitiser that reads complete and is not.
  assert.match(row.reason, /0\.19\.0/);
  assert.ok(row.reason.includes(ENGINES.prism.floor), `${row.reason} names the floor`);
});

test("an interpreter that answers reports its version and the floor it is held to", needsRuby, async () => {
  const [row] = await readiness({ engines: ["prism"] });

  assert.equal(row.present, true);
  assert.match(row.version, /^\d+\.\d+/);
  assert.equal(row.floor, ENGINES.prism.floor);
  assert.equal(row.ok, true);
});

test("an interpreter our own timer killed is not reported as a missing library", needsRuby, async () => {
  // Which of the two it is decides what the reader does next, and a loaded
  // machine is not an install to fix.
  const [row] = await readiness({ engines: ["prism"], timeoutMs: 1 });

  assert.equal(row.ok, false);
  assert.match(row.reason, /did not answer/);
});

test("the optional checker is never what makes a probe fail", async () => {
  // It is not an engine: one flag asks for it and that flag refuses on its own
  // before any work, so a doctor report that called it broken would send a
  // reader to install something no default run uses.
  const [row] = await readiness({ engines: ["typescript"] });

  assert.equal(row.engine, "typescript");
  assert.equal(row.ok, true);
  assert.match(row.reason, /--deep/, "and the row still says which flag wants it");
});

test("the default probe asks every declared engine and nothing else", async () => {
  const rows = await readiness({ env: { PATH: "" } });

  assert.deepEqual([...new Set(rows.map((r) => r.engine))], Object.keys(ENGINES));
});

test("a doctor line says what answered, or what to do about it", () => {
  const rows = [
    { engine: "oxc", extra: null, present: true, version: "0.144.0", floor: null, ok: true, reason: null, remedy: "r" },
    { engine: "oxc", extra: "flow-remove-types", present: true, version: "2.3.0", floor: null, ok: true, reason: null, remedy: "r" },
    { engine: "prism", extra: null, present: false, version: null, floor: "1.0.0", ok: false, reason: "ruby is not on PATH", remedy: "install Ruby" },
    { engine: "prism", extra: null, present: true, version: null, floor: "1.0.0", ok: false, reason: "prism is not installed for this ruby", remedy: "install Ruby" },
    { engine: "typescript", extra: null, present: false, version: null, floor: null, ok: true, reason: "optional: --deep needs it", remedy: "r" },
  ];

  assert.deepEqual(readinessLines(rows), [
    "oxc 0.144.0 ok",
    "flow-remove-types 2.3.0 ok",
    "prism absent: ruby is not on PATH, install Ruby",
    "prism no version: prism is not installed for this ruby, install Ruby",
    "typescript absent ok (optional: --deep needs it)",
  ]);
});

test("a version is compared by its numbers, never as a string", () => {
  // "1.10.0" sorts below "1.9.0" as text, and prism is already past its tenth
  // minor, so a string compare would refuse the version it is asking for.
  assert.equal(olderThan("0.19.0", "1.0.0"), true);
  assert.equal(olderThan("1.0.0", "1.0.0"), false);
  assert.equal(olderThan("1.10.0", "1.9.0"), false);
  assert.equal(olderThan("1.5.2", "1.0.0"), false);
  assert.equal(olderThan("1", "1.0.1"), true);
  // Nothing to compare is not a version below the floor: the caller already
  // reported that the engine answered nothing.
  assert.equal(olderThan(null, "1.0.0"), false);
  assert.equal(olderThan("1.0.0", null), false);
});

test("an installation with nothing in it is one problem, not one per engine", (t) => {
  // Claude Code installs a plugin's dependencies itself, from the lockfile
  // beside its manifest. When that has not happened every node-hosted row is
  // absent for the same reason, and a report naming them one at a time reads as
  // three faults with three fixes rather than one install that did not finish.
  const bare = installWithoutDependencies(t);
  const absent = [
    { engine: "oxc", extra: null, present: false, ok: false, reason: "oxc-parser did not load" },
    { engine: "oxc", extra: "flow-remove-types", present: false, ok: false, reason: "flow-remove-types did not load" },
    { engine: "prism", extra: null, present: true, version: "1.5.2", ok: true, reason: null },
  ];

  const said = installProblem(absent, bare);

  assert.match(said ?? "", /^nothing is installed here: /);
  // The directory once, on the half that is a command to run. Said twice, the
  // sentence ran to 174 characters and read as two places rather than one.
  assert.equal(said.split(bare).length - 1, 1, said);
  assert.equal(said.includes(pluginRoot()), false, "and never this checkout's own");
});

test("an installation with its engines loaded says nothing, and neither does an absent interpreter", () => {
  const ready = [{ engine: "oxc", extra: null, present: true, version: "0.144.0", ok: true, reason: null }];

  assert.equal(installProblem(ready, "/nowhere"), null, "nothing absent, so the directory is never looked at");
  assert.equal(
    installProblem([{ engine: "prism", extra: null, present: false, ok: false, reason: "ruby is not on PATH" }], "/nowhere"),
    null,
    "an interpreter is the machine's own and no install here puts one there"
  );
});

test("an interpreter this cannot install is never what the install line is about", () => {
  // No `npm install` anywhere puts a Ruby on a machine, so an absent prism is
  // not an install that did not run, whatever the plugin's own directory holds.
  // The row carries its own remedy and this says nothing.
  const rows = [
    { engine: "prism", extra: null, present: false, ok: false, reason: "ruby is not on PATH" },
    { engine: "oxc", extra: null, present: true, version: "0.144.0", ok: true, reason: null },
  ];

  assert.equal(installProblem(rows, "/nowhere-at-all"), null);
});

test("packages installed above the plugin are still installed, which is this checkout's own shape", (t) => {
  // The marketplace declares its plugins as workspaces, so npm hoists every
  // package to the root and `plugins/anatomiya/node_modules` never exists here.
  // Asked only about the directory beside the manifest, an engine that failed
  // to load in a contributor's checkout was reported as an install that never
  // ran, pointing at a directory that will never hold one. The question is
  // whether anything on the way up serves this plugin, which is where node's
  // own resolver would have looked.
  const above = mkdtempSync(join(tmpdir(), "anatomiya-hoisted-"));
  t.after(() => rmSync(above, { recursive: true, force: true }));
  mkdirSync(join(above, "node_modules"), { recursive: true });
  mkdirSync(join(above, REL.anatomiya), { recursive: true });
  const absent = [{ engine: "oxc", extra: null, present: false, ok: false, reason: "oxc-parser did not load" }];

  assert.equal(installProblem(absent, join(above, REL.anatomiya)), null);
});

test("an install that ran and stopped short is left to the rows that say which engine is missing", (t) => {
  // The loader kills an install at sixty seconds, and what that leaves is a
  // `node_modules` holding some of the packages. One sentence saying nothing is
  // installed would be wrong about that directory, and the rows already name
  // the engine that did not load. Driven with the directory there, since that
  // is the branch: with it absent the first guard has already answered.
  const half = mkdtempSync(join(tmpdir(), "anatomiya-halfinstall-"));
  t.after(() => rmSync(half, { recursive: true, force: true }));
  mkdirSync(join(half, "node_modules"), { recursive: true });
  const absent = [{ engine: "oxc", extra: null, present: false, ok: false, reason: "oxc-parser did not load" }];

  assert.equal(installProblem(absent, half), null);
  // Not a directory under it: the walk goes up, so anything below `half` is
  // served by the same `node_modules` and answers the same way. A tree with
  // none anywhere above it is what the lead line is about.
  const bare = mkdtempSync(join(tmpdir(), "anatomiya-nothing-"));
  t.after(() => rmSync(bare, { recursive: true, force: true }));

  assert.match(installProblem(absent, join(bare, "deep", "deeper")) ?? "", /nothing is installed/, "and a tree with none still answers");
});
