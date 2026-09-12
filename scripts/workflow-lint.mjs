#!/usr/bin/env node
/**
 * What a shipped workflow has to be, checked before anyone runs one.
 *
 * A plugin workflow whose meta will not parse is skipped by the loader with a
 * warning in a log nobody opens, and the model is then told the workflow does
 * not exist at the moment it reaches for it. Nothing else in a session says so.
 * So the rules below are the build's own, read off 2.1.268 rather than
 * paraphrased, and this is the only place that enforces them.
 *
 * The plugin ships no dependencies, so its hook reads a meta without a parser.
 * That is two readers of one file, which is the shape this repository keeps
 * writing tests against (A49, A50). It is allowed here because this gate runs a
 * real parse over every shipped file and refuses any answer the hook's reader
 * does not match.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parseSync } from "oxc-parser";

import { invokedAs } from "./entry.mjs";
import { ULTRACODE } from "./plugins.mjs";
import { PLUGIN, RESOLVABLE, SCRIPT_MOST, WORKFLOWS_DIR, metaIn } from "../plugins/ultracode-anywhere/hooks/catalogue.mjs";

// Re-exported so a caller reading this gate reads one name for the plugin, and
// one size for what the loader skips at.
export { PLUGIN, SCRIPT_MOST };

/** Where the loader looks for this plugin's agent types. */
export const AGENTS_DIR = "agents";

/**
 * Every name the workflow sandbox puts in the script's scope.
 *
 * Eleven, not the eight the tool's own description lists: `console`,
 * `setTimeout` and `clearTimeout` are injected too and are documented nowhere.
 * Read off the context construction, so a name this list is missing is a
 * script that fails on a line nobody ran in a test.
 */
export const INJECTED = ["agent", "parallel", "pipeline", "workflow", "phase", "log", "args", "budget", "console", "setTimeout", "clearTimeout"];

/**
 * The language's own names, which the sandbox leaves alone.
 *
 * An allowlist rather than a list of what is banned: the sandbox is a bare
 * realm, so anything not here and not injected is a `ReferenceError` on the
 * line that reaches it, and a denylist would pass every host global nobody
 * thought to name. `URL` and `setInterval` are the two that catch people, and
 * both are absent by being absent rather than by being deleted.
 *
 * Three kinds of name are deliberately not here, and a script using one is
 * refused on purpose:
 *
 * - `ShadowRealm`, `WebAssembly`, `FinalizationRegistry`, `WeakRef`, `Atomics`,
 *   `SharedArrayBuffer` and `queueMicrotask`, which the realm has and the
 *   build's hardening pass then deletes
 * - `eval` and `Function`, which the realm has and which throw an `EvalError`
 *   because the context is made with `codeGeneration: {strings: false}`
 * - `Iterator` and anything else whose presence depends on the engine the
 *   build was compiled against rather than on the language: unverified there,
 *   so refused here rather than waved through on a guess
 */
const LANGUAGE = new Set([
  "AggregateError", "Array", "ArrayBuffer", "BigInt", "BigInt64Array", "BigUint64Array", "Boolean", "DataView", "Date",
  "Error", "EvalError", "Float32Array", "Float64Array", "Infinity", "Int8Array", "Int16Array", "Int32Array", "Intl",
  "JSON", "Map", "Math", "NaN", "Number", "Object", "Promise", "Proxy", "RangeError", "ReferenceError", "Reflect",
  "RegExp", "Set", "String", "Symbol", "SyntaxError", "TypeError", "URIError", "Uint8Array", "Uint8ClampedArray",
  "Uint16Array", "Uint32Array", "WeakMap", "WeakSet", "decodeURI", "decodeURIComponent", "encodeURI",
  "encodeURIComponent", "escape", "globalThis", "isFinite", "isNaN", "parseFloat", "parseInt", "undefined", "unescape",
]);

/** Identifiers the compiler reserves for its own rewriting. */
const RESERVED_PREFIX = "__wRg$";

/**
 * How every read of a workflow here parses it.
 *
 * `showSemanticErrors` because a workflow file is a module and a module is
 * strict: without it oxc reports no strict-mode early error, so `\8` in a
 * string is decoded rather than refused, both readers agree on a decode no
 * engine performs, and the gate passes a file the build will not compile.
 */
const PARSE = { sourceType: "module", showSemanticErrors: true };

/**
 * The one parse complaint a workflow script is expected to raise.
 *
 * The build parses with `allowReturnOutsideFunction`, so a top-level `return`
 * is how a workflow exits early and oxc's objection to it is noise. Matched as
 * the whole sentence rather than as the word: a substring test on "return"
 * swallows any other parse error whose message happens to carry it, which is
 * the direction that ships a broken script.
 */
const RETURN_OUTSIDE = /^A 'return' statement can only be used within a function body\.?$/;

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/**
 * Every problem the shipped workflows have, and how many files were read.
 *
 * Problems rather than a throw, so one run names every file that is wrong
 * instead of the first.
 */
export function lintWorkflows({ dir = join(ULTRACODE, WORKFLOWS_DIR), agents = join(ULTRACODE, AGENTS_DIR), read = metaIn } = {}) {
  const problems = [];
  let entries = [];
  try {
    entries = readdirSync(dir).sort();
  } catch (err) {
    return { problems: [`${dir} could not be read: ${err.message}`], checked: 0 };
  }

  const shipped = agentTypesIn(agents);
  let checked = 0;
  const names = new Map();
  for (const entry of entries) {
    const path = join(dir, entry);
    // Opened once and asked what it is through the handle, the way the plugin's
    // own `readIfFile` does it: a path checked with `stat` and then read by name
    // is a path something else can swap between the two, and what this gate
    // then vouches for is not the file the loader will run.
    let handle;
    try {
      handle = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    } catch (err) {
      // A link pointing nowhere, or a file this account cannot open. Reported
      // rather than thrown: a gate that dies on one entry checks none of the rest.
      problems.push(`${entry}: could not be read: ${err.message}`);
      continue;
    }
    let text;
    try {
      if (!fstatSync(handle).isFile()) continue;
      if (!entry.endsWith(".js")) {
        // Named rather than passed over: the loader recognises these three and
        // refuses them, so a workflow written as `.mjs` is one nobody can run and
        // nothing says why.
        problems.push(`${entry}: the loader reads only .js here, so this file ships and never loads`);
        continue;
      }
      checked++;
      text = readFileSync(handle, "utf8");
    } catch (err) {
      problems.push(`${entry}: could not be read: ${err.message}`);
      continue;
    } finally {
      closeSync(handle);
    }
    problems.push(...problemsIn(entry, text, read, shipped));

    // Two files declaring one name is one workflow: the merge keys on the name,
    // so the later file wins and the catalogue prints the name twice with two
    // different descriptions. Nothing upstream says which won.
    const named = read(text)?.name;
    if (named) {
      if (names.has(named)) problems.push(`${entry}: declares meta.name ${JSON.stringify(named)}, which ${names.get(named)} already declares`);
      else names.set(named, entry);
    }
  }
  return { problems, checked };
}

/**
 * The agent types this plugin ships, under the names a spawn resolves.
 *
 * Null where the directory cannot be read, which turns the cross-check below
 * off rather than reporting every named type as missing: a caller that pointed
 * this somewhere else meant to check the workflows alone.
 */
function agentTypesIn(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const types = new Set();
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    let front;
    try {
      front = frontmatterIn(readFileSync(join(dir, entry), "utf8"));
    } catch {
      // An agent file this cannot read is one it cannot vouch for, so the
      // cross-check below simply will not find its name. Reported there rather
      // than here, where it would read as a workflow problem.
      continue;
    }
    // Keyed on the frontmatter name, which is what the build keys on: a file
    // called `finder.md` naming something else is that other agent.
    if (front?.name) types.add(`${PLUGIN}:${front.name}`);
  }
  return types;
}

/**
 * What a plugin agent file declares, or null for a file with no frontmatter.
 *
 * The three keys this gate rules on, plus the two the build ignores with a
 * warning, read off a block the build hands to a YAML parser. Quoted values
 * and a trailing comment are forgiven, because reporting a working file as
 * wrong is the failure that wastes an afternoon.
 */
export function frontmatterIn(text) {
  const lines = String(text ?? "").replace(/^﻿/, "").split(/\r?\n/);
  let at = 0;
  while (at < lines.length && lines[at].trim() === "") at++;
  if (!/^---[ \t]*$/.test(lines[at] ?? "")) return null;

  const front = { name: null, description: null, effort: null, disallowedTools: null, tools: null };
  for (at++; at < lines.length; at++) {
    if (/^---[ \t]*$/.test(lines[at])) return front;
    const pair = /^([A-Za-z_][A-Za-z0-9_-]*):(?=[ \t]|$)[ \t]*(.*)$/.exec(lines[at]);
    if (!pair) continue;
    const [, key, raw] = pair;
    // First wins, which is how a YAML mapping resolves a duplicate key.
    if (key in front && front[key] !== null) continue;
    const value = unquote(raw);
    if (key === "disallowedTools" || key === "tools") {
      front[key] = value === "" ? [] : value.replace(/^\[|\]$/g, "").split(",").map((tool) => unquote(tool)).filter((tool) => tool !== "");
      continue;
    }
    // Every other key is reported as written, so a case asking about one the
    // build ignores sees it rather than a null.
    front[key] = value;
  }
  return null;
}

/** A scalar as YAML reads one: quotes off, and a comment after it cut. */
function unquote(raw) {
  const text = String(raw ?? "").trim();
  const quoted = /^(["'])(.*)\1[ \t]*(?:#.*)?$/.exec(text);
  if (quoted) return quoted[2];
  return text.replace(/(^|[ \t])#.*$/, "").trim();
}

/**
 * The body as the build takes it: everything after the meta statement, with the
 * separator between them stripped.
 *
 * One expression, called by both readers here, because where a script begins is
 * one fact: a second copy of this is a second answer to it, and the two would
 * drift the next time the build's own spelling moves.
 */
const bodyAfter = (text, meta) => text.slice(meta.end).replace(/^[;\s]*\n/, "").trimStart();

/**
 * A script's meta and its body, split where the build splits them.
 *
 * Exported because the test harness has to run a script the same way, and a
 * second splitter would be a second answer to where a script begins.
 */
export function splitScript(text) {
  const parsed = parseSync("workflow.js", text, PARSE);
  const first = parsed.program.body[0];
  if (!isMetaExport(first)) throw new Error("`export const meta = { … }` must be the first statement");
  return {
    meta: literalOf(first.declaration.declarations[0].init),
    body: bodyAfter(text, first),
  };
}

/** What is wrong with one script, each said once and in the file's own name. */
function problemsIn(file, text, read, shipped) {
  const say = (problem) => `${file}: ${problem}`;
  const bytes = Buffer.byteLength(text);
  if (bytes > SCRIPT_MOST) return [say(`${bytes} bytes, over the ${SCRIPT_MOST} the loader skips at`)];

  const parsed = parseSync(file, text, PARSE);

  // A top-level `return` is how a workflow exits early, and the build parses
  // for it deliberately (`allowReturnOutsideFunction`). Every other complaint
  // is a script that will not compile.
  const real = parsed.errors.filter((e) => !RETURN_OUTSIDE.test(String(e.message).trim()));
  if (real.length > 0) return [say(`will not parse: ${real[0].message}`)];

  const first = parsed.program.body[0];
  if (!isMetaExport(first)) {
    return [say("`export const meta = { … }` must be the first statement, or the loader skips the file")];
  }

  const problems = [];
  let meta;
  try {
    meta = literalOf(first.declaration.declarations[0].init);
  } catch (err) {
    return [say(`meta must be a pure literal: ${err.message}`)];
  }

  if (typeof meta.name !== "string" || meta.name.length === 0) problems.push(say("meta.name must be a non-empty string"));
  if (typeof meta.description !== "string" || meta.description.length === 0) {
    problems.push(say("meta.description must be a non-empty string"));
  }
  // The build resolves any name at all, and the catalogue quotes only this
  // class. A name outside it therefore ships a workflow that loads, costs a
  // file, and is named nowhere in any session: the hook is the only thing that
  // ever says a plugin workflow exists.
  if (typeof meta.name === "string" && meta.name.length > 0 && !RESOLVABLE.test(meta.name)) {
    problems.push(say(`meta.name ${JSON.stringify(meta.name)} is outside ${RESOLVABLE}, so the catalogue cannot name it and nothing else will`));
  }

  problems.push(...readerProblems(say, text, meta, read));

  const body = bodyAfter(text, first);

  try {
    new AsyncFunction(body);
  } catch (err) {
    return [...problems, say(`the body is not a valid async function body: ${err.message}`)];
  }

  problems.push(...bodyProblems(say, parsed.program.body.slice(1), meta, shipped));
  return problems;
}

/**
 * Whether the plugin's own reader answers what a parse answers.
 *
 * The hook builds the sentence the model reads out of its reader, and a file
 * the two disagree about is one where that sentence describes a workflow
 * nobody has.
 */
function readerProblems(say, text, meta, read) {
  const mine = read(text);
  const parsed = {
    name: typeof meta.name === "string" ? meta.name : null,
    description: typeof meta.description === "string" ? meta.description : null,
    whenToUse: typeof meta.whenToUse === "string" && meta.whenToUse.length > 0 ? meta.whenToUse : null,
  };
  const answer = mine && { name: mine.name, description: mine.description, whenToUse: mine.whenToUse };
  // A meta the parse itself refuses has already been reported; the reader
  // answering null there is agreement, not a second problem.
  const refused = parsed.name === null || parsed.name === "" || parsed.description === null || parsed.description === "";
  if (refused) return answer === null ? [] : [say("the plugin's own reader accepts a meta the build refuses")];
  if (JSON.stringify(answer) === JSON.stringify(parsed)) return [];
  return [say(`the plugin's own reader answers ${JSON.stringify(answer)} where a parse answers ${JSON.stringify(parsed)}`)];
}

/** Whether a statement is the meta declaration the loader requires. */
function isMetaExport(node) {
  if (node?.type !== "ExportNamedDeclaration") return false;
  const declaration = node.declaration;
  if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") return false;
  if (declaration.declarations.length !== 1) return false;
  const [only] = declaration.declarations;
  return only.id?.type === "Identifier" && only.id.name === "meta" && only.init?.type === "ObjectExpression";
}

/** What the script's body does that the sandbox will not let it do. */
function bodyProblems(say, statements, meta, shipped) {
  const problems = [];
  const bound = new Set(INJECTED);
  const free = new Set();
  const phases = new Set();
  let unreadable = false;

  for (const node of statements) {
    walk(node, (child, parent) => {
      collectBindings(child, bound);
      if (child.type === "WithStatement") problems.push(say("`with` is refused by the workflow compiler"));
      if (child.type === "ImportExpression") problems.push(say("`import()` is refused by the workflow compiler"));
      if (child.type === "VariableDeclaration" && child.kind === "await using") {
        problems.push(say("`await using` is refused by the workflow compiler"));
      }
      if (child.type === "Identifier" && child.name.startsWith(RESERVED_PREFIX)) {
        problems.push(say(`\`${child.name}\` is reserved by the workflow compiler`));
      }
      if (isMember(child, "Date", "now")) problems.push(say("`Date.now()` throws in the workflow sandbox; pass a timestamp through args"));
      if (isMember(child, "Math", "random")) problems.push(say("`Math.random()` throws in the workflow sandbox; vary a label or prompt by index"));
      if (child.type === "NewExpression" && child.callee?.type === "Identifier" && child.callee.name === "Date" && child.arguments.length === 0) {
        problems.push(say("`new Date()` with no argument throws in the workflow sandbox"));
      }
      // The shim's first line is `if (!new.target) throw`, so a bare call
      // throws whatever it was passed.
      if (child.type === "CallExpression" && child.callee?.type === "Identifier" && child.callee.name === "Date") {
        problems.push(say("`Date()` called without `new` throws in the workflow sandbox"));
      }
      if (isPhaseCall(child)) phases.add(child.arguments[0].value);
      // A title this cannot read is not a title nobody calls. Reported as one,
      // the gate refuses a script whose phases are spelled with a template, a
      // variable, or a helper the script calls with a literal.
      if (isPhaseCallWithUnreadableTitle(child)) unreadable = true;
      // A stage naming an agent type nobody ships fails at the spawn with
      // "agent type not found", which is a whole phase of a run lost to a
      // typo nothing else reads.
      const named = agentTypeIn(child);
      if (named !== null && shipped !== null && !shipped.has(named)) {
        problems.push(say(`agentType ${JSON.stringify(named)} is not one this plugin ships`));
      }
      if (isReference(child, parent)) free.add(child.name);
    });
  }

  for (const name of free) {
    if (bound.has(name) || LANGUAGE.has(name)) continue;
    problems.push(say(`\`${name}\` is not one of the ${INJECTED.length} names the sandbox injects, so reaching it is a ReferenceError mid-run`));
  }

  problems.push(...phaseProblems(say, phases, meta, unreadable));
  return problems;
}

/** Whether a meta's declared phases and the script's phase calls describe one run. */
function phaseProblems(say, called, meta, unreadable = false) {
  const problems = [];
  // Upstream drops what it cannot read here without a word: a non-array
  // `phases`, or an entry with no string `title`, simply is not there, and the
  // run loses its progress grouping while reporting nothing.
  if (meta.phases !== undefined && !Array.isArray(meta.phases)) {
    problems.push(say("meta.phases must be an array, or the build drops it in silence"));
  }
  for (const [at, phase] of (Array.isArray(meta.phases) ? meta.phases : []).entries()) {
    if (!phase || typeof phase !== "object" || typeof phase.title !== "string") {
      problems.push(say(`meta.phases[${at}] has no string title, so the build drops it in silence`));
    }
  }
  const declared = new Set(
    (Array.isArray(meta.phases) ? meta.phases : [])
      .filter((phase) => phase && typeof phase === "object" && typeof phase.title === "string")
      .map((phase) => phase.title),
  );
  for (const title of called) {
    // The build matches titles exactly and says nothing about one that misses,
    // so a typo costs the run its progress grouping and reports as working.
    if (!declared.has(title)) problems.push(say(`phase(${JSON.stringify(title)}) has no entry in meta.phases`));
  }
  // Only where every call's title could be read. One that could not is a title
  // this cannot match, so reporting the declared entry as unused would refuse a
  // script that calls it.
  if (!unreadable) {
    for (const title of declared) {
      if (!called.has(title)) problems.push(say(`meta.phases names ${JSON.stringify(title)}, which no phase() call uses`));
    }
  }
  return problems;
}

/** Whether a node is `object.property`, read or called. */
function isMember(node, object, property) {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object?.type === "Identifier" &&
    node.object.name === object &&
    node.property?.type === "Identifier" &&
    node.property.name === property
  );
}

/**
 * The agent type a stage names, or null where it names none this can read.
 *
 * Only a literal: a type built at runtime is one this cannot check, and
 * guessing at it would report a working script.
 */
function agentTypeIn(node) {
  if (node.type !== "Property" || node.computed) return null;
  const key = node.key?.type === "Identifier" ? node.key.name : node.key?.value;
  if (key !== "agentType") return null;
  return typeof node.value?.value === "string" ? node.value.value : null;
}

/** Whether a node is `phase('…')` with a literal title this can read. */
function isPhaseCall(node) {
  return isPhaseCallAtAll(node) && typeof node.arguments[0]?.value === "string";
}

/** Whether a node is a `phase()` call whose title this cannot read. */
function isPhaseCallWithUnreadableTitle(node) {
  return isPhaseCallAtAll(node) && typeof node.arguments[0]?.value !== "string";
}

function isPhaseCallAtAll(node) {
  return node.type === "CallExpression" && node.callee?.type === "Identifier" && node.callee.name === "phase";
}

/** Node types whose `key` names something rather than reading it. */
const KEYED = new Set(["Property", "PropertyDefinition", "MethodDefinition", "AccessorProperty"]);

/** Node types whose `id` names something rather than reading it. */
const BINDING_PARENTS = new Set(["VariableDeclarator", "FunctionDeclaration", "FunctionExpression", "ClassDeclaration", "ClassExpression"]);

/**
 * Whether an identifier is a reference to a name rather than a name being
 * written down.
 *
 * A property after a dot, a non-computed key, a label and every binding
 * position are spellings of a name that resolve to nothing in scope, and
 * counting one as a reference reports `title` as a missing global.
 */
function isReference(node, parent) {
  if (node.type !== "Identifier" || !parent) return false;
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return false;
  // `MethodDefinition` among them: a class method, getter, setter or
  // constructor is a name being written down, and counting one as a reference
  // refuses a script whose only crime is declaring a class.
  if (KEYED.has(parent.type) && parent.key === node && !parent.computed) return false;
  if (parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") return false;
  if (BINDING_PARENTS.has(parent.type) && parent.id === node) return false;
  return true;
}

/**
 * Every name a node introduces into scope.
 *
 * Collected across the whole script rather than per scope: a name bound
 * anywhere is a name this will not report, which is lenient in the one
 * direction that matters. A stricter reading would need the scope tree, and
 * what this is for is catching `require` and `process`, not shadowing.
 */
function collectBindings(node, bound) {
  if (node.type === "VariableDeclarator") namesIn(node.id, bound);
  if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
    if (node.id?.type === "Identifier") bound.add(node.id.name);
    for (const param of node.params ?? []) namesIn(param, bound);
  }
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    if (node.id?.type === "Identifier") bound.add(node.id.name);
  }
  if (node.type === "CatchClause" && node.param) namesIn(node.param, bound);
  if ((node.type === "ForOfStatement" || node.type === "ForInStatement") && node.left?.type !== "VariableDeclaration") {
    namesIn(node.left, bound);
  }
}

/** The names a binding pattern of any shape introduces. */
function namesIn(pattern, bound) {
  if (!pattern || typeof pattern !== "object") return;
  switch (pattern.type) {
    case "Identifier":
      bound.add(pattern.name);
      return;
    case "ObjectPattern":
      for (const property of pattern.properties) namesIn(property.type === "RestElement" ? property.argument : property.value, bound);
      return;
    case "ArrayPattern":
      for (const element of pattern.elements) namesIn(element, bound);
      return;
    case "AssignmentPattern":
      namesIn(pattern.left, bound);
      return;
    case "RestElement":
      namesIn(pattern.argument, bound);
      return;
    default:
  }
}

/** Every node under one, with its parent, depth-first. */
function walk(node, visit, parent = null) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, parent);
    return;
  }
  if (typeof node.type !== "string") return;
  visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "range" || key === "loc") continue;
    walk(value, visit, node);
  }
}

/** The keys the build refuses outright, whatever their value. */
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** One meta literal as a value, refusing every node the build refuses. */
function literalOf(node) {
  switch (node.type) {
    case "Literal":
      return node.value;
    case "TemplateLiteral":
      if (node.expressions.length > 0) throw new Error("template interpolation not allowed in meta");
      return node.quasis.map((quasi) => quasi.value.cooked).join("");
    case "UnaryExpression":
      // The build's own condition, rather than a recursion that happens to
      // reach the same values: it requires `-` on a number literal, so `- -1`
      // and `-'3'` are metas it refuses and files this must refuse by the same
      // name rather than through the reader cross-check downstream.
      if (node.operator !== "-" || node.argument?.type !== "Literal" || typeof node.argument.value !== "number") {
        throw new Error("only negative-number unary allowed in meta");
      }
      return -node.argument.value;

    case "ArrayExpression":
      return node.elements.map((element) => {
        if (element === null) throw new Error("sparse arrays not allowed");
        if (element.type === "SpreadElement") throw new Error("spread not allowed in meta");
        return literalOf(element);
      });
    case "ObjectExpression":
      return objectOf(node);
    default:
      throw new Error(`non-literal node type in meta: ${node.type}`);
  }
}

function objectOf(node) {
  const value = {};
  for (const property of node.properties) {
    if (property.type === "SpreadElement") throw new Error("only plain properties allowed in meta");
    if (property.computed) throw new Error("computed keys not allowed in meta");
    if (property.method || property.kind !== "init") throw new Error("methods/accessors not allowed in meta");
    // An identifier or any literal, which is the build's own pair of cases: a
    // numeric key is `String(1)` there, and refusing it here refuses a file the
    // loader reads.
    if (property.key.type !== "Identifier" && property.key.type !== "Literal") {
      throw new Error(`unsupported key type in meta: ${property.key.type}`);
    }
    const key = property.key.type === "Identifier" ? property.key.name : String(property.key.value);
    if (RESERVED_KEYS.has(key)) throw new Error(`reserved key name not allowed in meta: ${key}`);
    Object.defineProperty(value, key, { value: literalOf(property.value), writable: true, enumerable: true, configurable: true });
  }
  return value;
}

if (invokedAs(import.meta.url)) {
  const { problems, checked } = lintWorkflows();
  for (const problem of problems) console.error(problem);
  console.log(`${checked} workflow${checked === 1 ? "" : "s"} checked, ${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  process.exit(problems.length === 0 ? 0 : 1);
}
