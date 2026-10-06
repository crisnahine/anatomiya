/**
 * One Ruby shard, in a worker thread: its stream, its clocks and its rows.
 *
 * A thread rather than a process, because nothing here can crash the way an
 * oxc parse can (B2): prism runs in the child, and what this thread holds is
 * JSON and the walks. The rows arrive as keys, since a function cannot cross
 * to a thread. What leaves is one record per file: on a scan it carries the
 * rows' counts and no tree, and on a check, which asks for no rows, it carries
 * the tree. Then one message says how the batch ended.
 *
 * The child itself is started by the parent and reached through a stand-in
 * that answers like one, because only the thread that spawns a child can reap
 * it and this one may die first.
 */
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { parentPort, workerData } from "node:worker_threads";

import { ALL_DIMENSIONS } from "./dimensions.mjs";
import { parseBatch } from "./ruby.mjs";

const { files, keys, ...job } = workerData;
const byKey = new Map(ALL_DIMENSIONS.map((d) => [d.key, d]));
const dimensions = keys.map((key) => {
  if (!byKey.has(key)) throw new Error(`no row named ${key}`);
  return byKey.get(key);
});

const children = new Map();
let next = 0;
const relay = ({ id, ...msg }) => children.get(id)?.(msg);
parentPort.on("message", relay);

/** A child on the parent, as `guardedChild` reads one: utf8 streams, events, kill. */
function spawner(command, args, options) {
  const id = next++;
  const send = (msg) => parentPort.postMessage({ id, ...msg });
  const child = new EventEmitter();
  const stream = () => {
    const s = new EventEmitter();
    s.decoder = new StringDecoder("utf8");
    s.setEncoding = () => s;
    return s;
  };
  child.stdout = stream();
  child.stderr = stream();
  child.stdin = { end: (text) => send({ stdin: text }), on: () => child.stdin };
  child.kill = () => send({ kill: true });
  children.set(id, (msg) => {
    for (const name of ["stdout", "stderr"]) {
      const bytes = msg[name];
      if (bytes) child[name].emit("data", child[name].decoder.write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
    }
    if (msg.stdout) send({ read: true });
    if (msg.error) child.emit("error", Object.assign(new Error(msg.error.message), { code: msg.error.code }));
    if (msg.close) {
      for (const name of ["stdout", "stderr"]) {
        const tail = child[name].decoder.end();
        if (tail) child[name].emit("data", tail);
      }
      children.delete(id);
      child.emit("close", ...msg.close);
    }
  });
  send({ spawn: [command, args, options] });
  return child;
}

// Each record leaves as it is decided, so the held heap carries one tree
// rather than every record of the batch. A check's tree crosses as JSON text:
// decoding a deeply nested object off a message overflows the parent's stack,
// and the record was lost with no error.
const post = (result) =>
  result.program
    ? parentPort.postMessage({ result: { ...result, program: null }, tree: JSON.stringify(result.program) })
    : parentPort.postMessage({ result });
const out = await parseBatch(files, { ...job, dimensions, spawner, onResult: post });
parentPort.postMessage({ out });
parentPort.off("message", relay);
