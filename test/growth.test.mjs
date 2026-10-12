import { test } from "node:test";
import assert from "node:assert/strict";
import { doublingRatio, LINEAR, settled, timedRatio } from "./growth.mjs";

test("a stall while the timed sides are sized leaves each side long enough to read on a coarse CPU clock", () => {
  // Windows counts CPU time in steps of about 15.6ms.
  const real = process.cpuUsage;
  const step = (us) => Math.floor(us / 15_600) * 15_600;
  process.cpuUsage = (since) => {
    const now = real();
    const at = { user: step(now.user), system: step(now.system) };
    return since ? { user: at.user - since.user, system: at.system - since.system } : at;
  };
  let stalls = 3;
  try {
    // One read, since a second would come after the stalls and pass whatever the first did.
    const ratio = timedRatio((n) => () => {
      if (stalls > 0) {
        stalls--;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      }
      // Kept to 32 bits: a sum past them leaves small-integer arithmetic and slows the larger side.
      let sum = 0;
      for (let i = 0; i < n * 1000; i++) sum = (sum + i) | 0;
      return sum;
    }, 50);
    // Above 1.5 as well: sides too short to read come out near 1, whatever the work.
    assert.ok(Number.isFinite(ratio) && ratio > 1.5 && ratio < LINEAR, `twice the work read ${ratio} times as long`);
  } finally {
    process.cpuUsage = real;
  }
});

/** A measure that hands back `reads` in turn, counting how many were taken. */
function reading(reads) {
  const measure = () => reads[measure.taken++];
  measure.taken = 0;
  return measure;
}

test("a ratio read past linear is read again, and the first read under it stands", () => {
  const measure = reading([3.4, 2.1, 1.9]);
  assert.equal(settled(measure), 2.1);
  assert.equal(measure.taken, 2);
});

test("work that grows faster than linear reads past it every time it is read", () => {
  const measure = reading([4.1, 3.9, 4.0, 1.9]);
  assert.equal(settled(measure), 3.9);
  assert.equal(measure.taken, 3);
});

test("a read that could not be timed neither passes the work nor hides a read that could", () => {
  assert.equal(settled(reading([NaN, 3.5, NaN])), 3.5);
  assert.ok(Number.isNaN(settled(reading([NaN, NaN, NaN]))));
  assert.equal(settled(reading([Infinity, 2.2])), 2.2);
});

test("doubling work whose first read comes out past linear is read again", () => {
  // A CPU clock only the work moves, so each read is exact and no side is timed twice.
  const real = process.cpuUsage;
  let spent = 0;
  process.cpuUsage = (since) => (since ? { user: spent - since.user, system: 0 } : { user: spent, system: 0 });
  // The first read's three rounds give the larger side four times the work, as a burst on a runner can.
  let larger = 0;
  try {
    const ratio = doublingRatio((n) => {
      const cost = n === 100 && larger++ < 3 ? 2 * n : n;
      return () => {
        spent += cost;
      };
    }, 50);
    assert.equal(larger, 6, "the first read's three rounds and the second's");
    assert.equal(ratio, 2);
  } finally {
    process.cpuUsage = real;
  }
});
