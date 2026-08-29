// test/ab.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rankAreas } from "../scripts/ab/pick.mjs";
import { scoreFile } from "../scripts/ab/score.mjs";
import { readingFor } from "../scripts/ab/read.mjs";
import { repoLabel } from "../scripts/ab/label.mjs";
import { needsShebang } from "./platform.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A `claude` earlier on PATH than the real one, running the script given.
 *
 * Running the real one would reach the network and cost a trial per assertion,
 * and what these cases are about is the argv and the environment the harness
 * hands over, and the answer it reads back, all of which a stub settles.
 */
function stubClaude(t, script) {
  const base = mkdtempSync(join(tmpdir(), "anatomiya-stub-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = join(base, "bin");
  const arm = join(base, "arm");
  mkdirSync(bin);
  mkdirSync(arm);
  const stub = join(bin, "claude");
  writeFileSync(stub, `#!/bin/sh\n${script(base)}\n`);
  chmodSync(stub, 0o755);
  return {
    arm,
    // The system directories come too: the stub is a shell script, and a PATH
    // holding only its own directory cannot resolve the commands it runs.
    path: [bin, "/usr/bin", "/bin"].join(":"),
    argv: () => readFileSync(join(base, "argv.txt"), "utf8").trim().split("\n"),
    env: () => new Map(
      readFileSync(join(base, "env.txt"), "utf8")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
    ),
  };
}

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
  for (const p of ["/Users/crisn/x/y", "/home/crisn/x/y", "C:\\Users\\crisn\\x"]) {
    assert.doesNotMatch(repoLabel(p, null), /Users|home|crisn/);
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
  const { MIN_BUNDLE } = await import("../plugins/ultracode-anywhere/hooks/upstream.mjs");
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
  const { cliPath } = await import("../plugins/ultracode-anywhere/hooks/upstream.mjs");

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
  t.after(() => rmSync(arm, { recursive: true, force: true }));
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

test("an arm whose settings cannot be removed fails the run instead of leaking a worktree", needsShebang, async (t) => {
  // unlinkSync throws on a read-only directory, and a throw between creating
  // the worktrees and returning their disposer left one registered in the
  // repository being measured.
  const { dropSettings } = await import("../scripts/ab/arms.mjs");
  const arm = mkdtempSync(join(tmpdir(), "anatomiya-ro-"));
  t.after(() => { chmodSync(join(arm, ".claude"), 0o755); rmSync(arm, { recursive: true, force: true }); });
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
  // Read out of 2.1.251 rather than reasoned from the name. It is an off
  // switch, not an enabler: the build tests it with a helper that answers true
  // for 0, false, no and off, and its only outcome is short-circuiting the
  // served-catalog mode to "off". The catalog that mode gates fetches an
  // organisation's model list, compares it against the model, window and output
  // cap the CLI already resolved, and logs the comparison. Nothing writes the
  // answer back, in either of the two live modes. So no value of this can make
  // two arms run different engines, which is the only thing the scrub is for.
  // A ruling about what a build does, not about a name: if a later build ever
  // applies the catalog rather than logging it, this row goes stale with
  // nothing here to notice, and the read to redo is the consumer of that mode.
  ["CLAUDE_CODE_MODEL_CATALOG", "an off switch for a catalog that is compared and logged, never applied"],
]);

test("the build carries no engine-shaped variable this run has not decided about", async (t) => {
  // The scrub list is hand-written against one build, and the build gains
  // variables every release. Left to rot it is a guess, and every row still
  // says medium. This reads the installed build for anything shaped like a
  // model, an effort or a thinking budget and fails on one nobody has ruled on.
  const { overridesEngine } = await import("../scripts/ab/engine.mjs");
  const { cliPath } = await import("../plugins/ultracode-anywhere/hooks/upstream.mjs");

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
  const { MIN_BUNDLE } = await import("../plugins/ultracode-anywhere/hooks/upstream.mjs");
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
