// lib/semantic.mjs
/**
 * The second tier: `typescript@5`'s checker, opt-in and never the default.
 *
 * Measured 26x slower than the syntactic tier and whole-program, so narrowing
 * its file set does not buy the time back: driving the corpus down drove
 * unresolved types from 3.1% to 36.2%. Major 5 is pinned because 7 is the Go
 * port and publishes no JS API at all.
 */

export const SEMANTIC_MIN_MAJOR = 5;

/**
 * The checker, or null.
 *
 * Imported by specifier from this module, so ESM resolves it from the plugin's
 * own node_modules and never from the repository being scanned. A repository
 * can ship its own `typescript`, and importing that one would run
 * repository-controlled code inside this process.
 */
export async function loadTypeScript({ specifier = "typescript" } = {}) {
  try {
    const mod = await import(specifier);
    const ts = mod.default ?? mod;
    if (!ts || typeof ts.createProgram !== "function") return null;
    const version = String(ts.version ?? "");
    if (Number(version.split(".")[0]) !== SEMANTIC_MIN_MAJOR) return null;
    return { ts, version };
  } catch {
    return null;
  }
}

export function notInstalledMessage() {
  return [
    "--deep needs typescript, which is an optional dependency and is not installed",
    "run `npm install --omit=dev` in the plugin directory, or scan again without --deep",
  ].join("\n");
}

import { fork } from "node:child_process";
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
  // nothing for the checker to resolve.
  if (rate !== null && rate < RESOLUTION_FLOOR) {
    return { status: "degraded", reason: "low-resolution", typedResolutionRate: rate };
  }
  return { status: "ok", reason: null, typedResolutionRate: rate };
}

/**
 * One whole-corpus checker run.
 *
 * Every failure answers itself rather than an empty result: a child that will
 * not start, a build that never finished, a stall, and a checker that is not
 * installed are four different things to do about it, and folding them into
 * "no hits" is the shape B13 and F15 both closed elsewhere.
 */
export function runSemantic(root, files, { keys = null, guards = SEMANTIC_GUARDS } = {}) {
  return new Promise((resolve) => {
    const records = new Map();
    let config = null;
    let resolution = { resolved: 0, total: 0 };
    let built = false;
    let settled = false;
    let timer = null;

    const child = fork(WORKER, [], { cwd: tmpdir(), stdio: ["ignore", "ignore", "pipe", "ipc"] });

    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.kill("SIGKILL");
      if (error) return resolve({ records, status: "degraded", reason: "tier-failed", typedResolutionRate: null, error });
      resolve({ records, ...classifySemantic({ config, resolution }), error: null });
    };

    const arm = (ms) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish(`the checker went quiet for ${Math.round(ms / 1000)}s`), ms);
      timer.unref?.();
    };

    child.on("message", (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.ready) return child.send({ root, files, keys });
      if (msg.error) return finish(msg.error);
      if (msg.built) {
        built = true;
        config = msg.config;
        resolution = msg.resolution;
        return arm(guards.idleMs);
      }
      if (msg.done) return finish(null);
      if (typeof msg.rel === "string") {
        records.set(msg.rel, { hits: msg.hits || {} });
        return arm(guards.idleMs);
      }
    });

    child.on("exit", (code, signal) => finish(built ? null : `the checker exited (${signal || `code ${code}`})`));
    arm(guards.buildMs);
  });
}
