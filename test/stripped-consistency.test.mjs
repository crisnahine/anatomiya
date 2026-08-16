import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSync } from "oxc-parser";
import stripFlow from "flow-remove-types";

import { dimensionsFor } from "../lib/dimensions.mjs";
import { collectHits } from "../lib/walk.mjs";

/**
 * A file the parser accepts as written, holding the shapes the stripper
 * touches: annotations, a type-only import, an ambient declaration, casts, and
 * ordinary code beside each one.
 *
 * Accepted as written on purpose. A file with Flow-only syntax has no
 * unstripped tree to compare against, and the comparison is the whole test.
 */
const FIXTURE = [
  "// @flow",
  "import type {Opts} from './opts'",
  "import {run} from './run'",
  "import {helper} from './helper.js'",
  "",
  "declare const ambient: number;",
  "declare module 'legacy' {",
  "  export var legacyGlobal: number;",
  "}",
  "",
  "type Config = {name: string}",
  "",
  "let mutable = 1",
  "const fixed: Config = {name: 'x'}",
  "",
  "export function describe(o: Opts, c: Config): string {",
  "  const fallback = o.name ?? ('' as string)",
  "  const other = c.name || 0",
  "  if (!fallback) return null as any",
  "  try {",
  "    for (const k of Object.keys(c)) run(k)",
  "  } catch (e) {",
  "    run(e)",
  "  }",
  "  return helper(fallback, other, mutable, ambient, fixed)",
  "}",
  "",
  "export const arrow = async (n: number): Promise<string> => {",
  "  const v = await run(n)",
  "  return v?.name ?? undefined",
  "}",
].join("\n");

const shape = (program, dims) => {
  const hits = collectHits(program, dims);
  const out = new Map();
  for (const d of dims) {
    const h = hits[d.key] || [];
    out.set(d.key, `${h.length} sites / ${h.filter((x) => x.conforming).length} conforming`);
  }
  return out;
};

test("only the dimensions marked blind answer differently once the types are stripped", () => {
  // This comparison is what found four bugs the review did not: a cast hiding
  // the value it wraps, an ambient declaration counted as module state, a
  // binding inside a namespace counted the same way, and type-only imports
  // counted as sites of the extension claim and then deleted. Any dimension
  // that moves here and is not marked blind will report one number for a file
  // and a different one for the same file after a retry.
  const before = parseSync("f.tsx", FIXTURE, { sourceType: "module" });
  assert.equal(before.errors.length, 0, "the fixture has to parse as written, or there is nothing to compare");

  const blanked = stripFlow(FIXTURE, { all: true }).toString();
  assert.notEqual(blanked, FIXTURE, "the fixture has to hold something the stripper removes");
  const after = parseSync("f.tsx", blanked, { sourceType: "module" });
  assert.equal(after.errors.length, 0, `the blanked fixture no longer parses: ${after.errors[0]?.message}`);

  const dims = dimensionsFor(["js"]);
  const a = shape(before.program, dims);
  const b = shape(after.program, dims);

  const moved = dims.filter((d) => a.get(d.key) !== b.get(d.key));
  const unmarked = moved.filter((d) => d.blindWhenStripped !== true);

  assert.deepEqual(
    unmarked.map((d) => `${d.key}: ${a.get(d.key)} -> ${b.get(d.key)}`),
    [],
    "a dimension answers two ways for one file depending on whether the retry ran"
  );
  // The fixture has to keep exercising the marked rows, or it stops proving
  // anything when someone edits it.
  assert.ok(
    moved.some((d) => d.blindWhenStripped === true),
    "the fixture no longer moves any blind dimension"
  );
});
