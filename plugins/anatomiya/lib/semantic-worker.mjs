/**
 * The checker, in one child process, for the whole corpus at once.
 *
 * A separate process because the run was measured at 880 MB resident, and
 * because a parent that has to stay responsive should not host it. This is the
 * shell alone: the job it runs is `semantic-job.mjs`, reachable in process.
 */
import { runJob } from "./semantic-job.mjs";

process.on("message", (job) => runJob(job, (msg) => process.send(msg)));

process.send({ ready: true });
