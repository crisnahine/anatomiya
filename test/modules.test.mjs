import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ANATOMIYA, BINARY, REL } from "../scripts/plugins.mjs";
import { parseSync } from "oxc-parser";
import { boundNames } from "../plugins/anatomiya/lib/walk.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(ANATOMIYA, "lib");

/**
 * Who imports whom, inside one directory. Node's own modules and the one npm
 * dependency are not part of this repository's shape.
 */
function graph(dir = LIB) {
  const edges = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".mjs"))) {
    const src = readFileSync(join(dir, file), "utf8");
    // Every spelling that closes a cycle, not just the one this repo writes
    // most: a bare `import "./x.mjs"` runs the module for its side effects and
    // a dynamic `import("./x.mjs")` is the form `parse-worker.mjs` already uses.
    // A cycle through either would pass a check that only knew `from`.
    const local = [...src.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["']\.\/([^"']+\.mjs)["']/g)].map((m) => m[1]);
    edges.set(file, [...new Set(local)]);
  }
  return edges;
}

/** Every cycle the edges hold, as a path each. */
function cyclesIn(edges) {
  const cycles = [];
  // Reset per root, so the report names every cycle rather than the first one
  // reached. A shared set stops the walk at a module some earlier root already
  // passed through, which is enough to fail the gate but not to fix it.
  let seen = new Set();
  const walk = (file, path) => {
    const at = path.indexOf(file);
    if (at !== -1) return void cycles.push([...path.slice(at), file].join(" -> "));
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of edges.get(file) || []) walk(next, [...path, file]);
  };
  for (const file of edges.keys()) {
    seen = new Set();
    walk(file, []);
  }
  return [...new Set(cycles)];
}

test("no module in lib imports its way back to itself", () => {
  // A cycle loads under ESM hoisting, so nothing fails at run time and the
  // first symptom is a module reading a half-initialised binding from a
  // partner that is still evaluating. `ruby.mjs` carried a comment refusing an
  // import for exactly this reason, and the comment was deleted in the same
  // change that took the import.
  assert.deepEqual(cyclesIn(graph()), []);
});

test("no script in scripts imports its way back to itself either", () => {
  // `scripts/` had no import graph of its own until the gates started sharing:
  // eleven files reach `entry.mjs`, `shipped.mjs` reads `validate.mjs`'s list
  // of loadable kinds, and `check-docs.mjs` runs `release.mjs`'s resolver. The
  // same hoisting applies, and one of these files runs in CI as the only thing
  // standing between a broken manifest and a release.
  const edges = graph(join(ROOT, "scripts"));

  assert.ok(edges.size > 0, "no scripts were read");
  assert.deepEqual(cyclesIn(edges), []);
});

/** Every module in `lib/` this one can reach, itself included. */
function reachedFrom(entry, edges = graph()) {
  const reached = new Set();
  const walk = (file) => {
    if (reached.has(file)) return;
    reached.add(file);
    for (const next of edges.get(file) || []) walk(next);
  };
  walk(entry);
  return reached;
}

test("no module the parse worker reaches imports node:child_process", () => {
  // Every JS parse child loads `dimensions.mjs` for the registry, and the two
  // Ruby dimension files took their walkers from `ruby.mjs`, the module that
  // spawns Ruby. That put the spawn machinery and the inline prism script into
  // all eight forked workers, which is the exact cost `langs.mjs` and
  // `limits.mjs` exist to avoid. `ruby-walk.mjs` is the importable leaf.
  const offenders = [...reachedFrom("parse-worker.mjs")].filter((file) =>
    /from\s*["']node:child_process["']/.test(readFileSync(join(LIB, file), "utf8"))
  );
  assert.deepEqual(offenders, []);
});

test("every bridge that runs a child takes the guards from the one supervisor", () => {
  // The same rule read from the other end: `child.mjs` is where the spawn, the
  // stderr cap, the clocks and the kill live for all three bridges, so it is
  // also the module that must stay on the far side of the parse worker's walk.
  // A fourth engine that wrote the battery a fourth time would fail here.
  const edges = graph();

  for (const bridge of ["pool.mjs", "ruby.mjs", "semantic.mjs"]) {
    assert.ok(edges.get(bridge).includes("child.mjs"), `${bridge} guards a child of its own again`);
  }
  assert.equal(reachedFrom("parse-worker.mjs", edges).has("child.mjs"), false);
});

test("the writers do not reach the pipeline that produced the record", () => {
  // Three of the four readers of the old module wanted a writer or the caveat
  // table and paid a parser, a git runner and the whole registry for it. The
  // record is the only thing between the two halves, so the reach is the seam:
  // a writer that reaches back into the pipeline has taken a second way to
  // learn something the record already carries.
  assert.deepEqual([...reachedFrom("check-report.mjs")].sort(), [
    "check-report.mjs",
    "encode.mjs",
    "rules.mjs",
  ]);
});

test("the grammar deciding what a branch introduced reaches no git, no child and no disk, and only the check reaches it", () => {
  // The identity of a site was pinned by comments in four other test files,
  // one citing a line that had moved, because the rule had no interface of its
  // own: the only way to run it was a repository committed twice. A leaf with a
  // namesake test is the fix, and it stays a leaf only while nothing but the
  // check imports it and it imports nothing that reads a repository.
  const edges = graph();
  const reached = reachedFrom("introduced.mjs", edges);
  for (const module of ["git.mjs", "child.mjs", "corpus.mjs", "revision.mjs", "check.mjs"]) {
    assert.equal(reached.has(module), false, `introduced.mjs reaches ${module}`);
  }
  const importers = [...edges].filter(([, deps]) => deps.includes("introduced.mjs")).map(([file]) => file);
  assert.deepEqual(importers, ["check.mjs"]);
});

test("the parse worker does not reach the registry", () => {
  // The worker runs the tree rows off `dimensionsFor` and nothing else: an
  // obligation has no program to run against and a filename row answers off
  // the corpus, so composing all three in eight forked children buys nothing.
  assert.equal(reachedFrom("parse-worker.mjs").has("registry.mjs"), false);
});

test("a module that branches on a row's kind loads the registry that stamps it", () => {
  // `stampKind` writes the field in place while the registry is assembled, so
  // a reader that never loads it reads undefined off a tree row and takes the
  // other branch without a word. `dimensions.mjs` writes the stamp and
  // `registry.mjs` runs it, which is where both of them read the field.
  const offenders = [];
  for (const [file, imports] of graph()) {
    if (file === "dimensions.mjs" || file === "registry.mjs") continue;
    if (!/\b(?:d|dim|dimension|row)\.kind\b/.test(readFileSync(join(LIB, file), "utf8"))) continue;
    if (!imports.includes("registry.mjs")) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

/**
 * The bodies of the named exports in one lib module, keyed by name.
 *
 * Read from source, because what is under test is which runner a function
 * reaches for, and both runners answer the same values.
 */
function bodies(file) {
  const src = readFileSync(join(LIB, file), "utf8");
  const out = new Map();
  for (const m of src.matchAll(/^(?:export )?(?:async )?function (\w+)\(/gm)) {
    const start = m.index;
    const next = src.slice(start + 1).search(/^(?:export )?(?:async )?function \w+\(/m);
    out.set(m[1], next === -1 ? src.slice(start) : src.slice(start, start + 1 + next));
  }
  return out;
}

test("every git read that grows with the repository is streamed, never buffered", () => {
  // Measured: `execFile` throws `RangeError: Invalid string length` from
  // inside Node's own exit handler, `maxBuffer` does not protect against it,
  // and V8 caps any string at 0x1fffffe8 bytes. Both runners answer the same
  // values on a small repository, so the only thing that says which one a
  // function used is the call it makes.
  const git = bodies("git.mjs");
  const check = bodies("check.mjs");

  for (const [name, body] of [
    ["filesAt", git.get("filesAt")],
    ["pathSet", git.get("pathSet")],
    ["changedSinceWorktree", git.get("changedSinceWorktree")],
    ["diffRange", git.get("diffRange")],
    ["changedFiles", check.get("changedFiles")],
  ]) {
    assert.ok(body, `${name} is not a named function any more`);
    assert.doesNotMatch(body, /gitBuffered\(/, `${name} buffers a listing that grows with the repository`);
  }
});

test("the bounded git reads stay on the buffered runner", () => {
  // The split is real rather than incidental: a blob, a ref and one sha are
  // bounded by what they are, and streaming them buys nothing.
  const git = bodies("git.mjs");

  for (const name of ["showBlob", "headSha", "mergeBase", "shaReachable"]) {
    assert.match(git.get(name), /gitBuffered\(/, `${name} left the runner it belongs on`);
  }
});

/**
 * The names the roster module defines, wherever they are read.
 *
 * `render.mjs` re-exported four of them so its own callers could keep taking
 * them from there, which is two homes for one name: a reader who greps for
 * `plural` finds the definition, the pass-through and importers of each, and
 * nothing says which is the one to add the next name beside.
 */
const ROSTER_NAMES = ["kindsLine", "layoutSummary", "namesakeClause", "plural", "renderLayout", "ROOT_LABEL"];

function sourceFiles() {
  // The marketplace's own directories, and each plugin's: a file that reaches
  // across the seam lives in one of them. The second plugin is here too, since
  // a rule that reads one plugin and not the other is a rule that covers the
  // repository by half.
  // Answered with slashes on every platform: `readdirSync` gives the host's
  // separator, and every rule below compares what comes back against a path
  // this repository spells one way. On Windows the module allowed to hold the
  // plugin path was reported as breaking its own rule, and the filter for what
  // the plugin ships matched none of it.
  return ["scripts", "test", `${REL.anatomiya}/bin`, `${REL.anatomiya}/commands`, `${REL.anatomiya}/hooks`, `${REL.anatomiya}/lib`, REL.ultracode].flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true })
      .filter((name) => typeof name === "string" && name.endsWith(".mjs"))
      .map((name) => `${dir}/${name.split(/[\\/]/).join("/")}`)
  );
}

/**
 * The source with its comments blanked, and its string bodies too when asked.
 *
 * Blanked rather than cut, so every offset still lines up with the file a
 * reader opens. The `/` is the whole difficulty: it opens a regular expression
 * only where a value cannot already be sitting to its left, and a stripper that
 * skips that test reads `/(["'])/` as the start of a string and blanks the rest
 * of the file, which is a rule that passes because it saw nothing. A template's
 * `${...}` is code and stays whatever is asked for, since the path a rule looks
 * for can be spelled in either half.
 */
function scan(src, { strings = false } = {}) {
  const blank = (text) => text.replace(/[^\n]/g, " ");
  let out = "";
  let prev = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === "//") {
      const stop = src.indexOf("\n", i);
      const end = stop === -1 ? src.length : stop;
      out += blank(src.slice(i, end));
      i = end;
      continue;
    }
    if (two === "/*") {
      const stop = src.indexOf("*/", i + 2);
      const end = stop === -1 ? src.length : stop + 2;
      out += blank(src.slice(i, end));
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      const body = src.slice(i + 1, Math.min(j, src.length));
      out += c + (strings ? blank(body) : body) + (j < src.length ? c : "");
      prev = c;
      i = Math.min(j + 1, src.length);
      continue;
    }
    if (c === "`") {
      out += c;
      let j = i + 1;
      while (j < src.length && src[j] !== "`") {
        if (src[j] === "\\") {
          out += "  ";
          j += 2;
          continue;
        }
        if (src.slice(j, j + 2) === "${") {
          // The expression is code: copied through, with its own braces
          // counted so a nested object literal does not end it early. Counting
          // starts at the brace and not at the `$`, or the first pass sees no
          // brace, leaves the depth at zero and ends the expression on the
          // character that opened it.
          let depth = 0;
          const from = j;
          j += 1;
          do {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") depth--;
            j++;
          } while (j < src.length && depth > 0);
          out += scan(src.slice(from, j), { strings });
          continue;
        }
        out += strings ? (src[j] === "\n" ? "\n" : " ") : src[j];
        j++;
      }
      out += j < src.length ? "`" : "";
      prev = "`";
      i = Math.min(j + 1, src.length);
      continue;
    }
    // A value to the left means division; anything else means a literal.
    if (c === "/" && !/[\w$)\]]/.test(prev)) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && (inClass || src[j] !== "/")) {
        if (src[j] === "\\") j += 2;
        else {
          if (src[j] === "[") inClass = true;
          else if (src[j] === "]") inClass = false;
          else if (src[j] === "\n") break;
          j++;
        }
      }
      out += blank(src.slice(i, Math.min(j + 1, src.length)));
      prev = "/";
      i = Math.min(j + 1, src.length);
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

test("a roster name is taken from the module that defines it and from no other", () => {
  const wrong = [];
  for (const rel of sourceFiles()) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
      const names = m[1].split(",").map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      const taken = names.filter((n) => ROSTER_NAMES.includes(n));
      if (taken.length > 0 && !m[2].endsWith("render-layout.mjs")) wrong.push(`${rel}: ${taken.join(", ")} from ${m[2]}`);
    }
  }

  assert.deepEqual(wrong, []);
});

test("no file under scripts/ hardcodes the rules or store directory instead of importing it", () => {
  // A comment cannot import a constant: the only file left here names
  // `.claude/rules/` in a prose aside about a past bash-output miscount.
  const EXEMPT = new Set(["scripts/measure-delivery.mjs"]);
  const offenders = [];
  for (const rel of sourceFiles().filter((f) => f.split(/[\\/]/)[0] === "scripts")) {
    // The listing carries the host's separator and this set is written in the
    // one every other path here uses, so the exemption is looked up in posix.
    if (EXEMPT.has(rel.split(/[\\/]/).join("/"))) continue;
    const src = readFileSync(join(ROOT, rel), "utf8");
    if (src.includes(".claude/rules") || src.includes(".claude/anatomiya")) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test("nothing anatomiya ships imports the plugin beside it", () => {
  // A plugin's hook may only run a file inside its own root, which is why the
  // second plugin keeps its own copy of the payload read and the entry guard.
  // An import across the seam would load under the suite and be missing from
  // both installs, so the README's claim about the two is pinned here rather
  // than left as a sentence.
  // The plugin's own list, not the marketplace's: the root declares the
  // workspaces and ships nothing itself. Spelled without the trailing slash,
  // because npm reads `lib` and `lib/` as the same entry and a lookup that knew
  // one of them skipped every file.
  const SHIPPED = new Set(
    JSON.parse(readFileSync(join(ANATOMIYA, "package.json"), "utf8")).files.map((entry) => entry.replace(/\/$/, "")),
  );
  const read = [];
  const offenders = [];
  for (const rel of sourceFiles()) {
    if (!rel.startsWith(`${REL.anatomiya}/`)) continue;
    const dir = rel.slice(REL.anatomiya.length + 1).split(/[\\/]/)[0];
    if (!SHIPPED.has(dir)) continue;
    read.push(rel);
    // The three spellings `graph()` above matches, for the reason it gives:
    // a bare import and a dynamic one cross the seam as surely as `from` does,
    // and the one this repository writes least is the one a leak would use.
    if (/(?:from\s*|import\s*\(\s*|import\s+)["'][^"']*ultracode-anywhere/.test(readFileSync(join(ROOT, rel), "utf8"))) {
      offenders.push(rel);
    }
  }

  // The loop having a body, not the list having entries: `files` can be full
  // and every one of its spellings miss, which is how this checked nothing.
  assert.ok(read.length > 20, `read only ${read.length} shipped files`);
  assert.deepEqual(offenders, []);
});


test("no repository-relative plugin path is spelled outside the one module that holds it", () => {
  // The move that put the plugins under `plugins/` had to find every file that
  // spelled the path by hand. What this covers is the repository-relative
  // spelling, the one a constant can carry: a relative import cannot go through
  // one, so `../plugins/anatomiya/lib/x.mjs` in a test is a specifier rather
  // than a second copy of the fact.
  //
  // What it cannot see is the other direction. Routing a string through `REL`
  // satisfies this rule whether or not the string was ever this repository's
  // path, and a sweep did exactly that to four fixtures: a module specifier in
  // a synthetic corpus, a `bin` on a fixture PATH, a scanned repository's own
  // source directory. Each still passed, and each had stopped testing what its
  // name says. A path inside a fixture tree is that tree's, not ours.
  const offenders = [];
  for (const rel of sourceFiles()) {
    if (rel === "scripts/plugins.mjs") continue;
    // Code, not prose: a comment naming the directory is documentation, and
    // saying `${REL.anatomiya}` in a sentence would make it worse. What this is
    // about is a second place the program itself reads the path from.
    const src = scan(readFileSync(join(ROOT, rel), "utf8"));
    // `"./plugins/anatomiya"` is the idiomatic spelling and the first pattern
    // here missed it, and a path handed to `join` a segment at a time is the
    // same fact spelled without a slash in it.
    if (/["'`](?:\.\/)?plugins\/(?:anatomiya|ultracode-anywhere)\b/.test(src)) offenders.push(rel);
    else if (/["'`]plugins["'`]\s*,\s*["'`](?:anatomiya|ultracode-anywhere)["'`]/.test(src)) offenders.push(rel);
  }

  assert.ok(sourceFiles().length > 50, "no source files were read");
  assert.deepEqual(offenders, []);
});

/**
 * Every name one module offers the rest of the repository.
 *
 * Read off the module rather than listed here, so a name added to it is
 * covered by the rule the moment it exists.
 */
function exportedBy(rel) {
  const src = readFileSync(join(ROOT, rel), "utf8");
  const names = new Set();
  for (const [, name] of src.matchAll(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(name);
  return names;
}

// A name imported nowhere and declared nowhere is a `ReferenceError` waiting
// for the one run that gets that far. `scripts/ab.mjs` carried one for a whole
// review round: its old path constant was replaced by this module's `BINARY`
// and the import was never added, and the arg gate three lines above it made
// the script look healthy to everything that ran it.
test("a name this repository's own module offers is imported where it is used, not assumed", () => {
  const offered = exportedBy("scripts/plugins.mjs");
  assert.ok(offered.size > 0, "read no exported names");
  const assumed = [];
  for (const rel of sourceFiles()) {
    if (rel === "scripts/plugins.mjs") continue;
    // Strings blanked as well: `installed` is a word an assertion sentence
    // uses far more often than this repository's function of that name.
    const src = scan(readFileSync(join(ROOT, rel), "utf8"), { strings: true });
    for (const name of offered) {
      if (!new RegExp(`\\b${name}\\b`).test(src)) continue;
      const imported = new RegExp(`import[^;]*\\b${name}\\b[^;]*from`).test(src);
      const declared = new RegExp(`(?:const|let|var|function|class)\\s+${name}\\b|\\b${name}\\s*[,}][^=]*=\\s`).test(src);
      if (!imported && !declared) assumed.push(`${rel}: ${name}`);
    }
  }

  assert.deepEqual(assumed, []);
});

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/**
 * Every read in a module that no scope in reach declares, where a block in the
 * same module does.
 *
 * Resolved the way the engine resolves it: a block, a `for` head, a `switch`,
 * a `catch` and a function each open a scope, `var` hoists to the nearest
 * function or the module, and an import or a top-level declaration is the
 * module's. What is left is a name that exists in the file and not where it is
 * read, which is the one shape `node --check` passes and the first run to get
 * there throws on.
 */
function readOutsideTheirBlock(src, file) {
  const { program } = parseSync(file, src, { sourceType: "module" });
  const inBlocks = new Set();
  const out = [];
  const lineOf = (offset) => src.slice(0, offset).split("\n").length;
  const open = (parent, kind) => ({ names: new Set(), parent, kind });
  const resolves = (name, scope) => {
    for (let s = scope; s; s = s.parent) if (s.names.has(name)) return true;
    return false;
  };
  // What a statement list declares into the scope holding it, ahead of the
  // walk, so a read above its declaration still resolves.
  const hoist = (stmts, scope, block) => {
    for (let stmt of stmts) {
      if (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration") stmt = stmt.declaration;
      if (!stmt) continue;
      const names = [];
      if (stmt.type === "VariableDeclaration" && stmt.kind !== "var") for (const d of stmt.declarations) boundNames(d.id, names);
      else if (stmt.type === "FunctionDeclaration" || stmt.type === "ClassDeclaration") {
        if (stmt.id) names.push(stmt.id.name);
      } else if (stmt.type === "ImportDeclaration") for (const sp of stmt.specifiers) names.push(sp.local.name);
      for (const n of names) {
        scope.names.add(n);
        if (block) inBlocks.add(n);
      }
    }
  };
  // `var` declared anywhere below, short of the next function.
  const hoistVars = (node, scope) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) hoistVars(n, scope);
      return;
    }
    if (FUNCTIONS.has(node.type)) return;
    if (node.type === "VariableDeclaration" && node.kind === "var") {
      for (const d of node.declarations) for (const n of boundNames(d.id)) scope.names.add(n);
    }
    for (const k of Object.keys(node)) if (k !== "type") hoistVars(node[k], scope);
  };
  // A pattern binds names the scope already holds, and reads only what its
  // defaults and computed keys say.
  const visitPattern = (p, scope) => {
    if (!p) return;
    switch (p.type) {
      case "AssignmentPattern":
        visitPattern(p.left, scope);
        return visit(p.right, scope);
      case "ObjectPattern":
        for (const q of p.properties) {
          if (q.type === "RestElement") visitPattern(q.argument, scope);
          else {
            if (q.computed) visit(q.key, scope);
            visitPattern(q.value, scope);
          }
        }
        return;
      case "ArrayPattern":
        for (const el of p.elements) visitPattern(el, scope);
        return;
      case "RestElement":
        return visitPattern(p.argument, scope);
    }
  };
  const visit = (node, scope) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, scope);
      return;
    }
    switch (node.type) {
      case "Identifier":
        if (!resolves(node.name, scope) && inBlocks.has(node.name)) out.push({ name: node.name, line: lineOf(node.start) });
        return;
      case "BlockStatement":
      case "StaticBlock": {
        const inner = open(scope, "block");
        hoist(node.body, inner, true);
        return visit(node.body, inner);
      }
      case "SwitchStatement": {
        visit(node.discriminant, scope);
        const inner = open(scope, "block");
        hoist(node.cases.flatMap((c) => c.consequent), inner, true);
        for (const c of node.cases) {
          visit(c.test, inner);
          visit(c.consequent, inner);
        }
        return;
      }
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const inner = open(scope, "block");
        const head = node.init ?? node.left;
        if (head && head.type === "VariableDeclaration") hoist([head], inner, true);
        visit(head, inner);
        visit(node.test, inner);
        visit(node.update, inner);
        visit(node.right, inner);
        return visit(node.body, inner);
      }
      case "CatchClause": {
        const inner = open(scope, "block");
        for (const n of boundNames(node.param)) {
          inner.names.add(n);
          inBlocks.add(n);
        }
        visitPattern(node.param, inner);
        return visit(node.body, inner);
      }
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        const inner = open(scope, "function");
        if (node.type === "FunctionExpression" && node.id) inner.names.add(node.id.name);
        for (const p of node.params) for (const n of boundNames(p)) inner.names.add(n);
        hoistVars(node.body, inner);
        for (const p of node.params) visitPattern(p, inner);
        if (node.body.type === "BlockStatement") {
          hoist(node.body.body, inner, false);
          return visit(node.body.body, inner);
        }
        return visit(node.body, inner);
      }
      case "VariableDeclaration":
        for (const d of node.declarations) {
          visitPattern(d.id, scope);
          visit(d.init, scope);
        }
        return;
      case "ClassDeclaration":
      case "ClassExpression":
        visit(node.superClass, scope);
        return visit(node.body, scope);
      case "MethodDefinition":
      case "PropertyDefinition":
      case "Property":
        if (node.computed) visit(node.key, scope);
        return visit(node.value, scope);
      case "MemberExpression":
        visit(node.object, scope);
        if (node.computed) visit(node.property, scope);
        return;
      case "ImportDeclaration":
      case "ExportAllDeclaration":
      case "BreakStatement":
      case "ContinueStatement":
      case "MetaProperty":
        return;
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
        return visit(node.declaration, scope);
      case "LabeledStatement":
        return visit(node.body, scope);
      default:
        for (const k of Object.keys(node)) if (k !== "type") visit(node[k], scope);
    }
  };
  const module = open(null, "module");
  hoist(program.body, module, false);
  hoistVars(program.body, module);
  visit(program.body, module);
  return out;
}

// A binding declared inside a block and read outside it is a `ReferenceError`
// on the one run that gets that far. `scripts/ab.mjs` carried one from
// 2026-08-29: `label` and `result` moved inside the `try` around the trials,
// the two lines that write the result document stayed at module scope, and
// every trial was paid for before the throw. Nothing imports the file, so no
// case could reach it, and the argument gate above made it look healthy to the
// one case that spawns it.
test("a name declared inside a block is read only where that block is in reach", () => {
  const outside = [];
  for (const rel of sourceFiles()) {
    for (const { name, line } of readOutsideTheirBlock(readFileSync(join(ROOT, rel), "utf8"), rel)) {
      outside.push(`${rel}:${line}: ${name}`);
    }
  }

  assert.deepEqual(outside, []);
});

// The rule above sees whatever this resolves, so it is driven directly.
test("the block reader tells a read inside a block from one outside it", () => {
  const reads = (src) => readOutsideTheirBlock(src, "t.mjs").map((r) => `${r.line}:${r.name}`);
  assert.deepEqual(reads("try { const a = 1; } catch {}\nconsole.log(a);"), ["2:a"]);
  assert.deepEqual(reads("try { const a = 1; console.log(a); } catch {}"), []);
  assert.deepEqual(reads("let a;\ntry { a = 1; } catch {}\nconsole.log(a);"), []);
  assert.deepEqual(reads("{ let a = 1; }\nconst f = () => a;"), ["2:a"]);
  assert.deepEqual(reads("{ let a = 1; }\nconst f = (a) => a;"), []);
  assert.deepEqual(reads("{ var a = 1; }\nconsole.log(a);"), []);
  assert.deepEqual(reads("for (const i of []) {}\nconsole.log(i);"), ["2:i"]);
  assert.deepEqual(reads("try {} catch (e) {}\nconsole.log(e);"), ["2:e"]);
  assert.deepEqual(reads("{ const a = 1; }\nconst o = { a: 1 };\nconsole.log(o.a);"), []);
  assert.deepEqual(reads("switch (1) { case 1: { const a = 1; } }\nconsole.log(a);"), ["2:a"]);
  assert.deepEqual(reads("{ const a = 1; }\nfunction f() { return a; }"), ["2:a"]);
});

/**
 * Spellings that are not under a checkout of this repository, each with why.
 *
 * A marketplace install puts the plugin's own directory at the root, so the
 * binary sits at `bin/anatomiya.mjs` with nothing in front of it. A step that
 * models one has to spell it that way, or it is running this checkout instead,
 * which is the thing that step exists to stop trusting. Named one at a time, so
 * a spelling nobody has ruled on is still refused.
 */
const NOT_UNDER_A_CHECKOUT = new Map([
  ["$install/bin/anatomiya.mjs", "a marketplace install, where the plugin's own directory is the root"],
]);

// A workflow step and a package script cannot import a constant, so the rule
// for them is agreement rather than absence: every one of these spelled the
// binary by hand, and the move that put it under `plugins/` had to find all
// eight without anything to list them.
test("every spelling of the binary outside the modules that can import it agrees with the one that holds it", () => {
  const rel = relative(ROOT, BINARY).split(/[\\/]/).join("/");
  const wrong = [];
  const files = ["package.json", ...readdirSync(join(ROOT, ".github", "workflows")).map((f) => join(".github", "workflows", f))];
  let spelled = 0;
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const [, named] of text.matchAll(/([\w$./-]*bin\/anatomiya\.mjs)/g)) {
      spelled++;
      // A workflow spells it under the checkout it is running, so what has to
      // agree is the tail rather than the whole path.
      if (!named.endsWith(rel) && !NOT_UNDER_A_CHECKOUT.has(named)) wrong.push(`${file}: ${named}`);
    }
  }

  assert.ok(spelled >= 8, `found only ${spelled} spellings to check`);
  assert.deepEqual(wrong, []);
});

// The rules above see whatever this leaves them, so it is driven directly: the
// stripper it replaced passed every one of these by deleting too much, and a
// rule that reads an empty file states that nothing is wrong with it.
test("the scanner tells a regular expression from a comment, and a template's code from its text", () => {
  // Stated as what survives and what does not, with every offset still where
  // it was: a hand-counted run of blanks is a number to keep in step and says
  // nothing about the rule that reads the answer.
  const holds = (src, kept, gone, opts) => {
    const out = scan(src, opts);
    assert.equal(out.length, src.length, `offsets moved in ${src}`);
    for (const one of kept) assert.ok(out.includes(one), `${one} should have survived ${src}`);
    for (const one of gone) assert.ok(!out.includes(one), `${one} should have gone from ${src}`);
  };

  const P = '"plugins/x"';
  holds('const EMPTY = /\\//; const P = "plugins/x";', [P], ["/\\//"]);
  holds('const R = /(["\'])a\\1/; const P = "plugins/x";', [P], ["a\\1"]);
  holds("const A = `a/*b`; const P = \"plugins/x\"; const C = `c*/d`;", [P, "`a/*b`", "`c*/d`"], []);
  holds('const U = "//example.com"; const P = "plugins/x";', [P, '"//example.com"'], []);
  holds('const P = "plugins/x"; // plugins/y\nconst Q = 2;', [P, "const Q = 2;"], ["plugins/y"]);
  holds('const P = "plugins/x"; /* plugins/y */ const Q = 2;', [P, "const Q = 2;"], ["plugins/y"]);
  holds('const A = 6 / 2 / 3; const P = "plugins/x";', [P, "6 / 2 / 3"], []);
  // The escape is the point: read as the end of the string, `b'; const P = 1;`
  // becomes text and the tail of the line disappears with it.
  holds("const s = 'a\\\\'b'; const P = \"plugins/x\";", ['"plugins/x"'], [], { strings: false });

  // Asked for with the string bodies gone, the quotes stay where they were and
  // a template's `${...}` is still code.
  holds('const P = "installed";', ['const P = "', '";'], ["installed"], { strings: true });
  holds("const P = `a${installed}b`;", ["${installed}"], ["`a$"], { strings: true });
});

// The release that moved anatomiya to its next version failed here first: eight
// cases spawned the real command with the previous version spelled into them,
// seven refused at the argument gate and passed anyway, and the eighth read the
// manifests and went red. A fixture that happens to carry the real version is
// the same trap from the other side, since it passes for a reason that is about
// to change.
test("no test spells this repository's own version, which moves", () => {
  const version = JSON.parse(readFileSync(join(ANATOMIYA, "package.json"), "utf8")).version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const offenders = [];
  for (const rel of sourceFiles()) {
    if (rel.split(/[\\/]/)[0] !== "test") continue;
    if (scan(readFileSync(join(ROOT, rel), "utf8")).includes(version)) offenders.push(rel);
  }

  assert.deepEqual(offenders, [], `read it from the manifest instead: ${version}`);
});
