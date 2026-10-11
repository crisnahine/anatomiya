import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { appendFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { needsRuby } from "./ruby-available.mjs";
import { compact, delivered, filler, transcript } from "./transcript.mjs";
import { addWorktree, scratch } from "./git-worktrees.mjs";
import { runScan } from "../plugins/anatomiya/lib/commands.mjs";
import { runEcho, runNotice, runReuse } from "../plugins/anatomiya/lib/hook-verbs.mjs";
import { OVERVIEW_FILE } from "../plugins/anatomiya/lib/rules.mjs";

const RULES = join(".claude", "rules");

// --- what a hook is answered with ---------------------------------------------

/**
 * A scanned repository with mailers nobody tests and services everybody does.
 *
 * Ruby, so the scan it runs refuses without a prism the tool reads, and every
 * case built on it carries `needsRuby`: ungated, all of them failed on the
 * missing interpreter rather than on anything a hook does.
 */
async function railsish(t) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "anatomiya-hookcmd-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const n of ["admin", "user", "hubspot", "cim_share"]) {
    mkdirSync(join(dir, "app/mailers"), { recursive: true });
    writeFileSync(join(dir, `app/mailers/${n}_mailer.rb`), `class ${n}Mailer\nend\n`);
  }
  for (const n of ["a", "b", "c", "d", "e", "f"]) {
    mkdirSync(join(dir, "app/services"), { recursive: true });
    mkdirSync(join(dir, "spec/services"), { recursive: true });
    writeFileSync(join(dir, `app/services/${n}.rb`), `class ${n}\nend\n`);
    writeFileSync(join(dir, `spec/services/${n}_spec.rb`), `RSpec.describe ${n} do\nend\n`);
  }
  // Committed, because the scan reads `git ls-files`: an uncommitted tree
  // counts nothing and the layout comes back empty.
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t.test", "-c", "user.name=T", "commit", "-qm", "init"], { cwd: dir });
  await runScan(dir, {});
  return dir;
}

const write = (dir, rel) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Write",
  tool_input: { file_path: join(dir, rel) },
});

/** Two checkouts side by side under a parent that is not itself a repository. */
async function siblings(t) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), "anatomiya-siblings-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  for (const [name, dir, files] of [
    ["alpha", "src/core", ["a", "b", "c", "d", "e", "f"]],
    ["beta", "lib/widgets", ["one", "two", "three", "four", "five", "six"]],
  ]) {
    const repo = join(parent, name);
    mkdirSync(join(repo, dir), { recursive: true });
    for (const f of files) writeFileSync(join(repo, dir, `${f}.js`), `export const ${f} = (x) => x\n`);
    // A paired directory beside the bare one, because the precedent rule stays
    // out of a repository that pairs no test with a source anywhere: without
    // this the fixture measures that guard rather than what it is here for.
    mkdirSync(join(repo, "src/util"), { recursive: true });
    for (const f of ["w", "x", "y", "z"]) {
      writeFileSync(join(repo, "src/util", `${f}.js`), `export const ${f} = (v) => v\n`);
      writeFileSync(join(repo, "src/util", `${f}.test.js`), `test("${f}", () => {})\n`);
    }
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["-c", "user.email=t@t.test", "-c", "user.name=T", "commit", "-qm", "init"], { cwd: repo });
    await runScan(repo, {});
  }
  return parent;
}

const read = (path) => ({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: path } });

test("the map a call is answered with is the one for the repository the call is about", async (t) => {
  // Two checkouts under one parent, and a working directory that is in neither
  // the one being read nor nowhere. Resolving from the working directory finds
  // a map, stops, and hands over another repository's roster and directives
  // under the line saying it was counted from this repository's own code.
  const parent = await siblings(t);

  const answered = runEcho(join(parent, "beta"), read(join(parent, "alpha/src/core/a.js")));

  assert.match(answered.hookSpecificOutput.additionalContext, /src\/core: 6 \.js/);
  assert.doesNotMatch(answered.hookSpecificOutput.additionalContext, /lib\/widgets/);
});

test("a call that names no path is still answered from where the session is", async (t) => {
  // `Bash` and `Task` carry no path, and there the working directory is the
  // only thing there is to answer from. Losing that would take the map away
  // from every turn that runs a command, which is most of them.
  const parent = await siblings(t);
  const ran = { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } };

  assert.match(runEcho(join(parent, "beta"), ran).hookSpecificOutput.additionalContext, /lib\/widgets: 6 \.js/);
  assert.match(runEcho(join(parent, "alpha"), ran).hookSpecificOutput.additionalContext, /src\/core: 6 \.js/);
  assert.deepEqual(runEcho(parent, ran), {}, "and a parent that is no repository still answers nothing");
});

test("the notice answers for the repository the write is going into, not the one the shell is in", async (t) => {
  // The sharper half: this one is holding the full path already. `ownLayout`
  // ran on the working directory first, so the target measured as outside that
  // root and the hook said nothing at all about a write whose path it had.
  const parent = await siblings(t);
  const spec = join(parent, "alpha/src/core/__tests__/a.test.js");
  const write = { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: spec } };

  const said = (await runNotice(join(parent, "beta"), write)).hookSpecificOutput.additionalContext;

  assert.match(said, /src\/core: 0 of 6 \.js files have a namesake test/);
});

test("a notebook names its path under its own key, and is answered like any other", async (t) => {
  // Measured on 2.1.251: `NotebookEdit` spells the target `notebook_path`, and
  // a reader of `file_path` alone finds nothing and falls back to the shell.
  const parent = await siblings(t);
  const edit = {
    hook_event_name: "PostToolUse",
    tool_name: "NotebookEdit",
    tool_input: { notebook_path: join(parent, "alpha/src/core/a.ipynb") },
  };

  assert.match(runEcho(join(parent, "beta"), edit).hookSpecificOutput.additionalContext, /src\/core: 6 \.js/);
});

test("a search names a directory rather than a file, and is not taken a level above it", async (t) => {
  // Measured on 2.1.251: `Glob` and `Grep` spell it `path`, and it is a
  // directory. Handing it to a reader written for a write target takes the
  // parent of the thing named, which at a repository root is the directory
  // holding every checkout: the answer would come from a sibling again.
  const parent = await siblings(t);
  const globbed = {
    hook_event_name: "PostToolUse",
    tool_name: "Glob",
    tool_input: { pattern: "**/*.js", path: join(parent, "alpha") },
  };

  assert.match(runEcho(join(parent, "beta"), globbed).hookSpecificOutput.additionalContext, /src\/core: 6 \.js/);
});

test("a path the payload spells relative is read against the directory the payload names", async (t) => {
  // Measured on 2.1.251: nothing normalises `tool_input` between the model's
  // call and the hook, and a relative `file_path` was seen arriving raw. The
  // tool resolves it against the session's own directory, so this has to as
  // well; requiring an absolute one falls back to the shell without saying so.
  // Spelled out of the directory it is read against, so that resolving it and
  // ignoring it answer with different repositories. A relative path that stays
  // inside its own base cannot tell the two apart.
  const parent = await siblings(t);
  const read = {
    hook_event_name: "PostToolUse",
    tool_name: "Read",
    cwd: join(parent, "beta"),
    tool_input: { file_path: "../alpha/src/core/a.js" },
  };

  const said = runEcho(parent, read).hookSpecificOutput.additionalContext;

  assert.match(said, /src\/core: 6 \.js/);
  assert.doesNotMatch(said, /lib\/widgets/);
});

test("the working directory the payload carries is the one the agent is in", async (t) => {
  // Measured on 2.1.251: the envelope `cwd` follows the agent, and one `cd` in
  // a Bash call moves it for every payload after it. The process this hook runs
  // in is not told, so for a call that names no place the payload's own answer
  // is the current one and `process.cwd()` may be a directory the session left.
  const parent = await siblings(t);
  const ran = {
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    cwd: join(parent, "alpha"),
    tool_input: { command: "ls" },
  };

  assert.match(runEcho(join(parent, "beta"), ran).hookSpecificOutput.additionalContext, /src\/core: 6 \.js/);
});

test("the notice reads a relative target the same way the map does", async (t) => {
  // Two readers of one payload have to agree on what its path means. `aboutDir`
  // resolves a relative one against the directory the payload names; a
  // `targetIn` that refuses it measured the target as outside the root it had
  // just resolved from, and the hook said nothing about a write it had located.
  const parent = await siblings(t);
  const write = {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    cwd: join(parent, "alpha"),
    tool_input: { file_path: "src/core/__tests__/a.test.js" },
  };

  const said = (await runNotice(join(parent, "beta"), write)).hookSpecificOutput.additionalContext;

  assert.match(said, /src\/core: 0 of 6 \.js files have a namesake test/);
});

test("a file the call names outside any map leaves the session's own map standing", async (t) => {
  // Reading something outside the repository is ordinary: a system file, a
  // dependency, a file in another project. Answering nothing there takes the
  // map off a turn that had one before, so the call's own repository is tried
  // first and the session's is what stands when the call is in none.
  const parent = await siblings(t);
  const outside = { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/etc/hosts" } };

  assert.match(runEcho(join(parent, "alpha"), outside).hookSpecificOutput.additionalContext, /src\/core: 6 \.js/);
  assert.deepEqual(runEcho(parent, outside), {}, "and a session in no repository still has none to stand");
});

test("a search whose directory is reached through a link is still that directory", async (t) => {
  // The walk asks whether a path is a directory, and a link to one is. Asking
  // without following it reads the link as not a directory and takes the
  // parent, which at a checkout's own root is the directory holding every
  // checkout: a sibling answers again.
  const parent = await siblings(t);
  const link = join(parent, "alpha-link");
  symlinkSync(join(parent, "alpha"), link, "dir");
  const globbed = { hook_event_name: "PostToolUse", tool_name: "Glob", tool_input: { pattern: "**/*.js", path: link } };

  assert.match(runEcho(join(parent, "beta"), globbed).hookSpecificOutput.additionalContext, /src\/core: 6 \.js/);
});

test("a checkout of its own is answered by itself, even when the answer is nothing", async (t) => {
  // The boundary invariant, which the fallback to the session's map overrode:
  // "a worktree, a submodule or a nested repository hears nothing rather than
  // the enclosing checkout's map, against a branch those counts never
  // described". A nested checkout with no map is in a repository, and that
  // repository's answer is silence rather than the one above it.
  const parent = await siblings(t);
  const nested = join(parent, "alpha/vendor/sub/src");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "n.js"), "export const n = 1\n");
  execFileSync("git", ["init", "-q"], { cwd: join(parent, "alpha/vendor/sub") });
  const read = { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: join(nested, "n.js") } };

  assert.deepEqual(runEcho(join(parent, "alpha"), read), {});
});

test("a mapped repository whose map says nothing is not handed another's", async (t) => {
  // `echoContext` answers null for more than one reason: no map above, and a
  // map whose body is empty. Reading either as "this call is in no repository"
  // served a sibling's roster for a file that has a repository of its own.
  const parent = await siblings(t);
  writeFileSync(join(parent, "beta/.claude/rules/anatomiya-overview.md"), "---\ngenerator: anatomiya\n---\n\n");
  const read = {
    hook_event_name: "PostToolUse",
    tool_name: "Read",
    tool_input: { file_path: join(parent, "beta/lib/widgets/one.js") },
  };

  assert.deepEqual(runEcho(join(parent, "alpha"), read), {});
});

test("a path too long to name a place does not cost the turn its map", async (t) => {
  // The bound answers null, and null reached `resolve` and threw. The bin turns
  // that into `{}` and exit 0, so the turn loses the map it would have had:
  // the very thing the fallback beside it exists to stop.
  const parent = await siblings(t);
  const absurd = `/${"a/".repeat(3000)}b.js`;
  const read = { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: absurd } };

  assert.match(runEcho(join(parent, "alpha"), read).hookSpecificOutput.additionalContext, /src\/core: 6 \.js/);
});

test("the notice answers for a test going where its kind of file has none", needsRuby, async (t) => {
  const dir = await railsish(t);

  const out = await runNotice(dir, write(dir, "spec/mailers/cim_share_mailer_spec.rb"));

  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(out.hookSpecificOutput.additionalContext, /spec\/mailers holds no other test/);
  assert.match(out.hookSpecificOutput.additionalContext, /app\/mailers: 0 of 4 \.rb files have a namesake test/);
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined, "it informs and never refuses");
});

test("the notice answers with an empty object for everything it cannot decide", needsRuby, async (t) => {
  const dir = await railsish(t);
  const spec = join(dir, "spec/mailers/cim_share_mailer_spec.rb");

  assert.deepEqual(await runNotice(dir, {}), {}, "no event name");
  assert.deepEqual(await runNotice(dir, { hook_event_name: "PreToolUse" }), {}, "no tool input");
  assert.deepEqual(await runNotice(dir, write(dir, "spec/services/g_spec.rb")), {}, "siblings have theirs");
  assert.deepEqual(await runNotice(dir, write(dir, "app/mailers/report_mailer.rb")), {}, "not a test");
  assert.deepEqual(
    await runNotice(dir, { ...write(dir, "x"), tool_input: { file_path: "/elsewhere/spec/mailers/x_spec.rb" } }),
    {},
    "another repository's file"
  );

  mkdirSync(join(dir, "spec/mailers"), { recursive: true });
  writeFileSync(spec, "RSpec.describe CimShareMailer do\nend\n");
  assert.deepEqual(await runNotice(dir, write(dir, "spec/mailers/cim_share_mailer_spec.rb")), {}, "the file is already there");
});

test("a repository nobody has scanned is answered with an empty object by both hooks", async (t) => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "anatomiya-nomap-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.deepEqual(await runNotice(dir, write(dir, "spec/mailers/x_spec.rb")), {});
  assert.deepEqual(runEcho(dir, { hook_event_name: "UserPromptSubmit" }), {});
});

/** A linked worktree of a checkout, which carries none of its untracked `.claude/`. */
const worktreeOf = (t, dir) => addWorktree(dir, join(scratch(t), "wt"));

test("a linked worktree with no map of its own is answered from its main checkout, and says so", needsRuby, async (t) => {
  // Measured on a front end whose `.claude/` is git-ignored: every linked
  // worktree had no map, so both hooks answered `{}` there, and the sessions
  // doing the work in one wrote tests into `__tests__` directories the map
  // would have named as having no precedent. Same repository, same history.
  const dir = await railsish(t);
  const wt = worktreeOf(t, dir);

  const said = await runNotice(wt, write(wt, "spec/mailers/cim_share_mailer_spec.rb"));
  assert.match(said.hookSpecificOutput.additionalContext, /spec\/mailers holds no other test/);
  assert.match(said.hookSpecificOutput.additionalContext, /app\/mailers: 0 of 4 \.rb files have a namesake test/);
  assert.ok(said.hookSpecificOutput.additionalContext.endsWith(`\n  Counted from this repository's main checkout at ${realpathSync.native(dir)}, not this worktree.`), "it names where the counts were taken");

  const echoed = runEcho(wt, read(join(wt, "app/mailers/admin_mailer.rb"))).hookSpecificOutput.additionalContext;
  assert.match(echoed, /# Repository map/);
  assert.ok(echoed.includes(`main checkout at ${realpathSync.native(dir)}`), "the stamp does not claim this worktree's own code");
  assert.doesNotMatch(echoed, /Counted from this repository's own code/);
});

test("a borrowed layout is judged against the worktree's own files, not the main checkout's", needsRuby, async (t) => {
  // The counts come from the main checkout; what sits on disk is this branch's.
  // A spec this worktree already holds is precedent here, and one only the main
  // checkout holds is not.
  const dir = await railsish(t);
  const wt = worktreeOf(t, dir);
  mkdirSync(join(dir, "spec/mailers"), { recursive: true });
  writeFileSync(join(dir, "spec/mailers/admin_mailer_spec.rb"), "RSpec.describe AdminMailer do\nend\n");

  assert.match((await runNotice(wt, write(wt, "spec/mailers/cim_share_mailer_spec.rb"))).hookSpecificOutput.additionalContext, /holds no other test/);

  mkdirSync(join(wt, "spec/mailers"), { recursive: true });
  writeFileSync(join(wt, "spec/mailers/user_mailer_spec.rb"), "RSpec.describe UserMailer do\nend\n");
  assert.deepEqual(await runNotice(wt, write(wt, "spec/mailers/cim_share_mailer_spec.rb")), {});
});

test("the end-of-turn check reads a worktree's own change against its main checkout's record", needsRuby, async (t) => {
  // The third hook gates on the same record, so a worktree used to end every
  // turn unchecked. The change it asks about is the worktree's, never one
  // sitting in the main checkout.
  const dir = await railsish(t);
  const wt = worktreeOf(t, dir);
  // A session that began a minute ago, as every real stop names one, inside a
  // call that runs through the test so its writes are the session's own.
  const at = (ms) => new Date(Date.now() + ms).toISOString();
  const session = transcript(t, [
    { type: "user", timestamp: at(-60 * 1000), message: { role: "user", content: "go" } },
    { type: "assistant", timestamp: at(-59 * 1000), message: { role: "assistant", content: [{ type: "tool_use", id: "w1", name: "Bash", input: {} }] } },
    { type: "user", timestamp: at(10 * 60 * 1000), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "w1", content: "done" }] } },
  ]);
  const stop = (cwd) => ({ hook_event_name: "Stop", cwd, transcript_path: session });

  writeFileSync(join(dir, "app/services/g.rb"), "class G\n  def g = 1\nend\n");
  assert.deepEqual(await runReuse(wt, stop(wt)), {}, "a change only the main checkout holds");

  writeFileSync(join(wt, "app/services/h.rb"), "class H\n  def h = 1\nend\n");
  const out = await runReuse(wt, stop(wt));
  assert.equal(out.decision, "block");
  assert.match(out.reason, /app\/services\/h\.rb/);
  assert.doesNotMatch(out.reason, /app\/services\/g\.rb/);
});

test("a worktree that was scanned answers with its own map, not its main checkout's", needsRuby, async (t) => {
  const dir = await railsish(t);
  const wt = worktreeOf(t, dir);
  await runScan(wt, {});

  const echoed = runEcho(wt, read(join(wt, "app/mailers/admin_mailer.rb"))).hookSpecificOutput.additionalContext;
  assert.match(echoed, /Counted from this repository's own code/);
  assert.ok(!echoed.includes("main checkout"));
  assert.doesNotMatch((await runNotice(wt, write(wt, "spec/mailers/cim_share_mailer_spec.rb"))).hookSpecificOutput.additionalContext, /main checkout/);
});

test("both hooks answer a payload when this process has no working directory", needsRuby, async (t) => {
  // `process.cwd()` refuses with ENOENT once the directory a session started in
  // is unlinked, which `git worktree remove` does under a session sitting in
  // one. The entry point hands that value in, so the base has to be allowed to
  // be absent: every hook after it is a fresh process, and a throw here answers
  // the empty object for the rest of that session while every payload is still
  // naming live paths.
  const dir = await railsish(t);

  const out = runEcho(undefined, {
    hook_event_name: "PostToolUse",
    tool_name: "Read",
    cwd: dir,
    tool_input: { file_path: join(dir, "app/mailers/admin_mailer.rb") },
  });
  assert.match(out.hookSpecificOutput.additionalContext, /<repository-map delivered="/);

  const said = await runNotice(undefined, write(dir, "spec/mailers/cim_share_mailer_spec.rb"));
  assert.match(said.hookSpecificOutput.additionalContext, /spec\/mailers holds no other test/);
});

test("a payload that names no place, with no working directory either, is silence rather than a throw", async () => {
  // The fallback is the only base such a payload has, and there is none. Both
  // hooks answer the empty object; the guard in the bin would turn a throw into
  // the same object, so the difference this holds is that nothing threw.
  assert.deepEqual(runEcho(undefined, { hook_event_name: "UserPromptSubmit" }), {});
  assert.deepEqual(runEcho(undefined, { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } }), {});
  assert.deepEqual(await runNotice(undefined, { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "spec/x_spec.rb" } }), {});
});

test("the echo hands back the map it was asked for, and nothing without an event", needsRuby, async (t) => {
  const dir = await railsish(t);

  assert.deepEqual(runEcho(dir, {}), {}, "no event name");
  const out = runEcho(dir, { hook_event_name: "PostToolUse" });
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(out.hookSpecificOutput.additionalContext, /<repository-map delivered="/);
});

test("the echo says nothing when this context window already holds the same map", needsRuby, async (t) => {
  const dir = await railsish(t);
  const first = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext;
  const path = transcript(t, [{ type: "user", message: { content: "go" } }, delivered(first)]);

  assert.deepEqual(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path }), {});
});

test("the echo delivers again once a compaction follows the last delivery", needsRuby, async (t) => {
  const dir = await railsish(t);
  const first = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext;
  const path = transcript(t, [delivered(first), compact()]);

  assert.match(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path }).hookSpecificOutput.additionalContext, /<repository-map /);
});

test("the echo delivers a map that differs from the one the window holds", needsRuby, async (t) => {
  const dir = await railsish(t);
  const older = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext.replace(/digest="[0-9a-f]{12}"/, `digest="${"0".repeat(12)}"`);
  const path = transcript(t, [delivered(older)]);

  assert.match(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path }).hookSpecificOutput.additionalContext, /<repository-map /);
});

test("the echo holds a delivery 150 KiB back and delivers again past 192 KiB", needsRuby, async (t) => {
  const dir = await railsish(t);
  const first = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext;
  const after = (bytes) => transcript(t, [delivered(first), filler(bytes)]);

  assert.deepEqual(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: after(150 * 1024) }), {});
  assert.match(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: after(192 * 1024) }).hookSpecificOutput.additionalContext, /<repository-map /);
});

// What 2.1.296 writes for itself between two calls: a snapshot of the system
// prompt, a bookkeeping line, and a hook's own stdout. None carries `rendered`.
const own = (bytes) => [
  { type: "attachment", attachment: { type: "prompt_snapshot", systemPrompt: ["x".repeat(bytes)] } },
  { type: "queue-operation", operation: "enqueue", content: "x".repeat(bytes) },
  { type: "attachment", attachment: { type: "hook_success", stdout: "x".repeat(bytes) } },
];
const shown = (type, bytes) => ({ type: "attachment", attachment: { type }, rendered: [{ content: "x".repeat(bytes) }] });

test("records the build writes for itself do not push a delivery out of the window", needsRuby, async (t) => {
  const dir = await railsish(t);
  const first = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext;
  const call = (entries) => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: transcript(t, [delivered(first), ...entries]) });

  assert.deepEqual(call([...own(300 * 1024), filler(100 * 1024)]), {});
  assert.match(call([shown("skill_listing", 300 * 1024)]).hookSpecificOutput?.additionalContext ?? "", /<repository-map /, "an attachment the model reads counts");
});

test("the CLAUDE.md files the build writes after a delivery do not push it out of the window", needsRuby, async (t) => {
  // The build places them at the head of the context, ahead of the delivery they follow in the transcript.
  const dir = await railsish(t);
  const first = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext;
  const path = transcript(t, [delivered(first), shown("instructions", 129_512), filler(100 * 1024)]);

  assert.deepEqual(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path }), {});
});

/** The plugin's data directory as Claude Code names it to a plugin's hooks, for one test. */
function pluginData(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-plugin-data-"));
  const before = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = dir;
  t.after(() => {
    if (before === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = before;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

const append = (path, entries) => writeFileSync(path, `${readFileSync(path, "utf8")}${entries.map((e) => `${JSON.stringify(e)}\n`).join("")}`);

test("the calls of one batch deliver one copy between them, before any of them is in the transcript", needsRuby, async (t) => {
  const dir = await railsish(t);
  const first = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext;
  const data = pluginData(t);
  const path = transcript(t, [delivered(first), filler(300 * 1024)]);
  const call = () => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path });

  assert.match(call().hookSpecificOutput?.additionalContext ?? "", /<repository-map /, "due by the window");
  assert.deepEqual(call(), {}, "a sibling");
  assert.deepEqual(call(), {}, "another sibling");
  assert.equal(readdirSync(join(data, "echo")).length, 1, "one batch claim per transcript and map");

  // A sibling whose result alone outruns the window is owed a copy the batch claim must not hold back.
  append(path, [filler(300 * 1024)]);
  assert.match(call().hookSpecificOutput?.additionalContext ?? "", /<repository-map /, "due again");
  assert.deepEqual(call(), {});
  assert.equal(readdirSync(join(data, "echo")).length, 1, "the batch claim was replaced, not added to");

  // The same records and a little more, so a batch claim at this window's offset would sit inside it.
  const other = transcript(t, [delivered(first), filler(300 * 1024), filler(300 * 1024), filler(20 * 1024)]);
  assert.match(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: other }).hookSpecificOutput?.additionalContext ?? "", /<repository-map /, "another window's batch claim holds nothing here");
});

const BIN = fileURLToPath(new URL("../plugins/anatomiya/bin/anatomiya.mjs", import.meta.url));

/** How many of `n` echo processes deliver when their payloads arrive together. */
async function batch(dir, data, path, n, nodeArgs = []) {
  const runs = [];
  for (let i = 0; i < n; i++) {
    // Killed, so delivering nothing, where its lock never comes to an end.
    const child = spawn(process.execPath, [...nodeArgs, BIN, "echo", dir], { env: { ...process.env, CLAUDE_PLUGIN_DATA: data }, timeout: 60_000 });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    runs.push({ child, done: new Promise((done) => child.on("close", () => done(out))) });
  }
  // Every process is up and blocked on stdin before any payload is written.
  const payload = JSON.stringify({ hook_event_name: "PostToolUse", transcript_path: path, cwd: dir });
  for (const { child } of runs) child.stdin.end(payload);
  const outs = await Promise.all(runs.map((run) => run.done));
  return outs.filter((out) => out.includes("<repository-map ")).length;
}

test("echo processes started together deliver one copy per batch, with no batch claim on disk and with a stale one", needsRuby, async (t) => {
  const dir = await railsish(t);
  const data = pluginData(t);
  const path = transcript(t, [filler(300 * 1024)]);
  runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path });
  const [name] = readdirSync(join(data, "echo"));
  const claim = join(data, "echo", name);

  for (const n of [3, 8]) {
    for (const [what, reset] of [["no batch claim", () => rmSync(claim, { force: true })], ["a stale batch claim", () => writeFileSync(claim, "0\n")]]) {
      for (let round = 0; round < 20; round++) {
        reset();
        assert.equal(await batch(dir, data, path, n), 1, `${what}, ${n} at once, round ${round}`);
      }
    }
  }
});

test("a lock held by another call holds this one, and a lock a minute old or a minute ahead is broken", needsRuby, async (t) => {
  const dir = await railsish(t);
  const data = pluginData(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const echo = () => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path });
  echo();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  // Stamped as the call first reads the lock's age, so a slow runner moves no age across the bound.
  const held = (ms) => {
    writeFileSync(join(data, "echo", name), "0\n");
    writeFileSync(lock, "");
    let stamped = false;
    return lockEnds(() =>
      stubbed("lstatSync", (real, p, ...rest) => {
        if (p === lock && !stamped) {
          stamped = true;
          const at = new Date(Date.now() + ms);
          utimesSync(lock, at, at);
        }
        return real(p, ...rest);
      }, echo)
    );
  };

  assert.deepEqual(held(0), {}, "a fresh lock");
  // Past the 5 s hook timeout, inside the 2 s a FAT or exFAT mtime can be off by.
  assert.deepEqual(held(-6900), {}, "a lock 6.9 s old");
  assert.deepEqual(held(6900), {}, "a lock 6.9 s ahead");

  assert.match(held(-60_000).hookSpecificOutput?.additionalContext ?? "", /<repository-map /, "a lock a minute old");
  assert.equal(existsSync(lock), false, "released after the delivery");
  assert.deepEqual(readdirSync(join(data, "echo")), [name], "nothing left of the lock it broke");
  assert.deepEqual(lockEnds(echo), {}, "the batch claim it wrote holds");

  assert.match(held(60_000).hookSpecificOutput?.additionalContext ?? "", /<repository-map /, "a lock a minute ahead");
  assert.match(held(-7100).hookSpecificOutput?.additionalContext ?? "", /<repository-map /, "a lock 7.1 s old, past the slack");
});

/** Runs `call` and fails where a lock loop goes on past the few exclusive creates one call makes. */
function lockEnds(call) {
  let creates = 0;
  const answer = stubbed("openSync", (real, p, flags, ...rest) => {
    if (flags === "wx" && ++creates > 8) throw new Error("the lock loop did not end");
    return real(p, flags, ...rest);
  }, call);
  assert.ok(creates <= 8, `the lock loop ended, after ${creates} exclusive creates`);
  return answer;
}

/** Runs one echo call with `fs[name]` replaced by `stub`, which is handed the real one. */
function stubbed(name, stub, call) {
  const real = fs[name];
  fs[name] = (...args) => stub(real, ...args);
  syncBuiltinESMExports();
  try {
    return call();
  } finally {
    fs[name] = real;
    syncBuiltinESMExports();
  }
}

// Holds every read of a lock's age, so two calls that find one dead both read it before either breaks it.
const SLOW_LOCK_AGE = `data:text/javascript,${encodeURIComponent(`
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const real = fs.lstatSync;
fs.lstatSync = (path, ...rest) => {
  const stat = real(path, ...rest);
  if (String(path).endsWith(".lock")) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  return stat;
};
syncBuiltinESMExports();
`)}`;

test("two calls that both find a dead lock deliver one copy between them", needsRuby, async (t) => {
  const dir = await railsish(t);
  const data = pluginData(t);
  const path = transcript(t, [filler(300 * 1024)]);
  runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path });
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  const dead = new Date(Date.now() - 60_000);

  for (let round = 0; round < 20; round++) {
    writeFileSync(join(data, "echo", name), "0\n");
    writeFileSync(lock, "");
    utimesSync(lock, dead, dead);
    assert.equal(await batch(dir, data, path, 2, [`--import=${SLOW_LOCK_AGE}`]), 1, `round ${round}`);
  }
});

test("three and eight calls that find a dead lock deliver one copy per batch and leave no lock or token", needsRuby, async (t) => {
  const dir = await railsish(t);
  const data = pluginData(t);
  const path = transcript(t, [filler(300 * 1024)]);
  runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path });
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);

  for (const n of [3, 8]) {
    for (let round = 0; round < 50; round++) {
      writeFileSync(join(data, "echo", name), "0\n");
      writeFileSync(lock, "");
      const dead = new Date(Date.now() - 60_000);
      utimesSync(lock, dead, dead);
      assert.equal(await batch(dir, data, path, n), 1, `${n} at once, round ${round}`);
      assert.deepEqual(readdirSync(join(data, "echo")), [name], `${n} at once, round ${round}: nothing but the batch claim`);
    }
  }
});

test("a dead lock replaced by a live one before it is broken holds the call, and the live one stays", needsRuby, async (t) => {
  const dir = await railsish(t);
  const data = pluginData(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path }));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");
  writeFileSync(lock, "live");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  let replaced = false;
  const answer = stubbed("lstatSync", (real, p, ...rest) => {
    const stat = real(p, ...rest);
    if (p === lock && !replaced) {
      // Another call broke it and took its own in the meantime.
      replaced = true;
      utimesSync(lock, new Date(), new Date());
    }
    return stat;
  }, call);

  assert.equal(replaced, true);
  assert.deepEqual(answer, {});
  assert.equal(readFileSync(lock, "utf8"), "live", "the live lock is where its holder will release it");
  assert.deepEqual(readdirSync(join(data, "echo")).sort(), [name, `${name}.lock`], "and nowhere else");
});

/** Runs `call` with every removal of a path `refuses` names failing as Windows fails one another process holds. */
function removalRefused(refuses, call) {
  const busy = (real, p, ...rest) => {
    if (refuses(String(p))) throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${p}'`), { code: "EBUSY" });
    return real(p, ...rest);
  };
  return stubbed("rmSync", busy, () => stubbed("unlinkSync", busy, call));
}

test("a lock token that cannot be removed leaves the call to the lock's one create, so it holds where another call took the lock", needsRuby, async (t) => {
  const dir = await railsish(t);
  const data = pluginData(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path }));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");
  writeFileSync(lock, "");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  const answer = removalRefused((p) => {
    if (!p.startsWith(`${lock}.`)) return false;
    // Another call took the lock the moment the dead one went.
    if (!existsSync(lock)) writeFileSync(lock, "live");
    return true;
  }, call);

  assert.deepEqual(answer, {});
  assert.equal(readFileSync(lock, "utf8"), "live", "the call that took the lock holds it");
});

test("a dead lock that cannot be removed holds the call, and the next call breaks it", needsRuby, async (t) => {
  const dir = await railsish(t);
  const data = pluginData(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path }));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");
  writeFileSync(lock, "");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  assert.deepEqual(removalRefused((p) => p === lock, call), {});
  assert.deepEqual(readdirSync(join(data, "echo")).sort(), [name, `${name}.lock`], "the dead lock and the batch claim, and no lock token");
  assert.match(call().hookSpecificOutput?.additionalContext ?? "", /<repository-map /, "once the lock can be removed");
  assert.deepEqual(readdirSync(join(data, "echo")), [name]);
});

test("a call that broke a dead lock and finds a live one in its place holds", needsRuby, async (t) => {
  const dir = await railsish(t);
  const data = pluginData(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path }));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");
  writeFileSync(lock, "");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  let creates = 0;
  const answer = stubbed("openSync", (real, p, flags, ...rest) => {
    // Another call takes the lock between this one's break and its create.
    if (p === lock && flags === "wx" && ++creates === 2) writeFileSync(lock, "");
    return real(p, flags, ...rest);
  }, call);

  assert.equal(creates, 2);
  assert.deepEqual(answer, {});
});

test("a dead lock whose token another call holds is left to that call", needsRuby, async (t) => {
  const dir = await railsish(t);
  const data = pluginData(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path }));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");
  writeFileSync(lock, "");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);
  const token = `${name}.lock.${Math.round(statSync(lock).mtimeMs)}`;
  writeFileSync(join(data, "echo", token), "");

  assert.deepEqual(call(), {});
  assert.deepEqual(readdirSync(join(data, "echo")).sort(), [name, `${name}.lock`, token].sort(), "both left as they were");
});

test("a dead lock released before the call could break it is taken", needsRuby, async (t) => {
  const dir = await railsish(t);
  const data = pluginData(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path }));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");
  writeFileSync(lock, "");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  let tokens = 0;
  const answer = stubbed("openSync", (real, p, flags, ...rest) => {
    // Its holder releases it after this call took the token to break it.
    if (p.startsWith(`${lock}.`) && ++tokens === 1) rmSync(lock);
    return real(p, flags, ...rest);
  }, call);

  assert.equal(tokens, 1);
  assert.match(answer.hookSpecificOutput?.additionalContext ?? "", /<repository-map /);
  assert.deepEqual(readdirSync(join(data, "echo")), [name], "no lock and no token left");
});

test("a batch claim write that fails partway leaves the batch claim it replaces whole", needsRuby, async (t) => {
  const dir = await railsish(t);
  const data = pluginData(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path });
  call();
  const [name] = readdirSync(join(data, "echo"));
  const claim = join(data, "echo", name);
  const before = readFileSync(claim, "utf8");
  append(path, [filler(300 * 1024)]);

  let failed = false;
  const answer = stubbed("writeFileSync", (real, p, text, ...rest) => {
    if (!String(p).startsWith(join(data, "echo"))) return real(p, text, ...rest);
    failed = true;
    real(p, String(text).slice(0, 1));
    throw Object.assign(new Error("EIO"), { code: "EIO" });
  }, call);

  assert.equal(failed, true);
  assert.match(answer.hookSpecificOutput?.additionalContext ?? "", /<repository-map /, "a batch claim that cannot be written answers as the transcript alone");
  assert.equal(readFileSync(claim, "utf8"), before);
});

test("a batch claim from later in the same transcript holds a sibling that read an earlier, shorter snapshot", needsRuby, async (t) => {
  const dir = await railsish(t);
  const data = pluginData(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path });
  call();
  const [name] = readdirSync(join(data, "echo"));

  for (const [what, after, held] of [["inside the window", 100, true], ["pushed out of the window since", 300 * 1024, false]]) {
    const claimedAt = statSync(path).size + Buffer.byteLength(`${JSON.stringify(filler(100))}\n`);
    writeFileSync(join(data, "echo", name), `${claimedAt}\n`);
    // The transcript grows after this call read it and before it reads the batch claim, as a sibling's record would.
    const mkdir = fs.mkdirSync;
    let grew = false;
    fs.mkdirSync = (...args) => {
      if (!grew) appendFileSync(path, [filler(100), ...(after > 100 ? [filler(after)] : [])].map((e) => `${JSON.stringify(e)}\n`).join(""));
      grew = true;
      return mkdir(...args);
    };
    syncBuiltinESMExports();
    let answer;
    try {
      answer = call();
    } finally {
      fs.mkdirSync = mkdir;
      syncBuiltinESMExports();
    }
    assert.equal(grew, true, `${what}: the transcript grew inside the call`);
    if (held) assert.deepEqual(answer, {}, what);
    else assert.match(answer.hookSpecificOutput?.additionalContext ?? "", /<repository-map /, what);
  }
});

test("a window's first batch delivers once, before anything is in its transcript", needsRuby, async (t) => {
  const dir = await railsish(t);
  pluginData(t);
  const path = transcript(t, []);
  const call = () => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path });

  assert.match(call().hookSpecificOutput?.additionalContext ?? "", /<repository-map /);
  append(path, [filler(100)]);
  assert.deepEqual(call(), {});
});

test("a batch claim after a compaction holds nothing", needsRuby, async (t) => {
  const dir = await railsish(t);
  pluginData(t);
  const path = transcript(t, [filler(10)]);
  const call = () => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path });

  assert.match(call().hookSpecificOutput?.additionalContext ?? "", /<repository-map /);
  append(path, [compact()]);
  assert.match(call().hookSpecificOutput?.additionalContext ?? "", /<repository-map /);
});

test("with nowhere to keep a batch claim, every call of a batch answers as it would alone", needsRuby, async (t) => {
  const dir = await railsish(t);
  const path = transcript(t, [filler(10)]);
  const call = () => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path });
  const data = pluginData(t);
  const blocked = join(data, "file");
  writeFileSync(blocked, "");

  const relative = `anatomiya-relative-${process.pid}`;
  t.after(() => rmSync(relative, { recursive: true, force: true }));
  for (const [what, value] of [["unset", undefined], ["relative", relative], ["a file", blocked], ["below a file", join(blocked, "x")]]) {
    if (value === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = value;
    for (let i = 0; i < 2; i++) assert.match(call().hookSpecificOutput?.additionalContext ?? "", /<repository-map /, what);
  }
  assert.equal(existsSync(relative), false, "a relative name is not resolved against the cwd");
});

test("batch claims older than a day are swept when a new one is made", needsRuby, async (t) => {
  const dir = await railsish(t);
  const data = pluginData(t);
  mkdirSync(join(data, "echo"));
  const old = join(data, "echo", "0000000000000000-000000000000");
  writeFileSync(old, "0\n");
  const twoDays = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  utimesSync(old, twoDays, twoDays);
  const recent = join(data, "echo", "1111111111111111-000000000000");
  writeFileSync(recent, "0\n");
  const lock = join(data, "echo", "0000000000000000-000000000000.lock");
  writeFileSync(lock, "");
  utimesSync(lock, twoDays, twoDays);
  const token = `${lock}.1700000000000`;
  writeFileSync(token, "");
  utimesSync(token, twoDays, twoDays);
  const foreign = join(data, "echo", "notes.txt");
  writeFileSync(foreign, "");
  utimesSync(foreign, twoDays, twoDays);

  runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: transcript(t, [filler(10)]) });

  assert.equal(existsSync(old), false);
  assert.equal(existsSync(lock), false, "a lock left by a call that died");
  assert.equal(existsSync(token), false, "a token a call died holding");
  assert.equal(existsSync(recent), true);
  assert.equal(existsSync(foreign), true, "only a name a batch claim has");
  assert.equal(readdirSync(join(data, "echo")).length, 3);
});

test("a batch claim that is not one this hook wrote is replaced rather than believed", needsRuby, async (t) => {
  const dir = await railsish(t);
  pluginData(t);
  const path = transcript(t, [filler(10)]);
  const call = () => runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path });
  assert.match(call().hookSpecificOutput?.additionalContext ?? "", /<repository-map /);
  const [name] = readdirSync(join(process.env.CLAUDE_PLUGIN_DATA, "echo"));
  const claim = join(process.env.CLAUDE_PLUGIN_DATA, "echo", name);

  for (const content of ["", "12", "nonsense\n", "999999999\n"]) {
    writeFileSync(claim, content);
    assert.match(call().hookSpecificOutput?.additionalContext ?? "", /<repository-map /, JSON.stringify(content));
    assert.deepEqual(call(), {}, `${JSON.stringify(content)} replaced`);
  }
});

test("a re-scan that changes the map on disk is delivered on the next call", needsRuby, async (t) => {
  const dir = await railsish(t);
  const first = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext;
  const path = transcript(t, [delivered(first)]);
  const overview = join(dir, RULES, OVERVIEW_FILE);
  writeFileSync(overview, readFileSync(overview, "utf8").replace("# Repository map", "# Repository map\n\nOne more line."));

  assert.match(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path }).hookSpecificOutput.additionalContext, /One more line/);
});

test("the echo delivers when the transcript names nothing it can read, and ignores a copy that is not its own delivery", needsRuby, async (t) => {
  const dir = await railsish(t);
  const first = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext;
  const quoted = { type: "user", message: { content: [{ type: "tool_result", content: first }] } };

  for (const transcript_path of [join(dir, "absent.jsonl"), dir, 7]) {
    assert.match(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path }).hookSpecificOutput.additionalContext, /<repository-map /);
  }
  const path = transcript(t, [quoted]);
  assert.match(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path }).hookSpecificOutput.additionalContext, /<repository-map /, "a tool result quoting the map is not a delivery");
});

test("a subagent's echo is answered from its own transcript, never from the session's", needsRuby, async (t) => {
  const dir = await railsish(t);
  const first = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext;
  const session = transcript(t, [delivered(first)]);
  const agentLog = join(session.replace(/\.jsonl$/, ""), "subagents", "agent-a1b2c3.jsonl");
  const sub = { hook_event_name: "PostToolUse", transcript_path: session, agent_id: "a1b2c3" };

  assert.match(runEcho(dir, sub).hookSpecificOutput.additionalContext, /<repository-map /, "the session's copy is not in the subagent's window");
  mkdirSync(join(agentLog, ".."), { recursive: true });
  writeFileSync(agentLog, `${JSON.stringify({ ...delivered(first), isSidechain: true, agentId: "a1b2c3" })}\n`);
  assert.deepEqual(runEcho(dir, sub), {});
  const outside = join(session.replace(/\.jsonl$/, ""), "probe.jsonl");
  writeFileSync(outside, `${JSON.stringify(delivered(first))}\n`);
  assert.match(
    runEcho(dir, { ...sub, agent_id: "x/../../probe" }).hookSpecificOutput.additionalContext,
    /<repository-map /,
    "an id that is not a plain name reads nothing, even where a path through it holds a delivery"
  );
});

test("a workflow stage's echo is answered from its transcript under the workflow's run", needsRuby, async (t) => {
  const dir = await railsish(t);
  const first = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext;
  const session = transcript(t, []);
  const run = join(session.replace(/\.jsonl$/, ""), "subagents", "workflows", "wf_1a2b3c-d4e");
  const stage = { hook_event_name: "PostToolUse", transcript_path: session, agent_id: "a9f8e7d6" };

  assert.match(runEcho(dir, stage).hookSpecificOutput.additionalContext, /<repository-map /);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "agent-a9f8e7d6.jsonl"), `${JSON.stringify(delivered(first))}\n`);
  assert.deepEqual(runEcho(dir, stage), {});
});

test("a subagent's window is found whatever case the session transcript's extension is in", needsRuby, async (t) => {
  const dir = await railsish(t);
  const first = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext;
  const session = transcript(t, []).replace(/\.jsonl$/, ".JSONL");
  const agentLog = join(session.slice(0, -".JSONL".length), "subagents", "agent-b1c2.jsonl");
  mkdirSync(join(agentLog, ".."), { recursive: true });
  writeFileSync(agentLog, `${JSON.stringify(delivered(first))}\n`);

  assert.deepEqual(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: session, agent_id: "b1c2" }), {});
});

test("the echo holds a delivery made after a compaction, and reads a null agent_id as the main thread", needsRuby, async (t) => {
  const dir = await railsish(t);
  const first = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext;
  const path = transcript(t, [compact(), delivered(first)]);

  assert.deepEqual(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path }), {});
  assert.deepEqual(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path, agent_id: null }), {});
});

test("a rewrite that changes only the frontmatter is not a new map", needsRuby, async (t) => {
  const dir = await railsish(t);
  const first = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext;
  const path = transcript(t, [delivered(first)]);
  const overview = join(dir, RULES, OVERVIEW_FILE);
  writeFileSync(overview, readFileSync(overview, "utf8").replace("generator: anatomiya", "generator: anatomiya\nnote: rewritten"));

  assert.deepEqual(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: path }), {});
});
