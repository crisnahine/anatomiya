/**
 * One supervised child process, and the battery every one of them carries.
 *
 * Three bridges run a child: the warm parse pool, the Ruby stream and the type
 * checker. Each wrote the same guards with different numbers and different
 * gaps, so a fourth engine would have written them a fourth time. The numbers
 * stay with the caller that measured them; the spawn, the bounded stderr, the
 * two clocks and the kill live here.
 *
 * Parent-only. It imports `node:child_process`, so nothing the parse worker
 * reaches may import it (F18).
 */
import { fork, spawn } from "node:child_process";
import { tmpdir } from "node:os";

/**
 * Start a child under the guards, and hand back what a caller reads it by.
 *
 * `wallMs` is armed at once and nothing re-arms it, because silence is not the
 * only way a child fails to end: one that keeps answering slowly forever never
 * trips a liveness check. `idleMs` is the silence clock, and it runs only once
 * `touch()` has started it. `touch(ms)` takes a window because a checker's
 * first silence is its whole program build and every silence after it is a
 * stall.
 */
export function guardedChild({
  kind,
  modulePath,
  args = [],
  command,
  // Outside the repository, whichever child this is: every one of them is
  // handed absolute paths, so a relative read inside it can only be a bug, and
  // out here it reaches nothing tracked.
  cwd = tmpdir(),
  env,
  // Empty rather than the parent's. A flag that is legal on a parent running
  // `node -e` can be illegal on a child that loads a file, and
  // `--input-type=module` is exactly that: inherited, it killed every parse
  // worker before it answered and the scan blamed the parser.
  execArgv = [],
  stdio,
  stderrBytes,
  wallMs = null,
  idleMs = null,
  onTimeout,
}) {
  const child =
    kind === "fork"
      ? fork(modulePath, args, { cwd, execArgv, stdio })
      : spawn(command, args, { cwd, env, stdio });

  let text = "";
  let killedBy = null;
  let settled = false;
  let wall = null;
  let idle = null;

  // A child that dies before it answers writes the only copy of the reason
  // here, and piping stderr without reading it fills a 64 KB buffer and stalls
  // the child into a silence its own guard then reads as a hang.
  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (text.length < stderrBytes) text += chunk.slice(0, stderrBytes - text.length);
    });
  }

  // Re-arming after the run has settled would leave a timer holding the event
  // loop open for the length of its window, long after the answer left.
  const settle = () => {
    settled = true;
    if (wall) clearTimeout(wall);
    if (idle) clearTimeout(idle);
    wall = null;
    idle = null;
  };

  const kill = (reason) => {
    killedBy = reason;
    child.kill("SIGKILL");
  };

  // The other clock is dropped first, so a caller hears from whichever one
  // fired and never from both.
  const fire = (reason) => {
    settle();
    killedBy = reason;
    onTimeout?.(reason);
    child.kill("SIGKILL");
  };

  const touch = (ms = idleMs) => {
    if (settled || ms === null || ms === undefined) return;
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => fire("idle"), ms);
    idle.unref?.();
  };

  if (wallMs !== null) {
    wall = setTimeout(() => fire("wall"), wallMs);
    wall.unref?.();
  }

  return { child, stderr: () => text, touch, kill, killedBy: () => killedBy, settle };
}

/**
 * Whether a spawn failed because the interpreter is not on the machine.
 *
 * An absent interpreter is every file of that language at once and an install
 * problem, where anything else is one run that went wrong, and the two have
 * different fixes.
 */
export function absentInterpreter(err) {
  return err?.code === "ENOENT";
}

/**
 * Mark a job for one more attempt, and answer whether this is the first time.
 *
 * How long a parse takes is a property of the machine rather than of the file,
 * so a child our own timer killed is worth one more child; a second kill is
 * charged. The mark rides the job, which is also what says it took two
 * attempts.
 */
export function retryOnce(state) {
  if (state.retried) return false;
  state.retried = true;
  return true;
}
