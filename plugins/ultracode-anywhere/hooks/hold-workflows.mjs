/**
 * Workflow scripts held to a level: the prelude every script gets, and the
 * injected copies a nested `workflow()` call runs.
 *
 * A stage's effort is whatever its script passes, and the sandbox leaves
 * `agent` and `workflow` writable, so a prelude placed right after `meta` can
 * pass the level on every stage. A child workflow gets a fresh sandbox the
 * prelude does not reach, so every workflow a name can resolve to gets an
 * injected copy of its own.
 *
 * Where the meta ends is found here, parentheses and a shebang included, since
 * `catalogue.mjs`'s reader refuses both. What the meta says is read by that one,
 * since the build takes a name only from a pure literal.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

import { SCRIPT_MOST, metaIn } from "./catalogue.mjs";
import { enabledPluginInstalls } from "./hold-agents.mjs";
import { holdStatePath } from "./hold-config.mjs";
import { ancestors, filesIn, inGitRepo, writeWhole } from "./hold-files.mjs";
import { configDirFor, readIfFile } from "./hook-io.mjs";

/** What marks the prelude, so injecting again replaces it. */
export const MARK = "/* ultracode-anywhere: stages held */";

const PRELUDE_LINE = new RegExp(`\\n${MARK.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}[^\\n]*\\n`);

/** Where a line that runs on from `from` ends: at any line terminator JavaScript has, or the end of the text. */
function lineEnd(src, from) {
  const terminator = /[\n\r\u2028\u2029]/g;
  terminator.lastIndex = from;
  return terminator.exec(src)?.index ?? src.length;
}

/** Past whitespace, comments and a leading `#!` line. */
function skipTrivia(src, from) {
  let at = from;
  if (at === 0 && src.startsWith("#!")) at = lineEnd(src, 0);
  for (;;) {
    while (at < src.length && /\s/.test(src[at])) at++;
    if (src.startsWith("//", at)) at = lineEnd(src, at);
    else if (src.startsWith("/*", at)) at = src.indexOf("*/", at + 2) < 0 ? src.length : src.indexOf("*/", at + 2) + 2;
    else return at;
  }
}

/**
 * Just past the object literal opening at `from`, skipping strings and comments
 * inside it, or -1 where it never closes or holds a regular expression, whose
 * quotes this would take for strings.
 */
function objectEnd(src, from) {
  let depth = 0;
  for (let at = from; at < src.length; at++) {
    const c = src[at];
    if (c === '"' || c === "'" || c === "`") {
      for (at++; at < src.length && src[at] !== c; at++) if (src[at] === "\\") at++;
    } else if (src.startsWith("//", at)) {
      at = lineEnd(src, at);
      if (at >= src.length) return -1;
    } else if (src.startsWith("/*", at)) {
      at = src.indexOf("*/", at + 2);
      if (at < 0) return -1;
      at++;
    } else if (c === "/") return -1;
    else if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) return at + 1;
  }
  return -1;
}

/**
 * Where the object literal of the `export const meta = {...}` statement that
 * opens a script starts and stops, and where the statement ends, or null, and
 * null too for a meta holding a template string with a substitution, whose
 * `${}` the reader above does not follow.
 */
function metaSpan(src) {
  let at = skipTrivia(src, 0);
  const head = /^export\s+const\s+meta\s*=\s*/.exec(src.slice(at));
  if (!head) return null;
  at += head[0].length;
  let parens = 0;
  while (src[at] === "(") {
    parens++;
    at = skipTrivia(src, at + 1);
  }
  if (src[at] !== "{") return null;
  const close = objectEnd(src, at);
  if (close < 0 || (src.slice(at, close).includes("`") && src.slice(at, close).includes("${"))) return null;
  let end = close;
  for (; parens > 0; parens--) {
    end = skipTrivia(src, end);
    if (src[end] !== ")") return null;
    end++;
  }
  return { open: at, close, end: src[end] === ";" ? end + 1 : end };
}

/** Just past the `export const meta = {...}` statement that opens a script, or -1. */
export function metaEnd(src) {
  return metaSpan(src)?.end ?? -1;
}

function prelude(level, copies, worktree) {
  const remote = worktree ? `o.isolation = "worktree"` : "delete o.isolation";
  return (
    `\n${MARK} { const run = globalThis.agent, nest = globalThis.workflow, copies = ${JSON.stringify(copies)}; ` +
    `globalThis.agent = (prompt, opts) => { const o = opts && typeof opts === "object" ? { ...opts } : {}; delete o.model; if (o.isolation === "remote") ${remote}; return run(prompt, { ...o, effort: ${JSON.stringify(level)} }); }; ` +
    `if (typeof nest === "function") globalThis.workflow = (ref, args) => { const key = typeof ref === "string" ? ref : ref && ref.scriptPath; ` +
    `if (typeof key !== "string" || !Object.hasOwn(copies, key)) throw new Error("workflow(" + JSON.stringify(key) + ") has no copy held to the level, so it cannot run here. Name a known workflow or call agent() directly"); ` +
    `return nest({ scriptPath: copies[key] }, args); }; }\n`
  );
}

/**
 * A script with the prelude placed right after its meta, holding every stage to
 * `level`, or null for a script whose meta this cannot find.
 *
 * The prelude drops a stage's `model`, since `"inherit"` there escapes the
 * forced subagent model, and keeps a remote stage on this machine, where the
 * hold reaches it: in a worktree where `worktree` says the project is in a git
 * repository, and with no isolation where it is not, since a script cannot look.
 */
export function injectLevel(script, level, copies = {}, { worktree = true } = {}) {
  const clean = String(script).replace(PRELUDE_LINE, "");
  const end = metaEnd(clean);
  return end < 0 ? null : clean.slice(0, end) + prelude(level, copies, worktree) + clean.slice(end);
}

function metaName(src) {
  const span = metaSpan(src);
  return span ? (metaIn(`export const meta = ${src.slice(span.open, span.close)}`)?.name ?? null) : null;
}

/**
 * Every workflow a session in `root` can run by name, lowest precedence first:
 * plugins, the user's, then project directories from the farthest to the
 * project itself.
 */
export function knownWorkflows(env = process.env, root = "") {
  const found = [];
  const add = (dir, prefix, source) => {
    for (const file of filesIn(dir, ".js")) {
      const src = readIfFile(file, SCRIPT_MOST);
      const name = metaName(src);
      if (name) found.push({ name: prefix + name, bare: name, file, src, source });
    }
  };
  for (const install of enabledPluginInstalls(env, root)) add(join(install.path, "workflows"), `${install.plugin}:`, "plugin");
  const config = configDirFor(env);
  if (config) add(join(config, "workflows"), "", "user");
  if (root) for (const dir of ancestors(root, [".claude", "workflows"], env).reverse()) add(dir, "", "project");
  return found;
}

/** The workflow a name refers to: the highest-precedence exact match, or the one plugin workflow with that bare name. */
export function resolveWorkflow(flows, name) {
  const exact = flows.filter((flow) => flow.name === name);
  if (exact.length > 0) return exact.at(-1);
  const bare = flows.filter((flow) => flow.bare === name);
  return bare.length === 1 ? bare[0] : null;
}

/**
 * Writes an injected copy of every workflow a session in `root` can reach into
 * `dir`, and answers which copy each name and file runs.
 */
export function workflowCopies(env = process.env, root, dir, level) {
  const flows = knownWorkflows(env, root);
  const own = new Map(
    flows.map((flow) => {
      const hash = createHash("sha1").update(`${flow.file}\0${flow.src}`).digest("hex").slice(0, 10);
      return [flow, join(dir, `held-${flow.name.replace(/[^\w.-]/g, "_")}-${hash}.js`)];
    }),
  );
  const copies = {};
  for (const [flow, path] of own) Object.assign(copies, { [flow.file]: path, [path]: path });
  for (const name of new Set(flows.flatMap((flow) => [flow.name, flow.bare]))) {
    const winner = resolveWorkflow(flows, name);
    if (winner) copies[name] = own.get(winner);
  }
  const worktree = inGitRepo(root, env);
  for (const [flow, path] of own) {
    const text = injectLevel(flow.src, level, copies, { worktree });
    if (text !== null && readIfFile(path, SCRIPT_MOST * 2) !== text) writeWhole(path, text);
  }
  return copies;
}

/** Where a session's injected copies go: beside its transcript, or into the hold's state when it has none. */
export function copiesBeside(transcriptPath, env = process.env) {
  return transcriptPath ? join(transcriptPath.replace(/\.jsonl$/, ""), "workflows", "ultracode-anywhere") : holdStatePath(env, "workflows");
}
