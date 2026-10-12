import { test } from "node:test";
import assert from "node:assert/strict";

import { tally } from "../scripts/measure-cochange.mjs";

test("the totals count the claims, the repositories holding one, and the held-out additions", () => {
  const rows = [
    { stated: 10, mined: 9, met: 379, fired: 395 },
    { stated: 0, mined: 1, met: 5, fired: 6 },
    { stated: 2, mined: 0, met: 0, fired: 0 },
  ];

  assert.deepEqual(tally(rows), { stated: 12, statedIn: 2, mined: 10, minedIn: 2, met: 384, fired: 401 });
});
