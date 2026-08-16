import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, appendFileSync, statSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { EXCLUDE_LINES } from "../lib/rules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The plugin's own code with no `node_modules` beside it, which is what a
 * marketplace install actually looks like: `/plugin install` copies the files
 * and does not run `npm install`.
 */
function installWithoutDependencies(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  for (const part of ["lib", "bin"]) cpSync(join(ROOT, part), join(dir, part), { recursive: true });
  cpSync(join(ROOT, "package.json"), join(dir, "package.json"));
  return dir;
}

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
  assert.match(stderr, /npm install/, "the message says how to fix it");
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
  assert.match(stderr, /npm install/, "the message says how to fix it");
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
    execFileSync(process.execPath, [join(ROOT, "bin", "anatomiya.mjs"), "scan", repo], { stdio: "pipe" })
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

  mkdirSync(join(dir, "lib", "core"), { recursive: true });
  for (let i = 0; i < 5; i++) writeFileSync(join(dir, "lib", "core", `c${i}.js`), `export const a${i} = 1\n`);
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
    execFileSync(process.execPath, [join(ROOT, "bin", "anatomiya.mjs"), "scan", repo], { stdio: "pipe" })
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
    execFileSync(process.execPath, [join(ROOT, "bin", "anatomiya.mjs"), "scan", join(repo, "src")], {
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
  const out = String(execFileSync(process.execPath, [join(ROOT, "bin", "anatomiya.mjs"), "scan", repo], { stdio: "pipe" }));

  assert.match(out, /^layout: 2 roots, 0 folded, tests: none; roster lines: 0 areas with imports, 0 with reuse$/m, out);
});

test("untracked source is reported rather than counted as a repository with nothing in it", (t) => {
  // The corpus is tracked files, which is the rule. A repository whose first
  // commit has not landed used to get an empty map, exit 0 and an overview
  // saying 0 files are uncovered, which states the opposite of what happened.
  const repo = repoWithNothingCommitted(t);
  const out = String(
    execFileSync(process.execPath, [join(ROOT, "bin", "anatomiya.mjs"), "scan", repo], { stdio: "pipe" })
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

  execFileSync(process.execPath, [join(ROOT, "bin", "anatomiya.mjs"), "scan", wt], { stdio: "pipe" });
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
  execFileSync(process.execPath, [join(ROOT, "bin", "anatomiya.mjs"), ...args, repo], {
    stdio: "pipe",
    encoding: "utf8",
  });

const ruleFiles = (repo) => {
  const dir = join(repo, ".claude", "rules");
  return readdirSync(dir).sort().map((name) => ({ name, body: readFileSync(join(dir, name), "utf8") }));
};

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

test("a scan says the running session still holds the old map (A8)", (t) => {
  // Measured: a rewritten context file does not re-attach mid-session.
  const repo = repoWithSource(t);

  const out = anatomiya(repo, "scan");

  assert.match(out, /^a session already running still holds the old map; restart to pick it up$/m);
});

test("a dry run does not claim a session needs restarting", (t) => {
  // Nothing was written, so there is nothing to pick up.
  const repo = repoWithSource(t);

  const out = anatomiya(repo, "scan", "--dry-run");

  assert.doesNotMatch(out, /restart to pick it up/);
});

test("a pin says it too, because it sends the reader off to scan (A8)", (t) => {
  const repo = repoWithSource(t);

  const out = anatomiya(repo, "pin");

  assert.match(out, /run `anatomiya scan` to measure the map against it/);
  assert.match(out, /^a session already running still holds the old map; restart to pick it up$/m);
});

/* --- what the command files tell the agent (A7, A8) --- */

test("every command that rebuilds the map forbids the Read tool on it (A7)", () => {
  // Measured: reading a context file permanently suppresses its automatic
  // injection for that path for the rest of the process, so the one session
  // that just built the map is the one that loses it.
  for (const name of ["scan.md", "pin.md"]) {
    const body = readFileSync(join(ROOT, "commands", name), "utf8");
    assert.match(body, /Do not open the generated files with the Read tool/, name);
    assert.match(body, /`cat`/, `${name} says what to use instead`);
  }
});

test("every command that reads the map forbids the Read tool on it (A7)", () => {
  // The check does not write the map, but it does show it, and showing it with
  // the Read tool turns the map off for the session that is using it.
  const body = readFileSync(join(ROOT, "commands", "check.md"), "utf8");

  assert.match(body, /Do not open the generated files with the Read tool/);
  assert.match(body, /`cat`/);
});

test("every command that rebuilds the map says a running session keeps the old one (A8)", () => {
  for (const name of ["scan.md", "pin.md"]) {
    const body = readFileSync(join(ROOT, "commands", name), "utf8");
    assert.match(body, /does not re-attach mid-session/, name);
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

test("the scan summary reads a count of one as one", (t) => {
  // Every count on the summary reaches a person, and several are 1 on a real
  // repository. Measured across a thirty-five repository corpus: seven printed
  // "1 files hold syntax the parser rejected", on this line and in the file
  // that loads on every turn.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-cli-one-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "only.ts"), `export const a = 1\n`);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");

  const out = String(execFileSync(process.execPath, [join(ROOT, "bin", "anatomiya.mjs"), "scan", dir], { stdio: "pipe" }));

  assert.doesNotMatch(out, /\b1 (files|areas|claims|source files)\b/, `a count of one wearing a plural:\n${out}`);
});

test("the untracked summary reads at one and at many", (t) => {
  // Fixing the count and leaving the clause after it is the same defect one
  // word along, and the first attempt at this traded a plural bug for a
  // singular one. Neither surface carries a word that has to agree.
  const build = (n) => {
    const dir = mkdtempSync(join(tmpdir(), "anatomiya-cli-untracked-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, "README.md"), "x\n");
    mkdirSync(join(dir, "src"), { recursive: true });
    for (let i = 0; i < n; i++) writeFileSync(join(dir, "src", `f${i}.ts`), `export const a${i} = ${i}\n`);
    const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    git("config", "user.email", "t@t.test");
    git("config", "user.name", "T");
    git("add", "README.md");
    git("commit", "-qm", "init");
    return String(execFileSync(process.execPath, [join(ROOT, "bin", "anatomiya.mjs"), "scan", dir], { stdio: "pipe" }));
  };

  assert.match(build(1), /1 source file in the working tree is untracked\./);
  assert.match(build(3), /3 source files in the working tree are untracked\./);
});

test("--deep is refused on check, because the check cannot run a whole-program checker", () => {
  // It was accepted, recorded as ran, and never ran: check.mjs has no runSemantic
  // in it. So the report said "rerun with --deep", the user did, the note
  // disappeared because ran was true, and nothing was measured either time.
  // The checker is whole-program and would need the whole corpus built at two
  // revisions to answer a branch, which is a scan's job and not a check's.
  let code = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [join(ROOT, "bin", "anatomiya.mjs"), "check", ".", "--deep"], {
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (err) {
    code = err.status;
    stderr = String(err.stderr ?? "");
  }

  assert.equal(code, 2);
  assert.match(stderr, /--deep is not a check option/);
  assert.match(stderr, /anatomiya scan --deep/, "and it says where the tier does run");
});
