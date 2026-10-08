import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

import { needsPosixPermissions, needsShebang, needsSymlinks } from "./platform.mjs";
import { installWithoutDependencies } from "./plugin-install.mjs";
import { scratch } from "./git-worktrees.mjs";
import { runCheck, runDoctor, runPin, runScan, runSetup } from "../plugins/anatomiya/lib/commands.mjs";
import { pinJson, pinLines, scanLines } from "../plugins/anatomiya/lib/summary.mjs";
import { PIN_PATH } from "../plugins/anatomiya/lib/baseline.mjs";
import { collect } from "../plugins/anatomiya/lib/corpus.mjs";
import { PROBE_IDS, pluginRoot } from "../plugins/anatomiya/lib/readiness.mjs";
import { OVERVIEW_FILE } from "../plugins/anatomiya/lib/rules.mjs";
import { CAVEATS } from "../plugins/anatomiya/lib/check-report.mjs";
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

/**
 * A TypeScript repository whose only Ruby is the Gemfile at its root, the shape
 * the React Native template ships: CocoaPods reads it, and nothing in the
 * repository is written in Ruby.
 */
function repoWithGemfile(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-commands-gemfile-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  for (const sub of ["utils", "components"]) mkdirSync(join(dir, "src", sub), { recursive: true });
  for (let i = 0; i < 6; i++) {
    writeFileSync(join(dir, "src", "utils", `u${i}.ts`), `export function f${i}(a: number) {\n  try { return a + 1 } catch (e) { throw e }\n}\n`);
    writeFileSync(join(dir, "src", "components", `C${i}.tsx`), `export const C${i} = () => <div className="x">hi</div>\n`);
  }
  writeFileSync(join(dir, "Gemfile"), 'source "https://rubygems.org"\ngem "cocoapods", "~> 1.13"\n');
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
  return dir;
}

/** A repository written in Ruby and nothing else, so no file of it can be read without an interpreter. */
function repoOnlyRuby(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-commands-ruby-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  mkdirSync(join(dir, "app", "models"), { recursive: true });
  for (let i = 0; i < 8; i++) {
    writeFileSync(join(dir, "app", "models", `m${i}.rb`), `class M${i}\n  def b\n    1\n  end\nend\n`);
  }
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-qm", "init");
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

test("a dry run says the old hook would be taken out, and leaves it where it is", async (t) => {
  // A dry run is the plan without the write, and this line said the write had
  // happened: measured before this, `scan --dry-run` printed "it was taken
  // out" over a settings file it had not touched.
  const dir = repo(t);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const settings = join(dir, ".claude", "settings.local.json");
  writeFileSync(settings, JSON.stringify(OLD_HOOK_SETTINGS));

  const lines = scanLines((await runScan(dir, { dryRun: true })).summary);

  assert.ok(lines.some((l) => l.endsWith("it would be taken out")), lines.join("\n"));
  assert.ok(!lines.some((l) => l.includes("was taken out")), lines.join("\n"));
  assert.equal(readFileSync(settings, "utf8"), JSON.stringify(OLD_HOOK_SETTINGS), "and it is still there");
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

test("a scan runs the checker where the repository's dependencies are on disk", needsTs, async (t) => {
  const dir = repo(t);
  mkdirSync(join(dir, "node_modules", "left-pad"), { recursive: true });

  const { result, summary } = await runScan(dir, { dryRun: true });

  assert.equal(summary.files, 8);
  assert.equal(result.semantic.ran, true, JSON.stringify(result.semantic));
});

test("a scan that leaves the checker off says why in the facts it writes", async (t) => {
  const dir = repo(t);

  await runScan(dir);

  const facts = JSON.parse(readFileSync(join(dir, ".claude", "anatomiya", "facts.json"), "utf8"));
  assert.deepEqual(facts.semantic, { ran: false, status: null, reason: "no-dependencies", typedResolutionRate: null, carried: false, measuredAt: null, measuredUnder: null });
});

test("a checked scan measures resolution over area files, so a bundle in no area does not degrade it", needsTs, async (t) => {
  // One untyped minified bundle outside every area pulled a repository whose
  // own code resolved at 100% down to 3% and printed it as low-resolution,
  // which points the reader at the tsconfig and the dependencies.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-commands-bundle-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "public", "assets"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "left-pad"), { recursive: true });
  writeFileSync(join(dir, "tsconfig.json"), `{"compilerOptions":{"strict":true,"allowJs":true},"include":["src","public"]}`);
  for (let i = 0; i < 8; i++) {
    writeFileSync(
      join(dir, "src", `m${i}.ts`),
      `export interface U${i} { a: { b: string } }\nexport const f${i} = (u: U${i}) => u.a.b.length;\n`
    );
  }
  let bundle = "(function(){";
  for (let i = 0; i < 200; i++) bundle += `function f${i}(a,b){return a.x.y+b.z;}`;
  writeFileSync(join(dir, "public", "assets", "game.min.js"), `${bundle}})();`);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=t@t.test", "-c", "user.name=T", "commit", "-qm", "init");

  const { result } = await runScan(dir, { dryRun: true });

  assert.equal(result.semantic.status, "ok", JSON.stringify(result.semantic));
  assert.equal(result.semantic.typedResolutionRate, 1);
});

test("a scan with no interpreter is told to install Ruby, never to run npm",needsShebang, async (t) => {
  // Measured on a Ruby repository with no `ruby` on PATH: the scan exited 1
  // with `spawn ruby ENOENT` and then "run `npm install --omit=dev` in the
  // plugin directory". npm cannot install an interpreter, and the one remedy
  // printed was the only one that could not work. Refused only where no
  // other language was there to read: every file here is Ruby, so a map would
  // be an empty one.
  const dir = repoOnlyRuby(t);
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

test("a TypeScript repository with a Gemfile still gets its map when ruby is missing", needsShebang, async (t) => {
  // Measured on the React Native template's shape, twelve .ts and .tsx files
  // and the Gemfile CocoaPods reads, on a machine with no ruby: the scan
  // exited 1 on `spawn ruby ENOENT` and wrote nothing, and the background
  // refresh failed the same way every session, so a repository written in
  // TypeScript got no map at all. An engine missing for one language costs
  // that language's files, and the map and the summary both say which and
  // what to do about it.
  const dir = repoWithGemfile(t);
  const path = process.env.PATH;
  t.after(() => {
    process.env.PATH = path;
  });
  process.env.PATH = withoutRuby(t);

  const { plan, summary } = await runScan(dir);

  assert.equal(plan.write.filter((name) => name !== OVERVIEW_FILE).length, 2, plan.write.join(", "));
  for (const name of plan.write) assert.ok(existsSync(join(dir, RULES, name)), `${name} is on disk`);
  const lines = scanLines(summary);
  assert.ok(lines.some((l) => /read no ruby file/.test(l)), lines.join("\n"));
  assert.ok(lines.some((l) => /install Ruby 3\.4 or newer/.test(l)), lines.join("\n"));
  const overview = readFileSync(join(dir, RULES, OVERVIEW_FILE), "utf8");
  assert.match(overview, /no ruby file was read\b.*install Ruby 3\.4 or newer/, overview);
});

test("a check of a change to a Gemfile and a .ts file checks the .ts file when ruby is missing", needsShebang, async (t) => {
  // The same machine and the same repository: a branch that added a Gemfile
  // line beside a TypeScript file exited 1 on `spawn ruby ENOENT`, so the
  // TypeScript change went unchecked because one file of another language
  // could not be read. The Gemfile is named as not checked, with the remedy.
  const dir = repoWithGemfile(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("checkout", "-q", "-b", "feat");
  writeFileSync(join(dir, "Gemfile"), 'source "https://rubygems.org"\ngem "cocoapods", "~> 1.13"\ngem "fastlane"\n');
  writeFileSync(join(dir, "src", "utils", "u7.ts"), "export function g(a: number) {\n  try { return a } catch (e) { }\n}\n");
  git("add", "-A");
  git("commit", "-qm", "feat");
  const path = process.env.PATH;
  t.after(() => {
    process.env.PATH = path;
  });
  process.env.PATH = withoutRuby(t);

  const { report } = await runCheck(dir, { baseRef: "main" });

  const said = report.caveats.map((c) => c.message).join("\n");
  assert.ok(!report.caveats.some((c) => c.message.includes("u7.ts")), `the TypeScript file was checked:\n${said}`);
  assert.ok(report.caveats.some((c) => c.message.startsWith("Gemfile ")), `the Gemfile is named as unchecked:\n${said}`);
  const missing = report.caveats.find((c) => c.code === CAVEATS.ENGINE_MISSING);
  assert.ok(missing, `and the missing engine is named:\n${said}`);
  assert.match(missing.message, /install Ruby 3\.4 or newer.*then check again$/, "with its remedy");
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

test("a pin whose store is linked outside the repository refuses, dry run included", async (t) => {
  // The refusal belongs to the half that plans (A19), or a dry run answers with
  // a clean delta for a write that lands in `../victim` the moment one is asked
  // for.
  const dir = repo(t);
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, join(dir, ".claude"));

  for (const dryRun of [true, false]) {
    await assert.rejects(() => runPin(dir, { dryRun }), /outside the repository/, `dryRun ${dryRun}`);
  }
  assert.deepEqual(readdirSync(outside), [], "nothing was written through the link");
});

test("a pin refuses a tree that differs from the commit it would record", async (t) => {
  // The pin records HEAD's sha and its file list came from the index and the
  // working tree: a staged file, an intent-to-add or an uncommitted edit was
  // listed against a commit that does not hold it, and every scan after read
  // that area as a population change for as long as the pin stood.
  const dir = repo(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  const cases = [
    ["a staged file", () => { writeFileSync(join(dir, "src", "new.ts"), "export const n = 1\n"); git("add", "src/new.ts"); }],
    ["an edited file", () => writeFileSync(join(dir, "src", "f0.ts"), "export const a0 = 2\n")],
  ];
  for (const [name, dirty] of cases) {
    dirty();
    for (const dryRun of [true, false]) {
      await assert.rejects(() => runPin(dir, { dryRun }), /commit or stash/, `${name}, dryRun ${dryRun}`);
    }
    assert.equal(existsSync(join(dir, PIN_PATH)), false, name);
    git("reset", "-q", "--hard");
    git("clean", "-qfd", "src");
  }
  // Untracked files are not in the corpus, so they are not a difference.
  writeFileSync(join(dir, "notes.txt"), "scratch\n");
  await runPin(dir);
  assert.ok(existsSync(join(dir, PIN_PATH)));
});

test("a pin leaves out this tool's own map committed through a linked rules directory", needsSymlinks, async (t) => {
  // A map committed under `.claude/rules` is rewritten by every scan and the pin
  // leaves it out. Through `.claude/rules -> ../agents/rules` git stores it
  // under `agents/rules/`, which the `.claude` exclusion never reached.
  const dir = repo(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "agents", "rules"), { recursive: true });
  writeFileSync(join(dir, "agents", "rules", "README.md"), "# shared\n");
  mkdirSync(join(dir, ".claude"), { recursive: true });
  symlinkSync(join("..", "agents", "rules"), join(dir, ".claude", "rules"));
  await runScan(dir);
  git("add", "-A");
  git("commit", "-qm", "commit the map through the link");
  writeFileSync(join(dir, "agents", "rules", OVERVIEW_FILE), "rewritten by a scan\n");

  await runPin(dir);
  assert.ok(existsSync(join(dir, PIN_PATH)));

  writeFileSync(join(dir, "agents", "rules", "README.md"), "# edited\n");
  await assert.rejects(() => runPin(dir), /commit or stash/, "a file of the directory's own is still a difference");
});

test("a pin leaves out its map where the index spells the linked directory in another case than the disk", needsSymlinks, async (t) => {
  const dir = repo(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "Agents", "Rules"), { recursive: true });
  if (!existsSync(join(dir, "AGENTS"))) return t.skip("this filesystem is case-sensitive");
  mkdirSync(join(dir, ".claude"), { recursive: true });
  symlinkSync(join("..", "Agents", "Rules"), join(dir, ".claude", "rules"));
  await runScan(dir);
  git("add", "-A");
  git("commit", "-qm", "commit the map through the link");
  renameSync(join(dir, "Agents"), join(dir, "tmp"));
  renameSync(join(dir, "tmp"), join(dir, "agents"));
  writeFileSync(join(dir, "agents", "Rules", OVERVIEW_FILE), "rewritten by a scan\n");

  await runPin(dir);
  assert.ok(existsSync(join(dir, PIN_PATH)));
});

test("a pin leaves out its map where the index spells .claude in another case than the disk", async (t) => {
  const dir = repo(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, ".Claude"));
  if (!existsSync(join(dir, ".CLAUDE"))) return t.skip("this filesystem is case-sensitive");
  await runScan(dir);
  git("add", "-f", join(".Claude", "rules"));
  git("commit", "-qm", "commit the map");
  renameSync(join(dir, ".Claude"), join(dir, "tmp"));
  renameSync(join(dir, "tmp"), join(dir, ".claude"));
  writeFileSync(join(dir, ".claude", "rules", OVERVIEW_FILE), "rewritten by a scan\n");

  await runPin(dir);
  assert.ok(existsSync(join(dir, PIN_PATH)));
});

test("a pin leaves out the map's copies for Cursor and Copilot, and nothing else beside them", async (t) => {
  // A repository that commits those copies has them rewritten by every scan,
  // and they are no more part of the population than the Claude ones.
  const dir = repo(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  await runScan(dir, { targets: ["claude", "cursor", "copilot"] });
  writeFileSync(join(dir, ".cursor", "rules", "team.mdc"), "# the team's own\n");
  git("add", "-A");
  git("commit", "-qm", "commit the map");
  for (const [at, name] of [[".cursor/rules", "anatomiya-overview.mdc"], [".github/instructions", "anatomiya-overview.instructions.md"]]) {
    writeFileSync(join(dir, at, name), "rewritten by a scan\n");
  }

  await runPin(dir);
  assert.ok(existsSync(join(dir, PIN_PATH)));

  writeFileSync(join(dir, ".cursor", "rules", "team.mdc"), "# edited\n");
  await assert.rejects(() => runPin(dir), /commit or stash/, "a rule somebody wrote there is still a difference");
});

test("a scan handed a set of targets writes that set, and one handed none writes what is on", async (t) => {
  const dir = repo(t);

  const named = await runScan(dir, { targets: ["claude", "cursor"] });
  const kept = await runScan(dir);
  const off = await runScan(dir, { targets: ["claude"] });

  assert.deepEqual(named.summary.targets, { cursor: { state: "on", dir: ".cursor/rules", wrote: 2, removed: 0, unfiled: 0, foreign: 0 } });
  assert.deepEqual(kept.summary.targets, named.summary.targets);
  assert.deepEqual(off.summary.targets, { cursor: { state: "off", dir: ".cursor/rules", wrote: 0, removed: 2, unfiled: 0, foreign: 0 } });
  assert.deepEqual(readdirSync(join(dir, ".cursor", "rules")), []);
  assert.equal(existsSync(join(dir, ".github")), false);
});

test("a person's file at a name a named target writes refuses the scan in the writer's sentence", async (t) => {
  const dir = repo(t);
  mkdirSync(join(dir, ".cursor", "rules"), { recursive: true });
  writeFileSync(join(dir, ".cursor", "rules", "anatomiya-overview.mdc"), "# mine\n");

  await assert.rejects(() => runScan(dir, { targets: ["claude", "cursor"] }), {
    message:
      ".cursor/rules/anatomiya-overview.mdc was not written by this tool, so .cursor/rules could not be written and nothing was written anywhere: move or delete it and scan again",
  });
  assert.equal(existsSync(join(dir, ".claude")), false);

  // Not named, the target is off: the file stays and the scan has nothing to say about it.
  const { summary } = await runScan(dir);
  assert.equal("targets" in summary, false);
  assert.equal(scanLines(summary).some((l) => l.includes(".cursor")), false, scanLines(summary).join("\n"));
  assert.equal(readFileSync(join(dir, ".cursor", "rules", "anatomiya-overview.mdc"), "utf8"), "# mine\n");
});

test("a pin refuses while a merge has left a path unmerged, under .claude/ as well", async (t) => {
  // `ls-files` lists an unmerged path once per stage, so a pin taken mid-merge
  // recorded the file three times and a corpus two larger than the tree, and
  // the corpus fixes the area floor for every scan after. The dirty check
  // caught a conflict in src/ and let one through under .claude/, which it
  // leaves out for this tool's own output: a tracked source file there made
  // an area of one file listed three times.
  const dir = repo(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, ".claude", "hooks"), { recursive: true });
  writeFileSync(join(dir, ".claude", "hooks", "h.mjs"), "export const h = 1\n");
  git("add", "-A");
  git("commit", "-qm", "hook");
  git("checkout", "-q", "-b", "other");
  writeFileSync(join(dir, ".claude", "hooks", "h.mjs"), "export const h = 2\n");
  git("commit", "-qam", "other");
  git("checkout", "-q", "-");
  writeFileSync(join(dir, ".claude", "hooks", "h.mjs"), "export const h = 3\n");
  git("commit", "-qam", "here");
  assert.throws(() => git("merge", "-q", "other"), "the merge conflicts");

  for (const dryRun of [true, false]) {
    await assert.rejects(() => runPin(dir, { dryRun }), /^Error: a merge is in progress, and a pin records HEAD/, `dryRun ${dryRun}`);
  }
  assert.equal(existsSync(join(dir, PIN_PATH)), false);
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

test("a pin over no tracked source refuses, and counts the source still untracked", async (t) => {
  // A young repository whose source was never committed pinned an empty
  // population with exit 0 and "0 files enter": every area the first commit
  // then made read postdates-baseline and stated nothing until somebody
  // re-pinned, with no line anywhere saying why.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-commands-empty-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  writeFileSync(join(dir, "README.md"), "hi\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  mkdirSync(join(dir, "src"));
  for (let i = 0; i < 4; i++) writeFileSync(join(dir, "src", `f${i}.ts`), `export const x${i} = ${i}\n`);

  for (const dryRun of [true, false]) {
    await assert.rejects(() => runPin(dir, { dryRun }), /nothing to pin: 4 source files in the working tree are untracked/, `dryRun ${dryRun}`);
  }
  assert.equal(existsSync(join(dir, PIN_PATH)), false);
});

test("a pin whose population makes no area refuses, and names the files left out", async (t) => {
  // An area-less pin is the empty one by another route: every area a later
  // commit makes postdates it, and states nothing until somebody pins again.
  const dir = repo(t, 2);

  for (const dryRun of [true, false]) {
    await assert.rejects(
      () => runPin(dir, { dryRun }),
      /^Error: nothing to pin: the 2 source files tracked here sit in no area \("src\/f0\.ts", "src\/f1\.ts"\), and a pin with no area holds back every area made after it/,
      `dryRun ${dryRun}`
    );
  }
  assert.equal(existsSync(join(dir, PIN_PATH)), false);
});

test("a pin in a sparse checkout refuses, since HEAD holds files the tree does not", async (t) => {
  // The paths outside the cone are skip-worktree, so `git status` is clean, and
  // the pin labelled half of HEAD's population with HEAD's sha.
  const dir = repo(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "lib"));
  for (let i = 0; i < 4; i++) writeFileSync(join(dir, "lib", `l${i}.ts`), `export const l${i} = ${i}\n`);
  git("add", "-A");
  git("commit", "-qm", "lib");
  git("sparse-checkout", "set", "lib");
  assert.equal(existsSync(join(dir, "src")), false, "the fixture left src out of the tree");

  for (const dryRun of [true, false]) {
    await assert.rejects(() => runPin(dir, { dryRun }), /8 tracked files are outside this sparse checkout, and a pin records HEAD/, `dryRun ${dryRun}`);
  }
  assert.equal(existsSync(join(dir, PIN_PATH)), false);
  git("sparse-checkout", "disable");
  await runPin(dir);
  assert.equal(JSON.parse(readFileSync(join(dir, PIN_PATH), "utf8")).corpus, 12);
});

test("a sparse checkout that leaves out only what is not corpus still pins", async (t) => {
  // An unreadable file inside the cone (a case-fold twin on a folding
  // filesystem) with a docs-only path outside it refused a pin whose population
  // was the whole one.
  const dir = repo(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "docs", "readme.md"), "# docs\n");
  git("add", "-A");
  git("commit", "-qm", "docs");
  git("sparse-checkout", "set", "src");
  assert.equal(existsSync(join(dir, "docs")), false, "the fixture left docs out of the tree");
  const collectFiles = async (root) => {
    const r = await collect(root);
    return { ...r, dropped: { ...r.dropped, unreadable: r.dropped.unreadable + 1 } };
  };

  await runPin(dir, { collectFiles });
  assert.equal(JSON.parse(readFileSync(join(dir, PIN_PATH), "utf8")).corpus, 8);
});

test("a sparse checkout that leaves out only generated source still pins", async (t) => {
  // An absent file is unreadable before its generated attribute is asked, so it
  // tripped the sparse refusal while a full checkout drops it from the population.
  const dir = repo(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  mkdirSync(join(dir, "gen"));
  writeFileSync(join(dir, "gen", "api.ts"), "export const api = 1\n");
  writeFileSync(join(dir, ".gitattributes"), "gen/** linguist-generated\n");
  git("add", "-A");
  git("commit", "-qm", "gen");
  git("sparse-checkout", "set", "src");
  assert.equal(existsSync(join(dir, "gen")), false, "the fixture left gen out of the tree");

  await runPin(dir);
  assert.equal(JSON.parse(readFileSync(join(dir, PIN_PATH), "utf8")).corpus, 8);
});

test("a root .gitattributes the index hides from the tree is read from the index", async (t) => {
  // Sparse, skip-worktree and assume-unchanged all make git treat the tree's
  // copy as no change, so the population is the one a full checkout counts.
  const cases = [
    { name: "left out by a non-cone sparse checkout", attrs: "gen/** linguist-generated\n", corpus: 8,
      hide: (git) => git("sparse-checkout", "set", "--no-cone", "/src/", "/gen/") },
    { name: "left out, holding no generated rule", attrs: "* text=auto eol=lf\n", corpus: 12,
      hide: (git) => git("sparse-checkout", "set", "--no-cone", "/src/", "/gen/") },
    { name: "skip-worktree and edited", attrs: "gen/** linguist-generated\n", corpus: 8,
      hide: (git, dir) => { git("update-index", "--skip-worktree", ".gitattributes"); writeFileSync(join(dir, ".gitattributes"), "x\n"); } },
    { name: "assume-unchanged and deleted", attrs: "gen/** linguist-generated\n", corpus: 8,
      hide: (git, dir) => { git("update-index", "--assume-unchanged", ".gitattributes"); rmSync(join(dir, ".gitattributes")); } },
    { name: "assume-unchanged and edited", attrs: "gen/** linguist-generated\n", corpus: 8,
      hide: (git, dir) => { git("update-index", "--assume-unchanged", ".gitattributes"); writeFileSync(join(dir, ".gitattributes"), "x\n"); } },
  ];
  for (const c of cases) {
    const dir = repo(t);
    const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    mkdirSync(join(dir, "gen"));
    for (let i = 0; i < 4; i++) writeFileSync(join(dir, "gen", `g${i}.ts`), `export const g${i} = ${i}\n`);
    writeFileSync(join(dir, ".gitattributes"), c.attrs);
    git("add", "-A");
    git("commit", "-qm", "gen");
    c.hide(git, dir);
    assert.equal(git("status", "--porcelain").length, 0, `${c.name}: git calls the tree clean`);
    assert.notEqual(existsSync(join(dir, ".gitattributes")) && readFileSync(join(dir, ".gitattributes"), "utf8"), c.attrs, `${c.name}: the tree's copy differs`);

    assert.equal((await collect(dir)).files.length, c.corpus, `${c.name}: collect`);
    await runPin(dir);
    assert.equal(JSON.parse(readFileSync(join(dir, PIN_PATH), "utf8")).corpus, c.corpus, `${c.name}: pin`);
  }
});

test("a pin mid-merge says to finish the merge, not to stash what git will not stash", async (t) => {
  const dir = repo(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("checkout", "-q", "-b", "other");
  writeFileSync(join(dir, "src", "f0.ts"), "export const a0 = 2\n");
  git("commit", "-qam", "other");
  git("checkout", "-q", "-");
  writeFileSync(join(dir, "src", "f0.ts"), "export const a0 = 3\n");
  git("commit", "-qam", "here");
  assert.throws(() => git("merge", "-q", "other"), "the merge conflicts");

  for (const dryRun of [true, false]) {
    await assert.rejects(() => runPin(dir, { dryRun }), /^Error: a merge is in progress, and a pin records HEAD: finish or abort the merge first, then pin$/, `dryRun ${dryRun}`);
  }
});

test("a pin names the remedy for the operation that is in progress", async (t) => {
  // A stash pop conflicts with no merge to abort, and a merge with no conflict
  // is not one to stash, which drops the merge.
  const dir = repo(t);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("checkout", "-q", "-b", "other");
  writeFileSync(join(dir, "src", "f0.ts"), "export const a0 = 2\n");
  git("commit", "-qam", "other");
  git("checkout", "-q", "-");
  writeFileSync(join(dir, "src", "f0.ts"), "export const a0 = 3\n");
  git("stash", "-q");
  git("checkout", "-q", "other");
  assert.throws(() => git("stash", "pop"), "the pop conflicts");
  const leftBy = /^Error: the index holds unmerged paths, and a pin records HEAD: resolve them, or abort the operation that left them, then pin$/;
  await assert.rejects(() => runPin(dir), leftBy, "stash pop");

  git("checkout", "-q", "-f", "-");
  git("stash", "drop", "-q");
  writeFileSync(join(dir, "src", "g.ts"), "export const g = 1\n");
  git("add", "-A");
  git("commit", "-qm", "here");
  git("merge", "-q", "--no-commit", "--no-ff", "other");
  await assert.rejects(() => runPin(dir), /^Error: a merge is in progress, and a pin records HEAD: finish or abort the merge first, then pin$/);

  git("merge", "--abort");
  writeFileSync(join(dir, "src", "f0.ts"), "export const a0 = 3\n");
  git("commit", "-qam", "once");
  writeFileSync(join(dir, "src", "f0.ts"), "export const a0 = 4\n");
  git("commit", "-qam", "again");
  assert.throws(() => git("revert", "--no-edit", "HEAD~1"), "the revert conflicts");
  await assert.rejects(() => runPin(dir), leftBy, "revert");
});

test("a pin names the repository root it pinned, in its lines and its record", async (t) => {
  // A path argument does not scope the pin: `pin ./src` pins the whole
  // repository, and an inherited GIT_DIR another one entirely.
  const dir = realpathSync.native(repo(t));

  for (const dryRun of [true, false]) {
    const { summary } = await runPin(join(dir, "src"), { dryRun });
    assert.equal(summary.root, dir);
    assert.equal(pinLines(summary).at(-1 - (dryRun ? 0 : 2)), `${dryRun ? "would write" : "wrote"} ${PIN_PATH}, root ${dir}`);
    assert.equal(JSON.parse(pinJson(summary)).root, dir);
  }
});

test("a store that cannot be written is refused by name before a dry run says it would write", needsPosixPermissions, async (t) => {
  // The first write is the temp file's `open`, and its raw EACCES named a
  // random temp path after `--dry-run` had answered "would write".
  const dir = repo(t);
  await runScan(dir);
  const store = join(dir, ".claude", "anatomiya");
  const bare = repo(t);
  chmodSync(store, 0o555);
  chmodSync(bare, 0o555);
  try {
    for (const dryRun of [true, false]) {
      await assert.rejects(
        () => runPin(dir, { dryRun }),
        { message: ".claude/anatomiya is not writable, so no pin is written there: fix its permissions and pin again" },
        `pin, dryRun ${dryRun}`
      );
      await assert.rejects(
        () => runScan(dir, { dryRun }),
        { message: ".claude/anatomiya is not writable, so the map could not be written: fix its permissions and scan again" },
        `scan, dryRun ${dryRun}`
      );
    }
    // With no `.claude` yet, the directory it would be made in is the one asked.
    await assert.rejects(() => runScan(bare, { dryRun: true }), /^Error: the repository root is not writable, so the map could not be written/);
  } finally {
    chmodSync(store, 0o755);
    chmodSync(bare, 0o755);
  }
});

test("a store that cannot be entered is refused by name before a dry run says it would write", needsPosixPermissions, async (t) => {
  // Writable without search permission passes a write check, and the temp
  // file's `open` inside it still fails.
  const dir = repo(t);
  await runScan(dir);
  const claude = join(dir, ".claude");
  const store = join(claude, "anatomiya");
  for (const [at, name] of [[store, ".claude/anatomiya"], [claude, ".claude"]]) {
    chmodSync(at, 0o666);
    try {
      for (const dryRun of [true, false]) {
        await assert.rejects(
          () => runPin(dir, { dryRun }),
          { message: `${name} cannot be entered, so no pin is written there: fix its permissions and pin again` },
          `pin ${name}, dryRun ${dryRun}`
        );
        await assert.rejects(
          () => runScan(dir, { dryRun }),
          { message: `${name} cannot be entered, so the map could not be written: fix its permissions and scan again` },
          `scan ${name}, dryRun ${dryRun}`
        );
      }
    } finally {
      chmodSync(at, 0o755);
    }
  }
});

test("a scan over a pin that conflicted on a merge says the pin would not load", async (t) => {
  // The pin is committed, so a merge can leave markers in it. The scan printed
  // "no baseline pinned" and pointed at `anatomiya pin`, over a pin a human had
  // accepted and a conflict nobody had been told about.
  const dir = repo(t);
  await runPin(dir);
  const path = join(dir, PIN_PATH);
  const text = readFileSync(path, "utf8");
  writeFileSync(path, `<<<<<<< HEAD\n${text}=======\n${text}>>>>>>> other\n`);

  const { summary } = await runScan(dir, { dryRun: true });
  const lines = scanLines(summary);

  assert.ok(lines.some((l) => l.startsWith("the pin on disk could not be read because it does not parse as JSON")), lines.join("\n"));
});

test("a pin over one this build cannot read says it is replacing it, not pinning for the first time", async (t) => {
  // A pin a newer build wrote read as no pin at all, so the delta printed
  // "baseline pinned at", the first pin's wording, and the write replaced the
  // newer file with nothing on screen saying there had been one.
  const dir = repo(t);
  await runPin(dir);
  const path = join(dir, PIN_PATH);
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), schema: 2 }));

  for (const [dryRun, verb] of [[true, "would replace"], [false, "replaced"]]) {
    const { summary } = await runPin(dir, { dryRun });
    assert.ok(
      pinLines(summary).includes(
        `the pin on disk could not be read because it is schema 2 and this build reads 1, so nothing was compared against it and this ${verb} it`
      ),
      pinLines(summary).join("\n")
    );
    if (dryRun) continue;
    // Pinned over, the file reads again, and the next pin compares against it.
    const { summary: again } = await runPin(dir, { dryRun: true });
    assert.equal(again.previousUnreadable, null);
  }
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
  const treeSitter = lines.filter((l) => l.startsWith("tree-sitter "));
  assert.equal(treeSitter.length, 1, "one line for the engine and its grammars together");
  assert.match(treeSitter[0], /^tree-sitter \d+\.\d+\.\d+ ok \(grammars: 7 of 7\)$/);
});

test("a doctor run inside a repository says which other targets are on there, and why one could not be read", needsSymlinks, async (t) => {
  const dir = repo(t);
  const engines = (await runDoctor()).lines;
  assert.deepEqual((await runDoctor({ cwd: dir })).lines, engines, "nothing for a target that is off");
  symlinkSync(join(dir, "src"), join(dir, ".cursor"));
  assert.deepEqual((await runDoctor({ cwd: dir })).lines, engines, "nor for one nobody can read that no scan here wrote to");
  rmSync(join(dir, ".cursor"));

  await runScan(dir, { targets: ["claude", "cursor", "copilot"] });
  rmSync(join(dir, ".github"), { recursive: true });
  symlinkSync(join(dir, "src"), join(dir, ".github"));

  const { lines } = await runDoctor({ cwd: join(dir, "src") });

  assert.deepEqual(lines.slice(engines.length), [
    ".cursor/rules: on, 2 files",
    ".github/instructions: could not be read (.github is a link)",
  ]);
});

test("a doctor counts the names a scan gives a file, and says when the directory cannot be listed", needsPosixPermissions, async (t) => {
  const dir = repo(t);
  const engines = (await runDoctor()).lines;
  await runScan(dir, { targets: ["claude", "cursor"] });
  const rules = join(dir, ".cursor", "rules");
  // A copy somebody kept: this tool's key, under a name no scan gives a file.
  writeFileSync(join(rules, "anatomiya-my-notes.mdc"), readFileSync(join(rules, "anatomiya-overview.mdc")));

  assert.deepEqual((await runDoctor({ cwd: dir })).lines.slice(engines.length), [".cursor/rules: on, 2 files"]);

  // Entered and not listed: the overview still reads as this tool's.
  chmodSync(rules, 0o311);
  try {
    assert.deepEqual((await runDoctor({ cwd: dir })).lines.slice(engines.length), [".cursor/rules: on, could not be listed"]);
  } finally {
    chmodSync(rules, 0o755);
  }
});

test("a doctor counts a target's files where the clone holds them and no record", async (t) => {
  const dir = repo(t);
  const engines = (await runDoctor()).lines;
  await runScan(dir, { targets: ["claude", "cursor"] });
  rmSync(join(dir, ".claude", "anatomiya"), { recursive: true });

  assert.deepEqual((await runDoctor({ cwd: dir })).lines.slice(engines.length), [".cursor/rules: on, 2 files"]);
});

test("a doctor run outside any repository answers about the installation alone", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-commands-none-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.deepEqual((await runDoctor({ cwd: dir })).lines, (await runDoctor()).lines);
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
  assert.doesNotMatch(output, /anatomiya:scan/, "nothing changed, so nothing to scan again for");
});

test("a dry run answers the exact command and runs nothing", async (t) => {
  // `--ignore-scripts` is the load-bearing one: without it a dependency's
  // install script runs arbitrary code in the plugin directory. And
  // `--include=optional`, because oxc's native binding is an optional
  // dependency: an npm configured with `optional=false` left it out, answered
  // "up to date", and the parser never loaded. Asked of a copy with nothing
  // installed, since a dry run with nothing to do names no command to run.
  const home = installWithoutDependencies(t);
  const { runSetup: fromCopy } = await import(pathToFileURL(join(home, "lib", "commands.mjs")).href);

  const { command, ran, ok, output } = await fromCopy({ dryRun: true });

  assert.deepEqual(command, ["npm", "install", "--omit=dev", "--include=optional", "--ignore-scripts", "--no-audit", "--no-fund"]);
  assert.equal(ran, false);
  assert.equal(ok, true);
  assert.match(output, /would run npm install --omit=dev --include=optional --ignore-scripts --no-audit --no-fund in /, output);
  assert.ok(output.includes(realpathSync(home)), `and it says which directory that is: ${output}`);
});

test("a dry run with nothing to install says so and names no command", needsEverything, async () => {
  // Measured: "nothing to install: oxc 0.x, ..." and then "would run npm
  // install ...", two lines that contradict each other about the same install.
  const { ran, ok, output } = await runSetup({ dryRun: true });

  assert.equal(ran, false);
  assert.equal(ok, true);
  assert.match(output, /^nothing to install: oxc \d/, output);
  assert.doesNotMatch(output, /would run/, output);
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
  assert.deepEqual(needed, ["oxc", "flow-remove-types", "tree-sitter", "typescript"], "the copy has no node_modules, so there is something to install");
  assert.match(output, /npm install --omit=dev --include=optional --ignore-scripts --no-audit --no-fund/, output);
  // Compared as the same directory rather than as the same string: node
  // resolves a module's own path, so `pluginRoot()` answers the realpath while
  // the fixture holds what `mkdtemp` returned. They share a suffix on macOS
  // only because `/private` is a pure prefix.
  assert.ok(output.includes(realpathSync(home)), `it names the directory to run it in: ${output}`);
});

test("a Windows machine with everything installed is told that, not the refusal", needsEverything, async () => {
  // The refusal sits after the two short-circuits: it is about an install that
  // has to happen, and a dry run with nothing to install has nothing to hand over.
  const done = await runSetup({ platform: "win32" });
  const dry = await runSetup({ platform: "win32", dryRun: true });

  assert.equal(done.ok, true);
  assert.match(done.output, /^nothing to install: oxc \d/, done.output);
  assert.equal(dry.ok, true);
  assert.match(dry.output, /^nothing to install: oxc \d/, dry.output);
  assert.doesNotMatch(dry.output, /would run/, dry.output);
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
