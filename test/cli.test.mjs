import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, appendFileSync, statSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

import { needsPathControl, needsRemovableCwd, needsShebang, needsSymlinks, needsUnreadableDirs, needsWindows } from "./platform.mjs";
import { ANATOMIYA } from "../scripts/plugins.mjs";
import { installWithoutDependencies } from "./plugin-install.mjs";
import { EXCLUDE_LINES } from "../plugins/anatomiya/lib/rules.mjs";
import { SUMMARY_SCHEMA } from "../plugins/anatomiya/lib/summary.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function repoWithSource(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-cli-repo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  mkdirSync(join(dir, "src"), { recursive: true });
  for (let i = 0; i < 8; i++) {
    writeFileSync(join(dir, "src", `f${i}.ts`), `const a${i} = 1\nexport { a${i} }\n`);
  }
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
  return dir;
}

test("a missing parser fails the scan instead of reporting an empty repository", (t) => {
  // Every file answers `ok: false` with the same import error, which was
  // counted as a successful parse: the CLI printed "0 areas", wrote a map
  // saying the repository has no conventions, and exited 0. A first-run user
  // cannot tell that apart from a real answer.
  const install = installWithoutDependencies(t);
  const repo = repoWithSource(t);

  let status = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [join(install, "bin", "anatomiya.mjs"), "scan", repo], {
      stdio: "pipe",
    });
  } catch (err) {
    status = err.status;
    stderr = String(err.stderr);
  }

  assert.equal(status, 1, "a scan that parsed nothing must not exit 0");
  assert.match(stderr, /oxc-parser is not installed/);
  assert.match(stderr, /bin\/anatomiya\.mjs setup/, "the message says how to fix it");
});

test("nothing is written to the repository when the parser is missing", (t) => {
  // Worse than the exit code: the empty map is a file the agent then reads on
  // every turn, stating that this repository has no conventions.
  const install = installWithoutDependencies(t);
  const repo = repoWithSource(t);

  try {
    execFileSync(process.execPath, [join(install, "bin", "anatomiya.mjs"), "scan", repo], {
      stdio: "pipe",
    });
  } catch {
    /* the failure is the point; what matters is what it left behind */
  }

  assert.throws(
    () => execFileSync("ls", [join(repo, ".claude", "rules")], { stdio: "pipe" }),
    "no rule files were written from a scan that parsed nothing"
  );
});

/** A branch off the base with one added file, which is what a check examines. */
function repoWithBranch(t) {
  const dir = repoWithSource(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("branch", "-M", "main");
  git("checkout", "-q", "-b", "feat");
  writeFileSync(join(dir, "src", "f8.ts"), "export function h() { try { go() } catch (e) { } }\n");
  git("add", "-A");
  git("commit", "-qm", "add");
  return dir;
}

test("a missing parser fails the check instead of reporting it found nothing", (t) => {
  // The same install the scan test describes, on the other command. A check
  // that cannot parse reports one caveat per file and no findings, and the
  // command file tells the agent a zero exit means the check ran.
  const install = installWithoutDependencies(t);
  const repo = repoWithBranch(t);

  let status = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [join(install, "bin", "anatomiya.mjs"), "check", repo], {
      stdio: "pipe",
    });
  } catch (err) {
    status = err.status;
    stderr = String(err.stderr);
  }

  assert.equal(status, 1, "a check that parsed nothing must not exit 0");
  assert.match(stderr, /oxc-parser is not installed/);
  assert.match(stderr, /bin\/anatomiya\.mjs setup/, "the message says how to fix it");
});

test("the CLI summary and the overview word an unexamined file the same way", (t) => {
  // Both surfaces list the ways a file went unexamined, and the sentences were
  // copied rather than shared: the cap read "over the size cap" in one and
  // "exceeded the size cap" in the other, under a comment claiming the two
  // could not drift. The same failure had already been fixed twice on the
  // uncovered count, which is why that one is built from a shared helper.
  const repo = repoWithSource(t);
  // Over the 4 MB cap, which is checked with `stat` before the file is
  // dispatched, so nothing reads these bytes.
  writeFileSync(join(repo, "src", "big.ts"), `const x = "${"a".repeat(1024 * 1024)}"\n`);
  const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "pipe" });
  git("add", "-A");
  git("commit", "-qm", "big");

  const out = String(
    execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), "scan", repo], { stdio: "pipe" })
  );
  const overview = readFileSync(join(repo, ".claude", "rules", "anatomiya-overview.md"), "utf8");

  const capSentence = (text) => (/\d+ files? [^\n]*size cap/.exec(text) || [])[0];
  assert.ok(capSentence(out), `the CLI must report the skipped file: ${out}`);
  assert.equal(capSentence(out), capSentence(overview), "one sentence, both surfaces");
});

/** A repository with source on disk and nothing committed. */
function repoWithNothingCommitted(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-cli-fresh-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  mkdirSync(join(dir, "src", "lib", "core"), { recursive: true });
  for (let i = 0; i < 5; i++) writeFileSync(join(dir, "src", "lib", "core", `c${i}.js`), `export const a${i} = 1\n`);
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "pipe" });
  return dir;
}

test("a scan that read no file of a language says so instead of reporting an empty map", (t) => {
  // The whole point of writing nothing is that the previous map survives, and a
  // summary that says "wrote 0 files" and stops reads as a repository with
  // nothing in it. The reader has to know an interpreter is missing.
  const repo = repoWithSource(t);
  // A crash on every file of a language is what a missing interpreter looks
  // like, and deep nesting is the portable way to crash oxc. Not a syntax
  // error: the parser answers those, and treating them as a blind run froze a
  // healthy repository's whole map.
  for (let i = 0; i < 8; i++) {
    writeFileSync(
      join(repo, "src", `f${i}.ts`),
      "const x = " + "[".repeat(60_000) + "1" + "]".repeat(60_000) + "\n"
    );
  }
  const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "pipe" });
  git("add", "-A");
  git("commit", "-qm", "break");

  const out = String(
    execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), "scan", repo], { stdio: "pipe" })
  );

  assert.match(out, /read no js file/, out);
  assert.ok(!/wrote \d+ files/.test(out) || /nothing was written/.test(out), out);
});

test("a scan names the root it resolved to, because a path argument does not scope it", (t) => {
  // `git rev-parse --show-toplevel` resolves any path inside a repository to
  // its root, so `scan ./packages/api` in a monorepo maps the monorepo. That is
  // what areas, the pin and the baseline need; the output has to say so.
  const repo = repoWithSource(t);
  const out = String(
    execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), "scan", join(repo, "src")], {
      stdio: "pipe",
    })
  );

  // Identified through the filesystem, not by comparing path strings. One
  // directory has several valid spellings on Windows, where a temporary
  // directory carries the 8.3 form and git prints the long one, and asserting
  // one of them tests the platform rather than the line.
  const first = out.split("\n")[0];
  assert.match(first, /^8 files, 1 area, \d+ms, root .+$/);
  const printed = first.slice(first.indexOf(", root ") + ", root ".length);

  assert.ok(existsSync(join(printed, "src", "f0.ts")), `not the repository that was scanned: ${first}`);
  assert.ok(!existsSync(join(printed, "src", "src")), "the argument was widened to the root, so the root is what prints");
});

/** Two sibling directories, each past the floor, so the layout counts two roots. */
function repoWithTwoRoots(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-cli-layout-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  for (const sub of ["alpha", "beta"]) {
    mkdirSync(join(dir, sub), { recursive: true });
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, sub, `f${i}.ts`), `export const a${i} = ${i}\n`);
  }
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
  return dir;
}

test("the scan summary says how much of the layout it printed", (t) => {
  const repo = repoWithTwoRoots(t);
  const out = String(execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), "scan", repo], { stdio: "pipe" }));

  assert.match(out, /^layout: 2 roots, 0 folded, tests: none; roster lines: 0 areas with imports, 0 with reuse$/m, out);
});

test("untracked source is reported rather than counted as a repository with nothing in it", (t) => {
  // The corpus is tracked files, which is the rule. A repository whose first
  // commit has not landed used to get an empty map, exit 0 and an overview
  // saying 0 files are uncovered, which states the opposite of what happened.
  const repo = repoWithNothingCommitted(t);
  const out = String(
    execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), "scan", repo], { stdio: "pipe" })
  );

  assert.match(out, /5 source files in the working tree are untracked\. The corpus is tracked files only, so nothing there was counted/);
  const overview = readFileSync(join(repo, ".claude", "rules", "anatomiya-overview.md"), "utf8");
  assert.match(overview, /5 source files in the working tree are untracked/);
});

test("the documented exclude line works from inside a linked worktree", (t) => {
  // `.git` in a worktree is a file holding a gitdir pointer, so the old
  // `.git/info/exclude` line was "not a directory" and the generated map showed
  // up as untracked in the one place an agent is most likely to be running.
  const main = repoWithSource(t);
  const wt = mkdtempSync(join(tmpdir(), "anatomiya-cli-wt-"));
  rmSync(wt, { recursive: true, force: true });
  t.after(() => rmSync(wt, { recursive: true, force: true }));
  execFileSync("git", ["worktree", "add", "-q", wt, "-b", "feat"], { cwd: main, stdio: "pipe" });

  assert.ok(statSync(join(wt, ".git")).isFile(), "a worktree's .git is a file, so .git/info/ is not a path");

  execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), "scan", wt], { stdio: "pipe" });
  const common = String(execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: wt, stdio: "pipe" })).trim();
  appendFileSync(resolve(wt, common, "info", "exclude"), `${EXCLUDE_LINES.join("\n")}\n`);

  const status = String(execFileSync("git", ["status", "--porcelain"], { cwd: wt, stdio: "pipe" }));
  assert.ok(!status.includes(".claude"), `the map is excluded in the worktree, got: ${status}`);
  assert.equal(
    String(execFileSync("git", ["status", "--porcelain"], { cwd: main, stdio: "pipe" })).includes(".claude"),
    false,
    "and in the main checkout, which shares the common dir"
  );
});

/* --- the map on disk holds its own invariants (A5, A6) --- */

const anatomiya = (repo, ...args) =>
  execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), ...args, repo], {
    stdio: "pipe",
    encoding: "utf8",
  });

const ruleFiles = (repo) => {
  const dir = join(repo, ".claude", "rules");
  return readdirSync(dir).sort().map((name) => ({ name, body: readFileSync(join(dir, name), "utf8") }));
};

/* --- the binary prints what the library answered --- */

test("a scan writes the map and says how many files it wrote", (t) => {
  // The count and the disk have to agree, which is the whole point of running
  // the binary rather than the functions it calls.
  const repo = repoWithSource(t);

  const out = anatomiya(repo, "scan");

  const claimed = /^wrote (\d+) files?$/m.exec(out);
  assert.ok(claimed, `the scan printed no write line:\n${out}`);
  assert.equal(readdirSync(join(repo, ".claude", "rules")).length, Number(claimed[1]));
});

test("a check prints its verdict line", (t) => {
  const repo = repoWithBranch(t);
  anatomiya(repo, "scan");

  const out = anatomiya(repo, "check");

  assert.match(out, /^\d+ MUST-FIX, \d+ FIX, \d+ NIT$/m, out);
});

test("a command that cannot run exits non-zero and says why without a stack trace", (t) => {
  // A missing repository, an unreadable tree or a git that will not run are all
  // ordinary conditions, and a stack trace is not what the caller needs.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-cli-bare-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  let status = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), "scan", dir], { stdio: "pipe" });
  } catch (err) {
    status = err.status;
    stderr = String(err.stderr);
  }

  assert.equal(status, 1, "a scan that could not run must not exit 0");
  assert.match(stderr, /^anatomiya: not a git repository/);
  assert.doesNotMatch(stderr, /\n\s+at /, "no stack trace");
});

test("a scan with no git on PATH says git is missing, not that the repository is", needsPathControl, (t) => {
  // Measured: with PATH holding node and nothing else, a scan of a real
  // repository said `not a git repository: .`, which names a fix that cannot
  // work while the one that can, installing git, goes unsaid.
  const repo = repoWithSource(t);
  const empty = mkdtempSync(join(tmpdir(), "anatomiya-cli-nogit-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));

  const { code, stderr } = runFrom(ANATOMIYA, ["scan", repo, "--dry-run"], empty);

  assert.equal(code, 1);
  assert.match(stderr, /^anatomiya: git is not on PATH/, stderr);
  assert.doesNotMatch(stderr, /not a git repository/);
});

test("two scans of unchanged source write byte-identical files", (t) => {
  // A5: the token economics only work on a cached read, so anything that moves
  // per commit destroys them. A timestamp, a duration, or a Map iterated in
  // filesystem order is enough.
  const repo = repoWithSource(t);

  anatomiya(repo, "scan");
  const first = ruleFiles(repo);
  anatomiya(repo, "scan");
  const second = ruleFiles(repo);

  assert.deepEqual(second, first);
});

test("no generated file passes the line bound on a real repository", (t) => {
  // A6, measured: a rewritten context file does not re-attach inside a live
  // session, and the change notice truncates head and tail, so a mid-file edit
  // reaches the model in neither copy.
  //
  // Measured over what a reader reads, which is the file past its frontmatter.
  // Across 35 repositories, 17 hold an area whose `paths` list alone runs past
  // forty lines, the worst at 170 patterns; every one of their bodies came to
  // ten lines or fewer. A glob dropped to save a line mis-delivers the whole
  // file, and the directives sit at the tail, which is the half a change notice
  // keeps.
  const repo = repoWithSource(t);

  anatomiya(repo, "scan");

  for (const { name, body } of ruleFiles(repo)) {
    const lines = body.trimEnd().split("\n");
    const bodyStart = lines[0] === "---" ? lines.indexOf("---", 1) + 1 : 0;
    assert.ok(lines.length - bodyStart <= 40, `${name} has ${lines.length - bodyStart} body lines`);
    // On an ordinary area the whole file holds too. The exemption is for the
    // `paths` list, not a licence for the rest of the file to grow.
    const globs = lines.filter((l) => /^ {2}- "/.test(l)).length;
    assert.ok(lines.length - Math.max(0, globs - 1) <= 40, `${name} is ${lines.length} lines with ${globs} globs`);
  }
});

test("the scan names the rule files it did not write, one per line (A4)", (t) => {
  const repo = repoWithSource(t);
  mkdirSync(join(repo, ".claude", "rules"), { recursive: true });
  writeFileSync(join(repo, ".claude", "rules", "house-style.md"), "# theirs\n");

  const out = anatomiya(repo, "scan");

  assert.match(out, /^"house-style\.md" in \.claude\/rules\/ was not written by this tool$/m);
  const overview = readFileSync(join(repo, ".claude", "rules", "anatomiya-overview.md"), "utf8");
  assert.match(overview, /^- "house-style\.md"$/m);
});

test("a scan says what reaches a session already running (A8)", (t) => {
  // The echo hands a changed overview to a running session on its next prompt
  // or tool call (A92), and a rewritten context file already read does not
  // re-attach until a new session, a compaction or /clear (A6).
  const repo = repoWithSource(t);

  const out = anatomiya(repo, "scan");

  assert.match(out, /^a running session gets the new overview on its next prompt or tool call, and a new session, a compaction or \/clear loads the whole map$/m);
});

test("a pin says it too, because it sends the reader off to scan (A8)", (t) => {
  const repo = repoWithSource(t);

  const out = anatomiya(repo, "pin");

  assert.match(out, /run `\/anatomiya:scan` to measure the map against it/);
  assert.match(out, /^a running session gets the new overview on its next prompt or tool call, and a new session, a compaction or \/clear loads the whole map$/m);
});

/* --- what the command files tell the agent (A7, A8) --- */

test("every command that rebuilds the map forbids the Read tool on it (A7)", () => {
  // Measured: reading a context file permanently suppresses its automatic
  // injection for that path for the rest of the process, so the one session
  // that just built the map is the one that loses it.
  for (const name of ["scan.md", "pin.md"]) {
    const body = readFileSync(join(ANATOMIYA, "commands", name), "utf8");
    assert.match(body, /Do not open the generated files with the Read tool/, name);
    assert.match(body, /`cat`/, `${name} says what to use instead`);
  }
});

test("every command that reads the map forbids the Read tool on it (A7)", () => {
  // The check does not write the map, but it does show it, and showing it with
  // the Read tool turns the map off for the session that is using it.
  const body = readFileSync(join(ANATOMIYA, "commands", "check.md"), "utf8");

  assert.match(body, /Do not open the generated files with the Read tool/);
  assert.match(body, /`cat`/);
});

test("every command that rebuilds the map says what reaches a running session (A8)", () => {
  // The agent relays this to the user, so it has to be the story the README
  // tells: no restart for the overview, and a fresh window for the rest.
  for (const name of ["scan.md", "pin.md"]) {
    const body = readFileSync(join(ANATOMIYA, "commands", name), "utf8");
    // Whitespace-tolerant, so rewrapping the paragraph is not a failure.
    assert.match(body, /next\s+prompt\s+or\s+tool\s+call/, name);
    assert.match(body, /new\s+session,\s+a\s+compaction\s+or\s+`\/clear`/, name);
    assert.doesNotMatch(body, /restart/i, name);
  }
});

test("a dry run does not report in the past tense", (t) => {
  // A dry run writes nothing, so every line it prints about what happened to a
  // file is about something that did not happen. The removal line carried the
  // same slip before the replacement line was added beside it.
  const repo = repoWithSource(t);
  const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "pipe" });

  // A second area, so the next scan has one to drop and a file to remove.
  mkdirSync(join(repo, "lib"), { recursive: true });
  for (let i = 0; i < 8; i++) writeFileSync(join(repo, "lib", `g${i}.ts`), `const b${i} = 1\nexport { b${i} }\n`);
  git("add", "-A");
  git("commit", "-qm", "two areas");
  anatomiya(repo, "scan");
  const libArea = readdirSync(join(repo, ".claude", "rules")).filter((f) => f.includes("area"));
  assert.equal(libArea.length, 2, "the fixture needs two areas to drop one");

  // Drop that area from the source, so the plan has a removal...
  rmSync(join(repo, "lib"), { recursive: true, force: true });
  git("add", "-A");
  git("commit", "-qm", "drop it");
  // ...and hand-write a file over a name the scan still plans, so it has a
  // replacement too.
  const kept = readdirSync(join(repo, ".claude", "rules")).find((f) => f.includes("area"));
  writeFileSync(join(repo, ".claude", "rules", kept), "# hand written, our exact name\n");

  const out = anatomiya(repo, "scan", "--dry-run");

  assert.match(out, /would be replaced/, out);
  assert.match(out, /would be removed/, out);
  assert.doesNotMatch(out, /it was replaced/);
  assert.doesNotMatch(out, /area file\(s\) removed/);
  assert.equal(
    readFileSync(join(repo, ".claude", "rules", kept), "utf8"),
    "# hand written, our exact name\n",
    "and nothing was actually written"
  );
});

for (const cmd of ["scan", "check", "pin", "doctor", "setup"]) {
  test(`--deep is refused on ${cmd}, and says the checker runs on its own`, () => {
    const path = cmd === "doctor" || cmd === "setup" ? [] : ["."];
    const { code, stderr } = runFrom(ANATOMIYA, [cmd, ...path, "--deep"], process.env.PATH);

    assert.equal(code, 2);
    assert.match(stderr, /--deep is not an option: scan runs the type checker on its own/);
  });
}

/* --- the other directories a scan writes to --- */

const CURSOR = join(".cursor", "rules");
const COPILOT = join(".github", "instructions");
const listed = (repo, dir) => (existsSync(join(repo, dir)) ? readdirSync(join(repo, dir)).sort() : null);

/** The binary's exit code and both streams, whichever way it came out. */
function ran(...args) {
  const r = spawnSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), ...args], { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("scan --targets writes the map for each tool named, and says so per directory", (t) => {
  const repo = repoWithSource(t);

  // Any case, and spaces around a name.
  const out = anatomiya(repo, "scan", "--targets", "Cursor, COPILOT");

  assert.match(out, /^wrote 2 files$/m, out);
  assert.match(out, /^wrote 2 files under \.cursor\/rules for Cursor$/m, out);
  assert.match(out, /^wrote 2 files under \.github\/instructions for GitHub Copilot$/m, out);
  const stems = listed(repo, join(".claude", "rules")).map((n) => n.replace(/\.md$/, ""));
  assert.equal(stems.length, 2);
  assert.deepEqual(listed(repo, CURSOR), stems.map((n) => `${n}.mdc`));
  assert.deepEqual(listed(repo, COPILOT), stems.map((n) => `${n}.instructions.md`));
});

test("a target stays on with no flag, and --targets claude turns the others off", (t) => {
  const repo = repoWithSource(t);
  anatomiya(repo, "scan", "--targets=cursor");
  const plain = /^wrote 2 files\n(?!wrote)/m;

  const kept = anatomiya(repo, "scan");
  assert.match(kept, /^wrote 2 files under \.cursor\/rules for Cursor$/m, kept);
  assert.doesNotMatch(kept, /instructions/, "and nothing turned the other one on");
  assert.equal(listed(repo, COPILOT), null);

  const dry = anatomiya(repo, "scan", "--dry-run", "--targets", "claude");
  assert.match(dry, /^would remove 2 files under \.cursor\/rules$/m, dry);
  assert.match(dry, /^\.cursor\/rules would be off$/m, dry);
  assert.equal(listed(repo, CURSOR).length, 2, "and the dry run removed nothing");

  const off = anatomiya(repo, "scan", "--targets", "claude");
  assert.match(off, /^removed 2 files under \.cursor\/rules$/m, off);
  assert.match(off, /^\.cursor\/rules is off now$/m, off);
  assert.deepEqual(listed(repo, CURSOR), []);

  const after = anatomiya(repo, "scan");
  assert.match(after, plain, after);
  assert.doesNotMatch(after, /\.cursor/, after);
  assert.deepEqual(listed(repo, CURSOR), []);
});

test("a dry run with --targets plans every directory and writes none", (t) => {
  const repo = repoWithSource(t);

  const out = anatomiya(repo, "scan", "--dry-run", "--targets", "cursor,copilot");

  assert.match(out, /^would write 2 files$/m, out);
  assert.match(out, /^would write 2 files under \.cursor\/rules for Cursor$/m, out);
  assert.match(out, /^would write 2 files under \.github\/instructions for GitHub Copilot$/m, out);
  for (const dir of [".claude", ".cursor", ".github"]) assert.equal(existsSync(join(repo, dir)), false, dir);
});

test("the scan record names each other target only where one is involved", (t) => {
  const repo = repoWithSource(t);

  const none = JSON.parse(anatomiya(repo, "scan", "--format", "json"));
  const one = JSON.parse(anatomiya(repo, "scan", "--format", "json", "--targets", "copilot"));

  assert.equal("targets" in none, false);
  assert.equal(one.schema, SUMMARY_SCHEMA);
  assert.deepEqual(one.targets, {
    copilot: { state: "on", dir: ".github/instructions", wrote: 2, removed: 0, unfiled: 0, foreign: 0 },
  });
});

test("a --targets the scan cannot take is refused before anything runs", (t) => {
  const repo = repoWithSource(t);

  for (const [args, message] of [
    [["scan", repo, "--targets", "windsurf"], /^unknown target: windsurf; the targets are claude, cursor, copilot$/m],
    [["scan", repo, "--targets"], /^--targets needs at least one name$/m],
    [["scan", repo, "--targets="], /^--targets needs at least one name$/m],
    [["scan", repo, "--targets", ","], /^--targets needs at least one name$/m],
    [["scan", repo, "--targets", "--dry-run"], /^--targets needs at least one name$/m],
    [["scan", repo, "--targets", "cursor", "--targets=copilot"], /^--targets may be given once$/m],
    [["check", repo, "--targets", "cursor"], /^check takes no --targets option$/m],
    [["pin", repo, "--targets=cursor"], /^pin takes no --targets option$/m],
    [["doctor", "--targets", "cursor"], /^doctor takes no --targets option$/m],
    [["setup", "--targets", "cursor"], /^setup takes no --targets option$/m],
  ]) {
    const { code, stderr, stdout } = ran(...args);
    assert.equal(code, 2, args.slice(2).join(" "));
    assert.match(stderr, message, args.join(" "));
    assert.match(stderr, /usage: anatomiya scan .*\[--targets <list>\]/, "and it prints the usage, which names the flag");
    assert.equal(stdout, "");
  }
  for (const dir of [".claude", ".cursor", ".github"]) assert.equal(existsSync(join(repo, dir)), false, dir);
});

test("a named target that cannot be written refuses the scan in the writer's own sentence", needsSymlinks, (t) => {
  const repo = repoWithSource(t);
  const elsewhere = mkdtempSync(join(tmpdir(), "anatomiya-cli-elsewhere-"));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  symlinkSync(elsewhere, join(repo, ".cursor"));

  const { code, stderr, stdout } = ran("scan", repo, "--targets", "cursor");

  assert.equal(code, 1);
  assert.equal(
    stderr,
    "anatomiya: .cursor is a link, so .cursor/rules could not be written and nothing was written anywhere: replace the link with a directory and scan again\n"
  );
  assert.equal(stdout, "");
  assert.equal(existsSync(join(repo, ".claude")), false, "the Claude files included");
  assert.deepEqual(readdirSync(elsewhere), []);
});

test("turning off a target that cannot be read refuses the scan and says why", needsSymlinks, (t) => {
  const repo = repoWithSource(t);
  const elsewhere = mkdtempSync(join(tmpdir(), "anatomiya-cli-elsewhere-"));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  anatomiya(repo, "scan", "--targets", "copilot");
  // The record names two files there, and now nobody can look.
  rmSync(join(repo, ".github"), { recursive: true });
  symlinkSync(elsewhere, join(repo, ".github"));
  const rules = ruleFiles(repo);

  const { code, stderr, stdout } = ran("scan", repo, "--targets", "claude");

  assert.equal(code, 1);
  assert.equal(
    stderr,
    "anatomiya: .github is a link, so .github/instructions could not be turned off and nothing was written anywhere: replace the link with a directory and scan again\n"
  );
  assert.equal(stdout, "");
  assert.deepEqual(ruleFiles(repo), rules);
  assert.deepEqual(readdirSync(elsewhere), []);
});

test("a repository that never turned a target on reads the same whatever sits in the other tools' directories", needsSymlinks, (t) => {
  const repo = repoWithBranch(t);
  const elsewhere = mkdtempSync(join(tmpdir(), "anatomiya-cli-elsewhere-"));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  anatomiya(repo, "scan");
  // The one thing that moves between two runs of unchanged source.
  const settled = (out) => out.replace(/, \d+ms, /, ", Nms, ").replace(/"durationMs": \d+/, '"durationMs": 0');
  const said = () => ({
    scan: settled(anatomiya(repo, "scan")),
    json: settled(anatomiya(repo, "scan", "--format", "json")),
    dry: settled(anatomiya(repo, "scan", "--dry-run")),
    check: anatomiya(repo, "check"),
    doctor: execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), "doctor"], { cwd: repo, encoding: "utf8" }),
  });
  const before = said();
  assert.equal("targets" in JSON.parse(before.json), false);

  // A link at `.cursor`, to a directory holding a hand-written file at the overview's name.
  const hand = "---\nalwaysApply: true\n---\n# Written by hand\n";
  mkdirSync(join(elsewhere, "rules"));
  writeFileSync(join(elsewhere, "rules", "anatomiya-overview.mdc"), hand);
  symlinkSync(elsewhere, join(repo, ".cursor"));
  // A team's own instructions, one of them under this tool's prefix and another at its overview's name.
  mkdirSync(join(repo, COPILOT), { recursive: true });
  const theirs = {
    "style.instructions.md": '---\napplyTo: "**"\n---\n# House style\n',
    "anatomiya-notes.instructions.md": "# Notes on the map\n",
    "anatomiya-overview.instructions.md": hand,
  };
  for (const [name, body] of Object.entries(theirs)) writeFileSync(join(repo, COPILOT, name), body);

  const after = said();

  for (const what of Object.keys(before)) assert.equal(after[what], before[what], what);
  for (const [name, body] of Object.entries(theirs)) assert.equal(readFileSync(join(repo, COPILOT, name), "utf8"), body, name);
  assert.deepEqual(readdirSync(join(elsewhere, "rules")), ["anatomiya-overview.mdc"]);
});

test("doctor names each other target that is on in the repository it is run in", (t) => {
  const repo = repoWithSource(t);
  const doctor = () => execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), "doctor"], { cwd: repo, encoding: "utf8" });
  const before = doctor();
  anatomiya(repo, "scan", "--targets", "cursor");

  const out = doctor();

  assert.equal(out, `${before}.cursor/rules: on, 2 files\n`);
});

/* --- one answer, three writers --- */

test("a scan answers as a record for a reader that is not a terminal", (t) => {
  const repo = repoWithSource(t);

  const s = JSON.parse(anatomiya(repo, "scan", "--format=json", "--dry-run"));

  assert.equal(s.schema, SUMMARY_SCHEMA);
  assert.equal(s.files, 8);
  assert.equal(s.dryRun, true);
  assert.equal(typeof s.wrote, "number");
  assert.equal(existsSync(join(repo, ".claude", "rules")), false, "and a dry run still wrote nothing");
});

test("a check answers as a record, and as annotations", (t) => {
  const repo = repoWithBranch(t);
  anatomiya(repo, "scan");

  const report = JSON.parse(anatomiya(repo, "check", "--format", "json"));
  const annotations = anatomiya(repo, "check", "--format", "github");

  assert.equal(report.schema, 1);
  assert.equal(typeof report.counts["MUST-FIX"], "number");
  assert.ok(Array.isArray(report.findings));
  assert.match(annotations, /^::notice::\d+ MUST-FIX, \d+ FIX, \d+ NIT$/m, annotations);
});

test("a format nothing writes is refused, and the annotations are a check's", () => {
  // Same shape as every other option: refused with the usage rather than
  // accepted and quietly answered in the format the caller did not ask for.
  const refused = (...args) => {
    try {
      execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), ...args, "."], {
        stdio: "pipe",
        encoding: "utf8",
      });
      return { code: 0, stderr: "" };
    } catch (err) {
      return { code: err.status, stderr: String(err.stderr ?? "") };
    }
  };

  const unknown = refused("check", "--format", "yaml");
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /unknown format: yaml/);
  assert.match(unknown.stderr, /usage: anatomiya scan/, "and it prints the usage");

  const wrongCommand = refused("scan", "--format", "github");
  assert.equal(wrongCommand.code, 2);
  assert.match(wrongCommand.stderr, /scan does not answer in github/);
});

/* --- the two commands about this installation --- */

/** The binary with no path argument, which is what doctor and setup take. */
const cli = (...args) =>
  execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), ...args], {
    stdio: "pipe",
    encoding: "utf8",
  });

/** The same, from an install of the plugin, with a PATH of this test's choosing. */
function runFrom(install, args, PATH) {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [join(install, "bin", "anatomiya.mjs"), ...args], {
      stdio: "pipe",
      encoding: "utf8",
      env: { ...process.env, PATH },
    }), stderr: "" };
  } catch (err) {
    return { code: err.status, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
}

/** A directory on PATH holding one stub npm, so the install runs without reaching a registry. */
function stubNpm(t, body) {
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-cli-npm-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, "npm"), body, { mode: 0o755 });
  return bin;
}

test("doctor answers a line per engine and exits 0 whatever it found", () => {
  // Exit 0 always: what it found is the report, and a non-zero exit would make
  // a probe that says "ruby is not on PATH" indistinguishable from one that
  // could not run.
  const out = cli("doctor");

  assert.match(out, /^oxc \d/m, out);
  assert.match(out, /^flow-remove-types /m, out);
  assert.match(out, /^prism /m, out);
  assert.match(out, /^typescript /m, out);
});

test("doctor leads with the install where an installation has nothing in it", (t) => {
  // Claude Code installs a plugin's dependencies itself, from the lockfile
  // beside its manifest. Where that has not happened every node-hosted row is
  // absent for that one reason, and three lines each naming their own remedy
  // read as three faults. The rows still print: they are true, and the lead is
  // what they have in common.
  const bare = installWithoutDependencies(t);

  const { code, stdout } = runFrom(bare, ["doctor"], process.env.PATH);

  assert.equal(code, 0);
  assert.match(stdout.split("\n")[0], /^nothing is installed here: /, stdout);
  assert.ok(stdout.split("\n")[0].includes(bare), stdout);
  assert.match(stdout, /^oxc absent: /m, "and the rows it explains are still there");
  // One fault, one fix. The rows keep what was wrong with each engine, which
  // differs, and drop the remedy, which does not: printed on every one of them
  // as well as on the lead, the same sentence appeared three times and the
  // report read as three faults again.
  assert.equal(stdout.split("run node").length - 1, 1, stdout);
  assert.match(stdout, /^oxc absent: oxc-parser did not load$/m, stdout);
});

test("doctor says nothing about the install where the packages are there", () => {
  const out = cli("doctor");

  assert.doesNotMatch(out, /nothing is installed/, out);
});

test("setup --dry-run prints the command and installs nothing", (t) => {
  // From an install with nothing beside it: a dry run with nothing to install
  // names no command, since there is no install to describe. The npm on PATH
  // fails loudly, so a dry run that reached it could not pass.
  const install = installWithoutDependencies(t);
  const bin = stubNpm(t, "#!/bin/sh\necho 'npm ran' >&2\nexit 1\n");

  const { code, stdout } = runFrom(install, ["setup", "--dry-run"], bin);

  assert.equal(code, 0, stdout);
  assert.match(stdout, /^would run npm install --omit=dev --include=optional --ignore-scripts --no-audit --no-fund in /m, stdout);
});

test("setup --dry-run never says both that nothing is needed and what it would run", () => {
  // Measured: "nothing to install: oxc 0.x, ..." then "would run npm install ...".
  // Asked of this checkout, whichever of the two it is.
  const out = cli("setup", "--dry-run");

  assert.notEqual(/^nothing to install: /m.test(out), /would run/.test(out), out);
});

test("setup runs npm in the plugin's own directory, with the arguments it printed", needsShebang, (t) => {
  // An install that did not run leaves the plugin's own code with nothing
  // beside it, which is the shape this command exists for. The stub stands in
  // for npm: a test that runs the real one is a test that reaches the network.
  // It links this checkout's own packages in, by an absolute `ln` since the
  // stub is all that is on PATH, because setup now asks the engines afterwards
  // whether they load, and an npm that installed nothing is the failure the
  // next case is about.
  const install = installWithoutDependencies(t);
  const packages = join(ROOT, "node_modules");
  const bin = stubNpm(t, `#!/bin/sh\nprintf '%s\\n' "$@" > npm-argv.txt\n/bin/ln -s ${JSON.stringify(packages)} node_modules\necho 'added 2 packages'\n`);

  const { code, stdout } = runFrom(install, ["setup"], bin);

  assert.equal(code, 0, stdout);
  assert.match(stdout, /^not installed: oxc, flow-remove-types, typescript$/m, stdout);
  assert.match(stdout, /added 2 packages/, "npm's own words come back");
  assert.deepEqual(
    readFileSync(join(install, "npm-argv.txt"), "utf8").trim().split("\n"),
    ["install", "--omit=dev", "--include=optional", "--ignore-scripts", "--no-audit", "--no-fund"],
    "the argv is what it said it would be, and it ran in the plugin's own directory"
  );
});

test("a setup with no npm on PATH says the one thing that fixes it, and exits 2", needsPathControl, (t) => {
  // npm cannot install itself, which is the same trap the Ruby remedy closed:
  // the message has to name the thing that is actually missing.
  const install = installWithoutDependencies(t);
  const empty = mkdtempSync(join(tmpdir(), "anatomiya-cli-nonpm-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));

  const { code, stderr } = runFrom(install, ["setup"], empty);

  assert.equal(code, 2);
  assert.match(stderr, /^npm was not found; install Node\.js 22 with npm, then run setup again$/m, stderr);
});

test("setup on Windows refuses, and prints the command to run by hand", needsWindows, (t) => {
  // The end of the same story the seam tells in `commands.test.mjs`, on the one
  // platform where it is the real behaviour rather than an argument.
  const install = installWithoutDependencies(t);

  let code = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [join(install, "bin", "anatomiya.mjs"), "setup"], { stdio: "pipe", encoding: "utf8" });
  } catch (err) {
    code = err.status;
    stderr = String(err.stderr ?? "");
  }

  assert.equal(code, 2);
  assert.match(stderr, /npm install --omit=dev --include=optional --ignore-scripts --no-audit --no-fund/, stderr);
  assert.ok(stderr.includes(install), `it names the directory to run it in: ${stderr}`);
});

test("a setup whose npm failed exits non-zero and shows what npm said", needsShebang, (t) => {
  const install = installWithoutDependencies(t);
  const bin = stubNpm(t, "#!/bin/sh\necho 'npm error code E404' >&2\nexit 1\n");

  const { code, stderr } = runFrom(install, ["setup"], bin);

  assert.equal(code, 2);
  assert.match(stderr, /npm error code E404/, stderr);
  assert.match(stderr, /failed/, stderr);
});

test("a setup whose npm finished without the engine loading fails and names it", needsShebang, (t) => {
  // Measured with `npm_config_optional=false`: oxc's native binding is an
  // optional dependency, npm answered "up to date" and exit 0, setup printed
  // `ran npm install ...` and exited 0, and doctor went on saying oxc was
  // absent and to run setup. The stub stands for any npm that exits 0 and
  // leaves the parser unloadable: success is what loads afterwards, not what
  // npm's exit said.
  const install = installWithoutDependencies(t);
  const bin = stubNpm(t, "#!/bin/sh\necho 'up to date in 1ms'\n");

  const { code, stdout, stderr } = runFrom(install, ["setup"], bin);

  assert.equal(code, 2, stdout);
  assert.match(stderr, /up to date in 1ms/, "npm's own words still come back");
  assert.match(stderr, /^npm finished, and still not loading: oxc \(oxc-parser did not load\)/m, stderr);
});

test("doctor and setup refuse the arguments they have no use for", () => {
  // Refused with the usage, rather than accepted and quietly not used.
  const refused = (...args) => {
    try {
      cli(...args);
      return { code: 0, stderr: "" };
    } catch (err) {
      return { code: err.status, stderr: String(err.stderr ?? "") };
    }
  };

  for (const [args, message] of [
    [["doctor", "--dry-run"], /doctor takes no --dry-run option/],
    [["doctor", "--format", "json"], /doctor does not answer in json/],
    [["setup", "--format", "json"], /setup does not answer in json/],
    [["doctor", "."], /doctor takes no path/],
    [["setup", "."], /setup takes no path/],
  ]) {
    const { code, stderr } = refused(...args);
    assert.equal(code, 2, args.join(" "));
    assert.match(stderr, message, args.join(" "));
    assert.match(stderr, /usage: anatomiya scan/, `${args.join(" ")} prints the usage`);
  }
});

test("echo answers an object and exits 0 whatever the filesystem does to it", needsUnreadableDirs, (t) => {
  // The one command a person never runs and a session runs on every tool call.
  // A non-zero exit interrupts the run it exists to help, so the guarantee is
  // the exit code rather than the answer: a directory the walk may not look at
  // refused with EACCES, and the error reached the top of the process.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-echo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const locked = join(dir, "locked");
  mkdirSync(join(locked, "inner"), { recursive: true });
  chmodSync(locked, 0o000);

  // Restored before the temp directory's own removal runs, since a directory
  // nobody may read cannot be removed.
  let out;
  try {
    out = execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), "echo", join(locked, "inner")], {
      input: '{"hook_event_name":"PostToolUse"}',
      encoding: "utf8",
    });
  } finally {
    chmodSync(locked, 0o755);
  }

  assert.equal(out, "{}", "an empty object, and the exit code execFileSync would have thrown on");
});

test("echo answers an object and exits 0 when the directory it fired in is gone", needsRemovableCwd, (t) => {
  // A worktree removed while a session sits in it, or any `rm -rf` of the
  // directory the session was started from. `process.cwd()` refuses with ENOENT
  // once the directory is unlinked, it is read before the command runs, and the
  // hook exited 1 with a bootstrap stack that never reached this tool's own
  // error line. Every turn and every tool call after that, for the life of the
  // session.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-gone-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const work = join(dir, "work");
  mkdirSync(work);

  const out = fromRemovedCwd(work, ["echo"], '{"hook_event_name":"PostToolUse"}');

  assert.equal(out, "{}", "an empty object, and the exit code execFileSync would have thrown on");
});

/**
 * A command run from a directory unlinked under it, the way a removed worktree
 * leaves a session.
 *
 * Through a shell, because a spawn resolves the child's directory before the
 * child starts: the removal has to happen inside the process that then execs
 * the command, rather than in the one launching it.
 */
function fromRemovedCwd(work, args, input, { bin = join(ANATOMIYA, "bin", "anatomiya.mjs") } = {}) {
  const spelled = args.map((a) => `"${a}"`).join(" ");
  return execFileSync("sh", ["-c", `cd "${work}" && rm -rf "${work}" && exec "${process.execPath}" "${bin}" ${spelled}`], {
    input,
    encoding: "utf8",
  });
}

test("a hook whose own module will not load still answers an object and exits 0, from a directory that is gone", needsRemovableCwd, (t) => {
  // Each arm imports its module when it runs, so a module that fails to load
  // is now a throw inside the boundary rather than before it.
  const install = installWithoutDependencies(t);
  for (const module of ["hook-verbs.mjs", "refresh.mjs"]) rmSync(join(install, "lib", module));
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-gone-hooks-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [hook, event] of [["echo", "PostToolUse"], ["notice", "PreToolUse"], ["reuse", "Stop"], ["refresh", "SessionStart"]]) {
    const work = join(dir, hook);
    mkdirSync(work);

    assert.equal(fromRemovedCwd(work, [hook], JSON.stringify({ hook_event_name: event }), { bin: join(install, "bin", "anatomiya.mjs") }), "{}", hook);
  }
});

test("a hook whose directory is gone still answers off the map the payload names", needsRemovableCwd, (t) => {
  // The case above stops where it is safe: a payload naming no place is owed
  // nothing, so `{}` is the right answer there and the defect lived under it.
  // This is the payload that does name one, on a live repository with a map,
  // and the answer was the same `{}` for the rest of that session.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-gone-map-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  mkdirSync(join(repo, ".claude", "rules"), { recursive: true });
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, ".claude", "rules", "anatomiya-overview.md"), "---\ngenerator: anatomiya\n---\n\n# Repository map\n\n- src: 3 .ts\n");
  const work = join(dir, "work");
  mkdirSync(work);

  const out = fromRemovedCwd(work, ["echo"], JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Read",
    cwd: repo,
    tool_input: { file_path: join(repo, "src/a.ts") },
  }));

  assert.match(JSON.parse(out).hookSpecificOutput?.additionalContext ?? "", /<repository-map delivered="/, out);
});

test("a verb that walks a repository names the directory that is missing", needsRemovableCwd, (t) => {
  // The other half of the same read, and the half nothing covered: a hook is
  // let through with no directory, and everything else needs a real one. It
  // used to reach a git call and fail there on a value that was never a path.
  // The script is named absolutely, because node resolves a relative one
  // against the working directory and throws its own stack before this code
  // runs at all.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-gone-scan-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const work = join(dir, "work");
  mkdirSync(work);
  const bin = join(ANATOMIYA, "bin", "anatomiya.mjs");

  for (const verb of ["scan", "check", "pin"]) {
    const run = spawnSync("sh", ["-c", `cd "${work}" && rm -rf "${work}" && exec "${process.execPath}" "${bin}" ${verb}`], {
      encoding: "utf8",
      timeout: 20_000,
    });
    mkdirSync(work, { recursive: true });

    assert.equal(run.status, 1, `${verb}: ${run.stdout}${run.stderr}`);
    assert.match(run.stderr, /^anatomiya: the directory this was run from has been removed/m, `${verb}: ${run.stderr}`);
    assert.doesNotMatch(run.stderr, /uv_cwd|at process\./, `${verb} answered with a stack trace`);
  }
});

test("doctor answers about this installation from a directory that is gone", needsRemovableCwd, (t) => {
  // It takes no path and reads no repository, so the directory the shell
  // happens to be in decides nothing about its answer. Reading one anyway made
  // an absent directory fail a question that was never about a directory.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-gone-doctor-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const work = join(dir, "work");
  mkdirSync(work);

  const out = fromRemovedCwd(work, ["doctor"], "");

  assert.match(out, /^prism /m, out);
});

/* --- the command word is required (#67) --- */

test("the bare name prints the usage and writes nothing", (t) => {
  // The command word used to be optional and to default to `scan`, which
  // writes. Typing the name to see what the tool does rewrote the map: 14
  // seconds and a replaced `.claude/rules/` for somebody who only wanted to
  // look.
  const repo = repoWithSource(t);

  const out = execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs")], {
    cwd: repo,
    stdio: "pipe",
    encoding: "utf8",
  });

  assert.match(out, /^usage: anatomiya scan/, out);
  assert.equal(existsSync(join(repo, ".claude", "rules")), false, "nothing was written");
});

test("a mistyped command is refused by name, not reported as a bad repository", () => {
  // The asymmetry was the tell: a mistyped option was already refused by name
  // with the usage, while a mistyped command was read as a path and reported as
  // `not a git repository: frobnicate`, which names the wrong fix.
  let status = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), "frobnicate"], {
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (err) {
    status = err.status;
    stderr = String(err.stderr ?? "");
  }

  assert.equal(status, 2, "refused the way an unknown option is refused");
  assert.match(stderr, /unknown command: frobnicate/);
  assert.match(stderr, /usage: anatomiya scan/, "and it prints the usage");
  assert.doesNotMatch(stderr, /not a git repository/, "the fix named is the command word");
});

test("a path with no command word is refused rather than scanned", (t) => {
  // `anatomiya <path>` used to scan and write. A path is not a command.
  const repo = repoWithSource(t);

  let status = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), repo], {
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (err) {
    status = err.status;
    stderr = String(err.stderr ?? "");
  }

  assert.equal(status, 2);
  assert.match(stderr, /unknown command/);
  assert.equal(existsSync(join(repo, ".claude", "rules")), false, "nothing was written");
});

test("--help and -h still print the usage with no command word", () => {
  for (const flag of ["--help", "-h"]) {
    const out = execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), flag], {
      stdio: "pipe",
      encoding: "utf8",
    });
    assert.match(out, /^usage: anatomiya scan/, `${flag} prints the usage`);
  }
});

test("the usage says what --targets writes, that a target stays on, and how to turn one off", () => {
  const out = execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), "--help"], { stdio: "pipe", encoding: "utf8" });
  // Joined, so where a line wraps is not what is held.
  const usage = out.replace(/\s+/g, " ");

  assert.match(usage, /--targets is a scan option: a comma-separated list of cursor and copilot\./);
  assert.match(usage, /also written under \.cursor\/rules for Cursor and under \.github\/instructions for GitHub Copilot\./);
  assert.match(usage, /A target stays on for every later scan while its anatomiya-overview file is there, until --targets names a set without it\./);
  assert.match(usage, /--targets claude turns the others off and removes what this tool wrote there\./);
});

test("a mistyped --base exits non-zero and names the argument, not the repository", (t) => {
  // The command file's contract: a non-zero exit means the check could not run,
  // show its output and stop. The old answer was a whole-branch review at exit
  // 0, which the agent is told to trust as a finished check.
  const repo = repoWithBranch(t);
  anatomiya(repo, "scan");

  let status = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), "check", repo, "--base", "no/such/ref"], {
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (err) {
    status = err.status;
    stderr = String(err.stderr ?? "");
  }

  assert.equal(status, 1, "a check that could not run must not exit 0");
  assert.match(stderr, /^anatomiya: --base no\/such\/ref resolves to no commit/, stderr);
  assert.doesNotMatch(stderr, /\n\s+at /, "no stack trace");
});

test("an option cannot stand in for the command word", () => {
  let status = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [join(ANATOMIYA, "bin", "anatomiya.mjs"), "--format", "json"], {
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (err) {
    status = err.status;
    stderr = String(err.stderr ?? "");
  }

  assert.equal(status, 2);
  assert.match(stderr, /no command given, and an option cannot stand in for one: --format/, stderr);
});
