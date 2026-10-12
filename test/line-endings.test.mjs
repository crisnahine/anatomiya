import { test } from "node:test";
import assert from "node:assert/strict";

import { endings, failedTests } from "../scripts/line-endings.mjs";

test("a failed test is named by its TAP line, nested or not, without its directive", () => {
  const tap = "ok 1 - reads\nnot ok 2 - a submodule's filter driver never runs\n  not ok 1 - inner case # TODO later\nok 3 - writes\n";

  assert.deepEqual(failedTests(tap), ["a submodule's filter driver never runs", "inner case"]);
});

test("the working tree's line endings are counted by the second column of the listing", () => {
  const listing = "i/lf    w/crlf  attr/text=auto  README.md\ni/lf    w/crlf  attr/text=auto  a.mjs\ni/-text w/-text attr/-text      g.wasm\n";

  assert.deepEqual(endings(listing), { "w/crlf": 2, "w/-text": 1 });
});
