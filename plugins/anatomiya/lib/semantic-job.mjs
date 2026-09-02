/**
 * The checker's job, in process: one program over the whole corpus, the
 * resolution measured before any file is answered, and per-file hits handed
 * to `send` as they come.
 *
 * Whole-program is the shape of the tool rather than a choice: narrowing the
 * file set was measured saving 3% of the time and driving unresolved types from
 * 3.1% to 36.2%, which is the number the whole tier exists to keep high. So one
 * program, one pass, and no tree in the channel.
 *
 * Here rather than in the worker so the function the whole degraded verdict
 * rests on can be reached without forking a real typescript program. The
 * worker is the shell around this, the same split the parse side makes (B22).
 */
import { loadTypeScript } from "./semantic.mjs";
import { readConfig, confinedCompilerHost } from "./tsconfig.mjs";
import { SEMANTIC_DIMENSIONS } from "./dimensions-semantic.mjs";
import { crossing } from "./walk.mjs";

/**
 * Run one job and report through `send`: `{ error }` and nothing after it,
 * or `{ built, resolution, config }`, then `{ rel, hits }` per file the
 * program holds, then `{ done }`.
 *
 * Every failure is one message on the channel rather than a dead one: the
 * parent reads a channel that closes with nothing said as a crash.
 */
export async function runJob(job, send, { load = loadTypeScript } = {}) {
  try {
    const loaded = await load();
    if (!loaded) return send({ error: "typescript is not installed" });
    const { ts } = loaded;

    const config = readConfig(ts, job.root);
    const host = confinedCompilerHost(ts, job.root, config.options);
    const rootNames = job.files.map((f) => f.abs);
    const program = ts.createProgram({ rootNames, options: config.options, host });
    const checker = program.getTypeChecker();

    const resolution = measureResolution(ts, program, checker, job.files);
    send({ built: true, resolution, config: { status: config.status, reason: config.reason } });

    const dims = SEMANTIC_DIMENSIONS.filter((d) => !job.keys || job.keys.includes(d.key));
    for (const file of job.files) {
      const source = program.getSourceFile(file.abs);
      if (!source) continue;
      const hits = {};
      for (const dim of dims) {
        const out = [];
        try {
          dim.run({ ts, checker, source }, (h) => out.push(crossing(h)));
        } catch {
          // A dimension that threw drops its own key for this file and leaves
          // the rest standing, the same rule the syntactic worker follows.
          continue;
        }
        if (out.length) hits[dim.key] = out;
      }
      send({ rel: file.rel, hits });
    }

    send({ done: true });
  } catch (err) {
    send({ error: String(err && err.message ? err.message : err) });
  }
}

/**
 * How much of this corpus the checker could actually resolve.
 *
 * A broken tsconfig does not fail: it drops typed resolution from 89.5% to
 * 39.8% and says nothing, and every claim built on the checker is then counted
 * over types it did not have. Property accesses are the population because they
 * are what the semantic dimensions read.
 */
export function measureResolution(ts, program, checker, files) {
  let resolved = 0;
  let total = 0;
  for (const file of files) {
    const source = program.getSourceFile(file.abs);
    if (!source) continue;
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node)) {
        total++;
        const type = checker.getTypeAtLocation(node.expression);
        const flags = type ? type.flags : 0;
        const isAny = (flags & ts.TypeFlags.Any) !== 0;
        const isUnknownOrError = (flags & ts.TypeFlags.Unknown) !== 0;
        if (type && !isAny && !isUnknownOrError) resolved++;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { resolved, total };
}
