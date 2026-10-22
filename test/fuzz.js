// `.js` rather than `.mjs`: OpenSSF Scorecard looks for a fast-check import only in `*.js` and `*.jsx` files.
import fc from "fast-check";

import { LANGUAGES, ENGINES } from "../plugins/anatomiya/lib/langs.mjs";

export { fc };

// A scan's record is read back from JSON, so every object here has the usual prototype.
const plain = { noNullPrototype: true };
const count = fc.nat({ max: 5000 });
const optional = (keys) => ({ ...plain, requiredKeys: keys });

/** What a parse can report, each field present or not, so the overview meets shapes no fixture spells. */
export const parseReport = fc
  .record(
    {
      parsed: count,
      crashed: count,
      skipped: count,
      failed: count,
      syntaxErrors: count,
      rejections: fc.record({ grammar: count, syntax: count }, plain),
      missingStripper: fc.boolean(),
      oneBranch: count,
      unreadable: fc.subarray(LANGUAGES.map((l) => l.id)),
      engines: fc.dictionary(
        fc.constantFrom(...Object.keys(ENGINES)),
        fc.oneof(fc.record({ version: fc.constant("1.0.0") }, plain), fc.record({ stalled: fc.constant("5000 ms") }, plain), fc.constant({})),
        plain
      ),
    },
    optional(["parsed", "unreadable", "engines"])
  )
  .chain((parse) => fc.subarray(parse.unreadable).map((missingGrammars) => ({ ...parse, missingGrammars })));

const ext = fc.constantFrom(".ts", ".tsx", ".js", ".rb", ".py", ".go", ".mo", ".po", ".rst", ".png", ".json", ".swift");

const root = fc.record(
  { files: count, exts: fc.array(fc.tuple(ext, count), { maxLength: 3 }), other: count, jsx: count, testRoot: fc.boolean() },
  plain
);

// Areas are named `src/m<i>`, so a claim can land in one of them or in none.
const areaPath = fc.nat({ max: 70 }).map((i) => `src/m${i}`);

const cochangeClaim = fc.record(
  {
    producer: areaPath.map((dir) => `${dir}/*.ts`),
    companion: fc.oneof(fc.constant({ kind: "adds", path: "test/*.test.ts" }), fc.constant({ kind: "edits", path: "CHANGELOG.md" })),
    candidates: count,
    conforming: count,
    authors: fc.nat({ max: 9 }),
    files: fc.tuple(count, count),
    area: fc.option(areaPath, { nil: null }),
    directive: fc.boolean(),
  },
  plain
);

const dimension = fc.record(
  {
    candidates: fc.integer({ min: 1, max: 900 }),
    authors: fc.nat({ max: 9 }),
    directive: fc.boolean(),
    states: fc.constantFrom(undefined, "claim", "counter", null),
    matchesDefault: fc.boolean(),
    exceptions: fc.array(areaPath.map((dir) => `${dir}/x.ts`), { maxLength: 3 }),
    moreExceptions: fc.nat({ max: 40 }),
    counterExceptions: fc.option(fc.array(areaPath.map((dir) => `${dir}/y.ts`), { maxLength: 3 }), { nil: undefined }),
  },
  optional(["candidates", "authors", "directive", "matchesDefault", "exceptions", "moreExceptions"])
).chain((d) =>
  fc.nat({ max: d.candidates }).map((conforming) => ({
    key: "swallowed_error",
    claim: "catch blocks use the error they caught",
    precision: "precise",
    applicability: 8,
    conforming,
    ratio: conforming / d.candidates,
    gate: null,
    langFileCount: 12,
    ...(d.counterExceptions ? { counterClaim: "catch blocks drop the error they caught", moreCounterExceptions: 0 } : {}),
    ...d,
  }))
);

/** Areas as the reducer hands them over, each stating, counting or saying nothing. */
export const areaList = fc.array(fc.array(dimension, { maxLength: 3 }), { maxLength: 60 }).map((all) =>
  all.map((dimensions, i) => ({
    id: `id${i}`,
    path: `src/m${i}`,
    globs: [{ negated: false, dir: `src/m${i}`, tail: "**/*.{ts,tsx}" }],
    fileCount: 12,
    dimensions,
  }))
);

/** Every state the checker tier is recorded in, and none. */
export const semanticShape = fc.oneof(
  fc.constant(undefined),
  fc.constant({ ran: true, status: "ok", reason: null, typedResolutionRate: 0.97 }),
  fc.constant({ ran: true, status: "degraded", reason: "low-resolution", typedResolutionRate: 0.73 }),
  fc.constant({ ran: true, status: "degraded", reason: "no tsconfig", typedResolutionRate: null }),
  fc.constant({ ran: false, status: null, reason: "plain-javascript", typedResolutionRate: null }),
  fc.constant({ ran: false, carried: true, status: "degraded", reason: "low-resolution", typedResolutionRate: 0.73, measuredAt: "2026-01-01T00:00:00.000Z" })
);

/** What git told the scan about authors and history. */
export const authorsShape = fc.oneof(
  fc.record({ files: count, error: fc.constant(null), repo: fc.constantFrom(1, 5), shallow: fc.option(fc.record({ commits: fc.option(count, { nil: null }), oldest: fc.constantFrom(null, "2026-01-02") }, plain), { nil: null }) }, plain),
  fc.constant({ files: 0, error: "git log failed", repo: null, shallow: { commits: 1, oldest: null } })
);

/** A roster as a scan builds one: some roots, some more, a test denominator. */
export const layoutShape = fc.record(
  {
    size: count,
    minFiles: fc.integer({ min: 1, max: 50 }),
    roots: fc
      .array(root, { maxLength: 12 })
      .map((roots) => roots.map((o, i) => ({ path: `src/d${i}`, dir: `src/d${i}`, source: 0, jsxExt: o.jsx ? ".tsx" : null, tests: [], ...o }))),
    more: fc.record(
      { roots: fc.nat({ max: 40 }), files: count, floor: fc.option(fc.record({ dirs: fc.nat({ max: 40 }), files: count, root: count }, plain), { nil: null }) },
      plain
    ),
    tests: fc.array(fc.record({ runner: fc.constantFrom("vitest", "rspec", "cypress"), root: fc.constant("src"), files: count }, plain), {
      maxLength: 3,
    }),
    principles: fc.subarray(["test_shape", "granularity"]),
    truncated: fc.boolean(),
    cochange: fc.option(
      fc.record({ from: fc.constant("a".repeat(40)), tip: fc.constant("b".repeat(40)), claims: fc.array(cochangeClaim, { maxLength: 8 }) }, plain),
      { nil: undefined }
    ),
  },
  optional(["size", "minFiles", "roots", "more", "tests", "principles", "truncated"])
);

/** The corpus fields the overview prints from. */
export const corpusShape = fc.record(
  {
    files: count,
    truncated: fc.boolean(),
    untracked: fc.constantFrom(0, 0, 0, 4),
    dropped: fc.record({ generated: fc.nat({ max: 50 }) }, plain),
    otherExts: fc.array(fc.tuple(ext, fc.integer({ min: 1, max: 900 })), { maxLength: 6 }),
    scriptOnly: fc.subarray([[".vue", 3], [".svelte", 12]]),
  },
  plain
);
