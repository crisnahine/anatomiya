import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, statSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { EXCLUDE_LINES } from "../lib/write.mjs";

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
  writeFileSync(join(repo, "src", "big.ts"), `const x = "${"a".repeat(4 * 1024 * 1024)}"\n`);
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
  assert.match(first, /^8 files, 1 areas, \d+ms, root .+$/);
  const printed = first.slice(first.indexOf(", root ") + ", root ".length);

  assert.ok(existsSync(join(printed, "src", "f0.ts")), `not the repository that was scanned: ${first}`);
  assert.ok(!existsSync(join(printed, "src", "src")), "the argument was widened to the root, so the root is what prints");
});

test("untracked source is reported rather than counted as a repository with nothing in it", (t) => {
  // The corpus is tracked files, which is the rule. A repository whose first
  // commit has not landed used to get an empty map, exit 0 and an overview
  // saying 0 files are uncovered, which states the opposite of what happened.
  const repo = repoWithNothingCommitted(t);
  const out = String(
    execFileSync(process.execPath, [join(ROOT, "bin", "anatomiya.mjs"), "scan", repo], { stdio: "pipe" })
  );

  assert.match(out, /5 source files are untracked and were not counted/);
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
