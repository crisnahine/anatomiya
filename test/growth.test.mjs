import { test } from "node:test";
import assert from "node:assert/strict";
import { doublingRatio, LINEAR, settled, timedRatio } from "./growth.mjs";

// Windows counts CPU time in steps of about 15.6 ms.
const step = (us) => Math.floor(us / 15_600) * 15_600;

/** Runs `fn` with `process.cpuUsage` reading `now(real)`, a `{ user, system }` in microseconds. */
function onCpuClock(now, fn) {
  const real = process.cpuUsage;
  process.cpuUsage = (since) => {
    const at = now(real);
    return since ? { user: at.user - since.user, system: at.system - since.system } : at;
  };
  try {
    return fn();
  } finally {
    process.cpuUsage = real;
  }
}

test("a stall while the timed sides are sized leaves each side long enough to read on a coarse CPU clock", () => {
  let stalls = 3;
  // One read, since a second would come after the stalls and pass whatever the first did.
  const ratio = onCpuClock(
    (real) => {
      const now = real();
      return { user: step(now.user), system: step(now.system) };
    },
    () =>
      timedRatio((n) => () => {
        if (stalls > 0) {
          stalls--;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
        }
        // Kept to 32 bits: a sum past them leaves small-integer arithmetic and slows the larger side.
        let sum = 0;
        for (let i = 0; i < n * 1000; i++) sum = (sum + i) | 0;
        return sum;
      }, 50)
  );
  // Above 1.5 as well: sides too short to read come out near 1, whatever the work.
  assert.ok(Number.isFinite(ratio) && ratio > 1.5 && ratio < LINEAR, `twice the work read ${ratio} times as long`);
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
  let spent = 0;
  // The first read's three rounds give the larger side four times the work, as a burst on a runner can.
  let larger = 0;
  const ratio = onCpuClock(
    () => ({ user: spent, system: 0 }),
    () =>
      doublingRatio((n) => {
        const cost = n === 100 && larger++ < 3 ? 2 * n : n;
        return () => {
          spent += cost;
        };
      }, 50)
  );
  assert.equal(larger, 6, "the first read's three rounds and the second's");
  assert.equal(ratio, 2);
});

test("a side timed again runs close to as long as it should, where two of Windows' steps are noise", () => {
  // Windows' 15.6 ms CPU steps over a clock only the work moves, and a stall in the calibration
  // alone, so the first timing reads nothing and the second about 80 ms.
  let spent = 0;
  let made = 0;
  let larger = 0;
  const ratio = onCpuClock(
    () => ({ user: step(spent), system: 0 }),
    () =>
      timedRatio((n) => {
        let stalls = made++ === 0 ? 3 : 0;
        if (n === 100) larger++;
        const cost = n === 100 ? 5000 : 2500;
        return () => {
          if (stalls > 0) {
            stalls--;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
          }
          spent += cost;
        };
      }, 50, { rounds: 1 })
  );
  assert.equal(larger, 3, "timed a third time, past 200 ms");
  assert.ok(ratio > 1.8 && ratio < 2.2, `twice the work read ${ratio} times as long`);
});
