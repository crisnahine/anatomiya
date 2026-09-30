import { test } from "node:test";
import assert from "node:assert/strict";

import { GENERATOR, HEAD_BYTES, isOwned } from "../plugins/anatomiya/lib/rules.mjs";
import { doublingRatio, LINEAR } from "./growth.mjs";

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
