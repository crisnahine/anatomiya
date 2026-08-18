import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

import { needsShebang } from "./platform.mjs";
import { installWithoutDependencies } from "./plugin-install.mjs";
import { runCheck, runDoctor, runPin, runScan, runSetup } from "../lib/commands.mjs";
import { PIN_PATH } from "../lib/baseline.mjs";
import { PROBE_IDS, pluginRoot } from "../lib/readiness.mjs";

const RULES = join(".claude", "rules");

/** A committed repository with one area's worth of source in it. */
function repo(t, files = 8) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-commands-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  mkdirSync(join(dir, "src"), { recursive: true });
  for (let i = 0; i < files; i++) {
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

/** A branch off the base with one added file, which is what a check examines. */
function repoWithBranch(t) {
  const dir = repo(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("branch", "-M", "main");
  git("checkout", "-q", "-b", "feat");
  writeFileSync(join(dir, "src", "f8.ts"), "export function h() { try { go() } catch (e) { } }\n");
  git("add", "-A");
  git("commit", "-qm", "add");
  return dir;
}

/** The same repository with one Ruby file in it, so the scan needs an interpreter as well as a parser. */
function repoWithRuby(t) {
  const dir = repo(t);
  writeFileSync(join(dir, "src", "a.rb"), "class A\n  def b\n    1\n  end\nend\n");
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("add", "-A");
  git("commit", "-qm", "ruby");
  return dir;
}

/**
 * A PATH the version control system is on and the interpreter is not.
 *
 * Emptying PATH outright takes git with it, and every read a scan makes before
 * the parse is a git read, so the run would fail long before reaching a parser.
 */
function withoutRuby(t) {
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-commands-path-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const git = (process.env.PATH ?? "")
    .split(delimiter)
    .map((d) => join(d, "git"))
    .find((p) => existsSync(p));
  writeFileSync(join(bin, "git"), `#!/bin/sh\nexec "${git}" "$@"\n`, { mode: 0o755 });
  return bin;
}

test("a dry-run scan plans the whole map and puts none of it on disk", async (t) => {
  const dir = repo(t);

  const { plan, summary } = await runScan(dir, { dryRun: true });

  assert.equal(summary.wrote, plan.write.length);
  assert.equal(summary.dryRun, true);
  assert.equal(existsSync(join(dir, ".claude")), false, "not even the directory");
});

test("a scan writes the files its summary counted", async (t) => {
  const dir = repo(t);

  const { summary } = await runScan(dir);

  assert.equal(summary.dryRun, false);
  assert.equal(readdirSync(join(dir, RULES)).length, summary.wrote);
  assert.ok(summary.wrote > 0, "a repository with an area writes a map");
});

test("a scan answers with the whole result, so the summary is not the only thing it derived", async (t) => {
  const dir = repo(t);

  const { result, summary } = await runScan(dir, { dryRun: true });

  assert.equal(summary.files, result.corpus.files);
  assert.equal(summary.areas, result.areas.length);
  assert.equal(summary.root, result.root);
});

test("a path inside the repository is widened to the root the scan reports", async (t) => {
  // `git rev-parse --show-toplevel` resolves any path inside a repository to
  // its root, so `scan ./packages/api` in a monorepo maps the monorepo.
  const dir = repo(t);

  const { summary } = await runScan(join(dir, "src"), { dryRun: true });

  assert.ok(existsSync(join(summary.root, "src", "f0.ts")), `not the repository that was scanned: ${summary.root}`);
  assert.ok(!existsSync(join(summary.root, "src", "src")), "the argument was widened to the root");
});

test("a scan of a directory that is not a repository refuses rather than reporting nothing", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-commands-bare-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  await assert.rejects(() => runScan(dir, { dryRun: true }), /not a git repository/);
});

test("a scan with no interpreter is told to install Ruby, never to run npm", needsShebang, async (t) => {
  // Measured on a Ruby repository with no `ruby` on PATH: the scan exited 1
  // with `spawn ruby ENOENT` and then "run `npm install --omit=dev` in the
  // plugin directory". npm cannot install an interpreter, and the one remedy
  // printed was the only one that could not work.
  const dir = repoWithRuby(t);
  const path = process.env.PATH;
  t.after(() => {
    process.env.PATH = path;
  });
  process.env.PATH = withoutRuby(t);

  await assert.rejects(
    () => runScan(dir),
    (err) => {
      assert.match(err.message, /install Ruby 3\.4 or newer/, err.message);
      assert.doesNotMatch(err.message, /npm/, err.message);
      assert.match(err.message, /then scan again$/, err.message);
      return true;
    }
  );
});

test("a pin writes the baseline and answers with the delta it accepted", async (t) => {
  const dir = repo(t);

  const { summary, pin, previous, delta } = await runPin(dir);

  assert.ok(existsSync(join(dir, PIN_PATH)));
  assert.equal(previous, null, "nothing was pinned before");
  assert.equal(summary.delta, delta);
  assert.equal(delta.addedFiles, 8);
  assert.equal(delta.removedFiles, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, PIN_PATH), "utf8")).sha, pin.sha);
});

test("a dry-run pin writes nothing", async (t) => {
  const dir = repo(t);

  const { summary } = await runPin(dir, { dryRun: true });

  assert.equal(existsSync(join(dir, PIN_PATH)), false);
  assert.equal(summary.dryRun, true);
});

test("a second pin measures itself against the first", async (t) => {
  const dir = repo(t);
  await runPin(dir);
  writeFileSync(join(dir, "src", "f8.ts"), "export const b = 1\n");
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("add", "-A");
  git("commit", "-qm", "one more");

  const { summary, previous } = await runPin(dir);

  assert.ok(previous, "the pin already on disk was read");
  assert.equal(summary.previousSha, previous.sha);
  assert.equal(summary.delta.addedFiles, 1);
});

test("a repository with no commit cannot be pinned", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-commands-fresh-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "pipe" });

  await assert.rejects(() => runPin(dir), /no commit to pin/);
});

test("a check answers with a report the caller can count", async (t) => {
  const dir = repoWithBranch(t);
  await runScan(dir);

  const { report } = await runCheck(dir);

  assert.ok(report.counts, "the report carries its own tally");
  assert.equal(typeof report.counts.NIT, "number");
  assert.equal(typeof report.counts.FIX, "number");
});

test("a check reads the base it was given", async (t) => {
  const dir = repoWithBranch(t);
  await runScan(dir);

  const { report } = await runCheck(dir, { baseRef: "main" });

  assert.equal(report.base.ref, "main");
});

test("a doctor asks every engine and the optional checker, and answers a line each", async () => {
  const { rows, lines } = await runDoctor();

  assert.deepEqual([...new Set(rows.map((r) => r.engine))], [...PROBE_IDS]);
  assert.equal(lines.length, rows.length, "an extra answers a line of its own");
  assert.ok(lines.some((l) => l.startsWith("oxc ")), lines.join("\n"));
});

test("a setup with the dependencies already installed runs nothing", async () => {
  // The case this checkout can prove: they are here, so npm has nothing to do.
  // Nothing in this suite ever runs the real install, which reaches the network.
  const { pluginRoot: root, needed, ran, ok, output } = await runSetup();

  assert.equal(ran, false);
  assert.deepEqual(needed, []);
  assert.equal(ok, true);
  assert.equal(root, pluginRoot());
  assert.match(output, /^nothing to install: oxc \d/, output);
});

test("a dry run answers the exact command and runs nothing", async () => {
  // `--ignore-scripts` is the load-bearing one: without it a dependency's
  // install script runs arbitrary code in the plugin directory.
  const { command, ran, ok, output } = await runSetup({ dryRun: true });

  assert.deepEqual(command, ["npm", "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]);
  assert.equal(ran, false);
  assert.equal(ok, true);
  assert.match(output, /would run npm install --omit=dev --ignore-scripts --no-audit --no-fund in /, output);
  assert.ok(output.includes(pluginRoot()), `and it says which directory that is: ${output}`);
});

test("a setup on Windows refuses rather than spawning an npm it cannot start", async (t) => {
  // libuv resolves an extension-less name against `.com` and `.exe` only, and
  // npm ships `npm.cmd` and no `npm.exe`, so the spawn answers ENOENT on a
  // machine that has npm installed and on PATH. Running a batch file needs a
  // shell, which no subprocess here may use (F5), so this refuses instead of
  // telling a Windows user to install what they already have.
  const home = installWithoutDependencies(t);
  const { runSetup: fromCopy } = await import(pathToFileURL(join(home, "lib", "commands.mjs")).href);

  const { ok, ran, needed, output } = await fromCopy({ platform: "win32" });

  assert.equal(ok, false);
  assert.equal(ran, false);
  assert.deepEqual(needed, ["oxc", "flow-remove-types", "typescript"], "the copy has no node_modules, so there is something to install");
  assert.match(output, /npm install --omit=dev --ignore-scripts --no-audit --no-fund/, output);
  assert.ok(output.includes(home), `it names the directory to run it in: ${output}`);
});

test("a Windows machine with everything installed is told that, not the refusal", async () => {
  // The refusal sits after the two short-circuits: it is about an install that
  // has to happen, and a dry run's own line is the by-hand instruction.
  const done = await runSetup({ platform: "win32" });
  const dry = await runSetup({ platform: "win32", dryRun: true });

  assert.equal(done.ok, true);
  assert.match(done.output, /^nothing to install: oxc \d/, done.output);
  assert.equal(dry.ok, true);
  assert.match(dry.output, /would run npm install --omit=dev/, dry.output);
});

/**
 * Every top-level declaration in the module, as its own code.
 *
 * Bounded by the next declaration of any kind rather than by the next exported
 * function: the last export otherwise swallows every helper below it, and a
 * helper that runs npm would be charged to whichever function it sits under.
 * Comments come out, since the next declaration's docblock sits inside this
 * one's slice and prose about an install is not a call to one.
 */
function declarations() {
  const src = readFileSync(new URL("../lib/commands.mjs", import.meta.url), "utf8");
  const starts = [...src.matchAll(/^(?:export )?(?:async )?(?:function|const|let|class) (\w+)/gm)];
  return starts.map((m, i) => ({
    name: m[1],
    exported: m[0].startsWith("export "),
    body: src
      .slice(m.index, starts[i + 1]?.index ?? src.length)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " "),
  }));
}

test("setup is the only command that runs npm, so a scan, a check and a pin install nothing", () => {
  // F5: the install is a command of its own precisely so that nothing else
  // reaches a package registry by finding a dependency missing and fetching it.
  // One hop out, since what a helper below does is charged to whoever calls it.
  const decls = declarations();
  const npmish = decls.filter((d) => d.body.includes("npm")).map((d) => d.name);
  const reaches = (d) => d.body.includes("npm") || npmish.some((n) => n !== d.name && new RegExp(`\\b${n}\\b`).test(d.body));

  assert.deepEqual(decls.filter((d) => d.exported && reaches(d)).map((d) => d.name), ["runSetup"]);
});
