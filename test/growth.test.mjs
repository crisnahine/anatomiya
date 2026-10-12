import { test } from "node:test";
import assert from "node:assert/strict";
import { doublingRatio, LINEAR, settled } from "./growth.mjs";

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
    const ratio = doublingRatio((n) => () => {
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
