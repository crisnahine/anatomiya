import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

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
