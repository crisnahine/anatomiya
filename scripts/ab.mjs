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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs, USAGE } from "./ab/args.mjs";
import { rankAreas, NO_HEADROOM } from "./ab/pick.mjs";
import { buildArms, installMap, probeFor } from "./ab/arms.mjs";
import { runTrial } from "./ab/run.mjs";
import { conflictingSettings, engineRan } from "./ab/engine.mjs";
import { settingsFor } from "../plugins/ultracode-anywhere/hooks/upstream.mjs";
import { scoreArm } from "./ab/score.mjs";
import { render } from "./ab/render.mjs";
import { repoLabel } from "./ab/label.mjs";
import { BINARY } from "./plugins.mjs";
import { invokedAs } from "./entry.mjs";
import { isCorpusPath } from "../plugins/anatomiya/lib/corpus.mjs";
import { FACTS_PATH } from "../plugins/anatomiya/lib/facts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const die = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};

async function main(argv) {
  const args = parseArgs(argv);
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
  let label;
  let result;
  try {
    try {
      origin = execFileSync("git", ["remote", "get-url", "origin"], { cwd: args.repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      // A clone with no origin names itself by its directory, which is all it has.
    }
    label = repoLabel(args.repo, origin);
    const prompt = readFileSync(args.task, "utf8");

    // 3. Two worktrees off one commit, one holding the map.
    const arms = await buildArms(args.repo, sha);
    try {
      installMap(args.repo, arms.a);

      // 4. An unverified arm is not an arm.
      // A file the corpus holds, because the map's own globs are what attach it:
      // a tracked file the scan excluded attaches nothing, and a hand-kept
      // extension list here missed every `.mjs` repository, this one included.
      const probeFile = execFileSync("git", ["ls-files", "-z", "--", `${target.path}/`], { cwd: args.repo, encoding: "utf8" })
        .split("\0")
        .find((f) => f && isCorpusPath(f));
      if (!probeFile) throw new Error(`no readable file under ${target.path} to probe with`);

      const probe = probeFor(probeFile);
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
      const arm = (runs) => scoreArm(runs, { key: target.key, frameworks: facts.corpus?.frameworks ?? [], learned: target.learned ?? null });
      // The result file quotes the engine the trials reported, not the flags they
      // were given. A run whose arms answered from two engines measured nothing.
      const ran = engineRan(args.engine, [...trials.a, ...trials.b]);
      if (ran.error) throw new Error(ran.error);
      if (ran.note) console.log(ran.note);
      result = { target, sha, label, said, engine: ran.engine, a: await arm(trials.a), b: await arm(trials.b) };
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
}

// One function rather than module scope, so every binding the seven steps share
// is declared where all of them can read it: two declared inside the `try`
// around the trials were read after it, and the document threw once every
// trial had been paid for.
if (invokedAs(import.meta.url)) await main(process.argv.slice(2));

