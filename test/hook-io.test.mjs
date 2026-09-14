import { test } from "node:test";
import assert from "node:assert/strict";

import { chownSync, closeSync, lstatSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";

import { needsGitRootLocalSettings, needsPosixSpecialFiles, needsSuperuser, needsSymlinks } from "./platform.mjs";
import { parsePayload, projectSettingsFiles, readIfFile, readOwnFile, readWhole } from "../plugins/ultracode-anywhere/hooks/hook-io.mjs";
import { repoWithSub, write } from "./hold-fixtures.mjs";

const HOOK_IO = new URL("../plugins/ultracode-anywhere/hooks/hook-io.mjs", import.meta.url).href;

/** One character that is two UTF-16 units, which is what a cap can cut in half. */
const PAIR = "\u{1F600}";

/** What `respond` writes, read off a process of its own, since it writes to stdout. */
function said(event, context) {
  const script = `import { respond } from ${JSON.stringify(HOOK_IO)}; respond(${JSON.stringify(event)}, ${JSON.stringify(context)});`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }).stdout;
}

test("a payload that will not parse reads as an empty one rather than throwing", () => {
  assert.deepEqual(parsePayload("{not json"), {});
  assert.deepEqual(parsePayload(""), {});
  assert.deepEqual(parsePayload("null"), {}, "a payload that parses to nothing is nothing");
  assert.deepEqual(parsePayload("[1,2]"), [1, 2], "an array is an object, and reads no fields");
  assert.deepEqual(parsePayload('{"cwd":"/repo"}'), { cwd: "/repo" });
});

test("a payload read only in part says so, and one read whole does not", () => {
  const whole = JSON.stringify({ agent_id: "a1", effort: { level: "medium" }, tool_input: { content: "x".repeat(64) } });

  assert.equal(readWhole(parsePayload(whole)), true);
  assert.equal(readWhole(parsePayload(whole.slice(0, 40))), false);
  assert.equal(readWhole(parsePayload("{not json")), false);
  assert.deepEqual(Object.keys(parsePayload(whole.slice(0, 40))), ["agent_id"], "the mark adds no member");
});

test("one object on stdout, named for its event, with the text escaped as JSON", () => {
  const out = said("SessionStart", 'a "quoted" line\nand another');

  assert.equal(out.endsWith("\n"), true);
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
  assert.equal(parsed.hookSpecificOutput.additionalContext, 'a "quoted" line\nand another');
});

test("nothing to say is nothing written, not an empty object", () => {
  assert.equal(said("UserPromptSubmit", null), "");
  assert.equal(said("UserPromptSubmit", undefined), "");
  assert.notEqual(said("UserPromptSubmit", ""), "", "an empty string is still an answer");
});

test("a reader that goes away before the answer is not a failed hook", async () => {
  // A hook that fails is worse than a hook nobody read: a non-zero exit
  // interrupts the run it exists to help, on every turn of that session. The
  // read end is closed from this side, which is what the caller going away
  // does; closing it from inside the child is a call node ignores on a pipe,
  // and a case written that way passes with no guard in the code at all.
  //
  // The ordering is forced rather than timed: the child reads before it writes,
  // so the destroy below has already happened by the time it answers.
  const script = `import { readStdin, respond } from ${JSON.stringify(HOOK_IO)};
    await readStdin();
    respond("UserPromptSubmit", "text");
    process.stderr.write("survived");`;

  // Three times, because the forcing is an argument and not a measurement: if
  // the read ever did finish first, once would be a pass and the defect would
  // come back as a flake nobody could place.
  for (let i = 0; i < 3; i++) {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", () => {});
    child.stdout.on("error", () => {});
    child.stdout.destroy();
    child.stdin.end("{}");

    // Bounded, because `node --test` has no per-case timeout of its own: a hook
    // that never answers takes the whole file with it and says nothing about
    // which case was waiting.
    let timer;
    const code = await Promise.race([
      new Promise((r) => child.on("close", r)),
      new Promise((r) => { timer = setTimeout(() => r("hung"), 8000); }),
    ]);
    clearTimeout(timer);
    if (code === "hung") child.kill("SIGKILL");

    assert.notEqual(code, "hung", "the hook had not answered after 8000ms");
    assert.equal(code, 0, stderr);
    assert.equal(stderr, "survived", "the hook stopped before its own last line");
  }
});

test("a script whose own file has gone is still the file being run", (t) => {
  // `realpathSync` throws on a path that no longer resolves, and a guard that
  // let that through would take the whole hook down on a plugin directory that
  // was replaced under a running session. Resolved first, because both sides
  // fall back to the path as spelled and a linked temp directory flips the
  // answer for a reason that has nothing to do with the guard.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ultracode-io-gone-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, "gone.mjs");
  writeFileSync(
    script,
    `import { unlinkSync } from "node:fs";
     import { invokedAs } from ${JSON.stringify(HOOK_IO)};
     unlinkSync(${JSON.stringify(script)});
     process.stdout.write(String(invokedAs(import.meta.url)));`,
  );

  const run = spawnSync(process.execPath, [script], { encoding: "utf8" });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "true", "a path that no longer resolves still matches rather than throwing");
});

// --- reads that have to end ---------------------------------------------------

/**
 * `readStdin` in a process of its own, since stdin is what it reads.
 *
 * The read is driven through the descriptor the hook actually gets rather than
 * through an argument, so the test cannot pass on a handle the product never
 * sees. `stdin` picks what fd 0 is: a pipe this returns for the caller to
 * drive, or a descriptor handed straight to the child.
 */
function reader(stdin = "pipe") {
  const script = `import { readStdin } from ${JSON.stringify(HOOK_IO)};
    const started = Date.now();
    const said = await readStdin();
    process.stdout.write(JSON.stringify({ length: said.length, ms: Date.now() - started, tail: said.slice(-4) }));`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: [stdin, "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  // Kept, because a child that failed otherwise surfaces here as a JSON parse
  // error about an empty string and says nothing about what went wrong.
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin?.on("error", () => {});
  let timer;
  const settled = Promise.race([
    new Promise((r) => child.on("close", () => r("exited"))),
    new Promise((r) => { timer = setTimeout(() => r("hung"), 8000); }),
  ]).then((how) => {
    clearTimeout(timer);
    if (how === "hung") child.kill("SIGKILL");
    if (how === "exited" && stdout === "") assert.fail(`the reader wrote nothing: ${stderr}`);
    return { how, said: how === "exited" ? JSON.parse(stdout) : null, stderr };
  });
  return { child, settled };
}

test("a pipe that is open and empty is not waited on past the bound", async () => {
  // Claude Code kills a hook at the timeout it declares, so an unbounded read
  // costs that whole timeout on every prompt of the session. The bound has to
  // be the hook's own: it is the only side that knows what it is waiting for.
  // The pipe stays open with nothing in it, which is what a caller that has
  // opened it and not written yet looks like.
  const { child, settled } = reader();

  const { how, said } = await settled;
  child.stdin.destroy();

  assert.equal(how, "exited", "the hook was still holding an empty pipe after 8 seconds");
  assert.equal(said.length, 0);
  // The bound is the point, so it is measured rather than left to the eight
  // seconds this file would otherwise call a pass.
  assert.ok(said.ms < 4000, `gave up after ${said.ms}ms`);
});

test("a payload longer than a megabyte is cut rather than held in memory whole", async () => {
  const { child, settled } = reader();
  child.stdin.end("x".repeat(3 * 1024 * 1024));

  const { how, said } = await settled;

  assert.equal(how, "exited");
  assert.equal(said.length, 1024 * 1024);
});

test("the cut does not fall between the halves of one character", async () => {
  // A cap counts UTF-16 units and an emoji is two of them, so a cut at the
  // boundary halves one and the decoding the read does to avoid exactly that is
  // undone at the last step. The payload puts a pair astride the megabyte.
  const { child, settled } = reader();
  child.stdin.end("x".repeat(1024 * 1024 - 1) + PAIR.repeat(8));

  const { how, said } = await settled;

  assert.equal(how, "exited");
  assert.equal(said.length, 1024 * 1024 - 1, "the pair is dropped whole rather than halved");
  assert.doesNotMatch(said.tail ?? "", /[\ud800-\udfff]/, "and nothing is left half a character");
});

test("stdin that never ends is not waited on for longer than a turn", needsPosixSpecialFiles, async (t) => {
  // A device on stdin returns for as long as it is willing to talk, and a
  // hook that reads it whole is a prompt held to its timeout.
  const fd = openSync("/dev/zero", "r");
  t.after(() => closeSync(fd));
  const { settled } = reader(fd);

  const { how, said } = await settled;

  assert.equal(how, "exited");
  assert.equal(said.length <= 1024 * 1024, true);
  assert.equal(said.ms < 3000, true, "and it stops rather than reading on");
});

test("a file this cannot read is an empty answer, whatever the reason", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-io-read-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.equal(readIfFile(join(dir, "absent")), "");
  assert.equal(readIfFile(dir), "", "a directory is not a file to read");
  writeFileSync(join(dir, "big"), "x".repeat(200));
  assert.equal(readIfFile(join(dir, "big"), 100), "", "and one larger than the caller allows is not read at all");
  assert.equal(readIfFile(join(dir, "big"), 4096).length, 200);
});

test("a path swapped for something that blocks between the check and the read is still not read", needsPosixSpecialFiles, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-io-fifo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("mkfifo", [join(dir, "pipe")]);

  const started = Date.now();
  assert.equal(readIfFile(join(dir, "pipe")), "");
  assert.equal(Date.now() - started < 3000, true);
});

test("a settings file a user symlinked into place is still read", needsSymlinks, (t) => {
  // Dotfiles repositories put `~/.claude/settings.json` behind a link, so the
  // read this plugin does of somebody else's file follows one. The read of its
  // own state does not.
  const dir = mkdtempSync(join(tmpdir(), "ultracode-io-link-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "real.json"), '{"ultracode":true}');
  symlinkSync(join(dir, "real.json"), join(dir, "settings.json"));

  assert.equal(readIfFile(join(dir, "settings.json")), '{"ultracode":true}');
  assert.equal(readOwnFile(join(dir, "settings.json")), "", "a file this plugin owns may not be a link");
});


test("a character split across two reads survives the read", (t) => {
  // The loop decoded each chunk on its own, so a character straddling a read
  // boundary came back as two replacement characters. The stdin read three
  // functions above is written the way it is to avoid exactly this, and says
  // so; this one was not.
  const dir = mkdtempSync(join(tmpdir(), "ultracode-io-split-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "wide");
  // The read buffer is a megabyte, so a three-byte character starting one byte
  // before that boundary is split across two calls.
  writeFileSync(path, `${"x".repeat(1024 * 1024 - 1)}\u20ac${"y".repeat(8)}`);

  const said = readIfFile(path, 4 * 1024 * 1024);

  assert.doesNotMatch(said, /\ufffd/, "a character came back as a replacement");
  assert.equal(said.includes("\u20ac"), true, "and the character itself did not survive");
});

test("one error listener per process, however many times this answers", () => {
  // A listener is added on every call, and node warns at eleven. A hook answers
  // once today, and the guard costs one comparison.
  const script = `import { respond } from ${JSON.stringify(HOOK_IO)};
    for (let i = 0; i < 12; i++) respond("UserPromptSubmit", "x");
    process.stderr.write(String(process.stdout.listenerCount("error")));`;

  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "1", `left ${run.stderr} listeners behind`);
});

// --- where a project's local settings live ------------------------------------------

/** The two files a directory's own `.claude` holds. */
const ownFiles = (dir) => [join(dir, ".claude", "settings.json"), join(dir, ".claude", "settings.local.json")];

test("a session below a git root reads the root's local settings after its own, the way 2.1.270 folds them", needsGitRootLocalSettings, (t) => {
  const { repo, sub } = repoWithSub(t);

  assert.deepEqual(projectSettingsFiles(sub, {}), [...ownFiles(sub), join(repo, ".claude", "settings.local.json")]);
  assert.deepEqual(projectSettingsFiles(join(sub, "deeper"), {}), [...ownFiles(join(sub, "deeper")), join(repo, ".claude", "settings.local.json")], "however far below the root");
});

test("a session at its git root, or with no git root above it, reads its own two files", (t) => {
  const { repo } = repoWithSub(t);
  const bare = mkdtempSync(join(tmpdir(), "ultracode-nogit-"));
  t.after(() => rmSync(bare, { recursive: true, force: true }));

  assert.deepEqual(projectSettingsFiles(repo, {}), ownFiles(repo));
  assert.deepEqual(projectSettingsFiles(bare, {}), ownFiles(bare));
  assert.deepEqual(projectSettingsFiles("", {}), []);
});

test("a git root that is the home directory keeps local settings at the session's directory", (t) => {
  const { repo, sub } = repoWithSub(t);

  assert.deepEqual(projectSettingsFiles(sub, { HOME: repo }), ownFiles(sub));
});

test("a home with no real path keeps local settings at the session's directory, as 2.1.270 does when it cannot resolve the home", needsGitRootLocalSettings, (t) => {
  const { repo, sub } = repoWithSub(t);

  assert.deepEqual(projectSettingsFiles(sub, { HOME: join(repo, "gone") }), ownFiles(sub));
  assert.deepEqual(projectSettingsFiles(sub, { HOME: "" }), ownFiles(sub), "an empty home has no real path either");
});

test("a git root reached through a symlink to the home directory keeps local settings at the session's directory", { skip: needsGitRootLocalSettings.skip || needsSymlinks.skip }, (t) => {
  const { repo, sub } = repoWithSub(t);
  const home = join(mkdtempSync(join(tmpdir(), "ultracode-link-")), "home");
  t.after(() => rmSync(dirname(home), { recursive: true, force: true }));
  symlinkSync(repo, home);
  const via = join(home, relative(repo, sub));

  assert.deepEqual(projectSettingsFiles(via, { HOME: home }), ownFiles(via));
});

test("a git root this account does not own keeps local settings at the session's directory", (t) => {
  const { sub } = repoWithSub(t);

  assert.deepEqual(projectSettingsFiles(sub, {}, "linux", 1 + (process.geteuid?.() ?? 0)), ownFiles(sub));
  assert.deepEqual(projectSettingsFiles(sub, {}, "linux", null), ownFiles(sub), "a platform with no uid to compare stays put");
});

test("the root, its .git and its .claude each have to be this account's", needsSuperuser, (t) => {
  const { repo, sub } = repoWithSub(t);
  mkdirSync(join(repo, ".claude"));
  for (const entry of [repo, join(repo, ".git"), join(repo, ".claude")]) {
    chownSync(entry, 65534, 65534);
    assert.deepEqual(projectSettingsFiles(sub, {}), ownFiles(sub), entry);
    chownSync(entry, 0, 0);
  }
  assert.equal(projectSettingsFiles(sub, {}).length, 3);
});

/** A linked worktree of a fresh repository, the way `git worktree add` lays one out. */
function linkedWorktree(t) {
  const { repo } = repoWithSub(t);
  const tree = mkdtempSync(join(tmpdir(), "ultracode-worktree-"));
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const admin = join(repo, ".git", "worktrees", "wt");
  write(join(admin, "commondir"), "../..\n");
  write(join(admin, "gitdir"), join(tree, ".git") + "\n");
  write(join(tree, ".git"), `gitdir: ${admin}\n`);
  mkdirSync(join(tree, "sub"));
  return { repo, tree, admin };
}

test("a linked worktree reads its main repository's local settings", needsGitRootLocalSettings, (t) => {
  const { repo, tree } = linkedWorktree(t);

  assert.deepEqual(projectSettingsFiles(tree, {}), [...ownFiles(tree), join(repo, ".claude", "settings.local.json")]);
  assert.deepEqual(projectSettingsFiles(join(tree, "sub"), {}), [...ownFiles(join(tree, "sub")), join(repo, ".claude", "settings.local.json")]);
});

test("a worktree pointer its main repository does not point back at reads its own local settings", (t) => {
  const { tree, admin } = linkedWorktree(t);
  write(join(admin, "gitdir"), join(tmpdir(), "somewhere-else", ".git") + "\n");

  assert.deepEqual(projectSettingsFiles(tree, {}), ownFiles(tree));
});

test("a worktree pointer whose commondir is a link reads its own local settings", needsSymlinks, (t) => {
  const { tree, admin } = linkedWorktree(t);
  write(join(admin, "commondir-target"), "../..\n");
  rmSync(join(admin, "commondir"));
  symlinkSync(join(admin, "commondir-target"), join(admin, "commondir"));

  assert.deepEqual(projectSettingsFiles(tree, {}), ownFiles(tree));
});

test("a worktree pointer whose commondir is a fifo is read without waiting on it", needsPosixSpecialFiles, (t) => {
  const { tree, admin } = linkedWorktree(t);
  rmSync(join(admin, "commondir"));
  execFileSync("mkfifo", [join(admin, "commondir")]);
  const script = `import { projectSettingsFiles } from ${JSON.stringify(HOOK_IO)}; process.stdout.write(JSON.stringify(projectSettingsFiles(${JSON.stringify(tree)}, {})));`;

  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 10000 });

  assert.equal(run.signal, null, "the read waited on the fifo for a writer");
  assert.deepEqual(JSON.parse(run.stdout), ownFiles(tree));
});

test("Windows keeps local settings at the session's directory", (t) => {
  const { sub } = repoWithSub(t);

  assert.deepEqual(projectSettingsFiles(sub, {}, "win32"), ownFiles(sub));
});
