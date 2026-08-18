/**
 * Whether the engines this tool parses with are installed, and what to do when
 * one is not.
 *
 * Three engines were detected three different ways and their remedies were
 * spelled at every printer that needed one, so a missing Ruby was answered with
 * "run npm install", which is the one remedy that cannot work. One probe asks
 * all of them, and one table says what to do.
 *
 * Parent-only. It spawns an interpreter, so nothing the parse worker reaches
 * may import it (F18): the engine table it reads lives in `langs.mjs`, which is
 * data the child can load.
 */
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ENGINES } from "./langs.mjs";
import { rubyEnv } from "./ruby.mjs";

/**
 * The type checker, probed beside the engines and deliberately not one of them.
 *
 * One flag asks for it, and that flag refuses on its own before any work, so a
 * report that called an absent checker a failure would send a reader to install
 * something no default run touches. Installed by the same command as the
 * node-hosted engine, so the sentence is that one rather than a second copy.
 */
const OPTIONAL = {
  typescript: {
    id: "typescript",
    host: "node",
    module: "typescript",
    optional: true,
    note: "optional: --deep needs it",
    remedy: ENGINES.oxc.remedy,
  },
};

const PROBES = { ...ENGINES, ...OPTIONAL };

// How to ask an interpreter-hosted engine for its version. The argv belongs to
// the engine rather than to its interpreter, so a second one adds a row here
// instead of a branch below.
const ASK_VERSION = { prism: ["--disable-gems", "-rprism", "-e", "print Prism::VERSION"] };

// The phrase the node remedy spells in the directory for. The table states it
// the way a person would read it aloud; a person following it needs the path.
const PLUGIN_DIRECTORY = "the plugin directory";

/**
 * The directory this plugin is installed in, which is where its own
 * dependencies live and where an install has to be run.
 *
 * Resolved from this file rather than from `process.cwd()`: every command runs
 * inside the repository being scanned, and installing there would put this
 * tool's dependencies in somebody else's tree. `lib/` sits beside the manifest
 * in every layout this ships in, packed or cloned.
 */
export function pluginRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/** The declaration behind an engine name. An unknown name is a bug, so it says so. */
function probeFor(id) {
  const engine = PROBES[id];
  if (!engine) throw new Error(`no engine named ${id}, so nothing declares how to probe it or what to do about it`);
  return engine;
}

/** What a person does about an engine that is not ready. */
export function remedyFor(engineId) {
  const engine = probeFor(engineId);
  return engine.host === "node" ? `run ${engine.remedy.replace(PLUGIN_DIRECTORY, pluginRoot())}` : engine.remedy;
}

/**
 * Whether a version is below a floor, by its numbers.
 *
 * Exported because a string compare is the wrong answer that looks right:
 * "1.10.0" sorts below "1.9.0" as text, and prism is already past its tenth
 * minor, so text would refuse the version this asks for.
 */
export function olderThan(version, floor) {
  if (!version || !floor) return false;
  const have = numbers(version);
  const want = numbers(floor);
  for (let i = 0; i < Math.max(have.length, want.length); i++) {
    if ((have[i] ?? 0) !== (want[i] ?? 0)) return (have[i] ?? 0) < (want[i] ?? 0);
  }
  return false;
}

// `||` rather than `??`: a part that is not a number parses to NaN, which is
// not absent, and comparing against it answers false in both directions.
const numbers = (v) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);

/**
 * Ask every named engine whether it is there, and answer one row each.
 *
 * A node-hosted engine answers a row of its own plus one per declared extra: a
 * stripper that is absent costs one dialect, and an engine that is absent costs
 * the run, so folding them together would lose the difference.
 *
 * `env` is a test seam with one real use: the interpreter has to be genuinely
 * unfindable to prove that its absence reads as an absent interpreter.
 */
export async function readiness({ engines = Object.keys(ENGINES), timeoutMs = 5_000, env = process.env } = {}) {
  const rows = [];
  for (const id of engines) {
    const engine = probeFor(id);
    if (engine.host === "node") rows.push(...(await probeNode(engine)));
    else rows.push(await probeInterpreter(engine, { timeoutMs, env }));
  }
  return rows;
}

/** One line per row for a person reading a doctor report. */
export function readinessLines(rows) {
  return rows.map((r) => {
    const name = r.extra ?? r.engine;
    const found = r.present ? r.version ?? "no version" : "absent";
    // A row that is not ready carries the two things the reader needs next:
    // what was wrong with it, and what to do. A ready one carries neither,
    // unless it is the optional checker, whose row is a note either way.
    return r.ok
      ? `${name} ${found} ok${r.reason ? ` (${r.reason})` : ""}`
      : `${name} ${found}: ${r.reason}, ${r.remedy}`;
  });
}

/** One row, so every probe answers the same shape whatever it looked at. */
function row(engine, { extra = null, present, version = null, ok = false, reason = null }) {
  return {
    engine: engine.id,
    extra,
    present,
    version,
    floor: engine.floor ?? null,
    ok,
    reason: reason ?? engine.note ?? null,
    remedy: remedyFor(engine.id),
  };
}

/**
 * A node-hosted engine and its extras, each loaded the way the parser loads it.
 *
 * By specifier, so ESM resolves it from this plugin's own node_modules and
 * never from the repository being scanned, which is the same rule the type
 * checker is loaded under: a repository can ship its own copy of any of these.
 */
async function probeNode(engine) {
  const rows = [];
  for (const module of [engine.module, ...(engine.extras ?? []).map((e) => e.module)]) {
    const extra = module === engine.module ? null : module;
    try {
      await import(module);
    } catch {
      // Absent, or installed and unloadable, which are the same thing to a
      // caller: nothing here can parse with it.
      rows.push(row(engine, { extra, present: false, ok: engine.optional === true }));
      continue;
    }
    rows.push(row(engine, { extra, present: true, version: versionOf(module), ok: true }));
  }
  return rows;
}

/**
 * A module's own version, off its manifest.
 *
 * Read rather than taken from the module: `oxc-parser` exports no version at
 * all, and the two that do would each have to be spelled here by name.
 */
function versionOf(module) {
  try {
    return createRequire(import.meta.url)(`${module}/package.json`).version ?? null;
  } catch {
    return null;
  }
}

/**
 * An interpreter-hosted engine: run the interpreter, ask the library its version.
 *
 * The three answers are three different next moves, and the old code had one
 * sentence for all of them. No interpreter is an install of the interpreter; an
 * interpreter that refuses is the library missing from that one; a version
 * under the floor parses without raising and counts every site as zero.
 */
async function probeInterpreter(engine, { timeoutMs, env }) {
  const { err, stdout } = await ask(engine.command, ASK_VERSION[engine.id], { timeoutMs, env });
  if (err && err.code === "ENOENT") {
    return row(engine, { present: false, reason: `${engine.command} is not on PATH` });
  }
  if (err) {
    // A child our own timer killed answered nothing, which is not the same as
    // answering that the library is absent.
    const reason = err.killed
      ? `${engine.command} did not answer within ${timeoutMs}ms`
      : `${engine.id} is not installed for this ${engine.command}`;
    return row(engine, { present: true, reason });
  }
  const version = stdout.trim();
  if (olderThan(version, engine.floor)) {
    return row(engine, {
      present: true,
      version,
      reason: `${engine.id} ${version} is older than the ${engine.floor} this reads`,
    });
  }
  return row(engine, { present: true, version, ok: true });
}

/**
 * The one subprocess this module runs.
 *
 * Buffered rather than streamed, unlike the parse bridge: what comes back is
 * one version string, so it is bounded by what it is. Outside the repository
 * and under the same scrub the Ruby bridge spawns with, because this points an
 * interpreter at whatever `PATH` names and `RUBYOPT` can inject a `-r` into it.
 */
function ask(command, args, { timeoutMs, env }) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: tmpdir(),
        env: rubyEnv(env),
        encoding: "utf8",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024,
      },
      (err, stdout, stderr) => resolve({ err, stdout, stderr })
    );
  });
}
