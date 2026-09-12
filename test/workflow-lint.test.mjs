import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { INJECTED, SCRIPT_MOST, lintWorkflows } from "../scripts/workflow-lint.mjs";
import { ULTRACODE } from "../scripts/plugins.mjs";
import { RESOLVABLE, WORKFLOWS_DIR, metaIn } from "../plugins/ultracode-anywhere/hooks/catalogue.mjs";

/** A workflows directory holding exactly what a case is about. */
function dirWith(t, files) {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-lint-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

/** A script the lint passes, so a case changes exactly one thing about it. */
const OK = `export const meta = {
  name: 'fine',
  description: 'a script the lint is happy with',
  phases: [{ title: 'Find' }],
}

phase('Find')
const found = await agent('find something', { effort: 'medium' })
log('found')
return { found }
`;

/** The problems a directory raises, as one string to match against. */
const problemsIn = (dir) => lintWorkflows({ dir }).problems.join("\n");

test("a script that keeps the contract raises nothing", (t) => {
  const result = lintWorkflows({ dir: dirWith(t, { "fine.js": OK }) });
  assert.deepEqual(result.problems, []);
  assert.equal(result.checked, 1);
});

test("the workflows this plugin ships pass their own gate", () => {
  const result = lintWorkflows({ dir: join(ULTRACODE, WORKFLOWS_DIR) });
  assert.deepEqual(result.problems, []);
  assert.ok(result.checked > 0, "the plugin ships no workflows at all");
});

test("a meta that is not the first statement is named, since the build would skip the file in silence", (t) => {
  const dir = dirWith(t, { "late.js": `const x = 1\n${OK}` });
  assert.match(problemsIn(dir), /late\.js.*first statement/s);
});

test("a meta that is not a pure literal is named", (t) => {
  const dir = dirWith(t, { "computed.js": OK.replace("name: 'fine',", "name: NAME,") });
  assert.match(problemsIn(dir), /computed\.js.*meta/s);
});

test("a missing or empty required field is named, one message per field", (t) => {
  assert.match(problemsIn(dirWith(t, { "noname.js": OK.replace("name: 'fine',", "") })), /noname\.js.*name/s);
  assert.match(problemsIn(dirWith(t, { "nodesc.js": OK.replace(/description: '[^']*',/, "description: '',") })), /nodesc\.js.*description/s);
});

test("a phase call with no entry in meta.phases is named, since the build matches them exactly and silently", (t) => {
  const dir = dirWith(t, { "extra.js": OK.replace("phase('Find')", "phase('Find')\nphase('Verify')") });
  assert.match(problemsIn(dir), /extra\.js.*Verify/s);
});

test("a meta.phases entry no phase call uses is named", (t) => {
  const dir = dirWith(t, { "unused.js": OK.replace("[{ title: 'Find' }]", "[{ title: 'Find' }, { title: 'Ghost' }]") });
  assert.match(problemsIn(dir), /unused\.js.*Ghost/s);
});

test("every clock and randomness call the sandbox refuses is named before a user meets it", (t) => {
  for (const [file, code] of [
    ["now.js", "const t = Date.now()"],
    ["date.js", "const t = new Date()"],
    ["random.js", "const t = Math.random()"],
  ]) {
    const dir = dirWith(t, { [file]: OK.replace("log('found')", code) });
    assert.match(problemsIn(dir), new RegExp(`${file.replace(".", "\\.")}`), file);
  }
});

test("a dated value the sandbox does allow is not named", (t) => {
  const dir = dirWith(t, { "parsed.js": OK.replace("log('found')", "const t = new Date(args.at)") });
  assert.deepEqual(lintWorkflows({ dir }).problems, []);
});

test("syntax the compiler refuses outright is named", (t) => {
  for (const [file, code] of [
    ["with.js", "with (args) { log('x') }"],
    ["dynimport.js", "const m = await import('node:fs')"],
    ["reserved.js", "const __wRg$x = 1"],
  ]) {
    const dir = dirWith(t, { [file]: OK.replace("log('found')", code) });
    assert.match(problemsIn(dir), new RegExp(file.replace(".", "\\.")), file);
  }
});

test("a global the sandbox does not inject is named, since referencing one is a ReferenceError mid-run", (t) => {
  for (const [file, code] of [
    ["req.js", "const fs = require('node:fs')"],
    ["proc.js", "log(process.cwd())"],
    ["url.js", "log(new URL('a', 'https://b').href)"],
    // In the realm and deleted by the build's hardening pass, so it compiles in
    // a bare vm and throws in a session: the one direction reading the realm
    // alone gets wrong.
    ["weak.js", "const held = new WeakRef({})"],
    // Code generation is off in the context, so both of these are an EvalError
    // on the line that runs them however the realm is spelled.
    ["gen.js", "const f = new Function('return 1')"],
    ["ev.js", "log(eval('1'))"],
  ]) {
    const dir = dirWith(t, { [file]: OK.replace("log('found')", code) });
    assert.match(problemsIn(dir), new RegExp(file.replace(".", "\\.")), file);
  }
});

test("an intrinsic the sandbox does provide is not named, since refusing it refuses a working script", (t) => {
  // `globalThis` is the one the build proves itself: its own shim runs inside
  // this context and ends `globalThis.Date = ShimDate`.
  for (const [file, code] of [
    ["global.js", "log(typeof globalThis)"],
    ["aggregate.js", "const e = new AggregateError([], 'x')"],
    ["bigarray.js", "const a = new BigInt64Array(1)"],
    ["esc.js", "log(escape('a b') + unescape('a%20b'))"],
  ]) {
    const dir = dirWith(t, { [file]: OK.replace("log('found')", code) });
    assert.deepEqual(lintWorkflows({ dir }).problems, [], file);
  }
});

test("the injected list is the eleven names the build actually provides", () => {
  // Stated here rather than read from the module under test. Built from
  // INJECTED, the fixture agreed with INJECTED whatever INJECTED said: adding a
  // name the sandbox does not provide, or dropping one it does, left the suite
  // green, and the added-name direction is the one that ships a workflow which
  // ReferenceErrors mid-run in somebody's session.
  assert.deepEqual(
    [...INJECTED].sort(),
    ["agent", "args", "budget", "clearTimeout", "console", "log", "parallel", "phase", "pipeline", "setTimeout", "workflow"],
  );
});

test("each of the eleven names the sandbox does inject is left alone", (t) => {
  const uses = ["agent", "args", "budget", "clearTimeout", "console", "log", "parallel", "phase", "pipeline", "setTimeout", "workflow"]
    .map((name) => `void ${name}`)
    .join("\n");
  const dir = dirWith(t, { "injected.js": OK.replace("log('found')", uses) });
  assert.deepEqual(lintWorkflows({ dir }).problems, []);
});

test("a body that is not a valid async function body is named as a parse failure", (t) => {
  const dir = dirWith(t, { "broken.js": `${OK}\nconst = ,\n` });
  assert.match(problemsIn(dir), /broken\.js/);
});

test("the size the loader skips at is the one the build carries", () => {
  // Stated rather than recomputed: a fixture padded to SCRIPT_MOST is over
  // whatever SCRIPT_MOST says, so a wrong cap passed in both directions.
  assert.equal(SCRIPT_MOST, 524_288);
});

test("a script over the size the build skips at is named, and one under it is not", (t) => {
  const over = dirWith(t, { "huge.js": `${OK}\n// ${"x".repeat(524_288)}\n` });
  assert.match(problemsIn(over), /huge\.js.*bytes/s);

  const under = dirWith(t, { "big.js": `${OK}\n// ${"x".repeat(524_288 - OK.length - 20)}\n` });
  assert.deepEqual(lintWorkflows({ dir: under }).problems, []);
});

test("a file with an extension the loader refuses is named rather than passed over", (t) => {
  const dir = dirWith(t, { "fine.js": OK, "other.mjs": OK });
  assert.match(problemsIn(dir), /other\.mjs/);
});

test("the plugin's own reader is held to the same answer as a real parse", (t) => {
  // The hook reads a meta without a parser, because the plugin ships no
  // dependencies. Two readers of one file is only safe while something refuses
  // to let them disagree, so the reader is a parameter here and the case drives
  // a wrong one through: a gate nobody can see fail is a gate nobody has.
  const dir = dirWith(t, { "fine.js": OK });
  assert.deepEqual(lintWorkflows({ dir }).problems, []);

  const wrong = (text) => ({ ...metaIn(text), description: "something the file does not say" });
  assert.match(lintWorkflows({ dir, read: wrong }).problems.join("\n"), /fine\.js.*reader answers/s);

  const blind = () => null;
  assert.match(lintWorkflows({ dir, read: blind }).problems.join("\n"), /fine\.js.*reader answers/s);
});

test("two workflows declaring one name is one workflow, and the gate says which", (t) => {
  // The merge keys on the name, so the later file wins and the catalogue prints
  // the same name twice with two different descriptions. Nothing upstream says
  // which won.
  const dir = dirWith(t, {
    "a.js": OK,
    "b.js": OK.replace("description: 'a script the lint is happy with'", "description: 'a different script with the same name'"),
  });
  assert.match(problemsIn(dir), /b\.js.*already declares|a\.js.*already declares/s);
});

test("a file the gate cannot read is named, rather than ending the run", (t) => {
  // One broken link took the whole gate down with an uncaught ENOENT, so none
  // of the other files were checked and the output said nothing about why.
  const dir = dirWith(t, { "fine.js": OK });
  symlinkSync(join(dir, "gone.js"), join(dir, "broken.js"));
  const result = lintWorkflows({ dir });
  assert.match(result.problems.join("\n"), /broken\.js/);
  assert.ok(result.checked >= 1, "it stopped before reading the file that was fine");
});

test("a parse error that is not the expected one is reported rather than swallowed", (t) => {
  // The filter was a substring match on "return", so any other parse error
  // whose message carried the word passed as the one a workflow is allowed.
  // The second fixture is the one that pins the anchoring rather than the
  // filter: its message carries "return" and is not the allowed sentence.
  assert.match(problemsIn(dirWith(t, { "bad.js": `${OK}\nfunction f( {\n` })), /bad\.js/);
  const inner = dirWith(t, { "static.js": OK.replace("log('found')", "class A { static { return 1 } }") });
  assert.match(problemsIn(inner), /static\.js: will not parse:.*static block/s);
});

test("a meta.name the catalogue cannot quote is named, since nothing else in a session says the workflow exists", (t) => {
  // The build resolves any name, and the sentence the hook writes quotes only
  // the resolvable class. Outside it the workflow loads and is named nowhere.
  for (const [file, name] of [
    ["space.js", "my review"],
    ["tick.js", "a" + String.fromCharCode(96) + "b"],
    ["quote.js", `a"b`],
    ["long.js", "n".repeat(65)],
  ]) {
    const dir = dirWith(t, { [file]: OK.replace("name: 'fine'", `name: ${JSON.stringify(name)}`) });
    assert.match(problemsIn(dir), new RegExp(`${file.replace(".", "\\.")}.*meta\\.name`, "s"), file);
  }
});

test("the class the gate holds a name to is the one the hook quotes it in", () => {
  // Two spellings of the class would be a name one accepts and the other drops
  // without a word, which is the failure the gate exists to make loud.
  assert.equal(RESOLVABLE.source, /^[A-Za-z0-9_.:-]{1,64}$/.source);
});

test("a legacy escape is named, since a module is strict and no parser decodes one", (t) => {
  // Without semantic errors on, oxc decodes these the way the plugin's own
  // reader used to, both agree, and the gate passes a file the build refuses.
  assert.match(problemsIn(dirWith(t, { "esc8.js": OK.replace("happy with", "happy with\\8") })), /esc8\.js: will not parse/);
  assert.match(problemsIn(dirWith(t, { "octal.js": OK.replace("happy with", "happy with\\101") })), /octal\.js: will not parse/);
});

test("a unary the build refuses is named as the meta problem it is", (t) => {
  // The build takes `-` on a number literal and nothing else. Recursing instead
  // reported these through the reader cross-check, which blames the plugin's
  // reader for a meta the build itself would have skipped the file over.
  for (const [file, value] of [["double.js", "- -1"], ["string.js", "-'3'"]]) {
    const dir = dirWith(t, { [file]: OK.replace("phases:", `w: ${value},\n  phases:`) });
    assert.match(problemsIn(dir), new RegExp(`${file.replace(".", "\\.")}: meta must be a pure literal`), file);
  }
});

test("a name a class writes down is not a global the script reaches for", (t) => {
  // oxc gives a class method the parent type `MethodDefinition`, which the key
  // exclusion did not name, so every method, getter, setter and constructor in
  // a workflow body was reported as an undeclared global and the gate refused a
  // script that runs.
  const dir = dirWith(t, {
    "cls.js": OK.replace(
      "log('found')",
      "class Tally { constructor(seed) { this.n = seed } run() { return this.n } get total() { return 1 } static make() { return new Tally(0) } }\nlog(String(Tally.make().run()))",
    ),
  });
  assert.deepEqual(lintWorkflows({ dir }).problems, []);
});

test("a phase title the gate cannot read is not a phase nobody calls", (t) => {
  // `isPhaseCall` reads a string literal only, so a template, a variable or a
  // helper made every declared phase look uncalled and the script was refused.
  for (const [file, body] of [
    ["tpl.js", "phase(`Find`)"],
    ["ident.js", "const title = 'Find'\nphase(title)"],
    ["helper.js", "const stage = (title) => phase(title)\nstage('Find')"],
  ]) {
    const dir = dirWith(t, { [file]: OK.replace("phase('Find')", body) });
    assert.deepEqual(lintWorkflows({ dir }).problems, [], file);
  }

  // And the check still fires where every title could be read.
  const typo = dirWith(t, { "typo.js": OK.replace("phase('Find')", "phase('Fnid')") });
  assert.match(problemsIn(typo), /typo\.js.*no phase\(\) call uses/s);
});

test("a meta key the build accepts is not one the gate refuses", (t) => {
  // The build reads an Identifier or any Literal key, `String(1)` included.
  const dir = dirWith(t, { "numkey.js": OK.replace("phases:", "1: 'one',\n  phases:") });
  assert.deepEqual(lintWorkflows({ dir }).problems, []);
});

test("a bare Date() call is named, since the shim throws on one without `new`", (t) => {
  // The shim's first line is `if (!new.target) throw`, so `Date()` throws
  // whatever it is passed, and only the `new Date()` spelling was checked.
  const dir = dirWith(t, { "bare.js": OK.replace("log('found')", "const stamp = Date()") });
  assert.match(problemsIn(dir), /bare\.js.*without `new`/s);
});

test("a top-level return is the one parse complaint a workflow may raise", (t) => {
  const dir = dirWith(t, { "early.js": OK.replace("return { found }", "if (!found) return { error: 'none' }\nreturn { found }") });
  assert.deepEqual(lintWorkflows({ dir }).problems, []);
});

test("a phases entry the build would drop in silence is named", (t) => {
  // Upstream has no error path here: a non-array, or an entry with no string
  // title, simply is not there, and the run loses its grouping saying nothing.
  assert.match(problemsIn(dirWith(t, { "notarray.js": OK.replace("phases: [{ title: 'Find' }]", "phases: 'Find'") })), /notarray\.js.*array/s);
  assert.match(
    problemsIn(dirWith(t, { "notitle.js": OK.replace("[{ title: 'Find' }]", "[{ title: 'Find' }, { detail: 'no title' }]") })),
    /notitle\.js.*title/s,
  );
});

test("an agentType no shipped agent declares is named", (t) => {
  // A stage naming a type nobody ships fails at the spawn with "agent type not
  // found", which is a whole phase of a run lost to a typo.
  const agents = mkdtempSync(join(tmpdir(), "ultracode-agents-"));
  t.after(() => rmSync(agents, { recursive: true, force: true }));
  writeFileSync(join(agents, "finder.md"), "---\nname: finder\ndescription: reads\n---\n");
  const dir = dirWith(t, { "typo.js": OK.replace("{ effort: 'medium' }", "{ agentType: 'ultracode-anywhere:findr' }") });
  assert.match(lintWorkflows({ dir, agents }).problems.join("\n"), /typo\.js.*findr/s);

  const right = dirWith(t, { "ok.js": OK.replace("{ effort: 'medium' }", "{ agentType: 'ultracode-anywhere:finder' }") });
  assert.deepEqual(lintWorkflows({ dir: right, agents }).problems, []);
});

test("the gate runs where a pull request can fail on it", () => {
  // `npm run validate` calls it, and CI does not call `npm run validate`: it
  // runs each script by name. A gate that only ever runs on the author's own
  // machine is one nothing enforces.
  const ci = readFileSync(fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url)), "utf8");
  assert.match(ci, /node scripts\/workflow-lint\.mjs/);

  const scripts = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")).scripts;
  assert.match(scripts.validate, /workflow-lint\.mjs/);
});
