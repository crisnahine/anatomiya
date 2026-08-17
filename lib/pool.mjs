import { fork, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";
import { cpus, tmpdir } from "node:os";

import { MAX_FILE_BYTES } from "./limits.mjs";
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
export function createPool({ size, withProgram = false, execArgv = [] } = {}) {
  const workers = [];
  const idle = [];
  const queue = [];
  let closed = false;
  let broken = null;
  let stillborn = 0;
  let rssTimer = null;

  function spawn() {
    // Empty by default rather than the parent's. A flag that is legal on a
    // parent running `node -e` can be illegal on a child that loads a file, and
    // `--input-type=module` is exactly that: inherited, it killed every worker
    // before it answered and the scan blamed the parser.
    //
    // Outside the repository, for the same reason the Ruby bridge is: a
    // worker is handed absolute paths, so a relative read inside it can only be
    // a bug, and there it reaches nothing tracked.
    const child = fork(WORKER, [], {
      execArgv,
      cwd: tmpdir(),
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    const w = { child, job: null, timer: null, started: 0, ready: false, stderr: "", killedBy: null };

    // Kept because a worker that dies before it answers writes the only copy of
    // the reason here, and the pool used to pipe this and read none of it.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (w.stderr.length < STDERR_BYTES) w.stderr += chunk;
    });

    child.on("message", (msg) => {
      if (msg && msg.ready) {
        w.ready = true;
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
    child.on("exit", (code, signal) => {
      const timedOut = w.killedBy === "timeout";
      if (w.job && timedOut && !w.job.retried && !closed) {
        const job = w.job;
        job.retried = true;
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
        return fail([`parser worker will not start`, firstLine(w.stderr)].filter(Boolean).join(": "));
      }
      spawn();
    });

    workers.push(w);
    return w;
  }

  function drop(list, w) {
    const i = list.indexOf(w);
    if (i >= 0) list.splice(i, 1);
  }

  function fail(reason) {
    broken = reason;
    for (const job of queue.splice(0)) job.resolve({ rel: job.file.rel, ok: false, error: reason });
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
    w.killedBy = null;

    w.timer = setTimeout(() => {
      if (w.job !== job) return;
      w.killedBy = "timeout";
      w.child.kill("SIGKILL");
    }, GUARDS.timeoutMs);

    startRssPoll();

    w.child.send({ rel: job.file.rel, abs: job.file.abs, lang: job.file.lang, withProgram }, (err) => {
      if (!err || w.job !== job) return;
      w.child.kill("SIGKILL");
      finish(w, { rel: job.file.rel, ok: false, error: "worker channel closed" }, true);
    });
  }

  // One poll for the whole pool: `ps` is a process spawn, and one per in-flight
  // worker every 25ms costs more parent time than the parses it guards.
  function startRssPoll() {
    if (rssTimer) return;
    rssTimer = setInterval(pollRss, GUARDS.rssPollMs);
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
    const watched = inFlight.filter((w) => w.child.pid && now - w.started >= GUARDS.rssGraceMs);
    if (watched.length === 0) return;

    const rss = rssOf(watched.map((w) => w.child.pid));
    for (const w of watched) {
      if (rss.get(w.child.pid) > GUARDS.rssBytes) {
        w.killedBy = "memory";
        w.child.kill("SIGKILL");
      }
    }
  }

  function parse(file) {
    return new Promise((resolve) => {
      if (closed) return resolve({ rel: file.rel, ok: false, error: "pool closed" });
      if (broken) return resolve({ rel: file.rel, ok: false, error: broken });

      let bytes = 0;
      try {
        bytes = statSync(file.abs).size;
      } catch {
        return resolve({ rel: file.rel, ok: false, error: "unreadable" });
      }
      if (bytes > GUARDS.maxBytes) {
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
    fail("pool closed");
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

  return { parse, close, size: target };
}

export function defaultPoolSize() {
  return Math.max(1, Math.min(8, cpus().length - 1));
}

/**
 * Resident size per pid, and the one subprocess this module runs that is not a
 * worker.
 *
 * Exported because it is the guard's own guard: `execFileSync` blocks the
 * parent's event loop, so a `ps` that never returns is the memory guard
 * becoming the hang it exists to prevent, and the only way to show that the
 * timeout holds is to hand it a `ps` that stalls.
 */
export function rssOf(pids) {
  // No `ps` on Windows, and the usual replacement is on its way out: `wmic` is
  // removed in Windows 11 25H2 and gone entirely in the next feature update,
  // which is what `pidusage` still shells out to. Rather than ship an untested
  // `tasklist` parser, the guard stands down there and the five-second timeout
  // is what catches a runaway parse.
  if (process.platform === "win32") return new Map();

  // ps is the portable way to read another process's resident size without a
  // native dependency.
  const out = new Map();
  try {
    const stdout = execFileSync("ps", ["-o", "pid=,rss=", "-p", pids.join(",")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GUARDS.psTimeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: GUARDS.psMaxBytes,
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
