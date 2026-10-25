// test/ab-scenario.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { measurable, PROBE_ANSWER, stubClaude } from "./ab-fixtures.mjs";

test("Fisher's exact test answers the textbook tables", async () => {
  // Independent values: 1 of 10 against 9 of 10 is 0.0011 two-sided, an even
  // split is 1, and 3 of 10 against 7 of 10 is 0.1789.
  const { fisherExact } = await import("../scripts/ab/checks.mjs");
  assert.equal(fisherExact(1, 10, 9, 10).toFixed(4), "0.0011");
  assert.equal(fisherExact(5, 10, 5, 10), 1);
  assert.equal(fisherExact(3, 10, 7, 10).toFixed(4), "0.1789");
  assert.equal(fisherExact(0, 0, 0, 0), 1, "no trials on either side is no evidence either way");
});

test("Fisher's exact test refuses counts that cannot be a table", async () => {
  const { fisherExact } = await import("../scripts/ab/checks.mjs");
  assert.equal(fisherExact(11, 10, 0, 10), null);
  assert.equal(fisherExact(-1, 10, 0, 10), null);
  assert.equal(fisherExact(1.5, 10, 0, 10), null);
});

/** A scenario as a file holds it, with `over` replacing any field. */
const scenarioText = (over = {}) =>
  JSON.stringify({
    name: "new-cop",
    repo: "github.com/rubocop/rubocop",
    commit: "f009b338048ea0ade9d6d88cf358111092c8f12c",
    area: "lib/rubocop/cop/style",
    prompt: "Add a new cop.",
    did: [{ changed: "^lib/rubocop/cop/style/reverse_first\\.rb$" }],
    checks: [
      { name: "config registers the cop", claim: "ships with an edit to config/default.yml", contains: "^Style/ReverseFirst:", in: "^config/default\\.yml$" },
      { name: "defaults use ??", dimension: "nullish_default", in: "\\.mjs$" },
    ],
    ...over,
  });

test("a scenario file is read into patterns, with the claim each check tests", async () => {
  const { parseScenario } = await import("../scripts/ab/checks.mjs");
  const { scenario, error } = parseScenario(scenarioText());

  assert.equal(error, undefined);
  assert.equal(scenario.name, "new-cop");
  assert.equal(scenario.probe, null, "no probe named, so the runner picks a file in the area");
  assert.ok(scenario.did[0].path.test("lib/rubocop/cop/style/reverse_first.rb"));
  const [config, nullish] = scenario.checks;
  assert.equal(config.kind, "contains");
  assert.equal(config.claim, "ships with an edit to config/default.yml");
  assert.ok(config.text.test("Style/Other:\nStyle/ReverseFirst:\n"), "a content pattern reads line by line");
  assert.equal(nullish.kind, "dimension");
  assert.equal(nullish.key, "nullish_default");
});

test("a scenario that could not score its trials is refused before any is run", async () => {
  // Every one of these, found after the trials, costs all of them.
  const { parseScenario } = await import("../scripts/ab/checks.mjs");
  const refused = (over) => parseScenario(scenarioText(over)).error;

  assert.match(parseScenario("{").error, /not JSON/);
  assert.match(refused({ commit: "f009b33" }), /40-character sha/);
  assert.match(refused({ name: "New Cop" }), /kebab-case/);
  assert.match(refused({ prompt: " " }), /no prompt/);
  assert.match(refused({ did: [] }), /no did/);
  assert.match(refused({ checks: [{ changed: "(" }] }), /does not compile/);
  assert.match(refused({ checks: [{ changed: "a", unchanged: "b" }] }), /changed and unchanged/);
  assert.match(refused({ checks: [{ contains: "x" }] }), /in is not a pattern/);
  assert.match(refused({ checks: [{ dimension: "no_such_row", in: "x" }] }), /no dimension/);
  assert.match(refused({ checks: [{ dimension: "exported_symbol_case", in: "x" }] }), /learned row/);
  assert.match(refused({ checks: [{ name: "a", changed: "x" }, { name: "a", changed: "y" }] }), /share a name/);
  assert.match(refused({ probe: "lib/other/file.rb" }), /probe is not a path under its area/);
});

test("median skips what was not reported, and has none for nothing", async () => {
  const { median } = await import("../scripts/ab/checks.mjs");
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([null, 2, undefined]), 2);
  assert.equal(median([]), null);
});

/** A trial as `runTrial` reports one: what it wrote and how it ended. */
const trial = (wrote, ok = true) => ({ ok, reason: ok ? null : "max turns", wrote: wrote.map(([rel, source]) => ({ rel, source })), spent: { costUsd: 1, wallMs: 1000 } });

test("each kind of check reads the files a trial wrote", async () => {
  const { parseScenario, runCheck } = await import("../scripts/ab/checks.mjs");
  const { scenario } = parseScenario(scenarioText({
    checks: [
      { name: "changed", changed: "^config/default\\.yml$" },
      { name: "unchanged", unchanged: "^Gemfile$" },
      { name: "contains", contains: "^Style/ReverseFirst:", in: "\\.yml$" },
      { name: "lacks", lacks: "def reverse_first", in: "\\.rb$" },
    ],
  }));
  const [changed, unchanged, contains, lacks] = scenario.checks;
  const files = trial([["config/default.yml", "Style/ReverseFirst:\n  Enabled: pending\n"], ["lib/x.rb", "class X; end\n"]]).wrote;

  assert.equal(await runCheck(changed, files), true);
  assert.equal(await runCheck(changed, []), false);
  assert.equal(await runCheck(unchanged, files), true);
  assert.equal(await runCheck(unchanged, [{ rel: "Gemfile", source: "" }]), false);
  assert.equal(await runCheck(contains, files), true);
  assert.equal(await runCheck(contains, [{ rel: "a.yml", source: "  Style/ReverseFirst:\n" }]), false, "anchored to a line start");
  assert.equal(await runCheck(lacks, files), true);
  assert.equal(await runCheck(lacks, [{ rel: "lib/y.rb", source: "  def reverse_first\n" }]), false);
});

test("a dimension check is the map's own predicate, and has no answer where it found no site", async () => {
  const { parseScenario, runCheck } = await import("../scripts/ab/checks.mjs");
  const { scenario } = parseScenario(scenarioText());
  const nullish = scenario.checks[1];

  assert.equal(await runCheck(nullish, [{ rel: "src/a.mjs", source: "const a = {};\nexport const v = a.p ?? {};\n" }]), true);
  assert.equal(await runCheck(nullish, [{ rel: "src/a.mjs", source: "const a = {};\nexport const v = a.p ?? {};\nexport const w = a.q || {};\n" }]), false);
  assert.equal(await runCheck(nullish, [{ rel: "src/a.mjs", source: "export const v = 1;\n" }]), null);
  assert.equal(await runCheck(nullish, [{ rel: "README.md", source: "a || b" }]), null, "a file the pattern leaves out is not judged");
});

test("an arm is scored only on the trials that did the task, never on the plugin's own files", async () => {
  // A trial that wrote nothing would otherwise pass every `unchanged` and
  // `lacks` check, and the map arm's hooks rewrite the plugin's own state,
  // which no task asks for and no check may count.
  const { parseScenario, scoreScenario } = await import("../scripts/ab/checks.mjs");
  const { scenario } = parseScenario(scenarioText({
    checks: [
      { name: "config", contains: "^Style/ReverseFirst:", in: "^config/default\\.yml$" },
      { name: "json", changed: "\\.json$" },
    ],
  }));
  const cop = ["lib/rubocop/cop/style/reverse_first.rb", "class ReverseFirst; end\n"];
  const runs = [
    trial([cop, ["config/default.yml", "Style/ReverseFirst:\n"], ["data.json", "{}"]]),
    trial([cop, [".claude/anatomiya/refresh.json", "{}"], [".claude/rules/anatomiya-overview.md", ""]]),
    trial([["notes.md", "nothing"]]),
    trial([], false),
  ];

  const s = await scoreScenario(runs, scenario);

  assert.equal(s.trials, 4);
  assert.equal(s.endedEarly, 1);
  assert.equal(s.did, 2);
  assert.deepEqual(s.checks, { config: { passed: 1, of: 2 }, json: { passed: 1, of: 2 } });
  assert.equal(s.allPassed, 1);
  assert.deepEqual(s.perTrial[1].wrote, ["lib/rubocop/cop/style/reverse_first.rb"], "the plugin's own files are not the trial's work");
  assert.deepEqual(s.perTrial[1].checks, { config: false, json: false });
  assert.deepEqual(s.perTrial[2], { ok: true, reason: null, wrote: ["notes.md"], did: false, checks: {}, spent: { costUsd: 1, wallMs: 1000 } });
});

test("a check with nothing to judge is left out of its own count and of every-check-held", async () => {
  const { parseScenario, scoreScenario } = await import("../scripts/ab/checks.mjs");
  const { scenario } = parseScenario(scenarioText({ did: [{ changed: "\\.mjs$" }] }));
  const s = await scoreScenario([trial([["src/a.mjs", "export const v = 1;\n"], ["config/default.yml", "Style/ReverseFirst:\n"]])], scenario);

  assert.deepEqual(s.checks, { "config registers the cop": { passed: 1, of: 1 }, "defaults use ??": { passed: 0, of: 0 } });
  assert.equal(s.allPassed, 0, "a trial is not counted as holding a check that could not be judged");
});

test("a rate is printed with its Wilson interval, and an empty one says so", async () => {
  // Independent values: the 95% Wilson interval of 7 of 10 is 0.397 to 0.892,
  // and of 1 of 1 is 0.207 to 1.
  const { rate } = await import("../scripts/ab/render.mjs");
  assert.equal(rate(7, 10), "7 of 10 (0.70, 95% 0.40 to 0.89)");
  assert.equal(rate(1, 1), "1 of 1 (1.00, 95% 0.21 to 1.00)");
  assert.equal(rate(0, 0), "none of 0");
});

test("the scenario run's arguments are refused at the door", async () => {
  const { parseScenarioArgs } = await import("../scripts/ab/args.mjs");
  const { ENGINE } = await import("../scripts/ab/engine.mjs");

  assert.match(parseScenarioArgs(["--repo", "r"]).error, /--scenario/);
  assert.match(parseScenarioArgs(["--repo", "r", "--scenario", "s", "--trials", "0"]).error, /positive integer/);
  assert.match(parseScenarioArgs(["--repo", "r", "--scenario", "s", "--effort", "huge"]).error, /--effort takes one of/);
  assert.match(parseScenarioArgs(["--repo", "r", "--scenario", "s", "--nope"]).error, /nope/);
  const ok = parseScenarioArgs(["--repo", "r", "--scenario", "s", "--model", "claude-opus-5-5", "--raw", "/tmp/raw.json"]);
  assert.deepEqual(ok, { repo: "r", scenario: "s", raw: "/tmp/raw.json", trials: 10, engine: { model: "claude-opus-5-5", effort: ENGINE.effort } });
});

/**
 * A `claude` that answers the probe from the map it finds, and otherwise
 * writes one module: with `??` where it was handed the plugin, with `||` where
 * it was not, so the two arms differ for a reason the test controls.
 */
const scenarioClaude = () => [
  'case " $* " in *" --plugin-dir "*) PLUGIN=1;; *) PLUGIN=0;; esac',
  'case "$2" in',
  "  *NONE*)",
  PROBE_ANSWER,
  "    ;;",
  "  *)",
  "    mkdir -p src/x",
  `    if [ "$PLUGIN" = 1 ]; then OP='??'; else OP='||'; fi`,
  `    printf 'const a = {};\\nexport const w = a.q %s {};\\n' "$OP" > src/x/written.mjs`,
  '    R="wrote src/x/written.mjs"',
  "    ;;",
  "esac",
  `printf '{"result":"%s","total_cost_usd":0.5,"duration_ms":2000,"num_turns":4,"modelUsage":{"claude-opus-5[1m]":{"contextWindow":1000000,"outputTokens":10}}}\\n' "$R"`,
].join("\n");

async function runScenario(t, scenarioOver = {}) {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { removeTree } = await import("./platform.mjs");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = measurable(t);
  const repo = { dir, sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim() };
  const work = mkdtempSync(join(tmpdir(), "anatomiya-scenario-work-"));
  t.after(() => removeTree(work));
  const stub = stubClaude(t, scenarioClaude);
  const scenario = join(work, "s.json");
  writeFileSync(scenario, JSON.stringify({
    name: "defaults",
    repo: "example.test/one/defaults",
    commit: repo.sha,
    area: "src/x",
    prompt: "Write src/x/written.mjs, reading one default.",
    did: [{ changed: "^src/x/written\\.mjs$" }],
    checks: [{ name: "defaults use ??", claim: "defaults are taken with ??, not ||", dimension: "nullish_default", in: "^src/x/" }],
    ...scenarioOver(repo),
  }));
  const files = { out: join(work, "r.md"), data: join(work, "r.json"), raw: join(work, "raw.json"), scenario };
  let status = 0;
  let output = "";
  try {
    output = execFileSync(process.execPath, [join(root, "scripts", "ab-scenario.mjs"), "--repo", repo.dir, "--scenario", scenario, "--trials", "2", "--out", files.out, "--data", files.data, "--raw", files.raw], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
      env: { PATH: stub.path, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: work },
    });
  } catch (err) {
    status = err.status;
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
  return { status, output, files, repo };
}

test("a scenario run goes from a bare clone to its document, with the plugin on in one arm and off in the other", { skip: process.platform === "win32" && "the stub is a shell script" }, async (t) => {
  // Every step with only the model stubbed: commit check, scan, pin, scan,
  // arms, probe, trials, score, render, write. The dimension run's ReferenceError
  // lived past 2,500 unit tests because no case ran its file to the end.
  const { readFileSync } = await import("node:fs");
  const { status, output, files } = await runScenario(t, () => ({}));

  assert.equal(status, 0, output);
  assert.match(output, /injection verified: A said "src\/x/, output);
  const doc = readFileSync(files.out, "utf8");
  for (const line of [
    "# Plugin on against plugin off: defaults",
    "| repository | example.test/one/defaults |",
    "| trials per arm | 2, alternating, each from a clean checkout |",
    "| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |",
    "| trials that did the task | 2 of 2 (1.00, 95% 0.34 to 1.00) | 2 of 2 (1.00, 95% 0.34 to 1.00) | 1.000 |",
    "| defaults use ?? | 2 of 2 (1.00, 95% 0.34 to 1.00) | 0 of 2 (0.00, 95% 0.00 to 0.66) | 0.333 |",
    "| median cost per trial | $0.50 | $0.50 | |",
    "| median wall time per trial | 0s | 0s | |",
    "- defaults use ??: the map states \"defaults are taken with ??, not ||\"",
  ]) assert.ok(doc.includes(line), `missing: ${line}\n\n${doc}`);

  const data = JSON.parse(readFileSync(files.data, "utf8"));
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(readFileSync(files.scenario)).digest("hex");
  assert.equal(data.scenarioSha256, digest, "the record names the exact scenario file it was scored by");
  assert.ok(doc.includes(`sha256 ${digest.slice(0, 12)}`), doc);
  assert.deepEqual(data.a.map((x) => x.checks), [{ "defaults use ??": true }, { "defaults use ??": true }]);
  assert.deepEqual(data.b.map((x) => x.checks), [{ "defaults use ??": false }, { "defaults use ??": false }]);
  assert.ok(!JSON.stringify(data).includes("const a = {}"), "the committed record holds no file contents");
  const raw = JSON.parse(readFileSync(files.raw, "utf8"));
  assert.match(raw.b[0].wrote.find((f) => f.rel === "src/x/written.mjs").source, /\|\|/, "the raw record keeps them, to score again");
});

test("a scenario run refuses a clone at another commit before it spends anything", { skip: process.platform === "win32" && "the stub is a shell script" }, async (t) => {
  const { existsSync } = await import("node:fs");
  const { status, output, files } = await runScenario(t, () => ({ commit: "0".repeat(40) }));

  assert.equal(status, 2);
  assert.match(output, /the scenario was written against 0{40}/);
  assert.ok(!existsSync(files.out));
});

test("a scenario run refuses an area the map does not hold", { skip: process.platform === "win32" && "the stub is a shell script" }, async (t) => {
  const { status, output } = await runScenario(t, () => ({ area: "src/nowhere" }));

  assert.equal(status, 2);
  assert.match(output, /the map holds no area src\/nowhere/);
});

/** A raw record as `--raw` writes one: the run's identity and every trial whole. */
const rawRun = (sha, aOps, bOps, over = {}) => {
  const trialOf = (op) => ({
    ok: true,
    reason: null,
    wrote: [{ rel: "src/x/written.mjs", source: `const a = {};\nexport const w = a.q ${op} {};\n` }],
    spent: { costUsd: 0.5, wallMs: 2000, inputTokens: 1, outputTokens: 10, cacheReadTokens: 0 },
  });
  return {
    scenario: "s.json",
    label: "example.test/one/defaults",
    sha,
    engine: { model: "claude-opus-5-5", effort: "medium" },
    said: { a: "src/x, 20 files", b: "NONE" },
    frameworks: [],
    a: aOps.map(trialOf),
    b: bOps.map(trialOf),
    ...over,
  };
};

async function fromRaw(t, raws, scenarioOver = {}) {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { removeTree } = await import("./platform.mjs");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const work = mkdtempSync(join(tmpdir(), "anatomiya-fromraw-"));
  t.after(() => removeTree(work));
  const scenario = join(work, "s.json");
  writeFileSync(scenario, JSON.stringify({
    name: "defaults",
    repo: "example.test/one/defaults",
    commit: "a".repeat(40),
    area: "src/x",
    prompt: "Write src/x/written.mjs, reading one default.",
    did: [{ changed: "^src/x/written\\.mjs$" }],
    checks: [{ name: "defaults use ??", dimension: "nullish_default", in: "^src/x/" }],
    ...scenarioOver,
  }));
  const args = ["--scenario", scenario, "--out", join(work, "r.md"), "--data", join(work, "r.json")];
  for (const [i, raw] of raws.entries()) {
    const path = join(work, `raw-${i}.json`);
    writeFileSync(path, JSON.stringify(raw));
    args.push("--from-raw", path);
  }
  try {
    const output = execFileSync(process.execPath, [join(root, "scripts", "ab-scenario.mjs"), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin" } });
    return { status: 0, output, work };
  } catch (err) {
    return { status: err.status, output: `${err.stdout ?? ""}${err.stderr ?? ""}`, work };
  }
}

test("runs of one scenario are scored as one from their raw records, with no clone and no model", async (t) => {
  // A slow scenario runs as several workers; rescoring the kept records is what
  // joins them, and what lets a refined report read trials already paid for.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const sha = "a".repeat(40);

  const { status, output, work } = await fromRaw(t, [rawRun(sha, ["??", "??"], ["||", "??"]), rawRun(sha, ["??"], ["||"])]);

  assert.equal(status, 0, output);
  const doc = readFileSync(join(work, "r.md"), "utf8");
  for (const line of [
    "| trials per arm | 3, alternating, each from a clean checkout, over 2 runs |",
    "| defaults use ?? | 3 of 3 (1.00, 95% 0.44 to 1.00) | 1 of 3 (0.33, 95% 0.06 to 0.79) | 0.400 |",
    "| model | claude-opus-5-5 |",
  ]) assert.ok(doc.includes(line), `missing: ${line}\n\n${doc}`);
  const data = JSON.parse(readFileSync(join(work, "r.json"), "utf8"));
  assert.equal(data.a.length, 3);
  assert.equal(data.b.length, 3);
});

test("raw records of another commit or another engine are refused, not joined", async (t) => {
  const sha = "a".repeat(40);

  const commit = await fromRaw(t, [rawRun(sha, ["??"], ["||"]), rawRun("b".repeat(40), ["??"], ["||"])]);
  const engine = await fromRaw(t, [rawRun(sha, ["??"], ["||"]), rawRun(sha, ["??"], ["||"], { engine: { model: "claude-opus-5", effort: "medium" } })]);

  assert.equal(commit.status, 2);
  assert.match(commit.output, /was run at b{40}, and the scenario was written against a{40}/);
  assert.equal(engine.status, 2);
  assert.match(engine.output, /ran on claude-opus-5 at medium, and the first on claude-opus-5-5 at medium/);
});

test("a cost under ten cents keeps a third decimal, so a cheap model's trial does not read as free", async () => {
  // A Haiku trial cost about $0.004, and two decimals printed it as $0.00.
  const { money } = await import("../scripts/ab/render.mjs");
  assert.equal(money(0.0042), "$0.004");
  assert.equal(money(0.0951), "$0.095");
  assert.equal(money(0.5), "$0.50");
  assert.equal(money(6.912), "$6.91");
  assert.equal(money(null), "not reported");
});
