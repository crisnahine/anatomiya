#!/usr/bin/env node
/**
 * The with-map / without-map diff, which is the only success measure this tool
 * accepts (G5).
 *
 * Never a review-comment count: comment data only sees what got through review,
 * preventable comments were 8.5% of a measured 4,616-comment corpus, and 93.5%
 * of pull requests held none at all. The pre-review effect is unmeasured, which
 * is a different thing from disproven, and this is what measures it.
 *
 * The order below is the experiment. Step 4 is the one that makes the rest
 * mean anything: an arm where the map did not attach, or an arm where it
 * attached and should not have, measured nothing at all.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { rankAreas, NO_HEADROOM } from "./ab/pick.mjs";
import { buildArms, installMap, PROBE } from "./ab/arms.mjs";
import { runTrial, CLAUDE_DEFAULTS } from "./ab/run.mjs";
import { conflictingSettings, engineFor, engineRan } from "./ab/engine.mjs";
import { settingsFor } from "../plugins/ultracode-anywhere/hooks/upstream.mjs";
import { scoreFile } from "./ab/score.mjs";
import { readingFor } from "./ab/read.mjs";
import { repoLabel } from "./ab/label.mjs";
import { BINARY } from "./plugins.mjs";
import { language } from "../plugins/anatomiya/lib/langs.mjs";
import { FACTS_PATH } from "../plugins/anatomiya/lib/facts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `usage: node scripts/ab.mjs --repo <path> --task <file> [options]

  --repo <path>      the repository to measure, scanned and pinned in place
  --task <file>      a file holding the prompt both arms are given
  --trials <n>       trials per arm (default 10)
  --model <name>     model for every trial (default ${CLAUDE_DEFAULTS.model}); quote it, since
                     the bracketed suffix is a glob in most shells
  --effort <level>   effort for every trial (default ${CLAUDE_DEFAULTS.effort})
  --out <path>       where to write the result (default docs/measurements/<repo>.md)
  --min-headroom <r> refuse below this (default 0.05)
  --key <dimension>  measure this claim rather than the top-ranked one
  --area <path>      measure in this area rather than the top-ranked one
`;

function parseArgs(argv) {
  const out = { trials: 10, model: CLAUDE_DEFAULTS.model, effort: CLAUDE_DEFAULTS.effort, minHeadroom: 0.05 };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) return { error: `${flag} takes a value` };
    switch (flag) {
      case "--repo": out.repo = value; break;
      case "--task": out.task = value; break;
      case "--trials": out.trials = Number(value); break;
      case "--model": out.model = value; break;
      case "--effort": out.effort = value; break;
      case "--out": out.out = value; break;
      case "--min-headroom": out.minHeadroom = Number(value); break;
      case "--key": out.key = value; break;
      case "--area": out.area = value; break;
      default: return { error: `unknown option ${flag}` };
    }
  }
  if (!out.repo || !out.task) return { error: "both --repo and --task are required" };
  if (!Number.isInteger(out.trials) || out.trials < 1) return { error: "--trials takes a positive integer" };
  const engine = engineFor(out);
  if (engine.error) return { error: engine.error };
  const { model, effort, ...rest } = out;
  return { ...rest, engine };
}

const die = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};

const args = parseArgs(process.argv.slice(2));
if (args.error) die(`${args.error}\n\n${USAGE}`);

// 0. The settings Claude Code will read, before anything is spent on a run they
// would decide. `engineEnv` cannot reach them: a settings file is read by the
// child after it starts. The measured repository's own are not among them, since
// the trials run in arms `buildArms` has already cleared.
const inForce = conflictingSettings(settingsFor(process.env), args.engine);
if (inForce) die(inForce);

// 1. A map measured against an accepted baseline, which is what arm A is for.
execFileSync(process.execPath, [BINARY, "scan", args.repo], { stdio: "inherit" });
execFileSync(process.execPath, [BINARY, "pin", args.repo], { stdio: "inherit" });
execFileSync(process.execPath, [BINARY, "scan", args.repo], { stdio: "inherit" });

// 2. Where the arms could differ at all.
const facts = JSON.parse(readFileSync(join(args.repo, FACTS_PATH), "utf8"));
// A named target measures the claim the experiment is about; the ranking is
// the default for when the question is only "where is there headroom".
const ranked = rankAreas(facts).filter(
  (r) => (!args.key || r.key === args.key) && (!args.area || r.path === args.area)
);
const target = ranked[0];
if (!target || target.headroom < args.minHeadroom) {
  die(
    `${NO_HEADROOM}\n\nbest available: ${target ? `${target.key} in ${target.path} at ${target.ratio.toFixed(3)}, headroom ${target.headroom.toFixed(3)}` : "no stated claim at all"}`
  );
}
console.log(`measuring ${target.key} in ${target.path}: ${target.ratio.toFixed(3)}, headroom ${target.headroom.toFixed(3)}`);

const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: args.repo, encoding: "utf8" }).trim();
// What the result file calls this repository. Never the path it sits at: the
// file is a document other people read, and a home directory is neither theirs
// nor checkable.
let origin = null;
try {
  try {
    origin = execFileSync("git", ["remote", "get-url", "origin"], { cwd: args.repo, encoding: "utf8" }).trim();
  } catch {
    // A clone with no origin names itself by its directory, which is all it has.
  }
  const label = repoLabel(args.repo, origin);
  const prompt = readFileSync(args.task, "utf8");

  // 3. Two worktrees off one commit, one holding the map.
  const arms = await buildArms(args.repo, sha);
  let result;
  try {
    installMap(args.repo, arms.a);

    // 4. An unverified arm is not an arm.
    const probeFile = execFileSync("git", ["ls-files", `${target.path}/`], { cwd: args.repo, encoding: "utf8" })
      .split("\n")
      .find((f) => f && [".rb", ".ts", ".tsx", ".js", ".jsx"].includes(extname(f)));
    if (!probeFile) throw new Error(`no readable file under ${target.path} to probe with`);

    const probe = PROBE.replace("{file}", probeFile);
    const said = {};
    for (const [name, arm] of [["a", arms.a], ["b", arms.b]]) {
      const r = await runTrial(arm, probe, { ...args.engine, tools: ["Read"] });
      if (!r.ok) throw new Error(`the probe could not run in arm ${name}: ${r.reason}`);
      said[name] = r.stdout.trim().split("\n").at(-1) ?? "";
    }
    if (!said.a.includes(target.path)) throw new Error(`arm A did not receive the map: it answered "${said.a}"`);
    if (!/NONE/i.test(said.b)) throw new Error(`arm B received a map it should not have: it answered "${said.b}"`);
    console.log(`injection verified: A said "${said.a}", B said "${said.b}"`);

    // 5. Alternating, so a rate limit partway through hits both arms equally.
    const trials = { a: [], b: [] };
    for (let i = 0; i < args.trials; i++) {
      for (const name of ["a", "b"]) {
        const r = await runTrial(name === "a" ? arms.a : arms.b, prompt, args.engine);
        trials[name].push(r);
        console.log(`  trial ${i + 1} arm ${name}: ${r.ok ? `${r.wrote.length} file(s)` : `failed, ${r.reason}`}`);
      }
    }

    // 6. Scored by the predicate the map stated, never by a second one.
    const score = async (runs) => {
      const out = { wroteSomething: 0, filesScored: 0, candidates: 0, conforming: 0, trialsWithAViolation: 0 };
      for (const r of runs) {
        if (!r.ok || !r.wrote.length) continue;
        out.wroteSomething++;
        let violated = false;
        for (const file of r.wrote) {
          const s = await scoreFile(
            { rel: file.rel, source: file.source, lang: language(file.rel) },
            { key: target.key, frameworks: facts.corpus?.frameworks ?? [], learned: target.learned ?? null }
          );
          if (!s) continue;
          out.filesScored++;
          out.candidates += s.candidates;
          out.conforming += s.conforming;
          if (s.conforming < s.candidates) violated = true;
        }
        if (violated) out.trialsWithAViolation++;
      }
      return out;
    };
    // The result file quotes the engine the trials reported, not the flags they
    // were given. A run whose arms answered from two engines measured nothing.
    const ran = engineRan(args.engine, [...trials.a, ...trials.b]);
    if (ran.error) throw new Error(ran.error);
    if (ran.note) console.log(ran.note);
    result = { target, sha, label, said, engine: ran.engine, a: await score(trials.a), b: await score(trials.b) };
  } finally {
    await arms.dispose();
  }
} catch (err) {
  die(err.message);
}

// 7. The file a reader quotes.
const out = args.out ?? join(root, "docs/measurements", `${label.split("/").at(-1)}.md`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, render(result, args));
console.log(`wrote ${out}`);

function render(r, o) {
  const { target: t, a, b } = r;
  const pct = (x) => (x.candidates ? (x.conforming / x.candidates).toFixed(3) : "no sites");
  return `# A/B: ${r.label} at ${r.sha.slice(0, 8)}

| setting | value |
|---|---|
| repository | ${r.label} |
| commit | ${r.sha} |
| area | ${t.path} |
| claim | ${t.claim} |
| baseline | ${Math.round(t.ratio * t.candidates)} of ${t.candidates}, ratio ${t.ratio.toFixed(3)} |
| headroom | ${t.headroom.toFixed(3)} |
| model | ${r.engine.model} |
| effort | ${r.engine.effort} |
| context window | ${r.engine.contextWindow ?? "not reported"} |${r.engine.asked ? `
| asked for | ${r.engine.asked}, which is not what served it |` : ""}
| trials per arm | ${o.trials} |
| tools | ${CLAUDE_DEFAULTS.tools.join(", ")} |
| max turns | ${CLAUDE_DEFAULTS.maxTurns} |

Injection: arm A answered "${r.said.a}", arm B answered "${r.said.b}".

| measure | with map | no map |
|---|---|---|
| trials that wrote a file | ${a.wroteSomething}/${o.trials} | ${b.wroteSomething}/${o.trials} |
| files scored | ${a.filesScored} | ${b.filesScored} |
| sites conforming | ${a.conforming} of ${a.candidates} (${pct(a)}) | ${b.conforming} of ${b.candidates} (${pct(b)}) |
| trials with a violating site | ${a.trialsWithAViolation} | ${b.trialsWithAViolation} |

## Reading this

${readingFor({ a, b }, t.headroom)}

Scored by ${t.key}'s own predicate through the same reducer the scan uses, so the number above and
the number the map states are the same number. Files the dimension found no site in are not counted
in either arm, because a trial that wrote something unrelated is not evidence either way.
`;
}
