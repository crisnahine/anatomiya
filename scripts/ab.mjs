#!/usr/bin/env node
/**
 * The with-map / without-map diff on one stated claim (G5); what a whole
 * session gets from the plugin is `scripts/ab-scenario.mjs` (G18).
 *
 * Never a review-comment count: comment data only sees what got through review,
 * preventable comments were 8.5% of a measured 4,616-comment corpus, and 93.5%
 * of pull requests held at least one comment the map could not have prevented,
 * so they came back anyway.
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
import { rankAreas, noHeadroom } from "./ab/pick.mjs";
import { buildArms, probeFor } from "./ab/arms.mjs";
import { runTrial } from "./ab/run.mjs";
import { engineRan } from "./ab/engine.mjs";
import { scoreArm } from "./ab/score.mjs";
import { render } from "./ab/render.mjs";
import { repoLabel } from "./ab/label.mjs";
import { BINARY } from "./plugins.mjs";
import { die, invokedAs } from "./entry.mjs";
import { isCorpusPath } from "../plugins/anatomiya/lib/corpus.mjs";
import { FACTS_PATH, factsAt } from "../plugins/anatomiya/lib/facts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) die(`${args.error}\n\n${USAGE}`);

  // No settings gate: a trial loads only the project and local sources, which
  // `buildArms` has cleared, so the operator's own settings never reach one.

  // 1. A map measured against an accepted baseline, which is what arm A is for.
  mapAndPin(args.repo);

  // 2. Where the arms could differ at all.
  const { facts, problem } = factsAt(join(args.repo, FACTS_PATH));
  if (problem) die(`${FACTS_PATH} in ${args.repo} was not read: ${problem.why}`);
  // A named target measures the claim the experiment is about; the ranking is
  // the default for when the question is only "where is there headroom".
  const ranked = rankAreas(facts).filter(
    (r) => (!args.key || r.key === args.key) && (!args.area || r.path === args.area)
  );
  const target = ranked[0];
  const refused = noHeadroom(target, args);
  if (refused) die(refused);
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

    // 3. Two checkouts of one commit, one holding the map.
    const arms = await buildArms(args.repo, sha);
    try {
      // 4. An unverified arm is not an arm.
      const said = await verifyInjection(arms, probeFileIn(args.repo, target.path), target.path, args.engine);

      // 5. The trials.
      const trials = await runTrials(arms, prompt, args.engine, args.trials);

      // 6. The result file quotes the engine the trials reported, not the flags they
      // were given. A run whose arms answered from two engines measured nothing.
      const ran = engineRan(args.engine, [...trials.a, ...trials.b]);
      if (ran.error) throw new Error(ran.error);
      if (ran.note) console.log(ran.note);
      result = { target, sha, label, said, engine: ran.engine, ...(await scoreTrials(trials, target, facts.corpus?.frameworks ?? [])) };
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

/** Scan, pin, then scan again, so the map arm A copies is measured against an accepted baseline. */
export function mapAndPin(repo) {
  for (const verb of ["scan", "pin", "scan"]) execFileSync(process.execPath, [BINARY, verb, repo], { stdio: "inherit" });
}

/**
 * A file under `area` the corpus holds, to probe with, because the map's own
 * globs are what attach it: a tracked file the scan excluded attaches nothing,
 * and a hand-kept extension list here missed every `.mjs` repository, this one
 * included. Throws where the area holds none.
 */
export function probeFileIn(repo, area) {
  const found = execFileSync("git", ["ls-files", "-z", "--", `${area}/`], { cwd: repo, encoding: "utf8" })
    .split("\0")
    .find((f) => f && isCorpusPath(f));
  if (!found) throw new Error(`no readable file under ${area} to probe with`);
  return found;
}

/**
 * Ask each arm what map it was given for `file`, and refuse the run where arm A
 * did not name `area` or arm B named anything. `perArm` holds what only one arm
 * runs with, such as no plugin at all.
 */
export async function verifyInjection(arms, file, area, engine, log = console.log, perArm = {}) {
  const probe = probeFor(file);
  const said = {};
  for (const name of ["a", "b"]) {
    const r = await runTrial(arms[name], probe, { ...engine, ...perArm[name], tools: ["Read"] });
    if (!r.ok) throw new Error(`the probe could not run in arm ${name}: ${r.reason}`);
    said[name] = r.stdout.trim().split("\n").at(-1) ?? "";
  }
  if (!said.a.includes(area)) throw new Error(`arm A did not receive the map: it answered "${said.a}"`);
  if (!/NONE/i.test(said.b)) throw new Error(`arm B received a map it should not have: it answered "${said.b}"`);
  log(`injection verified: A said "${said.a}", B said "${said.b}"`);
  return said;
}

/**
 * Alternating, so a rate limit partway through hits both arms equally, and each
 * from the commit, so no trial starts from another's files. `perArm` is as for
 * `verifyInjection`.
 */
export async function runTrials(arms, prompt, engine, count, log = console.log, perArm = {}) {
  const trials = { a: [], b: [] };
  for (let i = 0; i < count; i++) {
    for (const name of ["a", "b"]) {
      await arms.reset();
      const r = await runTrial(arms[name], prompt, { ...engine, ...perArm[name] });
      trials[name].push(r);
      const why = !r.ok ? `, ended early: ${r.reason}` : r.wrote.length ? "" : `, wrote nothing: ${r.reason}`;
      log(`  trial ${i + 1} arm ${name}: ${r.wrote.length} file(s)${why}`);
    }
  }
  return trials;
}

/** Both arms scored by the predicate the map stated, never by a second one. */
export async function scoreTrials(trials, target, frameworks) {
  const options = { key: target.key, frameworks, learned: target.learned ?? null, learnedKind: target.learnedKind ?? null };
  return { a: await scoreArm(trials.a, options), b: await scoreArm(trials.b, options) };
}

// One function rather than module scope, so every binding the seven steps share
// is declared where all of them can read it: two declared inside the `try`
// around the trials were read after it, and the document threw once every
// trial had been paid for.
if (invokedAs(import.meta.url)) await main(process.argv.slice(2));

