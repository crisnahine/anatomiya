/**
 * One Ruby shard, in a worker thread: its child, its stream and its rows.
 *
 * A thread rather than a process, because nothing here can crash the way an
 * oxc parse can (B2): prism runs in the child, and what this thread holds is
 * JSON and the walks. The rows arrive as keys, since a function cannot cross
 * to a thread, and what leaves is one record per file, counts and no tree,
 * then how the batch ended.
 */
import { parentPort, workerData } from "node:worker_threads";

import { ALL_DIMENSIONS } from "./dimensions.mjs";
import { parseBatch } from "./ruby.mjs";

const { files, keys, ...job } = workerData;
const byKey = new Map(ALL_DIMENSIONS.map((d) => [d.key, d]));
const dimensions = keys.map((key) => {
  if (!byKey.has(key)) throw new Error(`no row named ${key}`);
  return byKey.get(key);
});

// Each record leaves as it is decided, so the held heap carries one tree
// rather than every record of the batch.
const out = await parseBatch(files, { ...job, dimensions, onResult: (result) => parentPort.postMessage({ result }) });
parentPort.postMessage({ out: { ...out, results: [] } });
