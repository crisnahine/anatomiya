/**
 * A shipped workflow's own script, run the way the build runs one.
 *
 * The orchestration is the thing under test: the fan-out width, the vote
 * arithmetic, the early exits, what happens when an agent answers nothing. None
 * of that is reachable while the orchestration is a script the model improvises
 * per turn, and all of it is reachable now that it is a file.
 *
 * Faithful in the four ways that decide whether a passing case means anything:
 * the body runs as the build's own strict-mode async arrow, so a top-level
 * `return` exits the way the build lets it and a silent write is the throw a
 * session would get; the context holds only the eleven names the sandbox
 * injects, so a script reaching for `process` fails here rather than in a
 * user's session; `Date.now`, `new Date()` and `Math.random` throw, so a script
 * the build would refuse cannot pass a test; and code generation is off, so
 * `eval` and `new Function` fail here as they fail there.
 */
import { createContext, runInContext } from "node:vm";
import { readFileSync } from "node:fs";

import { splitScript } from "../scripts/workflow-lint.mjs";

/** What the sandbox says when a script reaches for a clock or a coin, verbatim. */
const NO_CLOCK =
  "Date.now() / new Date() are unavailable in workflow scripts (breaks resume). Stamp results after the workflow returns, or pass timestamps via args.";
const NO_RANDOM =
  "Math.random() is unavailable in workflow scripts (breaks resume). For N independent samples, include the index in the agent label or prompt.";

/**
 * Runs one workflow script against fake agents.
 *
 * `onAgent(prompt, opts, index)` stands in for every spawn: answer with what
 * that stage should return, or null for a stage that died. The default answers
 * a marker object, which is enough for cases about control flow and useless for
 * cases about content, on purpose.
 */
export async function runWorkflow(path, { args, onAgent, onWorkflow } = {}) {
  const { meta, body } = splitScript(readFileSync(path, "utf8"));

  const calls = [];
  const logs = [];
  const phases = [];
  let current = null;

  const agent = async (prompt, opts = {}) => {
    const at = calls.length;
    calls.push({ prompt: String(prompt), opts: here(opts ?? {}), phase: opts?.phase ?? current });
    const answer = onAgent ? await onAgent(String(prompt), opts ?? {}, at) : { agent: at };
    return answer === undefined ? { agent: at } : answer;
  };

  // The two collection helpers, as the real ones behave rather than as they
  // read: a harness that is kinder than the thing it stands in for passes a
  // script the session would break.
  const parallel = (thunks) => {
    // The real one takes thunks and calls them. Handed promises it raises a
    // TypeError, so a harness that accepted them would pass a script that
    // cannot run.
    for (const thunk of thunks) {
      if (typeof thunk !== "function") throw new TypeError("parallel() takes an array of functions returning promises");
    }
    return Promise.all([...thunks].map((thunk) => Promise.resolve().then(thunk).catch(() => null)));
  };
  const pipeline = (items, ...stages) =>
    Promise.all(
      [...items].map(async (item, index) => {
        let value = item;
        for (const stage of stages) {
          try {
            value = await stage(value, item, index);
          } catch {
            return null;
          }
          // A stage that yields null drops the item and skips the rest of its
          // chain. Running the later stages on a null is the harness being
          // kinder than the build, and it hides a stage that cannot take one.
          if (value === null) return null;
        }
        return value;
      }),
    );

  // `codeGeneration` off, the way the build creates it: `eval` and
  // `new Function` throw an EvalError in a session, and a harness that allowed
  // them would pass a script no session can run. The lint reads free
  // identifiers, so every member-access route to them is out of its reach and
  // only the context can close it.
  const context = createContext(
    {
      __proto__: null,
      agent,
      parallel,
      pipeline,
      workflow: async (name, inner) => (onWorkflow ? onWorkflow(name, inner) : null),
      phase: (title) => {
        current = String(title);
        phases.push(current);
      },
      log: (message) => logs.push(String(message)),
      // Crossed as JSON, the way the build crosses it, so a case cannot hand a
      // script a live object the real thing would have flattened.
      args: args === undefined ? undefined : JSON.parse(JSON.stringify(args)),
      budget: Object.freeze({ __proto__: null, total: null, spent: () => 0, remaining: () => Infinity }),
      console: { log: (...parts) => logs.push(parts.join(" ")), error: () => {}, warn: () => {}, info: () => {} },
      setTimeout,
      clearTimeout,
    },
    { codeGeneration: { strings: false, wasm: false } },
  );

  // The build's own shim, statement for statement, because a paraphrase of it
  // is a second answer to what the sandbox forbids. It runs as an IIFE, so
  // `RealDate` and `ShimDate` are not two extra names in a context whose whole
  // claim is that it holds eleven; `ShimDate.now` is the throwing function
  // rather than absent, so a script guarding with `typeof Date.now` takes the
  // same branch here as in a session; and the frozen `RealDate` with its
  // constructor pointed at the shim closes the `new Date(0).constructor` route
  // back to a live clock.
  runInContext(
    `(() => {
       const NOW_ERR = ${JSON.stringify(NO_CLOCK)};
       const RANDOM_ERR = ${JSON.stringify(NO_RANDOM)};
       Math.random = function random() { throw new Error(RANDOM_ERR) };
       const RealDate = Date;
       RealDate.now = function now() { throw new Error(NOW_ERR) };
       function ShimDate(...a) {
         if (!new.target) throw new Error(NOW_ERR);
         if (a.length === 0) throw new Error(NOW_ERR);
         return Reflect.construct(RealDate, a, new.target);
       }
       ShimDate.now = RealDate.now;
       ShimDate.parse = RealDate.parse;
       ShimDate.UTC = RealDate.UTC;
       ShimDate.prototype = RealDate.prototype;
       RealDate.prototype.constructor = ShimDate;
       Object.freeze(RealDate);
       globalThis.Date = ShimDate;
     })()`,
    context,
  );

  // The build hardens the same context straight after the shim, and what it
  // deletes is the other half of what the lint's allowlist may not hold: a
  // script reaching for `WeakRef` compiles in a bare realm and throws in a
  // session. The JSC shell globals it also deletes are not in this realm to
  // begin with.
  runInContext(
    `for (const name of ['ShadowRealm', 'WebAssembly', 'FinalizationRegistry', 'WeakRef',
                         'Atomics', 'SharedArrayBuffer', 'queueMicrotask']) delete globalThis[name];`,
    context,
  );

  // Wrapped the way the build wraps it, character for character: a strict-mode
  // async arrow. A function body makes a top-level `return` an early exit
  // rather than a syntax error, and strict is what makes a write to a frozen
  // `budget` throw here the way it throws in a session instead of passing
  // silently.
  const result = await runInContext(`(async () => {'use strict';\n${body}\n})()`, context);

  return { meta, result: here(result), calls, logs, phases };
}

/**
 * A value the script made, brought into this realm.
 *
 * A `vm` context has its own `Array` and `Object`, so an array a script returns
 * is structurally an array and fails `deepStrictEqual` against one written
 * here, with "same structure but not reference-equal" and nothing pointing at
 * the realm. Round-tripped rather than compared loosely, because that is what
 * actually happens to a workflow's answer: it leaves the sandbox as the tool's
 * JSON result, so a field that does not survive JSON does not reach the model
 * either, and a case asserting on one would be testing something no session
 * sees.
 */
function here(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    // A cycle, or a value JSON will not carry. The tool could not return it
    // either, so the case should see what it is rather than a crash here.
    return value;
  }
}

/** Every call a run made under one phase, in the order they were made. */
export const callsIn = (run, phase) => run.calls.filter((call) => call.phase === phase);
