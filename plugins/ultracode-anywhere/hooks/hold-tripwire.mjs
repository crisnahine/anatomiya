/**
 * The tripwire: a subagent, or a claude started from a held session's shell,
 * that acts at any level but the held one, or on another model, is stopped at
 * its next tool call (A81).
 *
 * The routing decides what a spawn is given. This is what catches one that got
 * past it: the level is on every PreToolUse payload, and the model is on the
 * spawn's own transcript.
 */
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { FILE_ID, holdStatePath, sameFamily } from "./hold-config.mjs";
import { pruneOlder } from "./hold-files.mjs";

/** How much of a transcript's end is read first. */
const TAIL_BYTES = 256 * 1024;

/** How far back a read goes before it gives up on finding a model. */
const MAX_READ_BYTES = 32 * 1024 * 1024;

/** How long a first call waits for its transcript, which is often written just after that call (A82). */
const WAIT_MS = 1500;
const WAIT_STEP_MS = 50;

/** How long a mark that a subagent was already waited on is kept. */
const MARK_KEEP_MS = 24 * 60 * 60 * 1000;

/** A model name plain enough to repeat to the model. */
const MODEL_NAME = /^[\w.[\]-]{1,64}$/;

/**
 * The model on the last assistant line of a transcript, or null.
 *
 * Read back from the end in growing pieces, so one huge line cannot hide the
 * model and a long transcript is not read whole.
 */
export function lastAssistantModel(path) {
  if (!path) return null;
  let fd;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const size = fstatSync(fd).size;
    for (let length = Math.min(size, TAIL_BYTES); ; length = Math.min(size, length * 4, MAX_READ_BYTES)) {
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      const lines = buffer.toString("utf8").split("\n");
      // The first line of a partial read may be cut, so it is read only when the read reached the start.
      for (let at = lines.length - 1; at >= (length < size ? 1 : 0); at--) {
        try {
          const entry = JSON.parse(lines[at]);
          // The build records a reply it made itself, an error say, under a bracketed name such as <synthetic>.
          if (entry.type === "assistant" && typeof entry.message?.model === "string" && !/^<.*>$/.test(entry.message.model)) return entry.message.model;
        } catch {
          // Not a line this reads.
        }
      }
      if (length >= size || length >= MAX_READ_BYTES) return null;
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * Where a subagent's own transcript can be. The payload names only the
 * session's: a subagent's sits beside it, and a workflow stage's one level
 * deeper, under its run.
 */
export function subagentTranscripts(event) {
  if (typeof event.transcript_path !== "string" || !FILE_ID.test(event.agent_id ?? "")) return [];
  const dir = join(event.transcript_path.replace(/\.jsonl$/, ""), "subagents");
  const file = `agent-${event.agent_id}.jsonl`;
  let runs = [];
  try {
    runs = readdirSync(join(dir, "workflows")).sort();
  } catch {
    // No workflow has run in this session.
  }
  return [join(dir, file), ...runs.map((run) => join(dir, "workflows", run, file))];
}

function modelIn(files) {
  for (const file of files) {
    const model = lastAssistantModel(file);
    if (model) return model;
  }
  return null;
}

/**
 * The model a subagent's transcript records, waiting briefly for the file once
 * per subagent in a session that keeps transcripts.
 */
export function subagentModel(event, env = process.env) {
  const read = () => modelIn(subagentTranscripts(event));
  if (!FILE_ID.test(event.agent_id ?? "") || !existsSync(event.transcript_path ?? "")) return read();
  return waitedModel(read, event.agent_id, env);
}

/** The model a claude started from a held session's shell records, waiting once for its transcript the same way. */
function childModel(event, env) {
  const path = typeof event.transcript_path === "string" ? event.transcript_path : "";
  const read = () => lastAssistantModel(path);
  if (!path || !FILE_ID.test(event.session_id ?? "") || !existsSync(dirname(path))) return read();
  return waitedModel(read, `child-${event.session_id}`, env);
}

/** What `read` finds, polled for a short while the first time only, as marked under `id`. */
function waitedModel(read, id, env) {
  let model = read();
  if (model) return model;
  const marks = holdStatePath(env, "waited");
  if (marks && existsSync(join(marks, id))) return null;
  for (const deadline = Date.now() + WAIT_MS; !model && Date.now() < deadline; ) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, WAIT_STEP_MS);
    model = read();
  }
  if (!model && marks) mark(marks, id);
  return model;
}

/** Marks a subagent as waited on, clearing marks more than a day old as it goes. */
function mark(dir, id) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    pruneOlder(dir, MARK_KEEP_MS);
    writeFileSync(join(dir, id), "");
  } catch {
    // A mark that cannot be kept is a wait paid again on the next call.
  }
}

/**
 * "allow", or why a call is refused: a subagent's, or any call inside a claude
 * started from a held session's shell, off the held level or the held model.
 */
export function verdict(event, { env = process.env, target }) {
  const subagent = typeof event.agent_id === "string";
  const child = env.ULTRACODE_ANYWHERE_HELD_CHILD === "1";
  if ((!subagent && !child) || !target) return "allow";
  const who = subagent ? "This subagent" : "This claude, started from another session's shell,";
  // A project's settings can set the child marker in a session nobody started from a shell.
  const report = subagent ? "Stop here and report that this spawn got past the spawn hold." : "Stop here and report that this claude got past the spawn hold, or that a project's settings set ULTRACODE_ANYWHERE_HELD_CHILD.";
  const level = event.effort?.level;
  if (level !== target.level) {
    const named = typeof level === "string" && /^[a-z]{1,16}$/.test(level) ? level : "an unknown";
    return `${who} is running at ${named} effort, and every spawned agent must run at ${target.level}. ${report}`;
  }
  const model = subagent ? subagentModel(event, env) : childModel(event, env);
  if (model && !sameFamily(model, target.family)) {
    return `${who} is running ${MODEL_NAME.test(model) ? model : "another model"}, and every spawned agent must run ${target.family}. ${report}`;
  }
  return "allow";
}

/** The self-check's record of one call: who made it, at what level, on what model. */
export function logLine(event, env = process.env) {
  const subagent = typeof event.agent_id === "string";
  const model = subagent ? subagentModel(event, env) : null;
  return `${subagent ? "child" : "main"} ${event.effort?.level ?? "none"} ${model ?? "none"}\n`;
}
