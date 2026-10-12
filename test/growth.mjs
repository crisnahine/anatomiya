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
export function doublingRatio(make, n, options) {
  return settled(() => timedRatio(make, n, options));
}

/**
 * The smallest of up to `attempts` reads of `measure`, stopping at the first under LINEAR.
 *
 * A shared runner now and then slows the larger side alone by half again, past LINEAR on work
 * that reads 2 everywhere else (3.15 and 3.51 in one CI run), and a second read does not. Work
 * that grows faster than linear reads past it every time. A read that could not be timed is no
 * answer while another read is one.
 */
export function settled(measure, attempts = ATTEMPTS) {
  const reads = [];
  do {
    reads.push(measure());
  } while (reads.length < attempts && !(reads.at(-1) < LINEAR));
  const timed = reads.filter(Number.isFinite);
  return timed.length ? Math.min(...timed) : reads.at(-1);
}

function timedRatio(make, n, { rounds = 3 } = {}) {
  // Windows counts CPU time in steps of about 15.6ms, so a short side reads as
  // none or rounds by a whole step. Each side runs long enough that a step is noise.
  // Sized from warmed calls: the first runs unoptimised, measured at twice a
  // warm one, which left each side at half the time it was meant to run.
  const probe = make(n);
  probe();
  let calls = 0;
  const warm = process.hrtime.bigint();
  do {
    probe();
    calls++;
  } while (Number(process.hrtime.bigint() - warm) < CALIBRATE_NS);
  const each = Number(process.hrtime.bigint() - warm) / calls;
  let reps = Math.max(1, Math.ceil(MIN_SPENT_NS / Math.max(1, each)));
  let enough = READABLE_NS;
  for (let timed = 1; ; timed++) {
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
    // A stall while sizing made every call look long, and the sides then ran too short for
    // Windows' steps to read: they are timed again, scaled to as long as they should have run.
    if (best[0] * 1000 >= enough || timed === TIMINGS) return best[1] / best[0];
    enough = SHORT_NS;
    reps = Math.ceil((reps * MIN_SPENT_NS) / Math.max(best[0] * 1000, WINDOWS_STEP_NS));
  }
}

const MIN_SPENT_NS = 250e6;
const CALIBRATE_NS = 20e6;
const WINDOWS_STEP_NS = 15.6e6;
// Four of Windows' CPU steps: a side under it reads as none, or off by half.
const READABLE_NS = 4 * WINDOWS_STEP_NS;
// A side timed again runs close to as long as it should, where two steps off is noise.
const SHORT_NS = 200e6;
const TIMINGS = 6;

// cpuUsage counts the collector's own threads, so garbage left by building the
// input would be charged to the work, more of it on the larger side.
setFlagsFromString("--expose-gc");
const collect = runInNewContext("gc");

/** Under 3: past linear's 2 with room for noise, short of quadratic's 4. */
export const LINEAR = 3;

export const ATTEMPTS = 3;
