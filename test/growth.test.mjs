import { test } from "node:test";
import assert from "node:assert/strict";
import { doublingRatio, LINEAR } from "./growth.mjs";

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
    assert.ok(Number.isFinite(ratio) && ratio < LINEAR, `twice the work read ${ratio} times as long`);
  } finally {
    process.cpuUsage = real;
  }
});
