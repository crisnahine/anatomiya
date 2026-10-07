// lib/semantic.mjs
/**
 * The second tier: `typescript@5`'s checker, run where the repository can use it.
 *
 * A scan with it measured about 3x a plain one, and the checker is whole-program,
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

/** What doctor says of a typescript that loads and cannot run this tier, or null. */
export function unusableReason(ts) {
  if (Number(String(ts?.version ?? "").split(".")[0]) !== SEMANTIC_MIN_MAJOR) return `the type checker needs typescript ${SEMANTIC_MIN_MAJOR}.x`;
  if (typeof ts.createProgram !== "function") return "the type checker needs a typescript that exports createProgram";
  return null;
}

/**
 * Why the checker cannot run in this repository, or null when it can. Without
 * the repository's own packages on disk, inside it, its types do not resolve
 * and every claim the checker could make reads degraded; a directory holding
 * only tool caches such as `.vite` is no install. A typescript of another major
 * reads `not-installed` too, and doctor names which. Plain JavaScript with no
 * config at its root is skipped before any of that: run on the compiler's defaults
 * it resolved 25% to 39% on three installed repositories and closed every
 * type-checked slot, and no install changes that.
 */
export async function checkerBlocked(root, { specifier = "typescript", checkedRels } = {}) {
  if (!Array.isArray(checkedRels)) throw new TypeError("checkerBlocked needs { checkedRels }: the paths of the files the checker would read");
  if (!hasConfig(root) && !checkedRels.some(isTypeScriptSource)) return "plain-javascript";
  if (!hasInstall(root)) return "no-dependencies";
  return (await loadTypeScript({ specifier })) ? null : "not-installed";
}

/**
 * What `checkerBlocked` reads, without importing typescript: the refresh stamps
 * this on every run, and the import doubled a no-op refresh's memory. The
 * version is there because an upgrade in place keeps the path.
 */
export function checkerStamp(root, { specifier = "typescript" } = {}) {
  let resolved = "";
  try {
    resolved = import.meta.resolve(specifier);
    resolved += `\0${readFileSync(join(dirname(dirname(fileURLToPath(resolved))), "package.json"), "utf8")}`;
  } catch {
    // Absent is a state the stamp records, not a failure.
  }
  return `${hasInstall(root)}\0${configNameIn(root) ?? ""}\0${resolved}`;
}

/**
 * What a verdict is measured under: this build, `checkerStamp`, what an install
 * leaves behind, and the bytes of the config the root is read through, since an
 * edit there is the likeliest thing to lift a rate and moves none of the others.
 */
export function verdictStamp(root, build) {
  const name = configNameIn(root);
  const config = name === null ? "" : configStamp(root, join(root, name));
  return createHash("sha256").update(`${build ?? ""}\0${checkerStamp(root)}\0${installStamp(root)}\0${config}`).digest("hex");
}

/**
 * A root config's bytes, or what stands in for them. One that leaves the
 * repository gives the reason the checker refuses it for and is not opened.
 * Bounded and typed: the file comes with the repository, and one linked to an
 * endless device read whole never returns. The bound is more than any config
 * a person writes; past it an edit is not seen.
 */
function configStamp(root, path) {
  if (!insideRoot(root, path)) return CONFIG_REFUSALS.escaped;
  const entry = readHead(path);
  return entry.kind === "file" ? entry.head : entry.kind;
}

/**
 * The file each package manager rewrites when it installs, by name under
 * `node_modules`: npm, pnpm, yarn 2 and later with the node-modules linker, yarn 1.
 */
const INSTALL_RECORDS = Object.freeze([".package-lock.json", ".modules.yaml", ".yarn-state.yml", ".yarn-integrity"]);

/**
 * What moves when an install changes the packages the checker resolves: the
 * size and modification time of `node_modules` and of each install record in
 * it. A verdict measured over a partial install is otherwise carried past the
 * install that completes it. Stats only, of the entries themselves: a linked
 * `node_modules` is no install of the repository's own, the same as for
 * `hasInstall`, and nothing is read through it.
 */
function installStamp(root) {
  const deps = join(root, "node_modules");
  if (!isDirectory(deps)) return "";
  return [deps, ...INSTALL_RECORDS.map((name) => join(deps, name))].map(sizeAndTime).join("\0");
}

function isDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function sizeAndTime(path) {
  try {
    const stat = lstatSync(path);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "";
  }
}

/**
 * The verdict a refresh carries in place of a run, or null where the checker
 * has to measure: `recorded` is the last record's tier, `under` the stamp now.
 * Only a degraded verdict a run measured under the same stamp: an ok tier's
 * numbers are the claims, and a failed run measured nothing.
 *
 * The record is a file anyone on the machine can edit, and what is carried is
 * printed in the always-loaded overview on every refresh after. So only a
 * verdict a scan could have written is carried, and any other is measured.
 */
export function carriedVerdict(recorded, under, now = Date.now()) {
  if (recorded?.status !== "degraded" || (recorded.ran !== true && recorded.carried !== true)) return null;
  if (recorded.measuredUnder !== under) return null;
  const { status, reason, measuredAt, measuredUnder } = recorded;
  const typedResolutionRate = recorded.typedResolutionRate ?? null;
  if (!classified(reason, typedResolutionRate) || !isMomentBy(measuredAt, now)) return null;
  return { status, reason, typedResolutionRate, measuredAt, measuredUnder };
}

const LOW_RESOLUTION = "low-resolution";
const REFUSALS = new Set(Object.values(CONFIG_REFUSALS));

/** Whether `classifySemantic` answers degraded with this reason beside this rate. */
function classified(reason, rate) {
  if (REFUSALS.has(reason)) return rate === null || isShare(rate, 1);
  if (reason !== LOW_RESOLUTION && reason !== NO_CONFIG) return false;
  return isShare(rate, 1) && rate < RESOLUTION_FLOOR;
}

const isShare = (rate, most) => typeof rate === "number" && rate >= 0 && rate <= most;

/** Whether `text` is a moment as a scan writes one, and not after `now`. */
function isMomentBy(text, now) {
  if (typeof text !== "string") return false;
  const at = Date.parse(text);
  return Number.isFinite(at) && at <= now && new Date(at).toISOString() === text;
}

function hasConfig(root) {
  return configNameIn(root) !== null;
}

// A hand-written `.d.ts` beside JavaScript types nothing that JavaScript imports.
function isTypeScriptSource(rel) {
  return holdsTypeSyntax(rel) && !extOf(rel).startsWith(".d.");
}

/**
 * Whether the repository's own packages are installed at its root: a real
 * directory holding at least one, since tool caches such as `.vite` are no
 * install and a linked one is not the repository's own.
 */
export function hasInstall(root) {
  return hasPackages(join(root, "node_modules"));
}

function hasPackages(deps) {
  try {
    return isDirectory(deps) && readdirSync(deps).some((name) => !name.startsWith("."));
  } catch {
    return false;
  }
}

import { guardedChild } from "./child.mjs";
import { guardsOver } from "./limits.mjs";
import { holdsTypeSyntax } from "./langs.mjs";
import { extOf } from "./paths.mjs";
import { readHead } from "./rules.mjs";
import { CONFIG_REFUSALS, configNameIn, insideRoot, NO_CONFIG } from "./tsconfig.mjs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
    return { status: "degraded", reason: config?.reason ?? LOW_RESOLUTION, typedResolutionRate: rate };
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
 * The rate here is over every file; `semanticOver` narrows it. `signal` stops the
 * child, for a scan that failed while the checker ran beside it.
 */
export function runSemantic(root, files, { guards: given = null, workerPath = WORKER, cwd = tmpdir(), signal = null } = {}) {
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

    const stopped = () => finish("the scan stopped before the checker finished");
    signal?.addEventListener("abort", stopped, { once: true });
    if (signal?.aborted) stopped();
    arm(guards.buildMs);
  });
}

/**
 * The tier's verdict with the rate taken over `rels`, the files a claim is
 * counted over. A file in no area that the map describes still lends its types
 * but not its rate: one untyped bundle took a fully typed repository to 3%.
 * An empty set has nothing to resolve.
 */
export function semanticOver(semantic, rels) {
  if (!semantic || semantic.error) return semantic;
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
