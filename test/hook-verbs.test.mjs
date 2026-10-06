import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

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

  const said = runNotice(join(parent, "beta"), write).hookSpecificOutput.additionalContext;

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

  const said = runNotice(join(parent, "beta"), write).hookSpecificOutput.additionalContext;

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

  const out = runNotice(dir, write(dir, "spec/mailers/cim_share_mailer_spec.rb"));

  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(out.hookSpecificOutput.additionalContext, /spec\/mailers holds no other test/);
  assert.match(out.hookSpecificOutput.additionalContext, /app\/mailers: 0 of 4 \.rb files have a namesake test/);
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined, "it informs and never refuses");
});

test("the notice answers with an empty object for everything it cannot decide", needsRuby, async (t) => {
  const dir = await railsish(t);
  const spec = join(dir, "spec/mailers/cim_share_mailer_spec.rb");

  assert.deepEqual(runNotice(dir, {}), {}, "no event name");
  assert.deepEqual(runNotice(dir, { hook_event_name: "PreToolUse" }), {}, "no tool input");
  assert.deepEqual(runNotice(dir, write(dir, "spec/services/g_spec.rb")), {}, "siblings have theirs");
  assert.deepEqual(runNotice(dir, write(dir, "app/mailers/report_mailer.rb")), {}, "not a test");
  assert.deepEqual(
    runNotice(dir, { ...write(dir, "x"), tool_input: { file_path: "/elsewhere/spec/mailers/x_spec.rb" } }),
    {},
    "another repository's file"
  );

  mkdirSync(join(dir, "spec/mailers"), { recursive: true });
  writeFileSync(spec, "RSpec.describe CimShareMailer do\nend\n");
  assert.deepEqual(runNotice(dir, write(dir, "spec/mailers/cim_share_mailer_spec.rb")), {}, "the file is already there");
});

test("a repository nobody has scanned is answered with an empty object by both hooks", (t) => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "anatomiya-nomap-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.deepEqual(runNotice(dir, write(dir, "spec/mailers/x_spec.rb")), {});
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

  const said = runNotice(wt, write(wt, "spec/mailers/cim_share_mailer_spec.rb"));
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

  assert.match(runNotice(wt, write(wt, "spec/mailers/cim_share_mailer_spec.rb")).hookSpecificOutput.additionalContext, /holds no other test/);

  mkdirSync(join(wt, "spec/mailers"), { recursive: true });
  writeFileSync(join(wt, "spec/mailers/user_mailer_spec.rb"), "RSpec.describe UserMailer do\nend\n");
  assert.deepEqual(runNotice(wt, write(wt, "spec/mailers/cim_share_mailer_spec.rb")), {});
});

test("the end-of-turn check reads a worktree's own change against its main checkout's record", needsRuby, async (t) => {
  // The third hook gates on the same record, so a worktree used to end every
  // turn unchecked. The change it asks about is the worktree's, never one
  // sitting in the main checkout.
  const dir = await railsish(t);
  const wt = worktreeOf(t, dir);
  // A session that began a minute ago, as every real stop names one.
  const session = transcript(t, [{ type: "user", timestamp: new Date(Date.now() - 60 * 1000).toISOString(), message: { role: "user", content: "go" } }]);
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
  assert.doesNotMatch(runNotice(wt, write(wt, "spec/mailers/cim_share_mailer_spec.rb")).hookSpecificOutput.additionalContext, /main checkout/);
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

  const said = runNotice(undefined, write(dir, "spec/mailers/cim_share_mailer_spec.rb"));
  assert.match(said.hookSpecificOutput.additionalContext, /spec\/mailers holds no other test/);
});

test("a payload that names no place, with no working directory either, is silence rather than a throw", () => {
  // The fallback is the only base such a payload has, and there is none. Both
  // hooks answer the empty object; the guard in the bin would turn a throw into
  // the same object, so the difference this holds is that nothing threw.
  assert.deepEqual(runEcho(undefined, { hook_event_name: "UserPromptSubmit" }), {});
  assert.deepEqual(runEcho(undefined, { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } }), {});
  assert.deepEqual(runNotice(undefined, { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "spec/x_spec.rb" } }), {});
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

test("the echo holds a delivery 200 KiB back and delivers again past 256 KiB", needsRuby, async (t) => {
  const dir = await railsish(t);
  const first = runEcho(dir, { hook_event_name: "PostToolUse" }).hookSpecificOutput.additionalContext;
  const after = (bytes) => transcript(t, [delivered(first), filler(bytes)]);

  assert.deepEqual(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: after(200 * 1024) }), {});
  assert.match(runEcho(dir, { hook_event_name: "PostToolUse", transcript_path: after(256 * 1024) }).hookSpecificOutput.additionalContext, /<repository-map /);
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
