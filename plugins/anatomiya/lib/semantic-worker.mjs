/**
 * The checker, in one child process, for the whole corpus at once.
 *
 * A separate process because the run was measured at 880 MB resident, and
 * because a parent that has to stay responsive should not host it. This is the
 * shell alone: the job it runs is `semantic-job.mjs`, reachable in process.
 */
import { runJob } from "./semantic-job.mjs";

// The first message is the job, and `{ stop }` may follow it at any moment, more than once or after the answer.
let stop = false;
process.on("message", (msg) => {
  if (msg?.stop) stop = true;
  else runJob(msg, (answer) => process.send(answer), { stopped: () => stop });
});

process.send({ ready: true });
