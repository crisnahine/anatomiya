import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, statSync } from "node:fs";
import { cpus } from "node:os";

import { guardedChild, retryOnce } from "./child.mjs";
import { guardsOver, MAX_FILE_BYTES } from "./limits.mjs";
import { firstLine } from "./encode.mjs";

const WORKER = fileURLToPath(new URL("./parse-worker.mjs", import.meta.url));

export const GUARDS = {
  maxBytes: MAX_FILE_BYTES,
  timeoutMs: 5_000,
  rssBytes: 1024 * 1024 * 1024,
  rssPollMs: 25,
  rssGraceMs: 250,
  // The memory guard's own subprocess carries the same battery every other
  // subprocess here does. A `ps` that does not return would otherwise
  // block the parent's event loop indefinitely, on the poll that exists to stop
  // a runaway parse: the guard becomes the hang. One second is far past what a
  // read of a handful of pids takes.
  psTimeoutMs: 1_000,
  psMaxBytes: 64 * 1024,
  // A file is handed only to a worker that said ready, and nothing timed the
  // wait for it: a worker stalled in its own startup (a native binding blocked
  // on a network filesystem, a preload that never settles) left every file
  // queued and the scan waiting forever. Past this it is killed and counts as
  // a worker that died before it answered. Generous, because a cold native
  // binding on a slow disk is slow rather than stalled, and the per-file clock
  // does not start until the worker is ready.
  readyTimeoutMs: 20_000,
};

// A worker that dies before it ever answers is a broken install, not a poison
// file, so respawning it forever would spin instead of failing.
const MAX_STILLBORN = 5;

// Enough of a stack trace to name the cause, not enough to carry a source line
// from a repository into an error message.
const STDERR_BYTES = 2048;

/**
 * A pool of warm child processes, one file per message.
 *
 * Warm matters: a process per file would pay fork cost on every file. A
 * respawn after a crash costs about a millisecond, so a poison file costs one
 * file rather than the run.
 *
 * A worker answers with per-dimension counts. `withProgram` additionally sends
 * the tree back, which only the check path wants and only for the files a diff
 * touched: the tree serialises to 16x the size of its source, and asking for it
 * across a whole repository is what held pool throughput to 2.8x on eleven
 * cores no matter how many workers ran.
 */
export function createPool({ size, withProgram = false, execArgv = [], guards = null } = {}) {
  const limits = guardsOver(GUARDS, guards, "oxc");
  const workers = [];
  const idle = [];
  const queue = [];
  // What answered, keyed by engine. The ready message has always carried the
  // version and the pool dropped it, so a caller could not say which parser
  // produced the counts it was handed.
  const versions = {};
  let closed = false;
  let broken = null;
  let stillborn = 0;
  let rssTimer = null;

  function spawn() {
    // The clocks are the pool's rather than the supervisor's: a warm worker
    // takes many files, so the deadline is armed per file and dropped when that
    // file answers, where the supervisor's two clocks time a whole run.
    const sup = guardedChild({
      kind: "fork",
      modulePath: WORKER,
      execArgv,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      stderrBytes: STDERR_BYTES,
    });
    const child = sup.child;
    const w = { sup, child, job: null, timer: null, started: 0, ready: false };

    // The ready clock: a worker still silent past it takes the stillborn path
    // below, so a pool no worker ever becomes ready in fails its queued files
    // as crashed rather than holding them.
    const readyTimer = setTimeout(() => {
      if (!w.ready) w.sup.kill("ready timeout");
    }, limits.readyTimeoutMs);
    readyTimer.unref?.();
    child.once("exit", () => clearTimeout(readyTimer));

    child.on("message", (msg) => {
      if (msg && msg.ready) {
        clearTimeout(readyTimer);
        w.ready = true;
        if (msg.engine) versions[msg.engine] = msg.version ?? null;
        return release(w);
      }
      finish(w, msg);
    });

    // An uncatchable crash lands here, not in a try/catch. The file is charged
    // as a failure and the worker is replaced.
    //
    // Except when the pool's own wall clock did the killing: that one goes back
    // on the end of the queue for a second attempt, after the burst that
    // starved it. How long a parse takes is a property of the machine, not of
    // the file, and a file charged as crashed in one scan and parsed in the
    // next moves the unexamined count in the always-loaded overview (A5). A
    // worker over the RSS ceiling, or one that died by itself, is a poison file
    // and gets the one attempt.
    child.on("exit", (code, signal) => died(code, signal));

    // A fork that never started emits this and never 'exit': a cwd that is
    // gone, which a cleaned-up per-session TMPDIR makes of every child, or
    // EAGAIN at a process limit, or EMFILE. Unlistened it is an uncaught
    // exception and the scan dies on Node's own stack; listened and ignored,
    // the worker is never replaced and a queued file waits forever. It is a
    // worker that died before it answered, so it takes that path. A child that
    // did start answers here only for a kill or a send that failed, and its own
    // 'exit' still says how it ended.
    child.on("error", (err) => {
      if (child.pid === undefined) died(null, null, err);
    });

    function died(code, signal, cause = null) {
      const timedOut = w.sup.killedBy() === "timeout";
      if (w.job && timedOut && !closed && retryOnce(w.job)) {
        const job = w.job;
        w.job = null;
        if (w.timer) clearTimeout(w.timer);
        w.timer = null;
        queue.push(job);
      } else if (w.job) {
        finish(w, {
          rel: w.job.file.rel,
          ok: false,
          error: timedOut && w.job.retried ? "parser timed out twice" : `parser died (${signal || `exit ${code}`})`,
          crashed: !closed,
        }, true);
      }
      drop(workers, w);
      // An idle worker can still die under an external kill, and assigning to a
      // dead channel would strand the job.
      drop(idle, w);
      if (closed) return;
      if (!w.ready && ++stillborn >= MAX_STILLBORN) {
        // A fork that never ran printed nothing, so the reason is the spawn's.
        // One the ready clock killed may have printed nothing either.
        const stalled = w.sup.killedBy() === "ready timeout" ? `no ready answer in ${limits.readyTimeoutMs}ms` : null;
        const why = stalled || firstLine(w.sup.stderr()) || firstLine(cause?.message);
        return fail([`parser worker will not start`, why].filter(Boolean).join(": "));
      }
      spawn();
    }

    workers.push(w);
    return w;
  }

  function drop(list, w) {
    const i = list.indexOf(w);
    if (i >= 0) list.splice(i, 1);
  }

  // A pool no worker will start in never answered for any file, which is a
  // crash on every file of the language: the condition A13 reads as a blind
  // run. Charged as unreadable, the scan went on to remove every correct area
  // file and write an overview of zero areas.
  function fail(reason) {
    broken = reason;
    for (const job of queue.splice(0)) job.resolve(neverAnswered(job.file.rel));
  }

  function neverAnswered(rel) {
    return { rel, ok: false, error: broken, crashed: true };
  }

  function finish(w, msg, dead = false) {
    const job = w.job;
    if (w.timer) clearTimeout(w.timer);
    w.timer = null;
    w.job = null;
    // A worker that answers with something other than its own reply shape would
    // otherwise land in the caller's result map under key `undefined`.
    if (job) {
      const result =
        msg && typeof msg === "object" && typeof msg.rel === "string"
          ? msg
          : { rel: job.file.rel, ok: false, error: "malformed worker reply" };
      result.attempts = job.retried ? 2 : 1;
      job.resolve(result);
    }
    if (!dead) release(w);
  }

  function release(w) {
    if (closed) return;
    const next = queue.shift();
    if (next) return assign(w, next);
    idle.push(w);
  }

  function assign(w, job) {
    w.job = job;
    w.started = Date.now();

    w.timer = setTimeout(() => {
      if (w.job !== job) return;
      w.sup.kill("timeout");
    }, limits.timeoutMs);

    startRssPoll();

    w.child.send({ rel: job.file.rel, abs: job.file.abs, lang: job.file.lang, withProgram }, (err) => {
      if (!err || w.job !== job) return;
      w.sup.kill("channel closed");
      finish(w, { rel: job.file.rel, ok: false, error: "worker channel closed" }, true);
    });
  }

  // One poll for the whole pool: `ps` is a process spawn, and one per in-flight
  // worker every 25ms costs more parent time than the parses it guards.
  function startRssPoll() {
    if (rssTimer) return;
    rssTimer = setInterval(pollRss, limits.rssPollMs);
    rssTimer.unref?.();
  }

  function stopRssPoll() {
    if (rssTimer) clearInterval(rssTimer);
    rssTimer = null;
  }

  function pollRss() {
    const now = Date.now();
    const inFlight = workers.filter((w) => w.job);
    if (inFlight.length === 0) return stopRssPoll();

    // Only watch a file that has been in flight a moment, so a normal parse
    // never pays for the polling.
    const watched = inFlight.filter((w) => w.child.pid && now - w.started >= limits.rssGraceMs);
    if (watched.length === 0) return;

    const rss = rssOf(watched.map((w) => w.child.pid), limits);
    for (const w of watched) {
      if (rss.get(w.child.pid) > limits.rssBytes) w.sup.kill("memory");
    }
  }

  function parse(file) {
    return new Promise((resolve) => {
      if (closed) return resolve({ rel: file.rel, ok: false, error: "pool closed" });
      if (broken) return resolve(neverAnswered(file.rel));

      let bytes = 0;
      try {
        bytes = statSync(file.abs).size;
      } catch {
        return resolve({ rel: file.rel, ok: false, error: "unreadable" });
      }
      if (bytes > limits.maxBytes) {
        return resolve({ rel: file.rel, ok: false, error: "over size cap", skipped: true });
      }

      const job = { file, resolve };
      const w = idle.pop();
      if (w) assign(w, job);
      else queue.push(job);
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
    stopRssPoll();
    for (const job of queue.splice(0)) job.resolve({ rel: job.file.rel, ok: false, error: "pool closed" });
    idle.length = 0;

    await Promise.all(
      workers.splice(0).map(
        (w) =>
          new Promise((resolve) => {
            if (w.child.exitCode !== null || w.child.signalCode !== null) return resolve();
            w.child.once("exit", resolve);
            w.child.kill();
            const hard = setTimeout(() => w.child.kill("SIGKILL"), 1_000);
            hard.unref?.();
            w.child.once("exit", () => clearTimeout(hard));
          }),
      ),
    );
  }

  const target = Math.max(1, Math.min(64, Math.floor(size) || defaultPoolSize()));
  for (let i = 0; i < target; i++) spawn();

  return { parse, close, size: target, versions };
}

export function defaultPoolSize() {
  return Math.max(1, Math.min(8, cpus().length - 1));
}

// Absolute, never looked up. `scan .` runs from the repository, and an empty
// PATH entry is the current directory, so `ps` by name ran whatever the
// repository had committed under that name, as the user, while the guard
// polled. macOS and the BSDs keep it here.
const PS = "/bin/ps";

/**
 * Resident size per pid, and the one subprocess this module runs that is not a
 * worker, where it runs one at all.
 *
 * Exported because it is the guard's own guard: `execFileSync` blocks the
 * parent's event loop, so a `ps` that never returns is the memory guard
 * becoming the hang it exists to prevent, and the only way to show that the
 * timeout holds is to hand it a `ps` that stalls. `platform` and `ps` are that
 * seam: on Linux the poll never reaches a `ps`.
 */
export function rssOf(pids, limits = GUARDS, { platform = process.platform, ps = PS } = {}) {
  // No `ps` on Windows, and the usual replacement is on its way out: `wmic` is
  // removed in Windows 11 25H2 and gone entirely in the next feature update,
  // which is what `pidusage` still shells out to. Rather than ship an untested
  // `tasklist` parser, the guard stands down there and the five-second timeout
  // is what catches a runaway parse.
  if (platform === "win32") return new Map();
  if (platform === "linux") return rssFromProc(pids);

  // ps is the portable way to read another process's resident size without a
  // native dependency.
  const out = new Map();
  try {
    const stdout = execFileSync(ps, ["-o", "pid=,rss=", "-p", pids.join(",")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: limits.psTimeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: limits.psMaxBytes,
    });
    for (const line of stdout.split("\n")) {
      const [pid, kb] = line.trim().split(/\s+/);
      if (pid && kb) out.set(Number(pid), Number(kb) * 1024);
    }
  } catch {
    /* the process is gone, or there is no ps; the exit handler takes it */
  }
  return out;
}

/**
 * Linux answers from the kernel's own table, with no subprocess and nothing
 * looked up on PATH. Slim images (node:*-slim, most devcontainers) ship no
 * procps, and there the `ps` this used to run was ENOENT on every poll,
 * swallowed: measured, three files a forced 1 MB ceiling killed with `ps`
 * present all parsed with it absent, and nothing said the ceiling had stood
 * down. `VmRSS` is in kB, the unit `ps -o rss=` answers in.
 */
function rssFromProc(pids) {
  const out = new Map();
  for (const pid of pids) {
    try {
      const kb = /^VmRSS:\s+(\d+) kB$/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1];
      if (kb) out.set(pid, Number(kb) * 1024);
    } catch {
      /* gone between the poll and the read; the exit handler takes it */
    }
  }
  return out;
}
