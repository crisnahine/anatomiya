import { test } from "node:test";
import assert from "node:assert/strict";

import { fc, parseReport, layoutShape, corpusShape, areaList, semanticShape, authorsShape } from "./fuzz.js";
import { renderOverview } from "../plugins/anatomiya/lib/render.mjs";
import { pathWords, pathSites } from "../plugins/anatomiya/lib/stems.mjs";

test("any parse, corpus and roster a scan can report keeps the overview to forty lines and its head", () => {
  // The bound has broken on combinations of optional lines that no
  // hand-written sweep had put together.
  fc.assert(
    fc.property(
      parseReport,
      corpusShape,
      fc.option(layoutShape, { nil: null }),
      areaList,
      fc.record({ semantic: semanticShape, authors: authorsShape, suppressAll: fc.boolean() }),
      fc.record({ foreign: fc.nat({ max: 12 }), unknown: fc.nat({ max: 12 }), unreadable: fc.nat({ max: 4 }) }),
      (parse, corpus, layout, areas, { semantic, authors, suppressAll }, others) => {
        const names = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}${i}.md`);
        const out = renderOverview(
          { layout, root: "/repo", scannedAt: "2026-01-01T00:00:00.000Z", durationMs: 1, corpus, parse, suppressAll, semantic, authors, areas },
          {
            uncovered: 40,
            orphaned: 10,
            barren: 30,
            others: { foreign: names(others.foreign, "f"), unknown: names(others.unknown, "anatomiya-area-u"), unreadable: names(others.unreadable, "r") },
          }
        );
        const lines = out.trimEnd().split("\n");
        assert.ok(lines.length <= 40, `${lines.length} lines`);
        assert.match(out, /^Read a file before editing it: /m);
        assert.match(out, /^When a change is asked for, /m);
        assert.match(out, new RegExp(`^## Areas \\(${areas.length}\\)$`, "m"));
        assert.match(out, /^Generated files: \d+ under/m);
        // A scan counts untracked files only where it found no tracked ones, so a roster and untracked files never meet.
        const roster = layout && (layout.truncated || layout.roots.length || layout.tests.length);
        if (roster && !corpus.untracked) assert.match(out, /^## What lives where$/m);
      }
    ),
    { numRuns: 300 }
  );
});

test("any string a route can hold gives path words that are its own, and a cut path no more sites", () => {
  const anyText = fc.oneof(
    fc.string({ unit: "binary" }),
    fc.array(fc.constantFrom("/", "a", "B", "-", "_", ":", "*", "?", "#", "(", ")", ".well-known", "support_tickets", "x-y"), { maxLength: 12 }).map((p) => p.join(""))
  );
  fc.assert(
    fc.property(anyText, (text) => {
      const words = pathWords(text);
      if (words === null) return;
      for (const word of words) {
        assert.ok(word.length > 0 && !word.includes("/"), JSON.stringify(word));
        assert.ok(text.includes(word), JSON.stringify(word));
      }
      // The same words rejoined are the same path, and a path that may be cut is the one without its last word.
      assert.deepEqual(pathSites(text), pathSites(`/${words.join("/")}`));
      assert.deepEqual(pathSites(text, { mayBeCut: true }), pathSites(`/${words.slice(0, -1).join("/")}`));
      for (const { word } of pathSites(text)) assert.ok(words.includes(word), word);
    }),
    { numRuns: 1000 }
  );
});

test("a path built from known segments gives back the words it was built from", () => {
  const word = fc.constantFrom("team-page", "saved_view", "userList", "x");
  const segment = fc.oneof(
    word.map((w) => ({ text: w, word: w })),
    word.map((w) => ({ text: `(${w})`, word: w })),
    word.map((w) => ({ text: `((${w}))`, word: w })),
    fc.constantFrom(":id", ":id?", "*rest", "[slug]", "{item}", "$post", "<int:pk>", "(:locale)", "(.:format)").map((text) => ({ text }))
  );
  fc.assert(
    fc.property(fc.array(segment, { maxLength: 8 }), fc.constantFrom(null, ".well-known", "(.well-known)"), fc.constantFrom("", "?next=/a_b", "#c_d/e-f"), (segments, wellKnown, tail) => {
      const at = wellKnown !== null ? Math.floor(segments.length / 2) : -1;
      const parts = segments.map((s) => s.text);
      if (at !== -1) parts.splice(at, 0, wellKnown);
      const expected = (at === -1 ? segments : segments.slice(0, at)).flatMap((s) => (s.word ? [s.word] : []));
      if (at === -1) expected.push("end-page");
      assert.deepEqual(pathWords(`/${[...parts, "end-page"].join("/")}${tail}`), expected);
    }),
    { numRuns: 1000 }
  );
});
