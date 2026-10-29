// test/ab.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rankAreas } from "../scripts/ab/pick.mjs";
import { scoreFile } from "../scripts/ab/score.mjs";
import { readingFor } from "../scripts/ab/read.mjs";
import { repoLabel } from "../scripts/ab/label.mjs";
import { needsPathControl, needsPosixPermissions, needsShebang, needsSymlinks, removeTree } from "./platform.mjs";
import { measurable, PROBE_ANSWER, stubClaude } from "./ab-fixtures.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A stub that records how it was called. */
const reporting = (base) =>
  [`printf '%s\\n' "$@" > ${JSON.stringify(join(base, "argv.txt"))}`, `env > ${JSON.stringify(join(base, "env.txt"))}`].join("\n");

/** A stub that answers in the shape `--output-format json` produces. */
const answering = (body) => () => `cat <<'JSON'\n${body}\nJSON`;

test("a trial reports the engine that ran, not the one it asked for", needsShebang, async (t) => {
  // The whole change exists to stop a measurement recording a request nothing
  // honoured. Recording the flags it passed is that same mistake one level up:
  // the CLI reports what it actually ran under `modelUsage`, window and all.
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, answering(JSON.stringify({
    is_error: false,
    result: "the answer\nlast line",
    modelUsage: {
      "claude-haiku-4-5-20251001": { contextWindow: 200000 },
      "claude-opus-5[1m]": { contextWindow: 1000000, canonicalModel: "claude-opus-5" },
    },
  })));

  const r = await runTrial(stub.arm, "go", { env: { PATH: stub.path } });

  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.ran, { model: "claude-opus-5[1m]", contextWindow: 1000000 });
  assert.equal(r.stdout, "the answer\nlast line", "and the text stays the text, so the probe still reads its last line");
});

test("a trial whose answer is not the shape expected still counts its files", needsShebang, async (t) => {
  // A build that changes the result shape, or a crash mid-write, must not take
  // the trial down with it: the files on disk are what the measurement counts.
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, answering("not json at all"));

  const r = await runTrial(stub.arm, "go", { env: { PATH: stub.path } });

  assert.equal(r.ok, true, r.reason);
  assert.equal(r.ran, null);
  assert.equal(r.stdout.trim(), "not json at all", "the raw answer is kept rather than lost");
});

test("a run with no model usage reports none rather than guessing", needsShebang, async (t) => {
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, answering(JSON.stringify({ is_error: true, result: "no", modelUsage: {} })));

  assert.equal((await runTrial(stub.arm, "go", { env: { PATH: stub.path } })).ran, null);
});

test("a trial is handed its tools and no others, the arm's own settings and the plugin under test", needsShebang, async (t) => {
  // `--allowedTools` only pre-approves: Bash stayed available and ran `cat` on
  // whatever it was pointed at, which is how arm B reaches a rule file. Without
  // a settings-source list a trial also read the operator's own CLAUDE.md,
  // plugins and MCP servers, so two machines ran two experiments.
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, reporting);

  await runTrial(stub.arm, "write a file", { env: { PATH: stub.path } });
  const argv = stub.argv();
  const after = (flag) => argv[argv.indexOf(flag) + 1];

  assert.equal(after("--tools"), "Read,Write,Glob,Grep");
  assert.equal(after("--allowedTools"), "Read,Write,Glob,Grep", "and still approved, so none of them prompts");
  assert.ok(argv.includes("--strict-mcp-config"), argv.join(" "));
  assert.equal(after("--setting-sources"), "project,local", "the project source is where the map is read from");
  const { ANATOMIYA } = await import("../scripts/plugins.mjs");
  assert.equal(after("--plugin-dir"), ANATOMIYA, "the user's plugins go with the user source, so this one is named");

  await runTrial(stub.arm, "probe", { env: { PATH: stub.path }, tools: ["Read"] });
  assert.equal(stub.argv()[stub.argv().indexOf("--tools") + 1], "Read", "the probe gets Read and nothing else");
});

test("a trial that ends early says why without repeating its command line", needsShebang, async (t) => {
  // Node's own message is "Command failed:" and the whole argv, the prompt and
  // the plugin's path on this machine among it, and the reason reaches a
  // committed record of the run.
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const capped = stubClaude(t, () => `echo '{"subtype":"error_max_turns","result":""}'\nexit 1`);
  const crashed = stubClaude(t, () => "echo 'the build said no' >&2\nexit 3");

  const r = await runTrial(capped.arm, "a prompt that must not be echoed", { env: { PATH: capped.path } });
  const c = await runTrial(crashed.arm, "a prompt that must not be echoed", { env: { PATH: crashed.path } });

  assert.equal(r.ok, false);
  assert.equal(r.reason, "exited 1: error_max_turns");
  assert.equal(c.reason, "exited 3: the build said no");
  for (const reason of [r.reason, c.reason]) assert.ok(!reason.includes("must not be echoed"), reason);
});

test("a trial's work is what git would show it changed, never what git ignores", needsShebang, async (t) => {
  // Measured on a Rails clone: a trial that ran the app left 4,360 bootsnap
  // cache files under tmp/ and a log, all ignored, beside the two files it wrote.
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, () => "mkdir -p tmp/cache src\necho x > tmp/cache/one\necho x > log.txt\necho 'export const a = 1;' > src/a.ts\necho '{}'");
  const git = (...a) => execFileSync("git", a, { cwd: stub.arm, stdio: "pipe" });
  git("init", "-q");
  writeFileSync(join(stub.arm, ".gitignore"), "tmp/\n*.txt\n");

  const r = await runTrial(stub.arm, "go", { env: { PATH: stub.path } });

  assert.deepEqual(r.wrote.map((f) => f.rel).sort(), ["src/a.ts"]);
});

test("a link whose target is missing neither stops a trial nor counts as its work", { ...needsShebang, ...needsPosixPermissions }, async (t) => {
  // Measured on a mastodon clone: `public/500.html` links to a compiled page
  // that is not built, and following it threw ENOENT before the first trial.
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, () => "mkdir -p src\necho 'export const a = 1;' > src/a.ts\necho '{}'");
  symlinkSync(join(stub.arm, "nowhere.html"), join(stub.arm, "500.html"));

  const r = await runTrial(stub.arm, "go", { env: { PATH: stub.path } });

  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.wrote.map((f) => f.rel), ["src/a.ts"]);
});

test("a trial run without the plugin names no plugin directory", needsShebang, async (t) => {
  // The scenario arm B is a session with no plugin at all, so its hooks are
  // gone with the map, and nothing else on the command line may differ.
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, reporting);

  await runTrial(stub.arm, "write a file", { env: { PATH: stub.path }, pluginDir: null });

  assert.ok(!stub.argv().includes("--plugin-dir"), stub.argv().join(" "));
  assert.ok(stub.argv().includes("--strict-mcp-config"), "the rest of the isolation stays");
});

test("a trial reports what it cost as the CLI counted it, and null where the answer says nothing", needsShebang, async (t) => {
  // Every model the run used is summed, the plugin's subagent included, since
  // that is what the user pays for a session.
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, answering(JSON.stringify({
    result: "done",
    total_cost_usd: 0.42,
    modelUsage: {
      "claude-opus-5[1m]": { contextWindow: 1000000, inputTokens: 100, outputTokens: 900, cacheReadInputTokens: 5000 },
      "claude-haiku-4-5-20251001": { contextWindow: 200000, inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0 },
    },
  })));

  const r = await runTrial(stub.arm, "go", { env: { PATH: stub.path } });

  const { wallMs, ...counted } = r.spent;
  assert.deepEqual(counted, { costUsd: 0.42, inputTokens: 110, outputTokens: 920, cacheReadTokens: 5000 });
  assert.ok(Number.isFinite(wallMs), "the wall clock is the harness's own");

  const bare = stubClaude(t, answering(JSON.stringify({ result: "done" })));
  const { wallMs: _, ...none } = (await runTrial(bare.arm, "go", { env: { PATH: bare.path } })).spent;
  assert.deepEqual(none, { costUsd: null, inputTokens: null, outputTokens: null, cacheReadTokens: null });
});

test("a trial's time is the harness's own clock, never the CLI's duration_ms", needsShebang, async (t) => {
  // Measured on 2.1.310: a session that waited on a background task for 25 s
  // reported duration_ms 1557 and num_turns 1, which cover only the stretch
  // after the last notification, while its cost and tokens cover the session.
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, () => `sleep 1\necho '{"result":"done","duration_ms":3,"num_turns":1,"total_cost_usd":0.01}'`);

  const r = await runTrial(stub.arm, "go", { env: { PATH: stub.path } });

  assert.ok(r.spent.wallMs >= 900, `wallMs ${r.spent.wallMs}`);
  assert.ok(!("durationMs" in r.spent) && !("turns" in r.spent), "a field that covers part of a session is not recorded as the session's");
});

/** A committed repository holding a settings file, with an untracked map beside it. */
function armSource(t) {
  const repo = mkdtempSync(join(tmpdir(), "anatomiya-ab-arms-"));
  t.after(() => removeTree(repo));
  const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: "pipe" });
  git("init", "-q");
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(repo, ".claude", "settings.json"), '{"env":{"CLAUDE_CODE_EFFORT_LEVEL":"xhigh"}}\n');
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t.test", "commit", "-qm", "init");
  mkdirSync(join(repo, ".claude", "rules"));
  writeFileSync(join(repo, ".claude", "rules", "anatomiya-area-0a1b2c3d.md"), "# the map\n");
  return { repo, sha: git("rev-parse", "HEAD").trim() };
}

test("every trial starts from the commit, the map in arm A and nothing in arm B", async (t) => {
  // The arms were built once and never reset, so trial 2 found trial 1's file
  // already there, wrote nothing and was dropped.
  const { buildArms } = await import("../scripts/ab/arms.mjs");
  const { repo, sha } = armSource(t);
  const arms = await buildArms(repo, sha);
  t.after(() => arms.dispose());

  const state = (arm) => ({
    written: existsSync(join(arm, "src", "New.ts")),
    source: readFileSync(join(arm, "src", "a.ts"), "utf8"),
    settings: existsSync(join(arm, ".claude", "settings.json")),
    map: existsSync(join(arm, ".claude", "rules", "anatomiya-area-0a1b2c3d.md")),
  });
  const clean = (map) => ({ written: false, source: "export const a = 1;\n", settings: false, map });
  assert.deepEqual([state(arms.a), state(arms.b)], [clean(true), clean(false)], "as built");

  for (const arm of [arms.a, arms.b]) {
    writeFileSync(join(arm, "src", "New.ts"), "export const x = 1;\n");
    writeFileSync(join(arm, "src", "a.ts"), "export const a = 2;\n");
    mkdirSync(join(arm, ".claude", "rules"), { recursive: true });
    writeFileSync(join(arm, ".claude", "rules", "anatomiya-area-0a1b2c3d.md"), "# a trial's own\n");
  }
  await arms.reset();

  assert.deepEqual([state(arms.a), state(arms.b)], [clean(true), clean(false)], "after a trial wrote in both");
  assert.equal(readFileSync(join(arms.a, ".claude", "rules", "anatomiya-area-0a1b2c3d.md"), "utf8"), "# the map\n");
});

test("the harness resets both arms before every trial it runs", needsShebang, async (t) => {
  // A stand-in for the model that writes the file only when it is not there,
  // as the real one did: an arm carried over from the last trial writes nothing.
  const { buildArms } = await import("../scripts/ab/arms.mjs");
  const { runTrials } = await import("../scripts/ab.mjs");
  const { repo, sha } = armSource(t);
  const arms = await buildArms(repo, sha);
  t.after(() => arms.dispose());
  const stub = stubClaude(t, () => "[ -e src/New.ts ] || echo 'export const x = 1;' > src/New.ts\necho '{}'");

  const trials = await runTrials(arms, "Create src/New.ts", { env: { PATH: stub.path } }, 3, () => {});

  assert.deepEqual([...trials.a, ...trials.b].map((r) => r.wrote.map((f) => f.rel)), Array(6).fill(["src/New.ts"]));
});

test("a trial that finishes and writes nothing is logged with its answer as the reason", needsShebang, async (t) => {
  // The only trace of such a trial was a lower "trials that wrote a file"
  // count, while its answer said why.
  const { runTrials } = await import("../scripts/ab.mjs");
  const stub = stubClaude(t, () => `printf '%s' '{"result":"  The file already exists\\n\\tsecond line"}'`);
  const arms = { a: stub.arm, b: stub.arm, reset: async () => {} };
  const lines = [];

  const trials = await runTrials(arms, "Create src/New.ts", { env: { PATH: stub.path } }, 1, (l) => lines.push(l));

  const reason = 'answered "The file already exists"';
  assert.deepEqual([trials.a[0].reason, trials.b[0].reason], [reason, reason]);
  assert.deepEqual(lines, [`  trial 1 arm a: 0 file(s), wrote nothing: ${reason}`, `  trial 1 arm b: 0 file(s), wrote nothing: ${reason}`]);
});

test("each arm sits alone at the same leaf name, so neither can tell it is an arm or find the other", async (t) => {
  // An agent with a shell sees its working directory: "no-map" beside
  // "with-map" told it which arm it was in and where the other arm's map lay.
  const { buildArms } = await import("../scripts/ab/arms.mjs");
  const { repo, sha } = armSource(t);
  const arms = await buildArms(repo, sha, { name: "rubocop" });
  t.after(() => arms.dispose());

  assert.equal(basename(arms.a), "rubocop");
  assert.equal(basename(arms.b), "rubocop");
  assert.notEqual(dirname(arms.a), dirname(arms.b));
  assert.deepEqual(readdirSync(dirname(arms.b)), ["rubocop"], "nothing beside arm B names arm A");

  await arms.dispose();
  assert.ok(!existsSync(dirname(arms.a)) && !existsSync(dirname(arms.b)), "dispose removes both");
});

test("the map reaches arm A through a rules directory the repository links elsewhere", needsSymlinks, async (t) => {
  // cal.diy tracks .claude/rules as a link to agents/rules: the scan writes through
  // it, and copying the directory onto arm A's link refused the whole run.
  const { buildArms } = await import("../scripts/ab/arms.mjs");
  const { git, scratch } = await import("./git-worktrees.mjs");
  const repo = scratch(t, "anatomiya-ab-linked-");
  mkdirSync(join(repo, "agents", "rules"), { recursive: true });
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, "agents", "rules", "team.md"), "# the team's own rule\n");
  symlinkSync(join("..", "agents", "rules"), join(repo, ".claude", "rules"));
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  writeFileSync(join(repo, "agents", "rules", "anatomiya-area-0a1b2c3d.md"), "# the map\n");
  writeFileSync(join(repo, "agents", "rules", "draft.md"), "# somebody's draft, not in the commit\n");
  writeFileSync(join(repo, "agents", "rules", "anatomiya-notes.md"), "# a note with the prefix, not a map file\n");
  mkdirSync(join(repo, "agents", "rules", "anatomiya-area-11111111.md"));
  const sha = git(repo, "rev-parse", "HEAD").toString().trim();

  const arms = await buildArms(repo, sha);
  t.after(() => arms.dispose());

  assert.equal(readFileSync(join(arms.a, ".claude", "rules", "anatomiya-area-0a1b2c3d.md"), "utf8"), "# the map\n");
  assert.equal(existsSync(join(arms.a, ".claude", "rules", "draft.md")), false, "only the map is copied");
  assert.equal(existsSync(join(arms.a, ".claude", "rules", "anatomiya-notes.md")), false, "a prefixed name the scan never writes stays put");
  assert.equal(existsSync(join(arms.a, ".claude", "rules", "anatomiya-area-11111111.md")), false, "a directory with a map's name is not copied");
  assert.equal(existsSync(join(arms.b, ".claude", "rules", "anatomiya-area-0a1b2c3d.md")), false);
  assert.equal(readFileSync(join(arms.b, ".claude", "rules", "team.md"), "utf8"), "# the team's own rule\n");
});

test("an arm whose rules link leads nowhere fails the build, so a map is never skipped in silence", needsSymlinks, async (t) => {
  const { buildArms } = await import("../scripts/ab/arms.mjs");
  const { git, scratch } = await import("./git-worktrees.mjs");
  const repo = scratch(t, "anatomiya-ab-dangling-");
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, "a.txt"), "a\n");
  symlinkSync(join("..", "agents", "rules"), join(repo, ".claude", "rules"));
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  // The source's link leads to a folder the commit does not hold, so only the source has it.
  mkdirSync(join(repo, "agents", "rules"), { recursive: true });
  writeFileSync(join(repo, "agents", "rules", "anatomiya-area-0a1b2c3d.md"), "# the map\n");
  const sha = git(repo, "rev-parse", "HEAD").toString().trim();

  await assert.rejects(buildArms(repo, sha), /could not install the map in the with-map arm/);
});

test("an arm keeps no path back to the checkout it was cloned from", async (t) => {
  // The source checkout holds the scanned map. A shared clone's alternates file
  // and its origin both named that checkout, and an agent with a shell in the
  // arm without the plugin could follow either to the map.
  const { buildArms } = await import("../scripts/ab/arms.mjs");
  const { repo, sha } = armSource(t);
  const arms = await buildArms(repo, sha);
  t.after(() => arms.dispose());

  for (const arm of [arms.a, arms.b]) {
    assert.equal(execFileSync("git", ["remote"], { cwd: arm, encoding: "utf8" }).trim(), "", `${arm} names a remote`);
    assert.ok(!existsSync(join(arm, ".git", "objects", "info", "alternates")), `${arm} borrows the source's objects`);
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: arm, encoding: "utf8" }).trim(), sha);
    // A clone's reflog opens with "clone: from <source>".
    const naming = filesUnder(join(arm, ".git")).filter((f) => readFileSync(f, "latin1").includes(basename(repo)));
    assert.deepEqual(naming, [], `${arm} names its source`);
  }
});

const filesUnder = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));

test("gh starts logged out in a trial", needsShebang, async (t) => {
  // A rubocop session ran `gh api user` to credit its changelog entry, so the
  // operator's own login was in reach of an agent with a shell.
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, reporting);
  const operatorGh = mkdtempSync(join(tmpdir(), "anatomiya-gh-"));
  t.after(() => removeTree(operatorGh));

  await runTrial(stub.arm, "write a file", {
    env: { PATH: stub.path, GH_TOKEN: "x", GITHUB_TOKEN: "x", GH_ENTERPRISE_TOKEN: "x", GITHUB_ENTERPRISE_TOKEN: "x", GH_CONFIG_DIR: operatorGh },
  });

  const env = stub.env();
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"]) assert.equal(env.has(name), false, name);
  const given = env.get("GH_CONFIG_DIR");
  assert.ok(given && given !== operatorGh, "gh is pointed away from the operator's config");
  assert.throws(() => mkdirSync(given, { recursive: true }), "and at a directory nothing can create");
});

test("a trial in a directory inside another repository still counts the tracked file it changed", needsShebang, async (t) => {
  // From a subdirectory, ls-tree names paths from there and diff names them
  // from the top, so an edit read through both looked unchanged.
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, (base) => `sleep 0.05; echo new > "${join(base, "arm", "x.txt")}"`);
  const top = dirname(stub.arm);
  const git = (...a) => execFileSync("git", a, { cwd: top, stdio: "pipe" });
  writeFileSync(join(stub.arm, "x.txt"), "old\n");
  git("init", "-q");
  git("add", "arm");
  git("-c", "user.name=t", "-c", "user.email=t@t.test", "commit", "-qm", "init");

  const r = await runTrial(stub.arm, "write a file", { env: { PATH: stub.path } });

  assert.deepEqual(r.wrote.map((f) => f.rel), ["x.txt"]);
});

test("a tracked file a trial rewrote with the same bytes is not counted as written", needsShebang, async (t) => {
  // A docs task regenerated eight pages it left unchanged, and all eight were
  // listed as the trial's work.
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, (base) => `sleep 0.05; cp "${join(base, "arm", "same.txt")}" "${join(base, "arm", "same.tmp")}"; mv "${join(base, "arm", "same.tmp")}" "${join(base, "arm", "same.txt")}"; echo new > "${join(base, "arm", "changed.txt")}"; echo b > "${join(base, "arm", "made.txt")}"`);
  const git = (...a) => execFileSync("git", a, { cwd: stub.arm, stdio: "pipe" });
  writeFileSync(join(stub.arm, "same.txt"), "same\n");
  writeFileSync(join(stub.arm, "changed.txt"), "old\n");
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t.test", "commit", "-qm", "init");

  const r = await runTrial(stub.arm, "write a file", { env: { PATH: stub.path } });

  assert.deepEqual(r.wrote.map((f) => f.rel).sort(), ["changed.txt", "made.txt"]);
});

test("a trial that commits its change is still counted as having written it", needsShebang, async (t) => {
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, (base) => `cd "${join(base, "arm")}" && sleep 0.05 && echo new > changed.txt && git add -A && git -c user.name=t -c user.email=t@t.test commit -qm work`);
  const git = (...a) => execFileSync("git", a, { cwd: stub.arm, stdio: "pipe" });
  writeFileSync(join(stub.arm, "changed.txt"), "old\n");
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t.test", "commit", "-qm", "init");

  const r = await runTrial(stub.arm, "write a file", { env: { PATH: stub.path } });

  assert.deepEqual(r.wrote.map((f) => f.rel), ["changed.txt"]);
});

test("an arm takes its leaf name from the repository when none is given", async (t) => {
  const { buildArms } = await import("../scripts/ab/arms.mjs");
  const { repo, sha } = armSource(t);
  const arms = await buildArms(repo, sha);
  t.after(() => arms.dispose());

  assert.equal(basename(arms.a), basename(repo));
  assert.equal(basename(arms.b), basename(repo));
});

test("what only one arm is run with reaches that arm's probe and trials and no other", needsShebang, async (t) => {
  // The scenario harness runs arm B without the plugin. Passed to both, the
  // plugin-off arm would be the only arm; passed to neither, there is no B.
  const { runTrials, verifyInjection } = await import("../scripts/ab.mjs");
  const base = mkdtempSync(join(tmpdir(), "anatomiya-ab-perarm-"));
  t.after(() => removeTree(base));
  const bin = join(base, "bin");
  mkdirSync(bin);
  const arms = { a: join(base, "a"), b: join(base, "b"), reset: async () => {} };
  for (const arm of [arms.a, arms.b]) mkdirSync(arm);
  // Each call is logged in the arm it ran in, and answers whether it was handed a plugin directory.
  writeFileSync(join(bin, "claude"), [
    "#!/bin/sh",
    'case " $* " in *" --plugin-dir "*) P=src/x;; *) P=NONE;; esac',
    'printf "%s\\n" "$*" >> calls.txt',
    `printf '{"result":"%s"}' "$P"`,
  ].join("\n") + "\n");
  chmodSync(join(bin, "claude"), 0o755);
  const env = { env: { PATH: [bin, "/usr/bin", "/bin"].join(":") } };
  const off = { b: { pluginDir: null } };

  const said = await verifyInjection(arms, "src/x/a.ts", "src/x", env, () => {}, off);
  await runTrials(arms, "write", env, 2, () => {}, off);

  assert.deepEqual(said, { a: "src/x", b: "NONE" });
  const calls = (arm) => readFileSync(join(arm, "calls.txt"), "utf8").trim().split("\n");
  assert.equal(calls(arms.a).length, 3);
  assert.ok(calls(arms.a).every((c) => c.includes("--plugin-dir")), calls(arms.a).join("\n"));
  assert.equal(calls(arms.b).length, 3);
  assert.ok(calls(arms.b).every((c) => !c.includes("--plugin-dir")), calls(arms.b).join("\n"));
});

test("an arm that answers wrongly stops the run before any trial", needsShebang, async (t) => {
  const { verifyInjection } = await import("../scripts/ab.mjs");
  const stub = stubClaude(t, answering('{"result":"src/x - 3 files"}'));
  const arms = { a: stub.arm, b: stub.arm };
  const env = { env: { PATH: stub.path } };

  await assert.rejects(verifyInjection(arms, "src/x/a.ts", "src/x", env, () => {}), /arm B received a map/);
  await assert.rejects(verifyInjection(arms, "src/x/a.ts", "lib", env, () => {}), /arm A did not receive the map/);
});

test("neither arm is a linked worktree, so the hooks cannot hand arm B the main checkout's map", async (t) => {
  // Since the plugin answers a mapless linked worktree from its main checkout,
  // arm B built with `git worktree add` answered the probe with the map, and
  // every run aborted at step 4.
  const { buildArms } = await import("../scripts/ab/arms.mjs");
  const { mainCheckoutOf } = await import("../plugins/anatomiya/lib/worktree.mjs");
  const { repo, sha } = armSource(t);
  const arms = await buildArms(repo, sha);
  t.after(() => arms.dispose());

  assert.equal(mainCheckoutOf(arms.b), null);
  assert.equal(mainCheckoutOf(arms.a), null);
  const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repo, encoding: "utf8" });
  assert.equal(worktrees.split("\n").filter((l) => l.startsWith("worktree ")).length, 1, worktrees);
});

const facts = {
  areas: [
    {
      path: "app/services",
      fileCount: 40,
      dimensions: [
        { key: "service_result_shape", claim: "service entry points return their failure instead of raising",
          directive: true, states: "claim", candidates: 145, conforming: 140 },
      ],
    },
    {
      path: "app/models",
      fileCount: 128,
      dimensions: [
        { key: "zone_aware_time", claim: "the current time is read through the application time zone",
          directive: true, states: "claim", candidates: 200, conforming: 200 },
      ],
    },
    {
      path: "lib",
      fileCount: 24,
      dimensions: [
        { key: "nullish_default", claim: "defaults are taken with ??, not ||",
          directive: false, states: null, candidates: 116, conforming: 52 },
      ],
    },
  ],
};

test("a stated claim at 1.0 has no headroom and ranks last", () => {
  const ranked = rankAreas(facts, { minCandidates: 20 });
  assert.equal(ranked.at(-1).key, "zone_aware_time");
  assert.equal(ranked.at(-1).headroom, 0);
});

test("a stated claim below 1.0 ranks first", () => {
  const ranked = rankAreas(facts, { minCandidates: 20 });
  assert.equal(ranked[0].key, "service_result_shape");
  assert.ok(ranked[0].headroom > 0.03 && ranked[0].headroom < 0.04);
});

test("a suppressed dimension is not a candidate: the map never told the agent anything", () => {
  const ranked = rankAreas(facts, { minCandidates: 20 });
  assert.equal(ranked.some((r) => r.key === "nullish_default"), false);
});

test("a facts record whose every stated claim is perfect answers that there is no headroom", () => {
  const perfect = { areas: [facts.areas[1]] };
  const ranked = rankAreas(perfect, { minCandidates: 20 });
  assert.equal(ranked.filter((r) => r.headroom > 0).length, 0);
});

test("a claim with too few sites is dropped: one site is not a measurable arm", () => {
  const thin = { areas: [{ path: "x", fileCount: 3, dimensions: [
    { key: "k", claim: "c", directive: true, states: "claim", candidates: 4, conforming: 3 },
  ] }] };
  assert.deepEqual(rankAreas(thin, { minCandidates: 20 }), []);
});
// append to test/ab.test.mjs

test("a written file is scored by the dimension's own predicate, not by a grep", async () => {
  const conforming = `export function f() { try { a() } catch (e) { log(e) } }`;
  const violating = `export function f() { try { a() } catch (e) { } }`;

  const good = await scoreFile({ rel: "new.ts", source: conforming, lang: "js" }, { key: "swallowed_error" });
  const bad = await scoreFile({ rel: "new.ts", source: violating, lang: "js" }, { key: "swallowed_error" });

  assert.deepEqual(good, { candidates: 1, conforming: 1, ratio: 1 });
  assert.deepEqual(bad, { candidates: 1, conforming: 0, ratio: 0 });
});

test("the probe names the file verbatim, whatever characters the name carries", async () => {
  const { PROBE, probeFor } = await import("../scripts/ab/arms.mjs");
  // `$&` and `$'` are replacement patterns to a string replace, so a file named
  // with either used to reach the model spelled as the match or the text after it.
  assert.ok(probeFor("src/x/$&.mjs").includes("Read the file at src/x/$&.mjs."), probeFor("src/x/$&.mjs"));
  assert.equal(probeFor("src/x/a.mjs"), PROBE.replace("{file}", "src/x/a.mjs"));
});

test("an arm is summed by the predicate, and a trial that wrote nothing is not a trial", async () => {
  const { scoreArm } = await import("../scripts/ab/score.mjs");
  const conforming = `export function f() { try { a() } catch (e) { log(e) } }`;
  const violating = `export function f() { try { a() } catch (e) { } }`;
  const runs = [
    { ok: true, wrote: [{ rel: "a.ts", source: conforming }, { rel: "b.ts", source: violating }] },
    { ok: true, wrote: [{ rel: "c.ts", source: `export const a = 1` }] },
    { ok: true, wrote: [] },
    { ok: false, wrote: [{ rel: "d.ts", source: violating }] },
    { ok: false, wrote: [] },
  ];

  assert.deepEqual(await scoreArm(runs, { key: "swallowed_error" }), {
    wroteSomething: 3,
    filesScored: 3,
    candidates: 3,
    conforming: 1,
    trialsWithAViolation: 2,
    endedEarly: 2,
    wroteNothing: 1,
  });
});

test("a trial that hit the turn cap is scored on the files it left, and counted", async () => {
  // `claude -p` exits 1 on the turn cap after a successful Write. The map arm's
  // Stop hook spends turns the other arm does not, so dropping those trials
  // dropped them from one arm: 7 of 7 capped trials on two saved runs.
  const { scoreArm } = await import("../scripts/ab/score.mjs");
  const file = { rel: "src/Pill.ts", source: "export interface IPillProps { label: string }\nexport const x = 1;\n" };

  assert.deepEqual(await scoreArm([{ ok: false, wrote: [file] }], { key: "interface_prefix" }), {
    wroteSomething: 1,
    filesScored: 1,
    candidates: 1,
    conforming: 1,
    trialsWithAViolation: 0,
    endedEarly: 1,
    wroteNothing: 0,
  });
});

test("a file the dimension has nothing to say about scores null, not zero", async () => {
  // Zero and "the construct never appeared" are different outcomes, and folding
  // them puts a trial that wrote an unrelated file into the failing bucket.
  const r = await scoreFile({ rel: "new.ts", source: `export const a = 1`, lang: "js" }, { key: "swallowed_error" });
  assert.equal(r, null);
});

test("the claim text comes from the registry, since the record does not store it", () => {
  // facts.json stores counts, not sentences: a stored dimension carries key,
  // ratio and gate and no claim at all. Passing that straight through put the
  // word "undefined" in the result file where the claim belongs.
  const stored = {
    areas: [
      {
        path: "src/vs/workbench",
        fileCount: 52,
        dimensions: [{ key: "non_null_assertion", directive: true, states: "claim", candidates: 797, conforming: 736 }],
      },
    ],
  };

  const [top] = rankAreas(stored, { minCandidates: 20 });

  assert.equal(top.claim, "possibly-absent values are read with ?., not asserted with !");
});

test("a key the registry does not know says so instead of saying undefined", () => {
  const stored = {
    areas: [{ path: "x", fileCount: 9, dimensions: [{ key: "gone_away", directive: true, states: "claim", candidates: 40, conforming: 30 }] }],
  };

  const [top] = rankAreas(stored, { minCandidates: 20 });

  assert.equal(top.claim, "gone_away");
});

test("a result where both arms scored perfectly says so instead of leaving it to the reader", () => {
  // The first A/B ever run scored 10 of 10 in both arms and was written up as a
  // null result about the map. It was a null result about the task. A file that
  // does not say which of those it is invites the same mistake again.
  const both = readingFor({ a: { candidates: 15, conforming: 15 }, b: { candidates: 9, conforming: 9 } }, 0.077);
  assert.match(both, /both arms wrote conforming code every time/i);

  const moved = readingFor({ a: { candidates: 15, conforming: 15 }, b: { candidates: 9, conforming: 6 } }, 0.077);
  assert.doesNotMatch(moved, /both arms wrote conforming code every time/i);
  assert.match(moved, /1\.000 against 0\.667/);

  const nothing = readingFor({ a: { candidates: 0, conforming: 0 }, b: { candidates: 0, conforming: 0 } }, 0.077);
  assert.match(nothing, /neither arm wrote a site this claim counts/i);
});

test("equal ratios are not a difference, and a missing arm is not a loser", () => {
  // The committed result file is the artifact the experiment is quoted from.
  // It asserted "The arms differ: 0.900 against 0.900", and Number(null) is 0,
  // so an arm that wrote no countable site was declared the loser and the word
  // null landed in the doc.
  const equal = readingFor({ a: { candidates: 30, conforming: 27 }, b: { candidates: 30, conforming: 27 } }, 0.1);
  assert.doesNotMatch(equal, /arms differ/);
  assert.match(equal, /both arms scored 0\.900/i);

  const oneSided = readingFor({ a: { candidates: 0, conforming: 0 }, b: { candidates: 8, conforming: 7 } }, 0.1);
  assert.doesNotMatch(oneSided, /null/);
  assert.match(oneSided, /only one arm wrote a site this claim counts/i);

  // A real difference still reads as one.
  const moved = readingFor({ a: { candidates: 15, conforming: 15 }, b: { candidates: 9, conforming: 6 } }, 0.1);
  assert.match(moved, /1\.000 against 0\.667/);
});

test("the result file names the repository without a local path in it", () => {
  // The first one committed carried /Users/<name>/Documents/... into a public
  // repository, twice. A measurement is a document other people read; where the
  // clone happened to sit on the machine that ran it is not part of it.
  assert.equal(repoLabel("/Users/someone/Projects/corpus/microsoft__vscode", null), "microsoft__vscode");
  assert.equal(repoLabel("/home/ci/work/anatomiya", null), "anatomiya");
  assert.equal(repoLabel("C:\\Users\\someone\\repos\\thing", null), "thing");

  // An origin is the better name when there is one, and it identifies the
  // commit for a reader who wants to check the numbers.
  assert.equal(
    repoLabel("/Users/someone/corpus/vscode", "https://github.com/microsoft/vscode.git"),
    "github.com/microsoft/vscode"
  );
  assert.equal(repoLabel("/tmp/x", "git@github.com:microsoft/vscode.git"), "github.com/microsoft/vscode");

  // Whatever it answers, it never carries a home directory.
  for (const p of ["/Users/jdoe/x/y", "/home/jdoe/x/y", "C:\\Users\\jdoe\\x"]) {
    assert.doesNotMatch(repoLabel(p, null), /Users|home|jdoe/);
  }
});

test("a claim the model writes by default is not a candidate: the map no longer states it", async () => {
  const { rankAreas } = await import("../scripts/ab/pick.mjs");
  const facts = {
    areas: [{
      path: "src",
      dimensions: [
        { key: "module_state_const", states: "claim", directive: true, candidates: 80, conforming: 70, matchesDefault: true },
        { key: "swallowed_error", states: "claim", directive: true, candidates: 80, conforming: 70 },
      ],
    }],
  };
  const ranked = rankAreas(facts);
  assert.deepEqual(ranked.map((r) => r.key), ["swallowed_error"]);
});

test("a learned row is scored against the map's class, never the file's own vote", async () => {
  const src = "export const my_thing = 1;\nexport const other_thing = 2;\nexport function fooBar() {}\n";
  const self = await scoreFile({ rel: "t.ts", source: src, lang: "js" }, { key: "exported_symbol_case" });
  assert.equal(self.ratio, 2 / 3, "self-learning scores the file against its own plurality, which is the trap");
  const pinned = await scoreFile(
    { rel: "t.ts", source: src, lang: "js" },
    { key: "exported_symbol_case", learned: "camelCase" }
  );
  assert.deepEqual(pinned, { candidates: 3, conforming: 1, ratio: 1 / 3 });
});

test("the picker carries the learned class and the filled sentence", () => {
  const learnedFacts = {
    areas: [{
      path: "src",
      fileCount: 40,
      dimensions: [
        { key: "exported_symbol_case", states: "claim", directive: true, candidates: 300, conforming: 280, learned: "PascalCase" },
      ],
    }],
  };
  const [top] = rankAreas(learnedFacts);
  assert.equal(top.learned, "PascalCase");
  assert.equal(top.claim, "exported names are PascalCase");
});

test("a filename target is scored by the name the trial chose", async () => {
  const s = await scoreFile(
    { rel: "src/orderList.ts", source: "export const a = 1;\n", lang: "js" },
    { key: "file_naming_case", learned: "kebab-case" }
  );
  assert.deepEqual(s, { candidates: 1, conforming: 0, ratio: 0 });
  const t = await scoreFile(
    { rel: "src/order-list.ts", source: "export const a = 1;\n", lang: "js" },
    { key: "file_naming_case", learned: "kebab-case" }
  );
  assert.deepEqual(t, { candidates: 1, conforming: 1, ratio: 1 });
});

test("a narrowed naming row scores only the kind of file it learned over", async () => {
  // "files here that hold JSX are named PascalCase" says nothing about a helper
  // with no JSX, and the map and the check both leave one out. Scoring every
  // written file put a violation in the harness that neither of them sees.
  const helper = { rel: "src/currencyFormat.js", lang: "js", source: "export const currencyFormat = (n) => n;\n" };
  const component = { rel: "src/priceTag.jsx", lang: "jsx", source: "export default function priceTag() { return <div/>; }\n" };
  const row = { key: "file_naming_case", learned: "PascalCase", learnedKind: "jsx" };

  assert.equal(await scoreFile(helper, row), null);
  assert.deepEqual(await scoreFile(component, row), { candidates: 1, conforming: 0, ratio: 0 });
  assert.equal(
    await scoreFile(helper, { key: "exported_symbol_case", learned: "PascalCase", learnedKind: "jsx" }),
    null,
    "and the other rows split the same way"
  );
  assert.deepEqual(await scoreFile(helper, { key: "file_naming_case", learned: "PascalCase" }), { candidates: 1, conforming: 0, ratio: 0 }, "a row with no kind scores every file");
});

test("the harness scores both arms over the kind the target learned over", async () => {
  const { scoreTrials } = await import("../scripts/ab.mjs");
  const wrote = [{ rel: "src/currencyFormat.js", source: "export const currencyFormat = (n) => n;\n" }];
  const target = { key: "file_naming_case", learned: "PascalCase", learnedKind: "jsx" };

  const scored = await scoreTrials({ a: [{ ok: true, wrote }], b: [{ ok: true, wrote }] }, target, []);

  assert.deepEqual([scored.a.filesScored, scored.b.filesScored], [0, 0], "a helper with no JSX says nothing about a JSX row");
});

test("the picker carries the kind a naming row learned over", () => {
  const [top] = rankAreas({
    areas: [{ path: "src", dimensions: [
      { key: "file_naming_case", states: "claim", candidates: 40, conforming: 30, learned: "PascalCase", learnedKind: "jsx" },
    ] }],
  });
  assert.equal(top.learnedKind, "jsx");
});

test("a refusal to measure says which rule fired, with the numbers", async () => {
  // It said "every stated claim in this repository is at 1.00" for a best claim
  // at 0.988, which a lower --min-headroom would have measured.
  const { noHeadroom } = await import("../scripts/ab/pick.mjs");
  const best = { key: "interface_prefix", path: "src/components", ratio: 247 / 250, headroom: 3 / 250 };

  assert.equal(noHeadroom({ ...best, headroom: 0.06 }, { minHeadroom: 0.05 }), null);
  assert.equal(
    noHeadroom(best, { minHeadroom: 0.05 }),
    "no stated claim has headroom of at least 0.05: the best is interface_prefix in src/components at 0.988, headroom 0.012. Lower --min-headroom to measure it, or pick another repository"
  );
  assert.equal(
    noHeadroom({ ...best, ratio: 1, headroom: 0 }, { minHeadroom: 0.05 }),
    "every stated claim is at 1.00, so an A/B here can only measure a ceiling: pick another repository"
  );
  assert.equal(
    noHeadroom(undefined, { minHeadroom: 0.05, key: "k", area: "src/x" }),
    "no stated claim matching --key k and --area src/x has 20 sites or more that the model does not already write by default"
  );
  assert.match(noHeadroom(best, { minHeadroom: 0.05, key: "interface_prefix" }), /^no stated claim matching --key interface_prefix has headroom/);
});

test("the harness runs one engine: Opus 5 with the 1M window, at medium", async () => {
  // A trial that states its model and inherits its effort is two variables, not
  // one, and the arms are only comparable when both are pinned.
  const { ENGINE } = await import("../scripts/ab/engine.mjs");

  assert.deepEqual(ENGINE, { model: "claude-opus-5[1m]", effort: "medium" });
});

test("an effort the CLI does not accept is refused before the first trial, not after the last", async () => {
  // The alternative is 30 trials that each die on an unrecognised flag, or
  // worse, a CLI that ignores it and measures at some other level.
  const { engineFor, ENGINE } = await import("../scripts/ab/engine.mjs");

  assert.deepEqual(engineFor(), { model: "claude-opus-5[1m]", effort: "medium" }, "a run that states nothing gets the pinned pair");
  assert.deepEqual(engineFor({ effort: "high" }), { model: ENGINE.model, effort: "high" });
  assert.deepEqual(engineFor({ model: "claude-sonnet-5" }), { model: "claude-sonnet-5", effort: ENGINE.effort });

  assert.match(engineFor({ effort: "med" }).error, /low, medium, high, xhigh, max/);
  assert.match(engineFor({ effort: "" }).error, /effort/);
  assert.match(engineFor({ model: "" }).error, /model/);
});

test("everything the build reads to decide a model, an effort or a context window is taken out", async () => {
  // Every name below is in the installed 2.1.250 bundle. The first shape rule
  // was written off the model families alone and let the thinking variables
  // through: MAX_THINKING_TOKENS=0 ran every trial with thinking off while
  // provenance recorded medium, which is the defect this change exists to close,
  // one variable over.
  const { overridesEngine } = await import("../scripts/ab/engine.mjs");

  for (const name of [
    "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES",
    "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL", "FALLBACK_FOR_ALL_PRIMARY_MODELS",
    "CLAUDE_CODE_EFFORT_LEVEL", "CLAUDE_CODE_ALWAYS_ENABLE_EFFORT", "MAX_THINKING_TOKENS",
    "CLAUDE_CODE_DISABLE_THINKING", "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING", "DISABLE_INTERLEAVED_THINKING",
    "CLAUDE_CODE_DISABLE_1M_CONTEXT", "ANTHROPIC_BETAS",
    "CLAUDE_CODE_MAX_CONTEXT_TOKENS", "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
    // 2.1.257: a forced subagent model, and the served catalog that now
    // replaces the compiled model list, with the switch and the URL that feed it.
    "CLAUDE_CODE_SUBAGENT_MODEL_FORCE", "CLAUDE_CODE_MODEL_CATALOG_URL", "CLAUDE_CODE_MODEL_CATALOG",
    // 2.1.296: the model a workflow's agents run on, over the one the script asks for.
    "CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL",
    // 2.1.303: a per-model client-data document, and the switch that starts without it.
    "CLAUDE_CODE_CLIENT_DATA_URL", "CLAUDE_CODE_ALLOW_OTHER_MODELS",
  ]) {
    assert.equal(overridesEngine(name), true, `${name} can move the engine and has to go`);
  }
});

test("nothing that carries a credential, an endpoint or a region is taken out", async () => {
  // The first rule matched any ANTHROPIC_ name holding the word MODEL, which
  // took ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION with it: a real name in that
  // bundle, and a Bedrock run needs the region it names.
  const { overridesEngine } = await import("../scripts/ab/engine.mjs");

  for (const name of [
    "ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_VERTEX_PROJECT_ID", "AWS_REGION",
    "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CONFIG_DIR", "PATH", "HOME",
  ]) {
    assert.equal(overridesEngine(name), false, `${name} is not a model or an effort and a run needs it`);
  }
});

test("a trial that cannot run the pinned model fails rather than answering from another one", async () => {
  // The build substitutes a model when the chosen one is refused, and says so:
  // "CLAUDE_CODE_NO_MODEL_FALLBACK is set: model substitution is disabled".
  // Left unset, a trial answers from whatever it fell back to and records the
  // model it asked for, which is the whole defect one level up.
  const { engineEnv, overridesEngine } = await import("../scripts/ab/engine.mjs");

  assert.equal(engineEnv({ PATH: "/usr/bin" }).CLAUDE_CODE_NO_MODEL_FALLBACK, "1");
  assert.equal(engineEnv({ CLAUDE_CODE_NO_MODEL_FALLBACK: "0" }).CLAUDE_CODE_NO_MODEL_FALLBACK, "1", "a parent that turned it off does not get to");
  assert.equal(overridesEngine("CLAUDE_CONTEXT_COLLAPSE_MODEL"), true, "and the model a collapse falls back to is not inherited either");
});

test("the child environment cannot override the engine the trial states", async () => {
  // 2.1.250 reads CLAUDE_CODE_EFFORT_LEVEL ahead of the session's own effort and
  // says so in its own words: "CLAUDE_CODE_EFFORT_LEVEL overrides effort for
  // this session". Passing the parent environment through means an exported
  // level decides every trial while provenance records the flag, which is a
  // measurement that documents a run that did not happen.
  const { engineEnv } = await import("../scripts/ab/engine.mjs");

  const child = engineEnv({
    PATH: "/usr/bin",
    ANTHROPIC_API_KEY: "keep-me",
    CLAUDE_CODE_EFFORT_LEVEL: "xhigh",
    ANTHROPIC_MODEL: "claude-sonnet-5",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-8",
    CLAUDE_CODE_SUBAGENT_MODEL: "claude-haiku-4-5-20251001",
  });

  assert.equal("CLAUDE_CODE_EFFORT_LEVEL" in child, false);
  assert.equal("ANTHROPIC_MODEL" in child, false);
  assert.equal("ANTHROPIC_DEFAULT_OPUS_MODEL" in child, false);
  assert.equal("CLAUDE_CODE_SUBAGENT_MODEL" in child, false);
  assert.equal(child.ANTHROPIC_API_KEY, "keep-me", "credentials are not a model choice");
  assert.equal(child.PATH, "/usr/bin");
});

test("a trial states both halves of its engine on the command line", needsShebang, async (t) => {
  // The harness said every setting was fixed rather than inherited and then
  // named only the model, so the effort came from whatever the machine was set
  // to and two arms measured hours apart were not the same experiment.
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, reporting);

  await runTrial(stub.arm, "write a file", { env: { PATH: stub.path } });

  const argv = stub.argv();
  assert.equal(argv[argv.indexOf("--model") + 1], "claude-opus-5[1m]");
  assert.equal(argv[argv.indexOf("--effort") + 1], "medium");
});

test("a trial's engine cannot be redirected by the environment it inherits", needsShebang, async (t) => {
  const { runTrial } = await import("../scripts/ab/run.mjs");
  const stub = stubClaude(t, reporting);

  await runTrial(stub.arm, "write a file", {
    env: { PATH: stub.path, CLAUDE_CODE_EFFORT_LEVEL: "xhigh", ANTHROPIC_MODEL: "claude-sonnet-5", HOME: "/home/x" },
  });

  const env = stub.env();
  assert.equal(env.has("CLAUDE_CODE_EFFORT_LEVEL"), false, "the build reads this ahead of the stated effort");
  assert.equal(env.has("ANTHROPIC_MODEL"), false);
  assert.equal(env.get("CI"), "1", "and the settings that are not a model choice still reach it");
  assert.equal(env.get("DISABLE_AUTOUPDATER"), "1", "a build that updates itself mid-run is two builds");
  assert.equal(env.get("HOME"), "/home/x");
});

test("the harness refuses an effort it cannot run before it scans, pins or spawns anything", async (t) => {
  // parseArgs runs before the first execFileSync, so this costs no trial and
  // touches no repository: the point is that a typo is caught at the door
  // rather than 30 model calls in.
  const { execFileSync } = await import("node:child_process");
  const gone = join(tmpdir(), "anatomiya-no-such-repo");

  let code = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [join(root, "scripts", "ab.mjs"), "--repo", gone, "--task", gone, "--effort", "med"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    code = err.status;
    stderr = String(err.stderr ?? "");
  }

  assert.equal(code, 2, stderr);
  assert.match(stderr, /--effort takes one of low, medium, high, xhigh, max, not "med"/, stderr);
});

/**
 * Whether the installed build still carries these strings.
 *
 * Streamed rather than read whole: the bundle is a few hundred megabytes, and
 * one pass answers for every string at once. `null` where there is nothing to
 * read, which is not the same answer as "the build dropped them".
 */
async function carriedBy(cli, wanted) {
  const { createReadStream, statSync } = await import("node:fs");
  const { MIN_BUNDLE } = await import("../scripts/claude-build.mjs");
  if (!cli || statSync(cli).size < MIN_BUNDLE) return null;

  const found = new Set();
  const longest = Math.max(...wanted.map((w) => w.length));
  let tail = "";
  const stream = createReadStream(cli, { encoding: "latin1", highWaterMark: 1 << 22 });
  for await (const chunk of stream) {
    const hay = tail + chunk;
    for (const w of wanted) if (hay.includes(w)) found.add(w);
    if (found.size === wanted.length) {
      stream.destroy();
      break;
    }
    tail = hay.slice(-longest);
  }
  return found;
}

test("the installed build still offers the model and the effort this harness pins", async (t) => {
  // A pinned model id outlives no release on its own. The CLI refuses an
  // unknown one at the first trial, with its own words, which is late but loud;
  // this says it at `npm test` instead. A skip where no build is installed: a
  // machine without one is not evidence that the pair went away.
  const { ENGINE, EFFORT_LEVELS } = await import("../scripts/ab/engine.mjs");
  const { cliPath } = await import("../scripts/claude-build.mjs");

  const cli = cliPath();
  if (!cli) return t.skip("no Claude Code build on this machine to read");
  // A prefix of the level list rather than the whole of it: a sixth level added
  // at the end leaves `medium` exactly where it was, and a guard that reddens
  // on that costs more than it catches.
  const wanted = [ENGINE.model, EFFORT_LEVELS.slice(0, 3).map((l) => `"${l}"`).join(",")];
  const found = await carriedBy(cli, wanted);
  if (found === null) return t.skip("the installed build could not be read");

  assert.deepEqual(
    wanted.filter((w) => !found.has(w)),
    [],
    `this Claude Code build no longer carries what scripts/ab/engine.mjs pins; re-read DECISIONS G11 (read ${cli})`
  );
});

test("an arm cannot set the engine that measures it", needsShebang, async (t) => {
  // The arms are worktrees of the repository under measurement, and a settings
  // file in one lands on the rung above the flag: `settings.env` sets
  // CLAUDE_CODE_EFFORT_LEVEL, which the build reads ahead of --effort. A repo
  // deciding how it is measured is the confound this harness exists to remove.
  // The map lives in .claude/rules/ and is left exactly where it is.
  const { dropSettings } = await import("../scripts/ab/arms.mjs");
  const arm = mkdtempSync(join(tmpdir(), "anatomiya-arm-"));
  t.after(() => removeTree(arm));
  mkdirSync(join(arm, ".claude", "rules"), { recursive: true });
  writeFileSync(join(arm, ".claude", "settings.json"), '{"env":{"CLAUDE_CODE_EFFORT_LEVEL":"xhigh"}}');
  writeFileSync(join(arm, ".claude", "settings.local.json"), '{"env":{"CLAUDE_CODE_EFFORT_LEVEL":"low"}}');
  writeFileSync(join(arm, ".claude", "rules", "area.md"), "# the map\n");

  const dropped = dropSettings(arm);

  assert.deepEqual(dropped.gone.map((d) => d.split(/[\\/]/).pop()).sort(), ["settings.json", "settings.local.json"]);
  assert.deepEqual(dropped.kept, []);
  assert.equal(existsSync(join(arm, ".claude", "rules", "area.md")), true, "the map is not a setting");
  assert.deepEqual(dropSettings(arm), { gone: [], kept: [] }, "an arm with none to drop drops none");
});

test("provenance takes the engine the trials reported, not the one the flags asked for", async () => {
  // Nothing else can confirm the 1M window: the `[1m]` suffix never reaches the
  // wire, it becomes a beta header, and only what comes back says whether the
  // window was granted.
  const { engineRan } = await import("../scripts/ab/engine.mjs");
  const asked = { model: "claude-opus-5[1m]", effort: "medium" };
  const trial = (model, contextWindow) => ({ ran: { model, contextWindow } });

  const agreed = engineRan(asked, [trial("claude-opus-5[1m]", 1000000), trial("claude-opus-5[1m]", 1000000)]);
  assert.deepEqual(agreed.engine, { model: "claude-opus-5[1m]", effort: "medium", contextWindow: 1000000 });
  assert.equal(agreed.note, null);
});

test("a batch whose trials ran on more than one engine is refused, not averaged", async () => {
  const { engineRan } = await import("../scripts/ab/engine.mjs");
  const asked = { model: "claude-opus-5[1m]", effort: "medium" };
  const trial = (model, contextWindow) => ({ ran: { model, contextWindow } });

  const split = engineRan(asked, [trial("claude-opus-5[1m]", 1000000), trial("claude-opus-5", 200000)]);

  assert.equal(split.engine, undefined);
  assert.match(split.error, /ran on more than one engine: claude-opus-5, claude-opus-5\[1m\]/);
});

test("a batch nothing reported an engine for records what it asked for, and says so", async () => {
  // An answer this cannot read decides nothing. Recording the request is the
  // honest fallback, and the run says the observation was missing rather than
  // letting the row read as confirmed.
  const { engineRan } = await import("../scripts/ab/engine.mjs");
  const asked = { model: "claude-opus-5[1m]", effort: "medium" };

  const blind = engineRan(asked, [{ ran: null }, { ran: null }]);

  assert.deepEqual(blind.engine, asked);
  assert.match(blind.note, /no trial reported which engine served it/);
});

test("a settings env entry that outranks the flags stops the run before it spends a batch", async () => {
  // `settings.env` is the one rung above the flags a trial passes, and no
  // environment scrub reaches it: Claude Code reads its own settings after it
  // starts, so what was taken out comes back.
  const { conflictingSettings, ENGINE } = await import("../scripts/ab/engine.mjs");

  assert.match(
    conflictingSettings({ env: { CLAUDE_CODE_EFFORT_LEVEL: "xhigh" } }, ENGINE),
    /decide this run's engine ahead of its flags: CLAUDE_CODE_EFFORT_LEVEL/
  );
  assert.match(conflictingSettings({ env: { ANTHROPIC_MODEL: "claude-sonnet-5" } }, ENGINE), /ANTHROPIC_MODEL/);
  assert.match(conflictingSettings({ env: { MAX_THINKING_TOKENS: "0" } }, ENGINE), /MAX_THINKING_TOKENS/);
});

test("settings the flags already beat let the run through", async () => {
  // Measured on 2.1.250 and written up in docs/research/one-model-one-effort.md:
  // `--effort` beats `ultracode: true`, `modelSettings` and `effortLevel`. A gate
  // that refused those would fail on a machine merely set up for ordinary work,
  // and would refuse a run the flags were deciding correctly anyway.
  const { conflictingSettings, ENGINE } = await import("../scripts/ab/engine.mjs");

  assert.equal(conflictingSettings({}, ENGINE), null);
  assert.equal(conflictingSettings(null, ENGINE), null);
  assert.equal(conflictingSettings({ ultracode: true }, ENGINE), null);
  assert.equal(conflictingSettings({ effortLevel: "high" }, ENGINE), null);
  assert.equal(conflictingSettings({ model: "claude-sonnet-5" }, ENGINE), null);
  assert.equal(conflictingSettings({ modelSettings: { "claude-opus-5": { effortLevel: "xhigh" } } }, ENGINE), null);
  assert.equal(conflictingSettings({ env: { PATH: "/usr/bin" } }, ENGINE), null, "and an env entry that names no engine is not one");
});

test("an arm whose settings cannot be removed fails the run instead of leaking a worktree", needsPosixPermissions, async (t) => {
  // unlinkSync throws on a read-only directory, and a throw between creating
  // the worktrees and returning their disposer left one registered in the
  // repository being measured.
  const { dropSettings } = await import("../scripts/ab/arms.mjs");
  const arm = mkdtempSync(join(tmpdir(), "anatomiya-ro-"));
  t.after(() => { chmodSync(join(arm, ".claude"), 0o755); return removeTree(arm); });
  mkdirSync(join(arm, ".claude"));
  writeFileSync(join(arm, ".claude", "settings.json"), "{}");
  chmodSync(join(arm, ".claude"), 0o555);

  const dropped = dropSettings(arm);

  assert.deepEqual(dropped.gone, []);
  assert.equal(dropped.kept.length, 1, "and it says which it could not take out");
});

test("a run served by a model nobody asked for says so", async () => {
  // Recording the substitute is honest and half the job: a record that reads
  // `claude-sonnet-9` with nothing saying it was not the request leaves the
  // reader to notice.
  const { engineRan } = await import("../scripts/ab/engine.mjs");
  const asked = { model: "claude-opus-5[1m]", effort: "medium" };

  const swapped = engineRan(asked, [{ ran: { model: "claude-sonnet-9", contextWindow: 200000 } }]);

  assert.equal(swapped.engine.model, "claude-sonnet-9", "the record is what ran");
  assert.match(swapped.note, /asked for claude-opus-5\[1m\] and was served by claude-sonnet-9/);
});

test("a trial whose answer named no window does not read as a second engine", async () => {
  // The key was `${model} at ${contextWindow}`, so one trial reporting null and
  // one reporting 1000000 for the same model were two engines, and the batch
  // died on "ran on more than one engine ... at null". An answer nobody could
  // read decides neither way, which is what the function says it does.
  const { engineRan } = await import("../scripts/ab/engine.mjs");
  const asked = { model: "claude-opus-5[1m]", effort: "medium" };

  const mixed = engineRan(asked, [
    { ran: { model: "claude-opus-5[1m]", contextWindow: null } },
    { ran: { model: "claude-opus-5[1m]", contextWindow: 1000000 } },
  ]);

  assert.equal(mixed.error, undefined, "one model is one engine");
  assert.deepEqual(mixed.engine, { model: "claude-opus-5[1m]", effort: "medium", contextWindow: 1000000 });
});

test("the same model in two different windows is still two engines", async () => {
  const { engineRan } = await import("../scripts/ab/engine.mjs");
  const asked = { model: "claude-opus-5[1m]", effort: "medium" };

  const split = engineRan(asked, [
    { ran: { model: "claude-opus-5[1m]", contextWindow: 1000000 } },
    { ran: { model: "claude-opus-5[1m]", contextWindow: 200000 } },
  ]);

  assert.match(split.error, /ran in more than one context window: 1000000, 200000/);
});

/**
 * Names the build reads that this run deliberately leaves alone, each with the
 * reason. Anything engine-shaped and not here has to be scrubbed.
 */
const KEPT = new Map([
  ["ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION", "a region, not a model, and a Bedrock run needs it"],
  ["CLAUDE_CODE_NO_MODEL_FALLBACK", "set rather than scrubbed, so a trial runs the pinned model or fails"],
  ["CLAUDE_CODE_THINKING_DISPLAY_UPDATES", "how thinking is shown, not how much of it there is"],
  // 2.1.280 keeps the name above in a length-prefixed string table, and the
  // next entry's length byte is 0x44, so the scan reads one name with a D on it.
  ["CLAUDE_CODE_THINKING_DISPLAY_UPDATESD", "the name above with the next string-table entry's length byte, not a name the build reads"],
  // 2.1.280, `j7()`: read only to colour the effort label and show a notice
  // when the effort is already max.
  ["CLAUDE_CODE_MAX_EFFORT_REMINDER", "a notice in the terminal at max effort, not the effort a trial runs at"],
  // 2.1.269. A fetch deadline for the gateway's /v1/models call, read as
  // `CLAUDE_CODE_GATEWAY_MODEL_DISCOVERY_TIMEOUT_MS ?? Bie` inside a function
  // that returns early unless discovery is enabled. That switch,
  // CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, is already in OVERRIDES, so no
  // trial reaches the call this bounds and the timeout decides nothing.
  ["CLAUDE_CODE_GATEWAY_MODEL_DISCOVERY_TIMEOUT_MS", "a deadline for a discovery call the scrubbed enable switch means no trial makes"],
  // 2.1.285 reads it in one place, OR-ed with the pinned switch:
  // `a.CLAUDE_CODE_NO_MODEL_FALLBACK===!0||a.CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK===!0`.
  ["CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK", "a second name for turning fallback off, which PINS already turns off"],
  // 2.1.285, `[3p-model-memory]`: the cache key for Bedrock and Vertex
  // model-access probes returns early when it is set, so the probe runs again.
  ["CLAUDE_CODE_SKIP_MODEL_ACCESS_MEMORY", "whether a saved third-party access probe is reused, not which model runs: with fallback pinned off no probe answer swaps it"],
  // 2.1.285 stores CLAUDE_CODE_EFFORT_LEVEL as a 24-byte string-table entry,
  // and the next entry's length byte is 0x5f, so the scan reads a trailing `_`.
  ["CLAUDE_CODE_EFFORT_LEVEL_", "CLAUDE_CODE_EFFORT_LEVEL with the next string-table entry's length byte, not a name the build reads"],
  // 2.1.286 does the same to two more names: the byte after each is 0x45, so
  // the scan reads a trailing `E`. The code reads both without it.
  ["CLAUDE_CODE_ALWAYS_ENABLE_EFFORTE", "CLAUDE_CODE_ALWAYS_ENABLE_EFFORT, which OVERRIDES scrubs, with the next string-table entry's length byte"],
  ["CLAUDE_CODE_SKIP_MODEL_ACCESS_MEMORYE", "CLAUDE_CODE_SKIP_MODEL_ACCESS_MEMORY with the next string-table entry's length byte, not a name the build reads"],
  // 2.1.290 does it once more: the byte after the name is 0x4e, so the scan
  // reads a trailing `N`.
  ["CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENTN", "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT, which OVERRIDES scrubs, with the next string-table entry's length byte"],
  // 2.1.306 moves both once more: the bytes after them are 0x43 and 0x45.
  ["CLAUDE_CODE_ALWAYS_ENABLE_EFFORTC", "CLAUDE_CODE_ALWAYS_ENABLE_EFFORT, which OVERRIDES scrubs, with the next string-table entry's length byte"],
  ["CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENTE", "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT, which OVERRIDES scrubs, with the next string-table entry's length byte"],
  // CLAUDE_CODE_MODEL_CATALOG sat here through 2.1.252 as the off switch for a
  // catalog that was compared and logged. 2.1.257 installs the fetched catalog
  // in place of the compiled model list, so the switch is scrubbed with the URL
  // that feeds it: docs/research/claude-code-2-1-257-engine-variables.md.
]);

test("the build carries no engine-shaped variable this run has not decided about", async (t) => {
  // The scrub list is hand-written against one build, and the build gains
  // variables every release. Left to rot it is a guess, and every row still
  // says medium. This reads the installed build for anything shaped like a
  // model, an effort or a thinking budget and fails on one nobody has ruled on.
  const { overridesEngine } = await import("../scripts/ab/engine.mjs");
  const { cliPath } = await import("../scripts/claude-build.mjs");

  const cli = cliPath();
  if (!cli) return t.skip("no Claude Code build on this machine to read");
  const found = await namesIn(cli);
  if (found === null) return t.skip("the installed build could not be read");

  const undecided = [...found].filter((name) => !overridesEngine(name) && !KEPT.has(name)).sort();

  assert.deepEqual(
    undecided,
    [],
    `this Claude Code build reads engine-shaped variables scripts/ab/engine.mjs has not ruled on; scrub them in OVERRIDES or list them in KEPT with the reason (read ${cli})`
  );
});

/** Every environment-variable-shaped name in the build that names an engine. */
async function namesIn(cli) {
  const { createReadStream, statSync } = await import("node:fs");
  const { MIN_BUNDLE } = await import("../scripts/claude-build.mjs");
  if (statSync(cli).size < MIN_BUNDLE) return null;

  const shaped = /\b(?:ANTHROPIC|CLAUDE|CLAUDE_CODE|MAX|DISABLE|FALLBACK)_[A-Z0-9_]*(?:MODEL|EFFORT|THINKING)[A-Z0-9_]*\b/g;
  const found = new Set();
  let tail = "";
  const stream = createReadStream(cli, { encoding: "latin1", highWaterMark: 1 << 22 });
  for await (const chunk of stream) {
    const hay = tail + chunk;
    for (const m of hay.matchAll(shaped)) found.add(m[0]);
    tail = hay.slice(-128);
  }
  return found;
}

test("a substitution reaches the record, not just the console", async () => {
  // The note was printed and the artifact said only `claude-haiku-4-5`, so a
  // reader of the table or the result file had nothing telling them the run
  // never asked for it.
  const { engineRan } = await import("../scripts/ab/engine.mjs");
  const asked = { model: "claude-opus-5[1m]", effort: "medium" };

  const swapped = engineRan(asked, [{ ran: { model: "claude-haiku-4-5", contextWindow: 200000 } }]);
  assert.equal(swapped.engine.asked, "claude-opus-5[1m]");

  const straight = engineRan(asked, [{ ran: { model: "claude-opus-5[1m]", contextWindow: 1000000 } }]);
  assert.equal("asked" in straight.engine, false, "and a run that got what it asked for says nothing extra");
});

/* --- the harness as a whole: its gate, its document and one run end to end --- */

test("the argument gate answers in process, with the engine folded in", async () => {
  const { parseArgs } = await import("../scripts/ab/args.mjs");

  assert.deepEqual(parseArgs(["--repo", "r", "--task", "t"]), {
    repo: "r",
    task: "t",
    trials: 10,
    minHeadroom: 0.05,
    engine: { model: "claude-opus-5[1m]", effort: "medium" },
  });
  assert.deepEqual(parseArgs(["--repo", "r", "--task", "t", "--model", "m", "--effort", "high", "--trials", "3"]).engine, { model: "m", effort: "high" });
  assert.deepEqual(parseArgs([]), { error: "both --repo and --task are required" });
  assert.match(parseArgs(["--repo"]).error, /--repo/);
  assert.equal(parseArgs(["--repo", "r", "--task", "t", "--bogus", "1"]).code, "ERR_PARSE_ARGS_UNKNOWN_OPTION");
  assert.equal(parseArgs(["--repo", "r", "--task", "t", "stray"]).code, "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL");
  assert.equal(parseArgs(["--repo=r", "--task=t"]).repo, "r");
  assert.equal(parseArgs(["--repo", "r", "--task", "t", "--frozen", "abc123"]).frozen, "abc123");
  assert.deepEqual(parseArgs(["--repo", "r", "--task", "t", "--trials", "0"]), { error: "--trials takes a positive integer" });
  assert.match(parseArgs(["--repo", "r", "--task", "t", "--effort", "med"]).error, /--effort takes one of low, medium, high, xhigh, max, not "med"/);
  // NaN compares false against every headroom, which switches the floor off
  // for the whole batch rather than refusing at the door.
  assert.deepEqual(parseArgs(["--repo", "r", "--task", "t", "--min-headroom", "0.O5"]), { error: "--min-headroom takes a number from 0 to 1" });
  assert.deepEqual(parseArgs(["--repo", "r", "--task", "t", "--min-headroom", "2"]), { error: "--min-headroom takes a number from 0 to 1" });
  assert.equal(parseArgs(["--repo", "r", "--task", "t", "--min-headroom", "0.2"]).minHeadroom, 0.2);
});

test("the usage text names every option the gate takes", async () => {
  const { parseArgs, USAGE } = await import("../scripts/ab/args.mjs");
  for (const flag of ["--repo", "--task", "--trials", "--model", "--effort", "--out", "--min-headroom", "--key", "--area"]) {
    assert.ok(USAGE.includes(`${flag} `), `${flag} is missing from the usage text`);
    assert.notEqual(parseArgs(["--repo", "r", "--task", "t", flag, "1"]).code, "ERR_PARSE_ARGS_UNKNOWN_OPTION", `${flag} is documented but refused`);
  }
});

/** A result the way step 6 of the harness builds one, with the numbers a reader would check. */
const RESULT = {
  target: { path: "src/x", key: "nullish_default", claim: "defaults are taken with ??, not ||", candidates: 300, ratio: 0.94, headroom: 0.06 },
  sha: "0123456789abcdef0123456789abcdef01234567",
  label: "crisnahine/anatomiya",
  said: { a: "src/x 20 files", b: "NONE" },
  engine: { model: "claude-opus-5[1m]", effort: "medium", contextWindow: 1000000 },
  a: { wroteSomething: 1, filesScored: 1, candidates: 10, conforming: 9, trialsWithAViolation: 1, endedEarly: 1, wroteNothing: 0 },
  b: { wroteSomething: 1, filesScored: 0, candidates: 0, conforming: 0, trialsWithAViolation: 0, endedEarly: 0, wroteNothing: 1 },
};

test("the result document is rendered from the result, with both arms' numbers where a reader looks", async () => {
  const { render } = await import("../scripts/ab/render.mjs");

  const doc = render(RESULT, { trials: 2 });

  for (const line of [
    "# A/B: crisnahine/anatomiya at 01234567",
    "| area | src/x |",
    "| claim | defaults are taken with ??, not || |",
    "| baseline | 282 of 300, ratio 0.940 |",
    "| headroom | 0.060 |",
    "| model | claude-opus-5[1m] |",
    "| effort | medium |",
    "| context window | 1000000 |",
    "| trials per arm | 2 |",
    'Injection: arm A answered "src/x 20 files", arm B answered "NONE".',
    "| trials that wrote a file | 1/2 | 1/2 |",
    "| trials cut short by the turn cap or an error | 1/2 | 0/2 |",
    "| trials that finished and wrote nothing | 0/2 | 1/2 |",
    "| files scored | 1 | 0 |",
    "| sites conforming | 9 of 10 (0.900) | 0 of 0 (no sites) |",
    "| trials with a violating site | 1 | 0 |",
    "## Reading this",
  ]) assert.ok(doc.includes(line), `missing: ${line}\n\n${doc}`);
  assert.ok(!doc.includes("| asked for |"), "a run served by what it asked for carries no substitution row");
});

test("a substituted engine is named in the document beside the one that served", async () => {
  const { render } = await import("../scripts/ab/render.mjs");

  const doc = render({ ...RESULT, engine: { ...RESULT.engine, model: "claude-sonnet-5", asked: "claude-opus-5[1m]" } }, { trials: 2 });

  assert.ok(doc.includes("| model | claude-sonnet-5 |"), doc);
  assert.ok(doc.includes("| asked for | claude-opus-5[1m], which is not what served it |"), doc);
});


/**
 * A `claude` that answers the probe from the arm it is run in and writes one
 * file per trial: the map's own area line where the map is present, NONE where
 * it is not, so the injection check passes for the right reason in each arm.
 */
const measuring = () => [
  'case "$2" in',
  '  *NONE*)',
  PROBE_ANSWER,
  '    ;;',
  '  *)',
  '    mkdir -p src/x',
  "    printf 'const a = {};\\nexport const w0 = a.q0 ?? {};\\nexport const w1 = a.q1 ?? {};\\nexport const w2 = a.q2 || {};\\n' > src/x/written.mjs",
  '    R="wrote a file"',
  '    ;;',
  'esac',
  `printf '{"result":"%s","modelUsage":{"claude-opus-5[1m]":{"contextWindow":1000000,"outputTokens":1}}}\\n' "$R"`,
].join("\n");

test("the harness completes a run from an empty state and writes the document", { ...needsShebang, ...needsPathControl }, async (t) => {
  // Every step the harness has, in order, with nothing but the model stubbed:
  // scan, pin, scan, rank, arms, probe, trials, score, render, write. The
  // ReferenceError that stopped step 7 lived past 2,500 unit tests because no
  // case ran the file to its end.
  const repo = measurable(t);
  const stub = stubClaude(t, measuring);
  const out = join(mkdtempSync(join(tmpdir(), "anatomiya-ab-out-")), "result.md");
  t.after(() => removeTree(dirname(out)));
  const config = mkdtempSync(join(tmpdir(), "anatomiya-ab-config-"));
  t.after(() => removeTree(config));
  // An engine in the operator's own settings is no reason to refuse: a trial
  // loads only the project and local sources, so it never reaches one.
  writeFileSync(join(config, "settings.json"), '{"env":{"CLAUDE_CODE_EFFORT_LEVEL":"xhigh"}}\n');
  const task = join(config, "task.md");
  writeFileSync(task, "Write a new module under src/x that reads three defaults.\n");

  let status = 0;
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync(process.execPath, [join(root, "scripts", "ab.mjs"), "--repo", repo, "--task", task, "--trials", "1", "--out", out], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
      env: { PATH: stub.path, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: config },
    });
  } catch (err) {
    status = err.status;
    stdout = String(err.stdout ?? "");
    stderr = String(err.stderr ?? "");
  }

  assert.equal(status, 0, `${stdout}\n${stderr}`);
  assert.match(stdout, /injection verified: A said "src\/x/, stdout);
  assert.match(stdout, /wrote .*result\.md/, stdout);
  const doc = readFileSync(out, "utf8");
  for (const line of [
    "| area | src/x |",
    "| claim | defaults are taken with ??, not || |",
    "| baseline | 376 of 400, ratio 0.940 |",
    "| model | claude-opus-5[1m] |",
    "| trials per arm | 1 |",
    "| trials that wrote a file | 1/1 | 1/1 |",
    "| trials cut short by the turn cap or an error | 0/1 | 0/1 |",
    "| sites conforming | 2 of 3 (0.667) | 2 of 3 (0.667) |",
  ]) assert.ok(doc.includes(line), `missing: ${line}\n\n${doc}`);
  // Both arms were removed from the repository under measurement.
  const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repo, encoding: "utf8" });
  assert.equal(worktrees.split("\n").filter((l) => l.startsWith("worktree ")).length, 1, worktrees);
});
