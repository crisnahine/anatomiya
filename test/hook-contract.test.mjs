import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { ANATOMIYA, REL, ULTRACODE } from "../scripts/plugins.mjs";
import { fieldsIn } from "../plugins/anatomiya/lib/hook.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Both plugins answer the same wire contract and neither may import from the
 * other: a plugin's hook may only run a file inside its own root, which
 * `scripts/validate.mjs` enforces and the loader enforces again once installed.
 * So the payload read, the megabyte cap, the wall-clock bound and the one-object
 * answer are written twice on purpose, and this is what holds the two spellings
 * to one behaviour.
 *
 * Driven through each plugin's own `hooks/hooks.json`, so a command that is
 * renamed or added is covered without this file being edited.
 */
const PLUGINS = [
  // `loads` is what each plugin's own hooks reach, named rather than walked
  // from the root: walking anatomiya's whole tree swept in `test/` and
  // `scripts/`, which contributed seven names no hook reads, and any git
  // worktree checked out inside the repository, which on one machine was 240
  // of the 393 files read. Whatever a stray checkout mentioned was then blanked
  // in the environment of every hook run here.
  { plugin: "anatomiya", root: ANATOMIYA, loads: ["bin", "lib", "hooks"] },
  { plugin: "ultracode-anywhere", root: ULTRACODE, loads: ["hooks"] },
];

/**
 * How long a hook has when it declares no timeout of its own.
 *
 * Ten minutes for a command hook, and thirty seconds where the event lowers it,
 * which `UserPromptSubmit` does and the other three events these plugins
 * declare do not (`docs/plugin-contract.md`, read off the binary). No hook here
 * should be anywhere near either. Every command both plugins declare carries a
 * timeout today, so this is what a new one would be held to until it declares
 * its own.
 */
const UNDECLARED = 5;

/** Every command a plugin declares, with the loader's variable substituted. */
function commandsOf({ plugin, root }) {
  const declared = JSON.parse(readFileSync(join(root, "hooks", "hooks.json"), "utf8"));
  const found = [];
  for (const [event, groups] of Object.entries(declared.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks ?? []) {
        if (hook.type !== "command") continue;
        found.push({
          plugin,
          event,
          // The bound the hook is held to here is the one it asks Claude Code
          // for, read off the same declaration the loader reads. A hook that
          // declares none is held to `UNDECLARED` instead, which is this
          // suite's number and not the harness's minute. Whether it declared
          // one is carried rather than inferred from the number: the fallback
          // and the number four of these hooks declare are both 5.
          declares: typeof hook.timeout === "number",
          // Two kinds of hook, and the difference is the point rather than an
          // accident. Most re-deliver on every turn, so they always have
          // something to say. `notice` answers for one write target and is
          // silent otherwise, because an unchanged block on every result is
          // what trained the reader to skip the clause that mattered (A44).
          // Listed rather than inferred, and speaking is the default: a fourth
          // verb that is silent fails this suite until it says so, where one
          // that speaks would have been exempted without anybody noticing.
          speaksAlways: !SOMETIMES_SILENT.has(hook.command.trim().split(/\s+/).pop()),
          timeout: typeof hook.timeout === "number" ? hook.timeout : UNDECLARED,
          command: hook.command.replaceAll("${CLAUDE_PLUGIN_ROOT}", root.replace(/[\\/]$/, "")),
        });
      }
    }
  }
  return found;
}

/** The verbs that answer only when the counts have something to say (A44). */
const SOMETIMES_SILENT = new Set(["notice"]);

const DECLARED = PLUGINS.flatMap(commandsOf);

/**
 * Every environment variable either plugin reads, taken off their own source.
 *
 * Listed by hand, it drifted the moment a plugin read a new one: the block here
 * neutralised four of the second plugin's and a comment beside it said three,
 * while the plugin read a dozen. A reader with any of the rest set would be
 * told the hook said nothing, for a reason that has nothing to do with the
 * contract this file is about.
 *
 * `PATH` is left alone, since the command being fired is `node`.
 */
function readsEnv() {
  const names = new Set();
  for (const { root, loads } of PLUGINS) {
    for (const rel of loads.flatMap((dir) => sourcesUnder(join(root, dir)))) {
      // `env.NAME` is the one spelling either plugin writes, behind an
      // `env = process.env` default parameter. A bracket read or a rename of
      // that binding would be invisible here, which is why the case below names
      // the four that decide whether a hook says anything at all.
      for (const [, name] of readFileSync(rel, "utf8").matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) names.add(name);
    }
  }
  // The command being fired is `node`.
  names.delete("PATH");
  return [...names].sort();
}

/** Every `.mjs` under one directory, at any depth. */
function sourcesUnder(dir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const at = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourcesUnder(at));
    else if (entry.name.endsWith(".mjs")) found.push(at);
  }
  return found;
}

const ENV_READ = readsEnv();

/**
 * A directory nothing else in this account reaches.
 *
 * Both plugins read settings and keep counters under the home they are given,
 * and the likeliest reader of this suite has `"ultracode": true` in theirs,
 * which silences a hook for a reason that has nothing to do with the contract.
 */
function elsewhere(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-contract-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // With a map here, anatomiya's hooks answer a real object rather than the
  // empty one they answer for an unscanned directory, so the assertions below
  // are about an answer rather than about its absence.
  mkdirSync(join(dir, ".claude", "rules"), { recursive: true });
  writeFileSync(
    join(dir, ".claude", "rules", "anatomiya-overview.md"),
    "---\ngenerator: anatomiya\n---\n\n# Repository map\n\n- lib: 3 .mjs\n",
  );
  // Every variable either plugin reads is cleared, and the four that name a
  // place are pointed here, so what the hook answers is the tree above and
  // nothing the machine running this happens to have set.
  const env = Object.fromEntries(ENV_READ.map((name) => [name, ""]));
  for (const name of ["CLAUDE_CONFIG_DIR", "HOME", "USERPROFILE", "ULTRACODE_ANYWHERE_STATE"]) env[name] = dir;
  return { dir, env };
}

/** One hook run, with the test holding both pipes. */
function fire(t, { command, event, timeout }, { write = true, payload = null, dropReader = false } = {}) {
  const waitMs = timeout * 1000;
  const { dir, env } = elsewhere(t);
  const child = spawn(command, {
    cwd: dir,
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.on("error", () => {});
  child.stdout.on("error", () => {});

  if (dropReader) child.stdout.destroy();
  if (write) child.stdin.end(payload ?? JSON.stringify({ hook_event_name: event, cwd: dir, session_id: "contract" }));

  let timer;
  return Promise.race([
    new Promise((r) => child.on("close", (code) => r({ code, stdout, stderr }))),
    new Promise((r) => { timer = setTimeout(() => r({ code: "hung", stdout, stderr }), waitMs); }),
  ]).then((result) => {
    // Cleared, or the timer keeps the runner alive for the whole bound after
    // the child has already answered, on every case in this file.
    clearTimeout(timer);
    if (result.code === "hung") child.kill("SIGKILL");
    child.stdin.destroy();
    return result;
  });
}

/** The one thing a hook may put on stdout: nothing, or a single JSON object. */
function answered({ code, stdout, stderr }, where) {
  assert.equal(code, 0, `${where} exited ${code}: ${stderr}`);
  assert.equal(stderr, "", `${where} wrote to stderr: ${stderr}`);
  if (stdout.trim() === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    assert.fail(`${where} wrote something that is not one JSON document: ${err.message}\n${stdout.slice(0, 200)}`);
  }
  assert.equal(typeof parsed, "object", `${where} answered ${typeof parsed}`);
  assert.notEqual(parsed, null, `${where} answered null`);
  return parsed;
}

test("both plugins declare at least one command, or this file proves nothing", () => {
  for (const { plugin } of PLUGINS) {
    assert.ok(DECLARED.some((declared) => declared.plugin === plugin), `${plugin} declares no command hook`);
  }
});

/** Each plugin's own payload reader, driven in a process of its own. */
const READERS = [
  {
    plugin: "anatomiya",
    script: (json) =>
      `import { readPayload } from ${json(new URL("../plugins/anatomiya/lib/hook.mjs", import.meta.url).href)};\n` +
      `process.stdout.write(JSON.stringify(await readPayload()));`,
  },
  {
    plugin: "ultracode-anywhere",
    script: (json) =>
      `import { parsePayload, readStdin } from ${json(new URL("../plugins/ultracode-anywhere/hooks/hook-io.mjs", import.meta.url).href)};\n` +
      `process.stdout.write(JSON.stringify(parsePayload(await readStdin())));`,
  },
];

/** What one plugin's reader makes of a payload, as the object it hands its hook. */
function read({ script }, payload) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", script(JSON.stringify)], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.on("error", () => {});
  child.stdin.end(payload);
  let timer;
  return Promise.race([
    new Promise((r) => child.on("close", () => r(null))),
    new Promise((r) => { timer = setTimeout(() => r("hung"), 15000); }),
  ]).then((how) => {
    clearTimeout(timer);
    if (how === "hung") child.kill("SIGKILL");
    assert.notEqual(how, "hung", "the reader was still waiting after 15 seconds");
    assert.equal(stderr, "", stderr);
    return JSON.parse(stdout);
  });
}

test("both plugins' readers make the same thing of one payload", async () => {
  // The hooks hardcode their own event at the call site and neither echoes the
  // payload back, so driving them proves nothing about what they read. What is
  // copied between the plugins is the reader, so that is what is held to one
  // answer: the two disagreed here, one keeping the capped prefix and one
  // throwing the whole payload away.
  const megabyte = 1024 * 1024;
  const whole = JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: "/repo", session_id: "abc" });
  // A real envelope, in the field order 2.1.251 builds one in, so a case that
  // cuts inside it cuts where a real payload would be cut.
  const envelope = JSON.stringify({
    session_id: "abc",
    cwd: "/repo",
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path: "/repo/src/a.ts", content: "y".repeat(4 * megabyte) },
  });
  const cases = [
    ["an ordinary payload", whole],
    ["one whole payload followed by padding past the cap", `${whole}${" ".repeat(2 * megabyte)}`],
    ["a payload that is padding all the way down", `{"pad":"${"x".repeat(3 * megabyte)}"}`],
    ["a payload that will not parse", "{not json"],
    ["nothing at all", ""],
    // Everything below reaches the reader of last resort, which is the part
    // that is written twice. The two agreed on the five above with no such
    // reader at all, so without these this case would go on passing while the
    // copies drifted.
    ["a whole payload and then one stray byte", `${whole}x`],
    ["a whole payload and then a second one", `${whole}${whole}`],
    ["an envelope whose bulk runs past the cap", envelope],
    ["a payload cut inside a value", envelope.slice(0, envelope.indexOf("yyy") + 32)],
    ["a payload cut between two members", '{"cwd":"/repo","hook_event_name":'],
    ["a key spelled inside a value", `{"cwd":"/repo","note":"{\\"cwd\\":\\"/evil\\"}","tool_name":"Read"}x`],
    ["a value carrying escapes", '{"cwd":"C:\\\\Users\\\\a","tool_name":"say \\"hi\\""}x'],
    ["a value too long to be a field", `{"cwd":"/repo","prompt":"${"a".repeat(9000)}","tool_name":"Read"}x`],
    // Between a path and a file's contents: a bound moved in one copy and not
    // the other answers this one differently and every other case the same.
    ["a value a path could still be", `{"cwd":"/repo","file":"/${"a".repeat(500)}","tool_name":"Read"}x`],
    // The bound itself, at the byte either side of it. The two spell the number
    // differently, so this is what holds them to the same one.
    ["a value just inside the bound", `{"cwd":"/repo","file":"${"a".repeat(4094)}","tool_name":"Read"}x`],
    ["a value just past it", `{"cwd":"/repo","file":"${"a".repeat(4095)}","tool_name":"Read"}x`],
    ["nesting deeper than a reader can recurse", `{"cwd":"/repo","list":${"[".repeat(20_000)}${"]".repeat(20_000)},"tool_name":"Read"}x`],
    // The array above is stepped over by a loop; this is the one member either
    // reader descends into, and the only place a call could nest.
    ["a chain of the member the reader descends into", `{"cwd":"/repo",${'"tool_input":{'.repeat(20_000)}"file_path":"/a"${"}".repeat(20_000)},"tool_name":"Read"}x`],
    ["a value that is not a string", '{"cwd":"/repo","duration_ms":12,"ok":true,"none":null,"tool_name":"Read"}x'],
    ["a member named for something on the prototype", '{"__proto__":"x","constructor":"y","cwd":"/repo"}x'],
  ];

  for (const [what, payload] of cases) {
    const answers = [];
    for (const reader of READERS) answers.push([reader.plugin, await read(reader, payload)]);
    assert.deepEqual(
      answers[0][1],
      answers[1][1],
      `${what}: ${answers[0][0]} read ${JSON.stringify(answers[0][1])} and ${answers[1][0]} read ${JSON.stringify(answers[1][1])}`,
    );
  }
});

/**
 * The reader of last resort, as each plugin holds it.
 *
 * From `NESTED_MEMBER` to the end of `skipValue`, which is everything written
 * twice that can be compared as text. Started at the constant rather than at
 * `fieldsIn`, because `isSpace` and `skipSpace` sit between them and a drift in
 * either went unseen while the span began lower down. `VALUE_MOST` is above
 * that line and stays outside: the two spell it differently on purpose, one
 * naming the bound its own path check already named, so it is held to a number
 * by the payloads below rather than to a spelling here.
 *
 * Read out of the file rather than imported, because what is being compared is
 * the text: one of them is a copy, and a copy is only as good as its last paste.
 */
function salvageReader(rel) {
  // Line endings normalised first: a Windows checkout stores these files with
  // CRLF and there is no `.gitattributes` saying otherwise, so a reader that
  // looks for a bare newline finds none and reports the block as missing.
  const text = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").split("\r\n").join("\n");
  const from = text.indexOf("const NESTED_MEMBER");
  assert.notEqual(from, -1, `${rel} holds no salvage reader`);
  // `indexOf` clamps a negative start to zero, so a `skipValue` that had moved
  // above the constant would search from the top of the file and answer an
  // offset behind `from`: the slice came back empty and the guard below passed
  // on it. The two are checked apart for that reason.
  const last = text.indexOf("function skipValue", from);
  assert.notEqual(last, -1, `${rel} holds no skipValue after the constants`);
  const end = text.indexOf("\n}\n", last);
  assert.notEqual(end, -1, `${rel}'s salvage reader has no end`);
  return text.slice(from, end + 3);
}

/**
 * The code of a block, with the lines that are only a comment taken out.
 *
 * Line by line rather than by pattern over the whole text: a regular expression
 * for `//` cannot tell a comment from a `//` inside a string, and the day either
 * copy holds a URL it would cut the rest of that line out of both sides and the
 * comparison would go on passing over what was left.
 *
 * What makes the line test safe is that no line of code in this block begins
 * with a comment marker, and the caller asserts the one thing that could make
 * one: a template literal, which is the only way a line here could start inside
 * a string. Block comments are tracked rather than matched, so a line beginning
 * `*` outside one is code and is kept.
 */
function codeOf(block) {
  const lines = [];
  let inComment = false;
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (inComment) {
      if (line.endsWith("*/")) inComment = false;
      continue;
    }
    if (line.startsWith("/*")) {
      if (!line.endsWith("*/")) inComment = true;
      continue;
    }
    if (line !== "" && !line.startsWith("//")) lines.push(line);
  }
  return lines.join("\n");
}

test("both plugins hold the same reader, character for character", () => {
  // The behavioural case below can only catch a divergence some payload in its
  // list happens to reach. This catches one the day it is pasted. Neither
  // plugin may run a file outside its own root, so the block cannot be shared;
  // what can be shared is a case that refuses to let the two drift.
  const [mine, theirs] = [`${REL.anatomiya}/lib/hook.mjs`, `${REL.ultracode}/hooks/hook-io.mjs`].map(salvageReader);
  // Comments differ on purpose: each points at the other by name, and one of
  // them names the bound its own path check already gave a name to.
  // The assumption `codeOf` rests on, asserted rather than trusted: a template
  // literal is the one thing that could put a line of code behind a comment
  // marker, and there is none in either copy.
  for (const [rel, block] of [["anatomiya", mine], ["ultracode-anywhere", theirs]]) {
    // Of the code, not of the prose: the docstrings are full of backticks.
    assert.doesNotMatch(codeOf(block), /`/, `${rel}'s reader holds a template literal, which a line-based comment strip cannot read past`);
  }
  assert.ok(codeOf(mine).length > 1200, `read only ${codeOf(mine).length} characters of reader`);
  assert.equal(codeOf(mine), codeOf(theirs));
});

test("the fields these hooks read come before the bulk, which is what makes the cut survivable", () => {
  // The megabyte is read from the left, so recovering anything from a payload
  // larger than it rests on where the build puts each field.
  // `docs/research/what-a-hook-payload-carries.md` records the order 2.1.251
  // builds one in: the envelope first, then `hook_event_name`, `tool_name`,
  // `tool_input`, and only then `tool_response`. Every short field these hooks
  // read is in front of the cargo.
  //
  // Stated as a case rather than left in a comment because nothing else would
  // notice it changing. A build that moved `tool_response` ahead of `cwd` would
  // return both hooks to silence on every large write, with every other case
  // here still green, and the first sign would be a map that stopped arriving.
  const cargo = "y".repeat(2 * 1024 * 1024);
  const envelope = { session_id: "abc", cwd: "/repo", hook_event_name: "PostToolUse", tool_name: "Read" };
  const asBuilt = JSON.stringify({ ...envelope, tool_input: { file_path: "/repo/a.ts" }, tool_response: { content: cargo } });
  const bulkFirst = JSON.stringify({ tool_response: { content: cargo }, ...envelope, tool_input: { file_path: "/repo/a.ts" } });

  const read = (text) => fieldsIn(text.slice(0, 1024 * 1024));

  assert.equal(read(asBuilt).cwd, "/repo", "the order this build writes keeps every field in front of the cut");
  assert.equal(read(asBuilt).tool_input?.file_path, "/repo/a.ts");
  assert.equal(read(bulkFirst).cwd, undefined, "and an order that put the cargo first would put them past it");
});

test("every command asks Claude Code for a bound of its own", () => {
  // Without one the harness allows ten minutes for `PostToolUse`,
  // `PostToolUseFailure` and `SessionStart`, and thirty seconds for
  // `UserPromptSubmit`: ten minutes of a session held by a hook that has
  // nothing to say. `UNDECLARED` is what this file would hold such a hook to;
  // this is what keeps it unused.
  const silent = DECLARED.filter((d) => !d.declares).map((d) => `${d.plugin} ${d.event}`);

  assert.deepEqual(silent, [], "a hook declaring no timeout is one Claude Code will wait its event's default for");
});

test("the variables cleared for a run are read off the plugins, not listed here", () => {
  // The list going empty, or losing the names that decide whether a hook says
  // anything at all, turns every case below into a test of the machine it runs
  // on.
  assert.ok(ENV_READ.length >= 10, `found only ${ENV_READ.length}: ${ENV_READ.join(", ")}`);
  for (const name of ["ULTRACODE_ANYWHERE", "ULTRACODE_ANYWHERE_EVERY", "CLAUDE_CONFIG_DIR", "HOME"]) {
    assert.ok(ENV_READ.includes(name), `${name} is read by a plugin and left set for these runs`);
  }
  assert.equal(ENV_READ.includes("PATH"), false, "the command being fired is node, and it needs a PATH");
  // A walk from a plugin root swept in this suite's own fixtures and any git
  // worktree checked out inside the repository, so names no hook reads were
  // blanked in every child. These are three that came from here.
  for (const name of ["PORT", "GIT_TERMINAL_PROMPT", "ANATOMIYA_HANDED"]) {
    assert.equal(ENV_READ.includes(name), false, `${name} is read by no hook and is being cleared for one`);
  }
});

for (const declared of DECLARED) {
  const where = `${declared.plugin} ${declared.event}`;

  test(`${where} answers an ordinary payload with one object and nothing else`, async (t) => {
    const parsed = answered(await fire(t, declared), where);

    assert.notEqual(parsed, null, `${where} answered with something that is not one object`);
    if (!declared.speaksAlways) {
      // The ordinary payload names no write target, and a hook that speaks only
      // about a target it was given has nothing to say about this one. An empty
      // object is the whole answer, and it is the right one.
      assert.deepEqual(parsed, {}, `${where} spoke about a payload that named no file`);
      return;
    }
    assert.equal(parsed.hookSpecificOutput.hookEventName, declared.event);
    assert.equal(typeof parsed.hookSpecificOutput.additionalContext, "string");
  });

  test(`${where} answers a payload that is not JSON rather than failing`, async (t) => {
    answered(await fire(t, declared, { payload: "{not json" }), where);
  });

  test(`${where} answers a payload far larger than a real one, and echoes none of it`, async (t) => {
    // Each plugin's own cap is measured in its own suite. What is shared is
    // that neither fails on one and neither hands the padding back.
    const pad = "x".repeat(3 * 1024 * 1024);
    const result = await fire(t, declared, { payload: `{"hook_event_name":"${declared.event}","pad":"${pad}"}` });

    answered(result, where);
    assert.doesNotMatch(result.stdout, /xxxxxxxxxx/, `${where} echoed the payload back`);
  });

  test(`${where} gives up on a pipe that stays open and empty, inside the timeout it declares`, async (t) => {
    // Nothing is written and the handle is never closed, which is a caller that
    // has opened the pipe and not decided what to say yet. Claude Code kills a
    // hook at the timeout the declaration asks for, so a hook still waiting at
    // that point has spent the whole of it and answered nothing.
    const result = await fire(t, declared, { write: false });

    assert.notEqual(result.code, "hung", `${where} was still holding an empty pipe after ${declared.timeout}s`);
    answered(result, where);
  });

  test(`${where} exits 0 when its reader goes away before it answers`, async (t) => {
    const result = await fire(t, declared, { dropReader: true });

    assert.equal(result.code, 0, `${where} exited ${result.code}: ${result.stderr}`);
    assert.equal(result.stderr, "", `${where} wrote to stderr: ${result.stderr}`);
  });
}
