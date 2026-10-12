import { test } from "node:test";
import assert from "node:assert/strict";

import { tally } from "../scripts/measure-cochange.mjs";

test("the totals count the claims, the repositories holding one, and the held-out additions", () => {
  const rows = [
    { stated: 10, mined: 9, held: [379, 395] },
    { stated: 0, mined: 1, held: [5, 6] },
    { stated: 2, mined: 0, held: [0, 0] },
  ];

  assert.deepEqual(tally(rows), { stated: 12, statedIn: 2, mined: 10, minedIn: 2, met: 384, fired: 401 });
});
