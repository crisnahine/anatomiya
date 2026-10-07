import { test } from "node:test";
import assert from "node:assert/strict";

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GENERATOR,
  HEAD_BYTES,
  OVERVIEW_FILE,
  PREFIX,
  RULES_DIR,
  auditRules,
  isGeneratedName,
  isOwned,
  resolveRulesDir,
  resolveTargetDir,
  targetState,
} from "../plugins/anatomiya/lib/rules.mjs";
import { TARGETS, areaName, overviewName } from "../plugins/anatomiya/lib/targets.mjs";
import { doublingRatio, LINEAR } from "./growth.mjs";
import { needsFoldingFilesystem, needsPosixPermissions, needsPosixSpecialFiles, needsSymlinks, needsUnreadableDirs } from "./platform.mjs";

const { claude, cursor, copilot } = TARGETS;
const OWNED = `---\ngenerator: ${GENERATOR}\nalwaysApply: true\n---\n# Repository map\n`;
const HAND = "---\nalwaysApply: true\n---\n# Team notes\n";

/** A repository root, resolved, and removed when the test ends. */
function workspace(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "anatomiya-rules-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function put(root, rel, text) {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
}

/** A frontmatter block opening with our key repeated `lines` times, closed or not. */
const repeating = (lines, close = "") => "---\n" + `generator: ${GENERATOR}\n`.repeat(lines) + close;

// Timed at the largest size whose double, both fences included, still fits the
// head a read takes. At 4,000 lines one call is about 260 us and noise read past
// LINEAR; past the head both sides do the same work and a quadratic walk reads
// under it.
const TIMED = Math.floor((HEAD_BYTES - 2 * "---\n".length) / `generator: ${GENERATOR}\n`.length / 2);

test("an unclosed frontmatter repeating our key is answered in linear time", () => {
  // Measured: a regex whose lazy line group re-tried every line after every
  // candidate key took 24 s over 32,000 lines, and a 1 MB overview of this shape
  // held the echo hook for 50,621 ms against its 5 s timeout. It is not ours:
  // the fence never closes.
  for (const lines of [32_000, Math.floor(HEAD_BYTES / 21)]) assert.equal(isOwned(repeating(lines)), false);
  const ratio = doublingRatio((lines) => { const text = repeating(lines); return () => isOwned(text); }, TIMED, { rounds: 9 });
  assert.ok(ratio < LINEAR, `twice the lines took ${ratio.toFixed(2)} times as long`);
});

test("the same shape closed at the end is ours, and still linear", () => {
  assert.equal(isOwned(repeating(32_000, "---\n")), true);
  assert.equal(isOwned(repeating(2 * TIMED, "---\n")), true, "the double's closing fence is inside the head");
  const ratio = doublingRatio((lines) => { const text = repeating(lines, "---\n"); return () => isOwned(text); }, TIMED, { rounds: 9 });
  assert.ok(ratio < LINEAR, `twice the lines took ${ratio.toFixed(2)} times as long`);
});

test("ownership reads the fences it always read", () => {
  // The cases the pattern answered, kept as the hand parser's contract.
  assert.equal(isOwned(`---\ngenerator: ${GENERATOR}\n---`), true, "a closing fence at the end of the text");
  assert.equal(isOwned(`---  \ngenerator:\t${GENERATOR} \n---\t\n`), true, "trailing blanks on fences and key");
  assert.equal(isOwned(`﻿---\r\npaths:\r\n  - x\r\ngenerator: ${GENERATOR}\r\n---\r\n`), true);
  assert.equal(isOwned(`---\ngenerator: ${GENERATOR}\n`), false, "no closing fence");
  assert.equal(isOwned(`---\ngenerator: ${GENERATOR}`), false, "no closing fence and no newline");
  assert.equal(isOwned(`---\ngenerator: ${GENERATOR}s\n---\n`), false, "another generator's name");
  assert.equal(isOwned(`---\n generator: ${GENERATOR}\n---\n`), false, "an indented key is a nested one");
  assert.equal(isOwned(`\n---\ngenerator: ${GENERATOR}\n---\n`), false, "the fence is at byte zero or nowhere");
  assert.equal(isOwned(`----\ngenerator: ${GENERATOR}\n---\n`), false, "four dashes are not a fence");
  assert.equal(isOwned(`---\na: b\n---\ngenerator: ${GENERATOR}\n---\n`), false, "the key past the first block");
  assert.equal(isOwned(`---\na\rb\ngenerator: ${GENERATOR}\n---\n`), false, "a lone carriage return inside");
  assert.equal(isOwned(`---\n---\n`), false, "an empty block");
  assert.equal(isOwned(42), false);
});

test("the claude names are the ones the target descriptors spell", () => {
  assert.equal(RULES_DIR, claude.dir);
  assert.equal(OVERVIEW_FILE, `${PREFIX}overview.md`);
  assert.equal(overviewName(cursor), `${PREFIX}overview.mdc`);
});

test("a target directory that is not there resolves, and is not created", (t) => {
  const dir = workspace(t);
  assert.equal(resolveTargetDir(dir, cursor), join(dir, ".cursor", "rules"));
  assert.equal(resolveTargetDir(dir, copilot), join(dir, ".github", "instructions"));
  assert.equal(existsSync(join(dir, ".cursor")), false);
  assert.equal(existsSync(join(dir, ".github")), false);
  // The parent alone: the rest is this tool's to create under it.
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  assert.equal(resolveTargetDir(dir, copilot), join(dir, ".github", "instructions"));
  assert.equal(existsSync(join(dir, ".github", "instructions")), false);
});

test("a target directory that is a real directory resolves to itself", (t) => {
  const dir = workspace(t);
  mkdirSync(join(dir, ".cursor", "rules"), { recursive: true });
  mkdirSync(join(dir, ".github", "instructions"), { recursive: true });
  assert.equal(resolveTargetDir(dir, cursor), join(dir, ".cursor", "rules"));
  assert.equal(resolveTargetDir(dir, copilot), join(dir, ".github", "instructions"));
});

test("the claude target resolves as the rules directory always has", needsSymlinks, (t) => {
  const dir = workspace(t);
  assert.equal(resolveTargetDir(dir, claude), resolveRulesDir(dir));
  // The one link this tool writes through, and only for this target.
  mkdirSync(join(dir, "agents", "rules"), { recursive: true });
  mkdirSync(join(dir, ".claude"));
  symlinkSync("../agents/rules", join(dir, ".claude", "rules"));
  assert.equal(resolveTargetDir(dir, claude), join(dir, "agents", "rules"));
  assert.equal(resolveTargetDir(dir, claude), resolveRulesDir(dir));
});

test("a link at any component of a Cursor or Copilot directory is refused, inside the tree or out", needsSymlinks, (t) => {
  const outside = workspace(t);
  mkdirSync(join(outside, "rules"));
  const cases = [
    [cursor, ".cursor", "inside"],
    [cursor, ".cursor/rules", "inside"],
    [cursor, ".cursor", "outside"],
    [cursor, ".cursor/rules", "outside"],
    [copilot, ".github", "inside"],
    [copilot, ".github/instructions", "inside"],
    [copilot, ".github", "outside"],
    [copilot, ".github/instructions", "outside"],
    [cursor, ".cursor", "dangling"],
    [copilot, ".github/instructions", "dangling"],
  ];
  for (const [target, link, where] of cases) {
    const dir = workspace(t);
    // A real directory holding a `rules` and an `instructions`, so a followed link would resolve.
    mkdirSync(join(dir, "shared", "rules"), { recursive: true });
    mkdirSync(join(dir, "shared", "instructions"), { recursive: true });
    mkdirSync(join(dir, link, ".."), { recursive: true });
    const to = { inside: join(dir, "shared"), outside, dangling: join(dir, "nothing-here") }[where];
    symlinkSync(to, join(dir, link));
    assert.equal(resolveTargetDir(dir, target), null, `${link} linked ${where}`);
    // The same link shape under `.claude/rules` is the exception, and it stays one.
    assert.equal(auditRules(dir, null, target).escaped, true, `${link} linked ${where}`);
    assert.equal(targetState(dir, target), "unknown", `${link} linked ${where}`);
  }
});

test("a file where a Cursor or Copilot directory belongs is refused", (t) => {
  for (const [target, rel] of [[copilot, ".github"], [copilot, ".github/instructions"], [cursor, ".cursor"], [cursor, ".cursor/rules"]]) {
    const dir = workspace(t);
    put(dir, rel, "not a directory\n");
    assert.equal(resolveTargetDir(dir, target), null, rel);
    assert.equal(readFileSync(join(dir, rel), "utf8"), "not a directory\n");
  }
});

test("a root that does not resolve gives no target directory", (t) => {
  const dir = workspace(t);
  assert.equal(resolveTargetDir(join(dir, "gone"), cursor), null);
});

test("a directory that cannot be looked into does not resolve", needsUnreadableDirs, (t) => {
  for (const [target, top] of [[cursor, ".cursor"], [copilot, ".github"]]) {
    const dir = workspace(t);
    mkdirSync(join(dir, target.dir), { recursive: true });
    chmodSync(join(dir, top), 0o000);
    try {
      assert.equal(resolveTargetDir(dir, target), null, top);
      assert.equal(targetState(dir, target), "unknown", top);
    } finally {
      chmodSync(join(dir, top), 0o755);
    }
  }
});

test("a target directory that is Claude Code's own, holds it or sits in it does not resolve", needsSymlinks, (t) => {
  const cases = [
    [copilot, "../.github/instructions", "is it"],
    [cursor, "../.cursor/rules", "is it"],
    [copilot, "../.github", "sits in it"],
    [cursor, "../.cursor", "sits in it"],
    [copilot, "../.github/instructions/claude", "holds it"],
    [cursor, "../.cursor/rules/claude", "holds it"],
  ];
  for (const [target, to, how] of cases) {
    const dir = workspace(t);
    put(dir, `${target.dir}/${overviewName(target)}`, OWNED);
    mkdirSync(join(dir, ".claude"));
    mkdirSync(join(dir, ".claude", to), { recursive: true });
    symlinkSync(to, join(dir, RULES_DIR));
    assert.equal(resolveRulesDir(dir), join(dir, ".claude", to), `${to}: the link Claude Code reads through still resolves`);
    assert.equal(resolveTargetDir(dir, target), null, `${target.dir} ${how}`);
    assert.equal(targetState(dir, target), "unknown", `${target.dir} ${how}`);
    assert.equal(auditRules(dir, null, target).escaped, true, `${target.dir} ${how}`);
  }
  // A shared directory that is neither leaves both targets where they were.
  const dir = workspace(t);
  mkdirSync(join(dir, "agents", "rules"), { recursive: true });
  mkdirSync(join(dir, ".claude"));
  symlinkSync("../agents/rules", join(dir, RULES_DIR));
  put(dir, `.cursor/rules/${overviewName(cursor)}`, OWNED);
  assert.equal(resolveTargetDir(dir, cursor), join(dir, ".cursor", "rules"));
  assert.equal(targetState(dir, cursor), "on");
  assert.equal(resolveTargetDir(dir, copilot), join(dir, ".github", "instructions"));
});

test("a rules link spelled in another case still overlaps the directory it leads to", { ...needsSymlinks, ...needsFoldingFilesystem }, (t) => {
  // The plain realpath keeps the link's spelling, so the two paths compared unequal.
  for (const [target, to] of [[copilot, "../.GitHub/instructions"], [cursor, "../.Cursor/rules"], [copilot, "../.GITHUB"]]) {
    const dir = workspace(t);
    put(dir, `${target.dir}/${overviewName(target)}`, OWNED);
    mkdirSync(join(dir, ".claude"));
    symlinkSync(to, join(dir, RULES_DIR));
    assert.notEqual(resolveRulesDir(dir), null, `${to}: the control, the link resolves`);
    assert.equal(resolveTargetDir(dir, target), null, to);
    assert.equal(targetState(dir, target), "unknown", to);
  }
});

test("claude is always on", (t) => {
  const dir = workspace(t);
  assert.equal(targetState(dir, claude), "on");
  assert.equal(targetState(join(dir, "gone"), claude), "on");
});

test("on: the overview is a file carrying our key, and it turns on only its own target", (t) => {
  const dir = workspace(t);
  put(dir, `.cursor/rules/${overviewName(cursor)}`, OWNED);
  assert.equal(targetState(dir, cursor), "on");
  assert.equal(targetState(dir, copilot), "off");
  put(dir, `.github/instructions/${overviewName(copilot)}`, `---\ngenerator: ${GENERATOR}\napplyTo: "**"\n---\n`);
  assert.equal(targetState(dir, copilot), "on");
});

test("off: nothing is at the overview's name", (t) => {
  const dir = workspace(t);
  assert.equal(targetState(dir, cursor), "off", "no directory");
  assert.equal(targetState(dir, copilot), "off", "no directory");
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  assert.equal(targetState(dir, copilot), "off", "the parent alone");
  // An area file alone, and the other targets' overviews, are not this target's overview.
  put(dir, `.cursor/rules/${areaName(cursor, "1a2b3c4d")}`, OWNED);
  put(dir, `.cursor/rules/${overviewName(copilot)}`, OWNED);
  put(dir, `.cursor/rules/${overviewName(claude)}`, OWNED);
  assert.equal(targetState(dir, cursor), "off", "a directory holding other names");
});

test("off: the overview is a readable file that does not carry our key, and it is left as written", (t) => {
  for (const text of [HAND, "", "# Repository map\n", `generator: ${GENERATOR}\n`, `---\ndescription: x\n---\n---\ngenerator: ${GENERATOR}\n---\n`]) {
    const dir = workspace(t);
    const rel = `.cursor/rules/${overviewName(cursor)}`;
    put(dir, rel, text);
    assert.equal(targetState(dir, cursor), "off", JSON.stringify(text));
    assert.equal(readFileSync(join(dir, rel), "utf8"), text);
  }
});

test("unknown: a file where the target's directory belongs", (t) => {
  for (const [target, rel] of [[copilot, ".github"], [copilot, ".github/instructions"], [cursor, ".cursor"], [cursor, ".cursor/rules"]]) {
    const dir = workspace(t);
    put(dir, rel, "not a directory\n");
    assert.equal(targetState(dir, target), "unknown", rel);
  }
});

test("unknown: a root that does not resolve", (t) => {
  const dir = workspace(t);
  assert.equal(targetState(join(dir, "gone"), cursor), "unknown");
});

test("unknown: a directory at the overview's name", (t) => {
  const dir = workspace(t);
  mkdirSync(join(dir, ".github", "instructions", overviewName(copilot)), { recursive: true });
  assert.equal(targetState(dir, copilot), "unknown");
});

test("unknown: a link at the overview's name, dangling or to a file of ours", needsSymlinks, (t) => {
  const dir = workspace(t);
  const at = join(dir, ".cursor", "rules", overviewName(cursor));
  mkdirSync(join(dir, ".cursor", "rules"), { recursive: true });
  symlinkSync(join(dir, "nothing-here"), at);
  assert.equal(targetState(dir, cursor), "unknown");
  rmSync(at);
  put(dir, `${RULES_DIR}/${OVERVIEW_FILE}`, OWNED);
  symlinkSync(join(dir, RULES_DIR, OVERVIEW_FILE), at);
  assert.equal(targetState(dir, cursor), "unknown");
  rmSync(at);
  put(dir, "notes.md", HAND);
  symlinkSync(join(dir, "notes.md"), at);
  assert.equal(targetState(dir, cursor), "unknown");
});

test("unknown: a fifo at the overview's name, answered without waiting on it", needsPosixSpecialFiles, (t) => {
  const dir = workspace(t);
  mkdirSync(join(dir, ".cursor", "rules"), { recursive: true });
  execFileSync("mkfifo", [join(dir, ".cursor", "rules", overviewName(cursor))]);
  assert.equal(targetState(dir, cursor), "unknown");
});

test("unknown: an overview that cannot be opened, ours or not", needsPosixPermissions, (t) => {
  for (const text of [OWNED, HAND]) {
    const dir = workspace(t);
    const rel = `.cursor/rules/${overviewName(cursor)}`;
    put(dir, rel, text);
    chmodSync(join(dir, rel), 0o000);
    assert.equal(targetState(dir, cursor), "unknown");
  }
});

test("unknown: a directory whose entries cannot be looked at", needsUnreadableDirs, (t) => {
  const dir = workspace(t);
  put(dir, `.cursor/rules/${overviewName(cursor)}`, OWNED);
  chmodSync(join(dir, ".cursor", "rules"), 0o000);
  try {
    assert.equal(resolveTargetDir(dir, cursor), join(dir, ".cursor", "rules"));
    assert.equal(targetState(dir, cursor), "unknown");
  } finally {
    chmodSync(join(dir, ".cursor", "rules"), 0o755);
  }
});

test("a generated name carries its own target's extension", () => {
  assert.equal(isGeneratedName("anatomiya-area-1a2b3c4d.mdc", cursor), true);
  assert.equal(isGeneratedName("anatomiya-area-1a2b3c4d.md", cursor), false);
  assert.equal(isGeneratedName("anatomiya-area-1a2b3c4d.instructions.md", copilot), true);
  assert.equal(isGeneratedName("anatomiya-area-1a2b3c4d.md", copilot), false);
  assert.equal(isGeneratedName("anatomiya-area-1a2b3c4d.mdc", copilot), false);
  // With no target it answers for Claude Code, as every caller today asks it.
  assert.equal(isGeneratedName("anatomiya-area-1a2b3c4d.md"), true);
  assert.equal(isGeneratedName("anatomiya-area-1a2b3c4d.mdc"), false);
  assert.equal(isGeneratedName("anatomiya-area-1a2b3c4d.md", claude), true);
  for (const target of [claude, cursor, copilot]) {
    assert.equal(isGeneratedName(overviewName(target), target), true);
    assert.equal(isGeneratedName(areaName(target, "9f86d081"), target), true);
    // The prefix and the extension with nothing between them name no file of ours.
    assert.equal(isGeneratedName(`${PREFIX}${target.ext}`, target), false);
    assert.equal(isGeneratedName(`team${target.ext}`, target), false);
    assert.equal(isGeneratedName(`${PREFIX}a/b${target.ext}`, target), false);
    assert.equal(isGeneratedName(`${PREFIX}a\\b${target.ext}`, target), false);
    assert.equal(isGeneratedName(`../${PREFIX}a${target.ext}`, target), false);
    assert.equal(isGeneratedName(`${PREFIX}a\0${target.ext}`, target), false);
    assert.equal(isGeneratedName(undefined, target), false);
  }
});

test("the audit of a Cursor directory names our files and the ones holding our names, and nobody else's", (t) => {
  const dir = workspace(t);
  const owned = areaName(cursor, "1a2b3c4d");
  put(dir, `.cursor/rules/${overviewName(cursor)}`, OWNED);
  put(dir, `.cursor/rules/${owned}`, OWNED);
  put(dir, `.cursor/rules/${areaName(cursor, "deadbeef")}`, HAND);
  put(dir, ".cursor/rules/team.mdc", HAND);
  // Another tool's extension under our prefix is not a file this target reads.
  put(dir, `.cursor/rules/${OVERVIEW_FILE}`, OWNED);
  mkdirSync(join(dir, ".cursor", "rules", "nested.mdc"));

  const audit = auditRules(dir, new Set([owned]), cursor);
  assert.deepEqual(audit.ours, [owned]);
  assert.deepEqual(audit.unknown, [overviewName(cursor)]);
  assert.deepEqual(audit.foreign, [areaName(cursor, "deadbeef")]);
  assert.deepEqual(audit.unreadable, []);
  assert.deepEqual(audit.occupied, []);
  assert.equal(audit.dir, join(dir, ".cursor", "rules"));
  assert.equal(audit.escaped, false);
  assert.equal(audit.listed, true);
  // With no record nothing is ours, in this directory as in the first.
  assert.deepEqual(auditRules(dir, null, cursor).ours, []);
  assert.deepEqual(auditRules(dir, null, cursor).unknown, [owned, overviewName(cursor)]);
});

test("the audit of a Copilot directory reads only .instructions.md under our prefix", (t) => {
  const dir = workspace(t);
  const owned = overviewName(copilot);
  put(dir, `.github/instructions/${owned}`, OWNED);
  put(dir, `.github/instructions/${OVERVIEW_FILE}`, OWNED);
  put(dir, ".github/instructions/team.instructions.md", HAND);
  mkdirSync(join(dir, ".github", "instructions", areaName(copilot, "1a2b3c4d")));
  const audit = auditRules(dir, new Set([owned]), copilot);
  assert.deepEqual(audit.ours, [owned]);
  assert.deepEqual(audit.unknown, []);
  assert.deepEqual(audit.foreign, []);
  // A directory at a name this target would write is still in the way of it.
  assert.deepEqual(audit.occupied, [areaName(copilot, "1a2b3c4d")]);
});

test("the audit of a target directory that is not there found nothing, and looked", (t) => {
  const dir = workspace(t);
  const audit = auditRules(dir, null, cursor);
  assert.equal(audit.listed, true);
  assert.equal(audit.escaped, false);
  assert.equal(audit.dir, join(dir, ".cursor", "rules"));
});

test("the audit with no target is the audit of Claude Code's directory, every .md in it", (t) => {
  const dir = workspace(t);
  put(dir, `${RULES_DIR}/${OVERVIEW_FILE}`, OWNED);
  put(dir, `${RULES_DIR}/team.md`, HAND);
  put(dir, `${RULES_DIR}/notes.mdc`, HAND);
  const known = new Set([OVERVIEW_FILE]);
  const audit = auditRules(dir, known);
  assert.deepEqual(audit.ours, [OVERVIEW_FILE]);
  assert.deepEqual(audit.foreign, ["team.md"]);
  assert.deepEqual(auditRules(dir, known, claude), audit);
});
