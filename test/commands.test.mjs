import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

import { needsShebang } from "./platform.mjs";
import { installWithoutDependencies } from "./plugin-install.mjs";
import { runCheck, runDoctor, runEcho, runNotice, runPin, runScan, runSetup } from "../plugins/anatomiya/lib/commands.mjs";
import { scanLines } from "../plugins/anatomiya/lib/summary.mjs";
import { PIN_PATH } from "../plugins/anatomiya/lib/baseline.mjs";
import { PROBE_IDS, pluginRoot } from "../plugins/anatomiya/lib/readiness.mjs";
import { OVERVIEW_FILE } from "../plugins/anatomiya/lib/rules.mjs";
import { loadTypeScript } from "../plugins/anatomiya/lib/semantic.mjs";

const RULES = join(".claude", "rules");

// The tier is optional, so the half of the deep path that needs a checker says
// so rather than failing on a machine that never installed one.
const needsTs = (await loadTypeScript()) ? {} : { skip: "typescript is not installed" };

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

/** The three entries 0.2.4 through 0.2.6 wrote into a scanned repository. */
const OLD_HOOK_SETTINGS = {
  hooks: {
    UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo' }] }],
    PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo' }] }],
    PostToolUseFailure: [{ matcher: "*", hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo' }] }],
  },
};

test("a dry-run scan plans the whole map and puts none of it on disk", async (t) => {
  const dir = repo(t);

  const { plan, summary } = await runScan(dir, { dryRun: true });

  // The whole map, planned: the overview and this repository's one area file,
  // which is what a real run of this fixture writes. Nothing of it lands.
  assert.equal(plan.write.length, 2, plan.write.join(", "));
  assert.ok(plan.write.includes(OVERVIEW_FILE), plan.write.join(", "));
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

test("a settings file the stale hook cannot be taken out of does not fail the scan", async (t) => {
  // The map is the product and this is a repair beside it, so a refusal is
  // reported rather than thrown: a scan that wrote the whole map and then
  // exited 1 over an unrelated file is the map not arriving.
  const dir = repo(t);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const settings = join(dir, ".claude", "settings.local.json");
  writeFileSync(settings, "{ not json");

  const { summary } = await runScan(dir);

  assert.ok(summary.wrote > 0, "the map is still written");
  assert.equal(summary.hookRemoved, false);
  assert.match(summary.hookRefused, /could not be read/, "and the reason is carried, not swallowed");
  assert.equal(readFileSync(settings, "utf8"), "{ not json", "the file is left alone");
  assert.ok(scanLines(summary).some((l) => l.includes("could not be read")), "and printed");
});

test("a scan takes out the hook an older version wrote, and says so once", async (t) => {
  // The one line in the summary that is a function of what this run did rather
  // than of the tree, and it can only fire once: the second scan finds nothing
  // to take out. The corpus harness compares two consecutive summaries, and no
  // repository in it carries the old file.
  const dir = repo(t);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const settings = join(dir, ".claude", "settings.local.json");
  writeFileSync(settings, JSON.stringify(OLD_HOOK_SETTINGS));

  const first = (await runScan(dir)).summary;
  const second = (await runScan(dir)).summary;

  assert.equal(first.hookRemoved, true);
  assert.ok(scanLines(first).some((l) => l.includes("taken out")), "and printed");
  assert.equal(existsSync(settings), false, "the file held nothing else");
  assert.equal(second.hookRemoved, false, "nothing left to take out");
});

test("two scans over unchanged source say the same thing", async (t) => {
  // The corpus harness asserts a second scan's summary equals the first beyond
  // its timing, and every line but the repair one is a function of the tree.
  const dir = repo(t);

  const first = (await runScan(dir)).summary;
  const second = (await runScan(dir)).summary;

  assert.equal(first.hookRemoved, false, "there was nothing to repair");
  const timeless = (s) => scanLines(s).filter((l) => !/\dms, root /.test(l));
  assert.deepEqual(timeless(second), timeless(first), "so the two summaries agree");
});

test("a settings file with a byte-order mark is read, not refused", async (t) => {
  // Editors write one. It is not a malformed file, it is a file with a BOM.
  const dir = repo(t);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const settings = join(dir, ".claude", "settings.local.json");
  const body = JSON.stringify({ permissions: { allow: ["Bash(x)"] }, ...OLD_HOOK_SETTINGS });
  writeFileSync(settings, `﻿${body}`);

  const { summary } = await runScan(dir);

  assert.equal(summary.hookRemoved, true);
  const s = JSON.parse(readFileSync(settings, "utf8"));
  assert.deepEqual(s.permissions.allow, ["Bash(x)"], "and what was in it survives");
  assert.equal("hooks" in s, false, "while the hook that cannot run goes");
});
test("a scan answers with the whole result, so the summary is not the only thing it derived", async (t) => {
  const dir = repo(t);

  const { result, summary } = await runScan(dir, { dryRun: true });

  // The summary carries the counts; the result carries the slots they were
  // counted from, which is the whole reason a caller is handed both.
  assert.equal(summary.files, 8);
  assert.equal(summary.claims.total, 1);
  assert.ok(
    result.areas[0].dimensions.every((d) => typeof d.candidates === "number"),
    "the slots are there, not only how many of them there were"
  );
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

test("a deep scan with no checker refuses before it reads anything", (t) => {
  // `/plugin install` copies the files and does not run `npm install`, so this
  // is the shape a marketplace user's first `--deep` meets. Refused before the
  // parse rather than after a minute of it, and out of process because that is
  // where the whole deep path through this module can be exercised at all.
  const install = installWithoutDependencies(t);
  const dir = repo(t);

  let status = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [join(install, "bin", "anatomiya.mjs"), "scan", dir, "--deep"], { stdio: "pipe" });
  } catch (err) {
    status = err.status;
    stderr = String(err.stderr);
  }

  assert.equal(status, 1, stderr);
  // The checker's own sentence, not the parser's: both are absent here, and the
  // refusal that fires decides which install the reader goes and does.
  assert.match(stderr, /--deep needs typescript/, stderr);
  assert.match(stderr, /bin\/anatomiya\.mjs setup/, stderr);
  assert.equal(existsSync(join(dir, ".claude")), false, "a refused scan wrote nothing");
});

test("a deep scan with the checker installed is not refused", needsTs, async (t) => {
  // The other half. A refusal that fired on every deep scan would pass the test
  // above just as loudly, and nothing else here runs this path at all.
  const dir = repo(t);

  const { summary } = await runScan(dir, { dryRun: true, deep: true });

  assert.equal(summary.files, 8);
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

/**
 * What this checkout is missing, asked once, and the guard for the two tests
 * that are about a setup with nothing left to do.
 *
 * Asked through `win32`, which is the seam that cannot reach npm: the probe
 * covers the optional checker, so a checkout installed with `--omit=optional`
 * has something to install, and a plain `runSetup()` here would install it into
 * the repository the suite is running in. `semantic.test.mjs` steps aside on the
 * same condition rather than assuming it.
 */
const { needed: MISSING } = await runSetup({ platform: "win32" });
const needsEverything = MISSING.length === 0 ? {} : { skip: `this checkout has not installed ${MISSING.join(", ")}` };

test("a setup with the dependencies already installed runs nothing", needsEverything, async () => {
  // `win32` is the guarantee rather than the subject: the refusal sits after the
  // short-circuit, so a checkout that has everything answers exactly what it
  // answers on this platform, and one that does not refuses instead of
  // installing. Nothing in this suite may run the real install.
  const { pluginRoot: root, needed, ran, ok, output } = await runSetup({ platform: "win32" });

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
  // Compared as the same directory rather than as the same string: node
  // resolves a module's own path, so `pluginRoot()` answers the realpath while
  // the fixture holds what `mkdtemp` returned. They share a suffix on macOS
  // only because `/private` is a pure prefix.
  assert.ok(output.includes(realpathSync(home)), `it names the directory to run it in: ${output}`);
});

test("a Windows machine with everything installed is told that, not the refusal", needsEverything, async () => {
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
  const src = readFileSync(new URL("../plugins/anatomiya/lib/commands.mjs", import.meta.url), "utf8");
  // `var` and a destructured binding count too: a helper declared either way
  // would otherwise be invisible to the guarantee below.
  const starts = [...src.matchAll(/^(?:export )?(?:async )?(?:function|const|let|var|class)\s+([\w$]+|\{[^}]*\})/gm)];
  return starts.map((m, i) => ({
    names: m[1].match(/[\w$]+/g) ?? [],
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
  const npmish = decls.filter((d) => d.body.includes("npm")).flatMap((d) => d.names);
  const reaches = (d) =>
    d.body.includes("npm") || npmish.some((n) => !d.names.includes(n) && new RegExp(`\\b${n}\\b`).test(d.body));

  assert.deepEqual(decls.filter((d) => d.exported && reaches(d)).flatMap((d) => d.names), ["runSetup"]);
});

// --- what a hook is answered with ---------------------------------------------

/** A scanned repository with mailers nobody tests and services everybody does. */
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

test("the notice answers for a test going where its kind of file has none", async (t) => {
  const dir = await railsish(t);

  const out = runNotice(dir, write(dir, "spec/mailers/cim_share_mailer_spec.rb"));

  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(out.hookSpecificOutput.additionalContext, /spec\/mailers holds no other test/);
  assert.match(out.hookSpecificOutput.additionalContext, /app\/mailers: 4 files, 0 with a namesake test/);
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined, "it informs and never refuses");
});

test("the notice answers with an empty object for everything it cannot decide", async (t) => {
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

test("the echo hands back the map it was asked for, and nothing without an event", async (t) => {
  const dir = await railsish(t);

  assert.deepEqual(runEcho(dir, {}), {}, "no event name");
  const out = runEcho(dir, { hook_event_name: "PostToolUse" });
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(out.hookSpecificOutput.additionalContext, /<repository-map delivered="/);
});
