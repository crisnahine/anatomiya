// lib/semantic.mjs
/**
 * The second tier: `typescript@5`'s checker, opt-in and never the default.
 *
 * A deep scan measured about 3x a plain one, and the checker is whole-program,
 * so narrowing its file set does not buy the time back: driving the corpus down
 * drove unresolved types from 3.1% to 36.2%. Major 5 is pinned because 7 is the Go
 * port and publishes no JS API at all.
 */

const SEMANTIC_MIN_MAJOR = 5;

/**
 * The checker, or null.
 *
 * Imported by specifier from this module, so ESM resolves it from the plugin's
 * own node_modules and never from the repository being scanned. A repository
 * can ship its own `typescript`, and importing that one would run
 * repository-controlled code inside this process.
 */
export async function loadTypeScript({ specifier = "typescript" } = {}) {
  const ts = await importTypeScript(specifier);
  return usable(ts) ? { ts, version: String(ts.version) } : null;
}

async function importTypeScript(specifier) {
  try {
    const mod = await import(specifier);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

function usable(ts) {
  return Boolean(ts) && unusableReason(ts) === null;
}

/** What doctor and `--deep` both say of a typescript that loads and cannot run this tier, or null. */
export function unusableReason(ts) {
  if (Number(String(ts?.version ?? "").split(".")[0]) !== SEMANTIC_MIN_MAJOR) return `--deep needs typescript ${SEMANTIC_MIN_MAJOR}.x`;
  if (typeof ts.createProgram !== "function") return "--deep needs a typescript that exports createProgram";
  return null;
}

/**
 * What `--deep` refuses with. The remedy is handed in rather than spelled here:
 * the engine table owns every install sentence, and importing the module that
 * reads it would pull the Ruby bridge and its walkers into the checker child,
 * which forks this file, for one line of prose.
 */
export function notInstalledMessage(remedy) {
  return [
    "--deep needs typescript, which is an optional dependency and is not installed",
    `${remedy}, or scan again without --deep`,
  ].join("\n");
}

/**
 * Why `--deep` cannot run, or null when it can. Absent and the wrong major are
 * told apart, because one install fixes both and only one of them is absent.
 */
export async function deepRefusal(remedy, { specifier = "typescript" } = {}) {
  const ts = await importTypeScript(specifier);
  if (!ts) return notInstalledMessage(remedy);
  const why = unusableReason(ts);
  if (!why) return null;
  const found = ts.version ? `typescript ${ts.version}` : "typescript of no version";
  return [`${found}: ${why}`, `${remedy}, or scan again without --deep`].join("\n");
}

import { guardedChild } from "./child.mjs";
import { guardsOver } from "./limits.mjs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const WORKER = fileURLToPath(new URL("./semantic-worker.mjs", import.meta.url));

export const SEMANTIC_GUARDS = {
  // The program build is one long silence before any file is answered, and it
  // is the expensive half: 160 files/sec is the throughput once it exists.
  buildMs: 10 * 60 * 1000,
  // After the build, silence means a stall rather than a large repository, the
  // same reading the Ruby bridge takes.
  idleMs: 60 * 1000,
};

/**
 * The share of property accesses whose receiver resolved to a real type.
 *
 * A working threshold, not a measured constant. Measured healthy is 89.5% and a
 * broken tsconfig is 39.8%, and this sits between them with room for a
 * repository that is honestly half untyped. Move it with numbers.
 */
export const RESOLUTION_FLOOR = 0.8;

export function classifySemantic({ config, resolution }) {
  const total = resolution?.total ?? 0;
  const rate = total > 0 ? resolution.resolved / total : null;
  if (config && config.status === "degraded") {
    return { status: "degraded", reason: config.reason, typedResolutionRate: rate };
  }
  // A corpus with no property access anywhere is a small or a plain-JS one, and
  // reading that as a broken config would degrade every repository that has
  // nothing for the checker to resolve. A config that read with a note of its
  // own, which is a root with no tsconfig at all, gives that note as the cause.
  if (rate !== null && rate < RESOLUTION_FLOOR) {
    return { status: "degraded", reason: config?.reason ?? "low-resolution", typedResolutionRate: rate };
  }
  return { status: "ok", reason: null, typedResolutionRate: rate };
}

/**
 * One whole-corpus checker run.
 *
 * Every failure answers itself rather than an empty result: a child that will
 * not start, a build that never finished, a stall, and a checker that is not
 * installed are four different things to do about it, and folding them into
 * "no hits" is the shape B13 and F15 both closed elsewhere. A bag naming a
 * guard the checker does not have is a caller's mistake rather than a run,
 * and rejects the way `parseAll` refuses one.
 *
 * The rate here is over every file; `semanticOver` narrows it.
 */
export function runSemantic(root, files, { guards: given = null, workerPath = WORKER, cwd = tmpdir() } = {}) {
  return new Promise((resolve) => {
    // Inside the promise so a bad bag rejects rather than throws, which is how
    // `parseAll` answers one for either parse bridge. Taken whole, a bag naming
    // only `idleMs` armed the build window with nothing.
    const guards = guardsOver(SEMANTIC_GUARDS, given, "checker");
    const records = new Map();
    let config = null;
    let built = false;
    let done = false;
    let settled = false;
    // The first silence is the whole program build and every silence after it
    // is a stall, so the window the clock is armed with moves once.
    let quiet = guards.buildMs;

    const sup = guardedChild({
      kind: "fork",
      modulePath: workerPath,
      // Named rather than inlined so the spawn-failure path has a way to be
      // reached from a test: a cwd that is not there is what makes fork emit
      // 'error' rather than exit.
      cwd,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      stderrBytes: 4096,
      idleMs: guards.idleMs,
      onTimeout: () => finish(`the checker went quiet for ${Math.round(quiet / 1000)}s`),
    });
    const child = sup.child;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      sup.settle();
      sup.kill("finished");
      if (error) return resolve({ records, config, status: "degraded", reason: "tier-failed", typedResolutionRate: null, error });
      resolve({ records, config, ...classifySemantic({ config, resolution: summed(records.keys(), records) }), error: null });
    };

    const arm = (ms) => {
      quiet = ms;
      sup.touch(ms);
    };

    child.on("message", (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.ready) {
        return child.send({ root, files }, (err) => {
          if (err) finish(`the checker closed its channel before it was given the corpus: ${err.message}`);
        });
      }
      if (msg.error) return finish(msg.error);
      if (msg.built) {
        built = true;
        config = msg.config;
        return arm(guards.idleMs);
      }
      if (msg.done) {
        done = true;
        return finish(null);
      }
      if (typeof msg.rel === "string") {
        records.set(msg.rel, { hits: msg.hits || {}, resolution: msg.resolution ?? null });
        return arm(guards.idleMs);
      }
    });

    // A death after the program was built is not a finished run. The worker was
    // measured at 880 MB resident, so being killed halfway is the likely way
    // this ends, and reading it as success shipped half a corpus as a whole one.
    child.on("exit", (code, signal) => {
      if (done) return finish(null);
      const how = signal || `code ${code}`;
      const why = sup.stderr().trim().split("\n").at(-1);
      finish(
        built
          ? `the checker exited before it finished (${how})${why ? `: ${why}` : ""}`
          : `the checker exited (${how})${why ? `: ${why}` : ""}`
      );
    });

    // fork emits this on EMFILE or EAGAIN, and a send onto a channel that just
    // closed emits it too. Unlistened, it is an uncaughtException that takes the
    // whole scan with it, including the syntactic pass that already finished.
    child.on("error", (err) => finish(`the checker could not run: ${err && err.message ? err.message : err}`));

    arm(guards.buildMs);
  });
}

/**
 * The tier's verdict with the rate taken over `rels`, the files a claim is
 * counted over. A file in no area that the map describes still lends its types
 * but not its rate: one untyped bundle took a fully typed repository to 3%.
 * `null`, a repository where no area was discovered, keeps the whole-corpus
 * answer. An empty set, every area dropped or none holding a checked file, has
 * nothing to resolve.
 */
export function semanticOver(semantic, rels) {
  if (!semantic || semantic.error || rels === null) return semantic;
  return { ...semantic, ...classifySemantic({ config: semantic.config, resolution: summed(rels, semantic.records) }) };
}

function summed(rels, records) {
  const out = { resolved: 0, total: 0 };
  for (const rel of rels) {
    const r = records.get(rel)?.resolution;
    if (!r) continue;
    out.resolved += r.resolved;
    out.total += r.total;
  }
  return out;
}
