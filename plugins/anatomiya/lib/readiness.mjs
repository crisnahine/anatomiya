/**
 * Whether the engines this tool parses with are installed, and the node it runs
 * on new enough, and what to do when one is not.
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
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { absentInterpreter } from "./child.mjs";
import { firstLine } from "./encode.mjs";
import { ENGINES, engineOf } from "./langs.mjs";
import { installedVersion, olderThan } from "./version.mjs";

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
    note: "optional: scan runs the type checker with it",
    remedy: ENGINES.oxc.remedy,
    // The test the scan's loader applies, so the row answers what a scan will
    // find. Imported and nothing more, a typescript 4.9.5 in a node_modules
    // above the plugin read `ok` here and `nothing to install` in setup while
    // the loader refused it: it holds to major 5, because 7 has no JS API and
    // 4 is not what the tier measured. Loaded when the probe runs, since the
    // entry point imports this module before every hook.
    unusable: async (ts) => (await import("./semantic.mjs")).unusableReason(ts),
  },
};

/**
 * The node this process runs on, probed first and deliberately not an engine.
 *
 * Both manifests declare it in `engines`, and nothing enforces that for a
 * plugin: Claude Code's own installer needs no Node, so the `node` on a user's
 * PATH is whatever was there. Measured on Node 20.20.2: doctor called every
 * engine ok, and the scan then died with `Map.groupBy is not a function`, which
 * names neither Node nor a fix. The floor is the manifests' number, and a test
 * holds the three together.
 */
const RUNTIME = {
  node: {
    id: "node",
    host: "runtime",
    floor: "22.0.0",
    remedy: "install Node 22 or newer and put it first on PATH",
  },
};

const PROBES = { ...RUNTIME, ...ENGINES, ...OPTIONAL };

/** Everything a readiness report asks about: the node it runs on, the engines, then the checker beside them. */
export const PROBE_IDS = Object.freeze(Object.keys(PROBES));

/**
 * The ones an install can do anything about: whatever node hosts, engine or
 * checker, since one `npm install` in the plugin directory provides them all.
 * An interpreter is the machine's own and no command here can put one there.
 */
export const NODE_PROBE_IDS = Object.freeze(PROBE_IDS.filter((id) => PROBES[id].host === "node"));

// How to ask an interpreter-hosted engine for its version, and which of its
// installs to ask: the same load path the parser is handed, so the answer is
// about the library that will parse. The argv belongs to the engine rather than
// to its interpreter, so a second one adds a row here instead of a branch below.
// Loaded when the probe runs: the entry point imports this module for the node
// floor before every hook, and the Ruby bridge reaches the walker.
const BRIDGES = {
  prism: async () => {
    const { prismLoadArgs, prismVersionArgs, rubyEnv } = await import("./ruby.mjs");
    return { loadArgs: prismLoadArgs, versionArgs: prismVersionArgs, env: rubyEnv };
  },
};

// What a node-hosted engine needs besides its module, asked the way a parse
// asks for it. Loaded when the probe runs, for the reason `BRIDGES` is.
const GRAMMARS = {
  "tree-sitter": async () => (await import("./tree-sitter-file.mjs")).probeGrammars(),
};

/**
 * What a person does about a grammar file that did not load.
 *
 * Its own sentence, because the engine's is wrong for it: the grammars ship in
 * the plugin's directory and no package install writes one, so `setup` would
 * run, change nothing, and send the reader back here.
 */
export const GRAMMAR_REMEDY = "reinstall this plugin, which ships its grammar files in its own directory";

/** Whether a row is an engine that loads and lost a grammar file: nothing an install provides is missing from it. */
export const lostGrammar = (row) => row.lostGrammars?.length > 0;

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

/** The version this build's own manifest states, or `""` where it cannot be read: what a stamp means by "this build". */
export function buildVersion() {
  try {
    return JSON.parse(readFileSync(join(pluginRoot(), "package.json"), "utf8")).version ?? "";
  } catch {
    return "";
  }
}

/** The declaration behind an engine name. An unknown name is a bug, so it says so. */
function probeFor(id) {
  const engine = PROBES[id];
  if (!engine) throw new Error(`no engine named ${id}, so nothing declares how to probe it or what to do about it`);
  return engine;
}

/**
 * What a person does about an engine that is not ready.
 *
 * `root` is the directory the node remedy spells, and it defaults to this
 * installation's. It is an argument because a report about one directory may
 * not name another in the same sentence: a reader told nothing is installed in
 * one place and to install it in a second has been handed two paths and no way
 * to tell which is theirs. `null` names no directory and leaves the table's
 * own words: a file written into a repository is committed and read on other
 * machines, where this one's path is nobody's.
 */
export function remedyFor(engineId, root = pluginRoot()) {
  const engine = probeFor(engineId);
  return engine.host === "node" ? `run ${engine.remedy.replace(PLUGIN_DIRECTORY, root ?? PLUGIN_DIRECTORY)}` : engine.remedy;
}

/**
 * The next move for whatever a parse found missing: the absent engine's own
 * remedy, and the grammar's where every engine was there.
 */
export function remedyForMissing({ missingEngines, missingGrammars = [] }, root = pluginRoot()) {
  return missingEngines.length || !missingGrammars.length ? remedyFor(missingEngines[0], root) : GRAMMAR_REMEDY;
}

/** Whether a parse could read no file of a language at all: its engine was absent, or its own grammar was. */
export const couldNotRead = ({ missingEngines, missingGrammars = [] }, lang) =>
  missingEngines.includes(engineOf(lang)) || missingGrammars.includes(lang);

/**
 * Why an engine read no file of its language, in its own terms, from the
 * versions a parse reported.
 *
 * One sentence used to cover every cause, and it guessed the likeliest: a
 * missing interpreter. Measured with ruby on PATH and no prism, that sentence
 * was wrong and there was no version anywhere on screen to say so. An engine
 * that reported a version ran, so the files are what failed; one that reported
 * none is the install, and its own remedy is the next move. Here rather than
 * with one printer, because the summary and the map both say it.
 */
function whyUnread(engineId, engines, root) {
  const engine = engines?.[engineId];
  if (engine?.version) return `${engineId} ${engine.version} ran and answered for none of them`;
  // Stopped by our own clock before it could report a version: the install is
  // not what that says, so its remedy is not the next move.
  if (engine?.stalled) return `${engineId} was stopped by its own clock before it answered: ${engine.stalled}`;
  return `${engineId} reported no version: ${remedyFor(engineId, root)}`;
}

/**
 * One reason per cause for the languages a run read no file of: a grammar that
 * did not load first, then each engine in its own terms.
 *
 * A grammar apart from its engine, because the engine answered: it reported a
 * version and read its other languages, so its own sentence would say it ran
 * and answered for none of them, which names no cause and no next move.
 */
export function unreadReasons(langs, { engines, missingGrammars = [] }, root = pluginRoot()) {
  const unloaded = langs.filter((l) => missingGrammars.includes(l));
  const rest = langs.filter((l) => !unloaded.includes(l));
  const reasons = [...new Set(rest.map(engineOf))].map((id) => ({
    langs: rest.filter((l) => engineOf(l) === id),
    why: whyUnread(id, engines, root),
  }));
  if (!unloaded.length) return reasons;
  const what = `${unloaded.join(" and ")} ${unloaded.length === 1 ? "grammar" : "grammars"}`;
  return [{ langs: unloaded, why: `the plugin's ${what} did not load: ${GRAMMAR_REMEDY}` }, ...reasons];
}

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
    if (engine.host === "runtime") rows.push(probeRuntime(engine));
    else if (engine.host === "node") rows.push(...(await probeNode(engine)));
    else rows.push(await probeInterpreter(engine, { timeoutMs, env }));
  }
  return rows;
}

/**
 * The same rows, asked by a node that has never tried to load anything.
 *
 * A module whose evaluation threw stays failed for the life of the process
 * that tried it. oxc-parser without its native binding is exactly that, so a
 * process that probed, watched npm install the binding, and probed again read
 * the parser as absent both times. Setup asks this after npm for that reason.
 * The node that runs it is this one, and it runs from the plugin's own
 * directory, as bounded as any other child here.
 */
export function readinessAfresh({ engines = NODE_PROBE_IDS, timeoutMs = 60_000 } = {}) {
  const script = [
    `const { readiness } = await import(${JSON.stringify(import.meta.url)});`,
    `process.stdout.write(JSON.stringify(await readiness({ engines: ${JSON.stringify(engines)} })));`,
  ].join("\n");
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--input-type=module", "-e", script],
      { cwd: pluginRoot(), encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return resolve({ rows: null, error: firstLine(stderr) || err.message });
        try {
          resolve({ rows: JSON.parse(stdout), error: null });
        } catch {
          resolve({ rows: null, error: "the probe answered something other than its rows" });
        }
      }
    );
  });
}

/**
 * Why this node cannot run anything here, with the fix, or null where it can.
 *
 * Asked by the entry point before any verb that works, so a scan refuses in
 * one sentence instead of dying halfway through on a builtin the old node
 * lacks. Doctor is the one verb that runs anyway, and says the same thing on
 * its row.
 */
export function unsupportedNode() {
  const row = probeRuntime(RUNTIME.node);
  return row.ok ? null : `${row.reason}, ${row.remedy}`;
}

/** The node this process runs on, held to its floor. */
function probeRuntime(engine) {
  const version = process.versions.node;
  if (olderThan(version, engine.floor)) {
    return row(engine, { present: true, version, reason: `${engine.id} ${version} is older than the ${engine.floor} this runs on` });
  }
  return row(engine, { present: true, version, ok: true });
}

/** What a row is called wherever one is printed: an extra by its module, an engine by its own name. */
export const probeName = (row) => row.extra ?? row.engine;

/**
 * The one thing wrong with an installation that has nothing in it at all, or null.
 *
 * Claude Code installs a plugin's dependencies itself, from the lockfile beside
 * its manifest, so a plugin with no `node_modules` anywhere above it is an
 * install that never ran rather than a step somebody forgot. Every node-hosted
 * row is then absent for that one reason, and a report naming them one at a
 * time reads as two faults with two fixes, since the optional checker's row is
 * a note either way.
 *
 * Asked of the whole way up rather than of the directory beside the manifest,
 * because that is where node looks: this marketplace declares its plugins as
 * workspaces, so npm hoists every package to the root and the plugin's own
 * directory never holds one. Asked only about that directory, a contributor
 * whose engine failed to load was told nothing was installed and pointed at a
 * place that will never hold it.
 *
 * Nothing at all, and deliberately not an install that ran and stopped short:
 * the loader kills one at sixty seconds, and what that leaves is a
 * `node_modules` with some of the packages in it. The rows are the better answer
 * there, because they say which ones, and one sentence claiming nothing is
 * installed would be wrong about a directory that holds most of it.
 *
 * Said as well as the rows rather than instead of them: the rows are still
 * true, and this is what they have in common. An interpreter is the machine's
 * own and no install here can put one there, so its absence is never this.
 */
export function installProblem(rows, root = pluginRoot()) {
  // The remedy comes off the row that is absent rather than off a name spelled
  // here: every node-hosted engine answers the same sentence, and naming one of
  // them would go stale the day that stops being true.
  const absent = rows.find((r) => PROBES[r.engine]?.host === "node" && !r.present && !r.ok);
  if (absent === undefined) return null;
  if (installedAbove(root)) return null;
  // The directory once, on the half that is a command to run: said on both
  // halves the sentence ran past 170 characters and read as two places.
  return `nothing is installed here: ${remedyFor(absent.engine, root)}`;
}

/**
 * Whether any `node_modules` on the way up could serve this directory.
 *
 * The walk node's own resolver makes, and it ends at the filesystem root, which
 * is its own fixed point under `dirname`. One that holds nothing this plugin
 * needs still answers yes, and the rows are then the report: each names the
 * engine that did not load and what to do about it, which is more than one
 * sentence about a directory could say.
 */
function installedAbove(root) {
  let at = root;
  for (;;) {
    if (existsSync(join(at, "node_modules"))) return true;
    const up = dirname(at);
    if (up === at) return false;
    at = up;
  }
}

/**
 * One line per row for a person reading a doctor report.
 *
 * `installSaid` is whether a line above these has already given the node
 * remedy. Those rows then keep what was wrong with each engine, which differs,
 * and drop what to do about it, which does not: said on the lead and on every
 * row it explains, one sentence appeared three times and the report read as
 * three faults again, which is what the lead is there to stop. An interpreter's
 * remedy is its own and is never the one that was said.
 */
export function readinessLines(rows, { installSaid = false } = {}) {
  return rows.map((r) => {
    const name = probeName(r);
    const found = r.present ? r.version ?? "no version" : "absent";
    // A row that is not ready carries the two things the reader needs next:
    // what was wrong with it, and what to do. A ready one carries neither,
    // unless it is the optional checker, whose row is a note either way.
    if (r.ok) return `${name} ${found} ok${r.reason ? ` (${r.reason})` : ""}`;
    const said = installSaid && PROBES[r.engine]?.host === "node";
    // A reason written to stand alone (the refusal every other verb prints)
    // names the engine and version the row already leads with.
    const lead = `${name} ${found} is `;
    const reason = r.reason?.startsWith(lead) ? r.reason.slice(lead.length) : r.reason;
    return said ? `${name} ${found}: ${reason}` : `${name} ${found}: ${reason}, ${r.remedy}`;
  });
}

/** One row, so every probe answers the same shape whatever it looked at. */
function row(engine, { extra = null, present, version = null, ok = false, reason = null, remedy = null, lostGrammars = [] }) {
  return {
    engine: engine.id,
    extra,
    present,
    version,
    floor: engine.floor ?? null,
    ok,
    reason: reason ?? engine.note ?? null,
    remedy: remedy ?? remedyFor(engine.id),
    lostGrammars,
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
    let loaded;
    try {
      loaded = await import(module);
    } catch {
      // Absent, or installed and unloadable, which are the same thing to a
      // caller: nothing here can parse with it. An engine carrying a note is
      // already saying why an absence is ok, and that is what its reader needs.
      rows.push(
        row(engine, {
          extra,
          present: false,
          ok: engine.optional === true,
          reason: engine.note ?? `${module} did not load`,
        })
      );
      continue;
    }
    // Present and not ready: installed where it resolves, and not a copy the
    // one caller that wants it will take. Not optional in that case, since the
    // flag it is for refuses it, and one install puts a usable one first.
    const why = extra === null && engine.unusable ? await engine.unusable(loaded.default ?? loaded) : null;
    if (why) {
      rows.push(row(engine, { extra, present: true, version: installedVersion(module), reason: why }));
      continue;
    }
    // An engine that loads and cannot read one of its languages is not ready,
    // and says which: the count is on its row either way.
    const held = extra === null && GRAMMARS[engine.id] ? await GRAMMARS[engine.id]() : null;
    if (held?.missing.length) {
      const reason = `${grammarsLine(held)}, ${held.missing.map((id) => `${id}.wasm`).join(" and ")} did not load`;
      rows.push(row(engine, { extra, present: true, version: installedVersion(module), reason, remedy: GRAMMAR_REMEDY, lostGrammars: held.missing }));
      continue;
    }
    rows.push(row(engine, { extra, present: true, version: installedVersion(module), ok: true, reason: held ? grammarsLine(held) : null }));
  }
  return rows;
}

const grammarsLine = ({ total, missing }) => `grammars: ${total - missing.length} of ${total}`;

/**
 * An interpreter-hosted engine: run the interpreter, ask the library its version.
 *
 * The three answers are three different next moves, and the old code had one
 * sentence for all of them. No interpreter is an install of the interpreter; an
 * interpreter that refuses is the library missing from that one; a version
 * under the floor parses without raising and counts every site as zero.
 */
async function probeInterpreter(engine, { timeoutMs, env }) {
  const bridge = await BRIDGES[engine.id]();
  const load = await bridge.loadArgs({ ruby: engine.command, env, timeoutMs });
  const scrubbed = bridge.env(env);
  const { err, stdout } = await ask(engine.command, bridge.versionArgs(load), { timeoutMs, env: scrubbed });
  if (absentInterpreter(err)) {
    return row(engine, { present: false, reason: `${engine.command} is not on PATH` });
  }
  if (err) {
    // A child our own timer killed answered nothing, which is not the same as
    // answering that the library is absent.
    if (err.killed) {
      return row(engine, { present: true, reason: `${engine.command} did not answer within ${timeoutMs}ms` });
    }
    // Nor is an interpreter that cannot run anything. Measured with rbenv and no
    // global version: the shim exits 127 with "rbenv: ruby: command not found",
    // and this said prism was not installed, whose remedy fails the same way.
    // Asked apart, with nothing loaded, so its failure is the interpreter's.
    const bare = await ask(engine.command, ["--disable-gems", "-e", "1"], { timeoutMs, env: scrubbed });
    if (bare.err && !bare.err.killed && !absentInterpreter(bare.err)) {
      const said = firstLine(bare.stderr) || `exit ${bare.err.code}`;
      return row(engine, {
        present: true,
        reason: `${engine.command} does not run: ${said}`,
        remedy: `make \`${engine.command} -e 1\` run first (with a version manager, select an installed version), then check again`,
      });
    }
    return row(engine, { present: true, reason: `${engine.id} is not installed for this ${engine.command}` });
  }
  const version = stdout.trim();
  // An answer holding no version says nothing about the library, and a missing
  // version is never older than the floor: a `ruby` that printed nothing and
  // exited 0 was reported ok, and the scan it cleared charged every file. A
  // prerelease suffix is still a version, so only the leading number is asked.
  if (!/^\d+(\.\d+)*/.test(version)) {
    return row(engine, { present: true, reason: `${engine.command} answered no ${engine.id} version` });
  }
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
 * and under the same scrub the Ruby bridge spawns with, which the caller hands
 * in, because this points an interpreter at whatever `PATH` names and `RUBYOPT`
 * can inject a `-r` into it.
 */
function ask(command, args, { timeoutMs, env }) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: tmpdir(),
        env,
        encoding: "utf8",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024,
      },
      (err, stdout, stderr) => resolve({ err, stdout, stderr })
    );
  });
}
