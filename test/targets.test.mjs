import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TARGETS,
  TARGET_IDS,
  parseTargets,
  overviewName,
  areaName,
  spelledGlobs,
  frontmatter,
} from "../plugins/anatomiya/lib/targets.mjs";
import { globEntry, globText } from "../plugins/anatomiya/lib/areas.mjs";
import { encodePath } from "../plugins/anatomiya/lib/encode.mjs";
import { renderArea, renderOverview } from "../plugins/anatomiya/lib/render.mjs";
import { GENERATOR, OVERVIEW_FILE, RULES_DIR, areaFilename } from "../plugins/anatomiya/lib/rules.mjs";

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
  assert.deepEqual(TARGETS, {
    claude: { id: "claude", dir: ".claude/rules", ext: ".md", always: true, reader: "Claude Code" },
    cursor: { id: "cursor", dir: ".cursor/rules", ext: ".mdc", always: false, reader: "Cursor" },
    copilot: { id: "copilot", dir: ".github/instructions", ext: ".instructions.md", always: false, reader: "GitHub Copilot" },
  });
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

test("a bare filename pattern passes through", () => {
  const bare = [{ negated: false, dir: "", tail: "Rakefile" }, { negated: false, dir: "lib", tail: "**/Gemfile" }];
  assert.deepEqual(spelledGlobs(cursor, bare, plain), { ...NONE, patterns: ["Rakefile", "lib/**/Gemfile"] });
  assert.deepEqual(spelledGlobs(copilot, bare, plain), { ...NONE, patterns: ["Rakefile", "lib/**/Gemfile"], widened: ["Rakefile", "lib/**/Gemfile"] });
});

test("a single extension has no brace to expand", () => {
  assert.deepEqual(spelledGlobs(cursor, [{ negated: false, dir: "app/models", tail: "*.py" }], plain).patterns, ["app/models/*.py"]);
});

test("a positive pattern a target cannot write is unspellable, and never a dropped negation", () => {
  for (const dir of ["a,b", "a{b", "a}b", 'a"b', "a\\b", "a\nb", "a\rb"]) {
    for (const target of [cursor, copilot]) {
      const out = spelledGlobs(target, [
        { negated: false, dir, tail: "**/*.{js,ts}" },
        { negated: false, dir: "ok", tail: `**/${dir}/**/*.js` },
        { negated: false, dir: "ok", tail: "*.js" },
        { negated: true, dir, tail: "*.js" },
      ], plain);
      const at = JSON.stringify(dir);
      assert.deepEqual(out.patterns, ["ok/*.js"], at);
      assert.deepEqual(out.unspellable, [`${dir}/**/*.{js,ts}`, `ok/**/${dir}/**/*.js`], at);
      assert.deepEqual(out.dropped, [`${dir}/*.js`], at);
    }
  }
});

test("cursor's unquoted line also cannot carry a comment mark, a mapping colon or a closing colon", () => {
  const globs = [
    { negated: false, dir: "a #b", tail: "*.js" },
    { negated: false, dir: "a: b", tail: "*.js" },
    { negated: false, dir: "lib", tail: "x:" },
    { negated: false, dir: "a:b", tail: "*.js" },
    { negated: false, dir: "a#b", tail: "*.js" },
  ];
  const all = ["a #b/*.js", "a: b/*.js", "lib/x:", "a:b/*.js", "a#b/*.js"];
  assert.deepEqual(spelledGlobs(cursor, globs, plain), { ...NONE, patterns: all.slice(3), unspellable: all.slice(0, 3) });
  assert.deepEqual(spelledGlobs(copilot, globs, plain), { ...NONE, patterns: all, widened: all });
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

test("an area with no pattern: claude refuses it, cursor attaches nothing, copilot cannot say so", () => {
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
