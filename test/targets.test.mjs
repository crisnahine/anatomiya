import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  GENERATOR,
  PREFIX,
  TARGETS,
  TARGET_IDS,
  assertPerTarget,
  assertTargets,
  isClaude,
  parseTargets,
  overviewName,
  areaName,
  spelledGlobs,
  frontmatter,
} from "../plugins/anatomiya/lib/targets.mjs";
import { globEntry, globText } from "../plugins/anatomiya/lib/areas.mjs";
import { encodePath } from "../plugins/anatomiya/lib/encode.mjs";
import { renderArea, renderOverview } from "../plugins/anatomiya/lib/render.mjs";
import * as RULES from "../plugins/anatomiya/lib/rules.mjs";
import { ANATOMIYA } from "../scripts/plugins.mjs";

const { OVERVIEW_FILE, RULES_DIR, areaFilename } = RULES;

const { claude, cursor, copilot } = TARGETS;
const EXTS = ["cjs", "cts", "js", "mjs", "mts", "ts"];
const TEST_GLOBS = [
  { negated: false, dir: "test", tail: "**/*.{cjs,cts,js,mjs,mts,ts}" },
  { negated: true, dir: "test", tail: "**/fixtures/**/*.{cjs,cts,js,mjs,mts,ts}" },
];
const SIX = EXTS.map((e) => `test/**/*.${e}`);
const NONE = { patterns: [], widened: [], dropped: [], unspellable: [] };
const plain = (g) => globText(g);
const encoded = (g) => globText(g, (dir) => encodePath(dir).slice(1, -1));

// The fence the renderer writes, read back off its own output.
const fenceOf = (text) => {
  const lines = text.split("\n");
  return lines.slice(0, lines.indexOf("---", 1) + 1);
};

test("the three targets, their directories and their extensions", () => {
  const wrote =
    "Written by anatomiya, a scanner run on this repository; where this and the code disagree, the code is right and this map is stale.";
  assert.deepEqual(TARGETS, {
    claude: {
      id: "claude", dir: ".claude/rules", ext: ".md", reader: "Claude Code", wrote: null, widens: null,
      reads: "Read a file before editing it: these notes load when you read, not when you grep.",
      listed: "loaded when you read one of its files",
    },
    cursor: {
      id: "cursor", dir: ".cursor/rules", ext: ".mdc", reader: "Cursor", wrote, widens: null,
      reads: "Each area has its own file under .cursor/rules whose `globs:` names that area's files: before editing a file, read the one that names it.",
      listed: "whose `globs:` names its files",
    },
    copilot: {
      id: "copilot", dir: ".github/instructions", ext: ".instructions.md", reader: "GitHub Copilot", wrote,
      widens: "VS Code also matches this file's patterns under any parent directory, so they can match a file outside the area.",
      reads:
        "Each area has its own file under .github/instructions whose `applyTo:` names that area's files: before editing a file, read the one that names it.",
      listed: "whose `applyTo:` names its files",
    },
  });
  // A sentence that names a directory names the target's own.
  for (const target of [cursor, copilot]) assert.ok(target.reads.includes(` under ${target.dir} `), target.id);
  // Delivery is measured for Claude Code alone, so no other target's sentence says when a file arrives.
  const DELIVERY = /\b(attach|applied|load|arrive)/i;
  for (const target of [cursor, copilot]) assert.doesNotMatch(`${target.reads} ${target.listed} ${target.widens ?? ""}`, DELIVERY, target.id);
  // The closing lines of an area file are a target's body too: one that drops a negation, widens a pattern and cannot spell another.
  const loose = {
    id: "0123abcd", path: "lib", fileCount: 9, dimensions: [],
    globs: [{ negated: false, dir: "lib", tail: "**/*.rb" }, { negated: true, dir: "lib/fixtures", tail: "**/*.rb" }, { negated: false, dir: 'lib/q"t', tail: "*.rb" }],
  };
  for (const target of [cursor, copilot]) {
    const body = renderArea(loose, target).split("\n---\n")[1];
    assert.match(body, /patterns also match .*\n(?:.*\n)*.*patterns do not match /, target.id);
    assert.doesNotMatch(body, DELIVERY, target.id);
  }
  assert.ok(renderArea(loose, copilot).includes(copilot.widens));
  assert.deepEqual(TARGET_IDS, ["claude", "cursor", "copilot"]);
  assert.ok(Object.isFrozen(TARGETS) && Object.isFrozen(TARGET_IDS) && TARGET_IDS.every((id) => Object.isFrozen(TARGETS[id])));
  assert.equal(claude.dir, RULES_DIR);
});

test("a file keeps the stem it has today and takes its target's extension", () => {
  assert.equal(overviewName(claude), OVERVIEW_FILE);
  assert.equal(areaName(claude, "9f86d081"), areaFilename({ id: "9f86d081" }));
  assert.equal(overviewName(cursor), "anatomiya-overview.mdc");
  assert.equal(areaName(cursor, "9f86d081"), "anatomiya-area-9f86d081.mdc");
  assert.equal(overviewName(copilot), "anatomiya-overview.instructions.md");
  assert.equal(areaName(copilot, "9f86d081"), "anatomiya-area-9f86d081.instructions.md");
});

test("parseTargets always includes claude and answers in the fixed order", () => {
  assert.deepEqual(parseTargets("cursor"), ["claude", "cursor"]);
  assert.deepEqual(parseTargets(" Copilot , cursor "), ["claude", "cursor", "copilot"]);
  assert.deepEqual(parseTargets("claude"), ["claude"]);
  assert.deepEqual(parseTargets("cursor,cursor"), ["claude", "cursor"]);
});

test("Claude Code's target is the one every scan writes, and it is asked for one way", () => {
  assert.deepEqual(Object.values(TARGETS).map(isClaude), [true, false, false]);
  assert.equal(isClaude({ ...TARGETS.claude }), true, "by its id, so a copy answers the same");
  const asked = /\.always\b|TARGETS\.claude\.id|[=!]== "claude"|[=!]== TARGETS\.claude\b/;
  for (const module of ["check.mjs", "commands.mjs", "corpus.mjs", "refresh-run.mjs", "render.mjs", "rules.mjs", "write.mjs"]) {
    assert.doesNotMatch(readFileSync(join(ANATOMIYA, "lib", module), "utf8"), asked, module);
  }
});

test("a list of target names is refused at the first that is no target", () => {
  assert.doesNotThrow(() => assertTargets(["claude", "copilot"]));
  assert.doesNotThrow(() => assertTargets([]));
  assert.throws(() => assertTargets(["cursor", "windsurf", "zed"]), { message: "unknown target: windsurf; the targets are claude, cursor, copilot" });
});

test("the prefix and the generator key are spelled here, and the rules module hands on the same two", () => {
  assert.equal(PREFIX, "anatomiya-");
  assert.equal(GENERATOR, "anatomiya");
  assert.equal(RULES.PREFIX, PREFIX);
  assert.equal(RULES.GENERATOR, GENERATOR);
  assert.doesNotMatch(readFileSync(join(ANATOMIYA, "lib", "rules.mjs"), "utf8"), /["'`^]anatomiya/, "spelled again");
});

test("parseTargets refuses a name that is not a target, and an empty list", () => {
  const unknown = (name) => ({ message: `unknown target: ${name}; the targets are claude, cursor, copilot` });
  assert.throws(() => parseTargets("windsurf"), unknown("windsurf"));
  assert.throws(() => parseTargets("cursor,windsurf"), unknown("windsurf"));
  // A name every object carries is still not a target.
  assert.throws(() => parseTargets("constructor"), unknown("constructor"));
  for (const empty of ["", ",", " , "]) assert.throws(() => parseTargets(empty), { message: "--targets needs at least one name" });
});

test("the descriptors load none of our modules, so a hook verb can read them", () => {
  const src = readFileSync(new URL("../plugins/anatomiya/lib/targets.mjs", import.meta.url), "utf8");
  assert.deepEqual(src.match(/^\s*(?:import|export)\b[^;]*\bfrom\b.*$/gm) ?? [], []);
  assert.ok(!/\bimport\s*\(/.test(src));
});

test("claude takes every glob as the caller spells it, negations included", () => {
  assert.deepEqual(spelledGlobs(claude, TEST_GLOBS, plain), {
    ...NONE,
    patterns: ["test/**/*.{cjs,cts,js,mjs,mts,ts}", "!test/**/fixtures/**/*.{cjs,cts,js,mjs,mts,ts}"],
  });
  // Not even a name the other two cannot write is held back from Claude Code.
  assert.deepEqual(spelledGlobs(claude, [{ negated: false, dir: "a,b", tail: "*.js" }], plain), { ...NONE, patterns: ["a,b/*.js"] });
});

test("cursor gets one pattern per extension and loses the negation", () => {
  assert.deepEqual(spelledGlobs(cursor, TEST_GLOBS, plain), {
    ...NONE,
    patterns: SIX,
    dropped: ["test/**/fixtures/**/*.{cjs,cts,js,mjs,mts,ts}"],
  });
});

test("copilot gets the same patterns, each one widened because none starts with **/", () => {
  assert.deepEqual(spelledGlobs(copilot, TEST_GLOBS, plain), {
    ...NONE,
    patterns: SIX,
    widened: SIX,
    dropped: ["test/**/fixtures/**/*.{cjs,cts,js,mjs,mts,ts}"],
  });
});

test("a pattern that already starts with **/ is not widened", () => {
  const root = [globEntry(".", ["ruby"]), { negated: false, dir: "", tail: "*.py" }];
  const out = spelledGlobs(copilot, root, plain);
  assert.ok(out.patterns.includes("**/*.rb") && out.patterns.includes("*.py"), out.patterns.join(" "));
  assert.deepEqual(out.widened, ["*.py"]);
});

test("a pattern anchored at the repository root is spelled as each reader reads one", () => {
  // Run on the matchers cut out of Cursor 3.20.21 and VS Code 1.140.0: `/*.go`
  // matched no file of a repository in either, since both read a leading slash
  // as the file system's root. Cursor's matched `*.go` at the root alone.
  // VS Code's matched it at every depth, which is what `widened` reports, and
  // no pattern short of the repository's own absolute path matched only the root.
  const root = [globEntry(".", ["go"], { recursive: false }), { negated: true, dir: "", tail: "zz_gen.go" }];
  assert.deepEqual(spelledGlobs(claude, root, plain), { ...NONE, patterns: ["/*.go", "!/zz_gen.go"] });
  assert.deepEqual(spelledGlobs(cursor, root, plain), { ...NONE, patterns: ["*.go"], dropped: ["zz_gen.go"] });
  assert.deepEqual(spelledGlobs(copilot, root, plain), { ...NONE, patterns: ["*.go"], widened: ["*.go"], dropped: ["zz_gen.go"] });
  assert.deepEqual(spelledGlobs(cursor, root, encoded).patterns, ["*.go"]);
  // A brace of two extensions is one pattern per extension, each without the slash.
  const two = [{ negated: false, dir: "", tail: "*.{go,rb}" }];
  assert.deepEqual(spelledGlobs(cursor, two, plain).patterns, ["*.go", "*.rb"]);
  assert.deepEqual(spelledGlobs(claude, two, plain).patterns, ["/*.{go,rb}"]);
});

test("a bare filename pattern passes through", () => {
  const bare = [{ negated: false, dir: "", tail: "Rakefile" }, { negated: false, dir: "lib", tail: "**/Gemfile" }];
  assert.deepEqual(spelledGlobs(cursor, bare, plain), { ...NONE, patterns: ["Rakefile", "lib/**/Gemfile"] });
  assert.deepEqual(spelledGlobs(copilot, bare, plain), { ...NONE, patterns: ["Rakefile", "lib/**/Gemfile"], widened: ["Rakefile", "lib/**/Gemfile"] });
});

test("a single extension has no brace to expand", () => {
  assert.deepEqual(spelledGlobs(cursor, [{ negated: false, dir: "app/models", tail: "*.py" }], plain).patterns, ["app/models/*.py"]);
});

const refused = (target, dir) =>
  spelledGlobs(target, [
    { negated: false, dir, tail: "**/*.{js,ts}" },
    { negated: false, dir: "ok", tail: `**/${dir}/**/*.js` },
    { negated: false, dir: "ok", tail: "*.js" },
    { negated: true, dir: "ok", tail: "x/*.js" },
  ], plain);

test("a positive pattern a target cannot write is unspellable, and never a dropped negation", () => {
  for (const dir of ["a,b", "a{b", "a}b", "a\\b", "a\nb", "a\rb"]) {
    for (const target of [cursor, copilot]) {
      const out = refused(target, dir);
      const at = JSON.stringify(dir);
      assert.deepEqual(out.patterns, ["ok/*.js"], at);
      assert.deepEqual(out.unspellable, [`${dir}/**/*.{js,ts}`, `ok/**/${dir}/**/*.js`], at);
      assert.deepEqual(out.dropped, ["ok/x/*.js"], at);
    }
  }
});

test("each target refuses what its own reader would change: a fence for cursor, a quote for copilot", () => {
  assert.deepEqual(refused(cursor, "a---b").unspellable, ["a---b/**/*.{js,ts}", "ok/**/a---b/**/*.js"]);
  assert.deepEqual(refused(copilot, "a---b").unspellable, []);
  assert.deepEqual(refused(copilot, 'a"b').unspellable, ['a"b/**/*.{js,ts}', 'ok/**/a"b/**/*.js']);
  assert.deepEqual(refused(cursor, 'a"b').unspellable, []);
  assert.deepEqual(refused(cursor, "a--b").unspellable, []);
});

test("cursor trims each pattern and unwraps a quoted line, so neither edge may hold a space nor the start a quote", () => {
  const at = (dir, tail = "*.js") => spelledGlobs(cursor, [{ negated: false, dir, tail }], plain);
  for (const [dir, tail] of [[" a"], ["\ta"], ['"a'], ["'a"], ["lib", "x "]]) {
    const p = plain({ dir, tail: tail ?? "*.js" });
    assert.deepEqual(at(dir, tail), { ...NONE, unspellable: [p] }, JSON.stringify(p));
  }
  // At the root the name is the whole pattern Cursor is handed, so its edges are the pattern's.
  assert.deepEqual(at("", "x\u00a0"), { ...NONE, unspellable: ["x\u00a0"] });
  assert.deepEqual(at("", " x"), { ...NONE, unspellable: [" x"] });
  for (const [dir, tail] of [["a b"], ['a"'], ["a'b"], ["lib", 'x"']]) {
    const p = plain({ dir, tail: tail ?? "*.js" });
    assert.deepEqual(at(dir, tail), { ...NONE, patterns: [p] }, JSON.stringify(p));
  }
});

test("a cursor pattern that opens on a bang is not written, since cursor would read it as every other file", () => {
  const bang = [{ negated: false, dir: "!bang", tail: "*.rb" }, { negated: false, dir: "lib", tail: "*.rb" }];
  assert.deepEqual(spelledGlobs(cursor, bang, plain), { ...NONE, patterns: ["lib/*.rb"], unspellable: ["!bang/*.rb"] });
  assert.deepEqual(spelledGlobs(copilot, bang, plain).unspellable, []);
  assert.deepEqual(spelledGlobs(cursor, [{ negated: false, dir: "a!b", tail: "*.rb" }], plain).patterns, ["a!b/*.rb"]);
});

test("a cursor pattern that opens on a comment mark is not written, since cursor's matcher would match nothing", () => {
  const hash = [{ negated: false, dir: "#lead", tail: "*.rb" }, { negated: false, dir: "lib", tail: "*.rb" }];
  assert.deepEqual(spelledGlobs(cursor, hash, plain), { ...NONE, patterns: ["lib/*.rb"], unspellable: ["#lead/*.rb"] });
  assert.deepEqual(spelledGlobs(copilot, hash, plain).unspellable, []);
});

test("a lone cursor pattern that reads as a boolean is not written", () => {
  // Cursor's reader turns a `globs` value of exactly `true` or `false` into a boolean.
  for (const word of ["true", "false"]) {
    const lone = [{ negated: false, dir: "", tail: word }];
    assert.deepEqual(spelledGlobs(cursor, lone, plain), { ...NONE, unspellable: [word] });
    assert.deepEqual(spelledGlobs(copilot, lone, plain).patterns, [word]);
    const beside = [...lone, { negated: false, dir: "lib", tail: "*.js" }];
    assert.deepEqual(spelledGlobs(cursor, beside, plain), { ...NONE, patterns: [word, "lib/*.js"] });
  }
  assert.deepEqual(spelledGlobs(cursor, [{ negated: false, dir: "", tail: "True" }], plain).patterns, ["True"]);
});

test("cursor takes a comment mark, a colon and a space, and a closing colon as part of the pattern", () => {
  const globs = [
    { negated: false, dir: "a #b", tail: "*.js" },
    { negated: false, dir: "a: b", tail: "*.js" },
    { negated: false, dir: "lib", tail: "x:" },
    { negated: false, dir: "a:b", tail: "*.js" },
    { negated: false, dir: "a#b", tail: "*.js" },
  ];
  const all = ["a #b/*.js", "a: b/*.js", "lib/x:", "a:b/*.js", "a#b/*.js"];
  assert.deepEqual(spelledGlobs(cursor, globs, plain), { ...NONE, patterns: all });
  assert.deepEqual(spelledGlobs(copilot, globs, plain), { ...NONE, patterns: all, widened: all });
});

test("a negation is dropped only where a pattern that was written reaches it", () => {
  const not = (dir) => ({ negated: true, dir, tail: "x/*.js" });
  const odd = { negated: false, dir: "a,b", tail: "**/*.js" };
  for (const target of [cursor, copilot]) {
    // The file matches nothing under the pattern at all, so it cannot match too much there.
    assert.deepEqual(spelledGlobs(target, [odd, not("a,b")], plain), { ...NONE, unspellable: ["a,b/**/*.js"] }, target.id);
    const mixed = spelledGlobs(target, [odd, not("a,b"), { negated: false, dir: "ok", tail: "**/*.js" }, not("ok/deep"), not("okay")], plain);
    assert.deepEqual(mixed.dropped, ["ok/deep/x/*.js"], target.id);
    const root = spelledGlobs(target, [odd, { negated: false, dir: "", tail: "**/*.rb" }, not("a,b")], plain);
    assert.deepEqual(root.dropped, ["a,b/x/*.js"], target.id);
    // A pattern that does not recurse matches nothing above or below its own directory.
    const above = spelledGlobs(target, [{ negated: false, dir: "ok/deep", tail: "*.js" }, { negated: true, dir: "ok", tail: "**/gen/*.js" }], plain);
    assert.deepEqual(above.dropped, [], target.id);
    const flat = [{ negated: false, dir: "lib", tail: "*.rb" }, { negated: true, dir: "lib/x", tail: "*.rb" }, { negated: true, dir: "lib", tail: "gen.rb" }];
    assert.deepEqual(spelledGlobs(target, flat, plain).dropped, ["lib/gen.rb"], target.id);
    const deep = [{ negated: false, dir: "lib", tail: "**/*.rb" }, { negated: true, dir: "lib/x", tail: "*.rb" }];
    assert.deepEqual(spelledGlobs(target, deep, plain).dropped, ["lib/x/*.rb"], target.id);
  }
});

// Mirrors the frontmatter reader of Cursor 3.20.21; the research note on its .mdc parser holds the evidence.
const cursorReads = (line) => {
  const value = line.slice(line.indexOf(":") + 1).trim();
  const parts = [];
  for (let i = 0, from = 0, depth = 0; i <= value.length; i++) {
    if (value[i] === "{") depth++;
    else if (value[i] === "}" && depth > 0) depth--;
    else if (i === value.length || (value[i] === "," && depth === 0)) parts.push(value.slice(from, (from = i + 1) - 1).trim());
  }
  return parts.filter(Boolean);
};

test("the globs line is spelled so that cursor's reader gets back the patterns it was written from", () => {
  for (const [line, got] of [
    ["globs: **/*.rb", ["**/*.rb"]],
    ["globs: *.py,src/**/*.ts", ["*.py", "src/**/*.ts"]],
    ["globs: test/**/*.cjs, test/**/*.ts , src/*.rb", ["test/**/*.cjs", "test/**/*.ts", "src/*.rb"]],
    ["globs: src/**/*.{ts,tsx}", ["src/**/*.{ts,tsx}"]],
    ["globs: a b/**/*.ts", ["a b/**/*.ts"]],
    ["globs: a/# b/*.ts", ["a/# b/*.ts"]],
    ["globs: a: b/*.ts", ["a: b/*.ts"]],
    ["globs: a: b/# c/*.ts,x:", ["a: b/# c/*.ts", "x:"]],
  ]) assert.deepEqual(cursorReads(line), got, line);

  const dirs = ["test", "a #b", "a: b", "a b", 'q"r', "a:b"];
  const globs = [...dirs.map((dir) => ({ negated: false, dir, tail: "**/*.{js,ts}" })), { negated: false, dir: "lib", tail: "x:" }];
  const { patterns, unspellable } = spelledGlobs(cursor, globs, plain);
  assert.deepEqual(unspellable, []);
  assert.equal(patterns.length, 13);
  assert.deepEqual(cursorReads(frontmatter(cursor, { kind: "area", patterns })[2]), patterns);
});

test("the check reads the string that is emitted, so a comma the encoder folds in is caught", () => {
  const fullwidth = [{ negated: false, dir: "a，b", tail: "*.{js,ts}" }, { negated: false, dir: "ok", tail: "*.js" }];
  assert.ok(encoded(fullwidth[0]).startsWith("a,b/"), encoded(fullwidth[0]));
  for (const target of [cursor, copilot]) {
    const out = spelledGlobs(target, fullwidth, encoded);
    assert.deepEqual(out.patterns, ["ok/*.js"]);
    assert.deepEqual(out.unspellable, ["a,b/*.{js,ts}"]);
  }
  // Read before the encoder, the same directory is one neither target objects to.
  assert.deepEqual(spelledGlobs(cursor, fullwidth, plain).unspellable, []);
});

test("every list is in the caller's own spelling", () => {
  const text = (g) => `${g.negated ? "!" : ""}<${g.dir}>/${g.tail}`;
  assert.equal(spelledGlobs(claude, TEST_GLOBS, text).patterns[1], "!<test>/**/fixtures/**/*.{cjs,cts,js,mjs,mts,ts}");
  const out = spelledGlobs(copilot, TEST_GLOBS, text);
  assert.equal(out.patterns[0], "<test>/**/*.cjs");
  assert.deepEqual(out.dropped, ["<test>/**/fixtures/**/*.{cjs,cts,js,mjs,mts,ts}"]);
  assert.throws(() => spelledGlobs(cursor, TEST_GLOBS), TypeError);
});

test("frontmatter: the exact lines for all six target and kind pairs", () => {
  const patterns = ["test/**/*.js", "test/**/*.ts"];
  const lines = (target, kind) => frontmatter(target, { kind, patterns });
  assert.deepEqual(lines(claude, "overview"), ["---", "generator: anatomiya", "---"]);
  assert.deepEqual(lines(claude, "area"), ["---", "generator: anatomiya", "paths:", '  - "test/**/*.js"', '  - "test/**/*.ts"', "---"]);
  assert.deepEqual(lines(cursor, "overview"), ["---", "generator: anatomiya", "alwaysApply: true", "---"]);
  assert.deepEqual(lines(cursor, "area"), ["---", "generator: anatomiya", "globs: test/**/*.js,test/**/*.ts", "alwaysApply: false", "---"]);
  assert.deepEqual(lines(copilot, "overview"), ["---", "generator: anatomiya", 'applyTo: "**"', "---"]);
  assert.deepEqual(lines(copilot, "area"), ["---", "generator: anatomiya", 'applyTo: "test/**/*.js,test/**/*.ts"', "---"]);
  assert.equal(lines(cursor, "overview")[1], `generator: ${GENERATOR}`);
});

test("an area with no pattern: claude refuses it, cursor matches nothing, copilot cannot say so", () => {
  for (const given of [{ kind: "area", patterns: [] }, { kind: "area" }]) {
    assert.throws(() => frontmatter(claude, given), { message: "an area file with no pattern would load on every turn" });
    assert.deepEqual(frontmatter(cursor, given), ["---", "generator: anatomiya", "alwaysApply: false", "---"]);
    assert.throws(() => frontmatter(copilot, given), { message: "no pattern of this area can be written for GitHub Copilot" });
  }
});

test("the claude frontmatter is byte-equal to what the renderer writes today", () => {
  const cases = [
    TEST_GLOBS,
    [globEntry("scripts", ["js", "ts"], { recursive: false })],
    [{ negated: false, dir: "", tail: "**/Rakefile" }, globEntry(".", ["ruby"])],
  ];
  for (const globs of cases) {
    const rendered = renderArea({ id: "a1", path: "test", fileCount: 3, langs: ["js"], dimensions: [], globs });
    const { patterns } = spelledGlobs(claude, globs, encoded);
    assert.deepEqual(frontmatter(claude, { kind: "area", patterns }), fenceOf(rendered));
  }
  const result = { root: "/repo", corpus: { files: 0, truncated: false, dropped: {} }, parse: { parsed: 0, crashed: 0, skipped: 0 }, suppressAll: true, areas: [] };
  const overview = renderOverview(result, { uncovered: 0 });
  assert.deepEqual(frontmatter(claude, { kind: "overview" }), fenceOf(overview));
});

test("a table keyed by target is refused where it lacks a target or holds a key that is none", () => {
  const whole = Object.fromEntries(TARGET_IDS.map((id) => [id, null]));
  assert.doesNotThrow(() => assertPerTarget("T", whole));
  const { copilot: _, ...short } = whole;
  assert.throws(() => assertPerTarget("T", short), /^Error: T has no entry for copilot$/);
  assert.throws(() => assertPerTarget("T", { ...whole, windsurf: null }), /^Error: T holds windsurf, which is no target$/);
  // An inherited name is no entry.
  assert.throws(() => assertPerTarget("T", Object.create(whole)), /T has no entry for claude/);
});
