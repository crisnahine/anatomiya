#!/usr/bin/env node
/**
 * The plugin on against the plugin off, on one task, scored by checks written
 * down before any trial ran (G18).
 *
 * `scripts/ab.mjs` asks whether the map moves one stated claim, with the
 * plugin loaded in both arms and the tools cut to four so no shell can reach a
 * rule file. This asks what a user gets: arm A is the product, map and hooks,
 * and arm B is a session without it, both with the tools a coding session has.
 * A shell is safe here because arm B holds no map to read, and each arm sits
 * alone, so neither can find the other.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parseScenarioArgs, SCENARIO_USAGE } from "./ab/args.mjs";
import { buildArms } from "./ab/arms.mjs";
import { parseScenario, scoreScenario } from "./ab/checks.mjs";
import { engineRan } from "./ab/engine.mjs";
import { renderScenario } from "./ab/render.mjs";
import { mapAndPin, probeFileIn, runTrials, verifyInjection } from "./ab.mjs";
import { die, invokedAs } from "./entry.mjs";
import { RESULTS_ROOT, runFrozen } from "./frozen-build.mjs";
import { FACTS_PATH, factsAt } from "../plugins/anatomiya/lib/facts.mjs";
import { ANATOMIYA } from "./plugins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Where a result file goes and what a path in it is shown relative to: the checkout a frozen run was started from, else this one.
const results = process.env[RESULTS_ROOT] ?? root;

/** What a coding session holds, the subagent tool included, since the reuse check asks for one. */
const SCENARIO_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Agent"];
const SCENARIO_MAX_TURNS = 40;
const SCENARIO_TIMEOUT_MS = 20 * 60 * 1000;

/** Arm B runs without the plugin: no map and no hooks. */
const PLUGIN_OFF = { b: { pluginDir: null } };

async function main(argv) {
  const args = parseScenarioArgs(argv);
  if (args.error) die(`${args.error}\n\n${SCENARIO_USAGE}`);
  // The run is the harness at that commit, binary and plugin both, and its `versionsAt` reads that checkout.
  if (args.frozen !== undefined) {
    const ran = runFrozen(args.frozen, "scripts/ab-scenario.mjs", argv);
    if (ran.error) die(ran.error);
    process.exit(ran.status);
  }
  const scenarioText = readFileSync(args.scenario, "utf8");
  const parsed = parseScenario(scenarioText);
  if (parsed.error) die(`${args.scenario}: ${parsed.error}`);
  const { scenario } = parsed;

  // The digest is what shows a reader the scenario was not edited after its trials.
  const scenarioSha256 = createHash("sha256").update(scenarioText).digest("hex");
  const run = args.fromRaw ? readKept(args.fromRaw, scenario, { file: args.scenario, digest: scenarioSha256 }) : await runFresh(args, scenario);
  const label = scenario.repo;
  const result = {
    scenario,
    sha: run.sha,
    label,
    said: run.said,
    engine: run.engine,
    versions: run.versions,
    a: await scoreScenario(run.trials.a, scenario, run.frameworks),
    b: await scoreScenario(run.trials.b, scenario, run.frameworks),
  };

  const out = args.out ?? join(results, "docs/measurements", `${scenario.name}.md`);
  const data = args.data ?? join(results, "docs/measurements/data", `${scenario.name}.json`);
  const shown = (p) => relative(results, p).split("\\").join("/");
  const record = { scenario: shown(args.scenario), scenarioSha256, label, sha: run.sha, engine: result.engine, versions: run.versions, said: result.said };
  const writeJson = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  };
  writeJson(data, { ...record, a: result.a.perTrial, b: result.b.perTrial });
  if (args.raw) writeJson(args.raw, { ...record, frameworks: run.frameworks, a: run.trials.a, b: run.trials.b });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderScenario(result, { trials: run.trials.a.length, runs: run.runs, tools: SCENARIO_TOOLS, maxTurns: SCENARIO_MAX_TURNS, scenarioPath: shown(args.scenario), scenarioSha256, dataPath: shown(data) }));
  console.log(`wrote ${out} and ${data}`);
}

/** Scan, pin and scan the clone, verify both arms, and run the trials. */
async function runFresh(args, scenario) {
  // The scenario names its commit, so a rerun measures the same tree or refuses.
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: args.repo, encoding: "utf8" }).trim();
  if (sha !== scenario.commit) die(`${args.repo} is at ${sha}, and the scenario was written against ${scenario.commit}`);

  // Before any trial: read after them, a build that changed mid-run is the one recorded.
  const versions = versionsAt(root);
  mapAndPin(args.repo);
  const { facts, problem } = factsAt(join(args.repo, FACTS_PATH));
  if (problem) die(`${FACTS_PATH} in ${args.repo} was not read: ${problem.why}`);
  if (!(facts.areas ?? []).some((a) => a.path === scenario.area)) die(`the map holds no area ${scenario.area}`);

  // The scenario's own name for the repository, never the path it sits at here.
  const arms = await buildArms(args.repo, sha, { name: scenario.repo.split("/").at(-1) });
  const options = { ...args.engine, tools: SCENARIO_TOOLS, maxTurns: SCENARIO_MAX_TURNS, timeoutMs: SCENARIO_TIMEOUT_MS };
  let failed;
  try {
    const probeFile = scenario.probe ?? probeFileIn(args.repo, scenario.area);
    const said = await verifyInjection(arms, probeFile, scenario.area, args.engine, console.log, PLUGIN_OFF);
    const trials = await runTrials(arms, scenario.prompt, options, args.trials, console.log, PLUGIN_OFF);
    const ran = engineRan(args.engine, [...trials.a, ...trials.b]);
    if (ran.error) throw new Error(ran.error);
    if (ran.note) console.log(ran.note);
    return { sha, said, engine: ran.engine, versions, trials, frameworks: facts.corpus?.frameworks ?? [], runs: 1 };
  } catch (err) {
    failed = err;
  } finally {
    await arms.dispose();
  }
  die(failed.message);
}

/**
 * The Claude Code and the anatomiya build the trials ran on, so a rerun can use
 * the same ones. A plugin with uncommitted changes says so.
 */
export function versionsAt(repoRoot) {
  const line = (command, argv) => {
    try {
      return execFileSync(command, argv, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0] || null;
    } catch {
      return null;
    }
  };
  const plugin = join(repoRoot, relative(root, ANATOMIYA));
  const { version } = JSON.parse(readFileSync(join(plugin, ".claude-plugin", "plugin.json"), "utf8"));
  const commit = line("git", ["rev-parse", "--short=12", "HEAD"]);
  // The harness decides what a trial is given and how it is scored, so it counts as the build too.
  const changed = line("git", ["status", "--porcelain", "--", plugin, join(repoRoot, "scripts"), join(repoRoot, "package-lock.json")]);
  return { claude: line("claude", ["--version"]), anatomiya: `${version}${commit ? ` at ${commit}` : ""}${changed ? ", with uncommitted changes" : ""}` };
}

/**
 * Raw records of earlier runs of this scenario, joined: one commit, one engine,
 * so trials paid for once can be scored again or several workers read as one run.
 */
function readKept(paths, scenario, { file, digest }) {
  const kept = paths.map((path) => ({ path, raw: JSON.parse(readFileSync(path, "utf8")) }));
  const named = basename(file);
  const engineOf = (raw) => `${raw.engine?.model} at ${raw.engine?.effort}`;
  const builtOf = (raw) => (raw.versions ? `claude ${raw.versions.claude}, anatomiya ${raw.versions.anatomiya}` : "no recorded build");
  const needsFrameworks = scenario.checks.some((c) => c.kind === "dimension");
  for (const { path, raw } of kept) {
    if (raw.sha !== scenario.commit) die(`${path} was run at ${raw.sha}, and the scenario was written against ${scenario.commit}`);
    // Two scenarios can share a commit, so the record has to name this one.
    if (typeof raw.scenario !== "string") die(`${path} names no scenario, so nothing ties it to ${named}`);
    if (basename(raw.scenario) !== named) die(`${path} was run with ${basename(raw.scenario)}, not ${named}`);
    if (typeof raw.scenarioSha256 === "string" && raw.scenarioSha256 !== digest) {
      die(`${path} was scored by a scenario file whose sha256 is ${raw.scenarioSha256.slice(0, 12)}, and ${named} is ${digest.slice(0, 12)} now`);
    }
    if (engineOf(raw) !== engineOf(kept[0].raw)) die(`${path} ran on ${engineOf(raw)}, and the first on ${engineOf(kept[0].raw)}`);
    if (builtOf(raw) !== builtOf(kept[0].raw)) die(`${path} ran on ${builtOf(raw)}, and the first on ${builtOf(kept[0].raw)}`);
    if (needsFrameworks && !Array.isArray(raw.frameworks)) die(`${path} records no frameworks, which a dimension check reads`);
  }
  const [first] = kept.map((k) => k.raw);
  return {
    sha: first.sha,
    said: first.said,
    engine: first.engine,
    versions: first.versions ?? null,
    trials: { a: kept.flatMap((k) => k.raw.a), b: kept.flatMap((k) => k.raw.b) },
    frameworks: first.frameworks ?? [],
    runs: kept.length,
  };
}

if (invokedAs(import.meta.url)) await main(process.argv.slice(2));
