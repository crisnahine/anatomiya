import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { MARK, copiesBeside, injectLevel, knownWorkflows, metaEnd, resolveWorkflow, workflowCopies } from "../plugins/ultracode-anywhere/hooks/hold-workflows.mjs";
import { runStages, world, write } from "./hold-fixtures.mjs";

const flow = (name, marker, extra = "") => `export const meta = { name: "${name}", description: "d" }\n${extra}return await agent("${marker}", { effort: "high" })\n`;

test("metaEnd skips braces inside strings and comments, and finds no meta where there is none", () => {
  const src = 'export const meta = { name: "a}{", d: \'}\', t: `}`, /* } */ phases: [{ title: "x" }] // }\n};\nrest';

  assert.equal(src.slice(metaEnd(src)), "\nrest");
  assert.equal(metaEnd("const x = 1"), -1);
  assert.equal(metaEnd("export const meta = { never: 'closed' "), -1);
  assert.equal(metaEnd("export const meta = ({ name: 'p' }"), -1, "an open parenthesis that never closes");
  assert.equal(metaEnd("export const meta = { a: 1 // no end"), -1);
  assert.equal(metaEnd("export const meta = { a: 1 /* no end"), -1);
  assert.equal(metaEnd("export const meta = f()"), -1);
});

test("a meta in parentheses, or after comments and a shebang that look like one, still gets the prelude", () => {
  const paren = 'export const meta = ({ name: "p", description: "d" })\nreturn await agent("a", { effort: "xhigh" })';
  assert.equal(paren.slice(metaEnd(paren)), '\nreturn await agent("a", { effort: "xhigh" })');

  const decoy = '#!/usr/bin/env node\n// export const meta = { name: "decoy" }\n/* export const meta = ( */\nexport const meta = { name: "real", description: "d" }\nreturn 1';
  const injected = injectLevel(decoy, "medium");
  assert.ok(injected.indexOf(MARK) > injected.indexOf('name: "real"'), "the prelude goes after the real meta");
});

test("every stage runs at the held level, keeps its own options, loses its model and stays on this machine", async () => {
  const script = 'export const meta = { name: "p", description: "d" }\nawait agent("a")\nawait agent("b", { effort: "xhigh", label: "b", isolation: "remote", model: "inherit" })\nreturn await agent("c", "odd")';

  const calls = await runStages(injectLevel(script, "low"));
  assert.deepEqual(calls.map((o) => o.effort), ["low", "low", "low"]);
  assert.equal(calls[1].label, "b");
  assert.equal(calls[1].isolation, "worktree");
  assert.equal(calls[1].model, undefined, "an inherited model never reaches the spawn");
  assert.equal(injectLevel("no meta here", "low"), null);
});

test("injecting again replaces the old prelude instead of stacking a second one", () => {
  const once = injectLevel('export const meta = { name: "p", description: "d" }\nreturn 1', "medium", { a: "/old.js" });
  const twice = injectLevel(once, "low", { a: "/new.js" });

  assert.equal(twice.split(MARK).length, 2);
  assert.ok(twice.includes("/new.js") && !twice.includes("/old.js"));
  assert.match(twice, /"low"/);
});

test("the workflows a name can reach are the plugins', the user's and the project's, the project's winning", (t) => {
  const { cfg, plugin, project, env } = world(t);
  write(join(plugin, "workflows", "foo.js"), flow("foo", "PLUGIN"));
  write(join(cfg, "workflows", "foo.js"), flow("foo", "USER"));
  write(join(project, ".claude", "workflows", "foo.js"), flow("foo", "PROJECT"));
  write(join(plugin, "workflows", "only.js"), flow("only", "SOLO"));
  write(join(cfg, "workflows", "broken.js"), "no meta at all");

  const flows = knownWorkflows(env, project);
  assert.match(resolveWorkflow(flows, "foo").src, /PROJECT/);
  assert.match(resolveWorkflow(flows, "kit:foo").src, /PLUGIN/);
  assert.match(resolveWorkflow(flows, "only").src, /SOLO/, "a bare name finds the one plugin workflow carrying it");
  assert.equal(resolveWorkflow(flows, "broken"), null);
  assert.equal(resolveWorkflow(knownWorkflows(env, join(project, "..", "..")), "foo").src.includes("USER"), true);
});

test("a nested workflow runs its injected copy, by name or by path, and an unknown one is refused", async (t) => {
  const { cfg, plugin, project, env, transcript } = world(t);
  write(join(plugin, "workflows", "sweep.js"), flow("sweep", "SWEEP"));
  const userFile = write(join(cfg, "workflows", "mine.js"), flow("mine", "MINE"));
  const dir = copiesBeside(transcript, env);

  const copies = workflowCopies(env, project, dir, "medium");
  const parent = injectLevel(`export const meta = { name: "p", description: "d" }\nawait workflow("sweep")\nawait workflow({ scriptPath: ${JSON.stringify(userFile)} })\nreturn await workflow({ scriptPath: "/somewhere/else.js" })`, "medium", copies);
  assert.equal(readdirSync(dir).length, 2);

  const calls = [];
  const nested = [];
  await assert.rejects(runStages(parent, calls, nested), /has no copy held to the level/);
  assert.deepEqual(calls.map((o) => o.effort), ["medium", "medium"], "the children's own high stages ran at medium");
  assert.ok(existsSync(nested[0].scriptPath));
  assert.match(readFileSync(nested[1].scriptPath, "utf8"), /MINE/);
  assert.equal(Object.keys(workflowCopies(env, project, dir, "medium")).length, Object.keys(copies).length, "a second pass rewrites nothing new");
});

test("copies go beside the session transcript, or into the state directory when there is none", (t) => {
  const { env, transcript } = world(t);

  assert.equal(copiesBeside(transcript, env), join(transcript.replace(/\.jsonl$/, ""), "workflows", "ultracode-anywhere"));
  assert.match(copiesBeside(undefined, env), /state[\\/]hold[\\/]workflows$/);
});

test("a meta holding a template string with a substitution is refused, since the prelude could land inside a string", () => {
  const script = 'export const meta = { name: "p", description: "d", x: `${"`"}` }\nconst s = `"}`;\nawait agent("a", { effort: "xhigh" })\n';

  assert.equal(injectLevel(script, "medium"), null);
});

test("a meta holding a regular expression is refused, since the reader above takes its quotes for strings", () => {
  const script = "export const meta = { name: \"p\", description: \"d\", re: /'/ }\nconst note = `'}`;\nawait agent(\"a\", { effort: \"xhigh\" })\n";

  assert.equal(injectLevel(script, "medium"), null);
});

test("a line comment ends at every line terminator JavaScript has, so a meta cannot hide its closing brace behind one", async () => {
  for (const end of ["\r", "\u2028", "\u2029"]) {
    const script = `export const meta = { name: "x" //${end} }; await agent("x", { effort: "low" }); if (0) {\n}\n`;
    const calls = await runStages(injectLevel(script, "medium") ?? "");
    assert.deepEqual(calls.map((opts) => opts.effort), ["medium"], JSON.stringify(end));
  }
});
