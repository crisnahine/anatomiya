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
  const best = [Infinity, Infinity];
  for (let r = 0; r < rounds; r++) {
    for (const [side, size] of [[0, n], [1, 2 * n]]) {
      const work = make(size);
      const started = process.cpuUsage();
      work();
      const spent = process.cpuUsage(started);
      best[side] = Math.min(best[side], spent.user + spent.system);
    }
  }
  return best[1] / best[0];
}

/** Under 3: past linear's 2 with room for noise, short of quadratic's 4. */
export const LINEAR = 3;
