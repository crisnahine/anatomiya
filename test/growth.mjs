import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

/**
 * How a piece of work grows, told apart from how fast the machine is.
 *
 * A wall-clock budget cannot separate a slow runner from the regression it
 * guards: a linear run on a loaded machine took longer than the quadratic
 * bound it was meant to catch. Doubling the input and comparing the two times
 * can, since load slows both sides alike. Linear work reads about 2, quadratic
 * about 4.
 *
 * `make(size)` builds the input untimed and returns the work to time. Each size
 * is timed several times, interleaved so a burst of load lands on both, and the
 * fastest of each is kept: noise only ever adds time.
 */
export function doublingRatio(make, n, { rounds = 3 } = {}) {
  // Windows counts CPU time in steps of about 15.6ms, so a short side reads as
  // none or rounds by a whole step. Each side runs long enough that a step is noise.
  // Sized from warmed calls: the first runs unoptimised, measured at twice a
  // warm one, which left each side at half the time it was meant to run.
  // Sized on CPU time, which a stall does not add to: on the wall clock one
  // paused call made every call look long, and both sides read as none.
  const probe = make(n);
  probe();
  let calls = 0;
  let sizing = 0;
  const warm = process.cpuUsage();
  do {
    probe();
    calls++;
    const used = process.cpuUsage(warm);
    sizing = (used.user + used.system) * 1000;
  } while (sizing < CALIBRATE_NS);
  const each = sizing / calls;
  const reps = Math.max(1, Math.ceil(MIN_SPENT_NS / Math.max(1, each)));
  const best = [Infinity, Infinity];
  for (let r = 0; r < rounds; r++) {
    for (const [side, size] of [[0, n], [1, 2 * n]]) {
      const work = make(size);
      collect();
      const started = process.cpuUsage();
      for (let i = 0; i < reps; i++) work();
      const spent = process.cpuUsage(started);
      best[side] = Math.min(best[side], spent.user + spent.system);
    }
  }
  return best[1] / best[0];
}

const MIN_SPENT_NS = 250e6;
// Over three of Windows' CPU steps, so the size read off them is off by a third at most.
const CALIBRATE_NS = 50e6;

// cpuUsage counts the collector's own threads, so garbage left by building the
// input would be charged to the work, more of it on the larger side.
setFlagsFromString("--expose-gc");
const collect = runInNewContext("gc");

/** Under 3: past linear's 2 with room for noise, short of quadratic's 4. */
export const LINEAR = 3;
