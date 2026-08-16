/**
 * The checker, in one child process, for the whole corpus at once.
 *
 * Whole-program is the shape of the tool rather than a choice: narrowing the
 * file set was measured saving 3% of the time and driving unresolved types from
 * 3.1% to 36.2%, which is the number the whole tier exists to keep high. So one
 * program, one pass, per-file hits back over IPC and no tree in the channel.
 *
 * A separate process because the run was measured at 880 MB resident, and
 * because a parent that has to stay responsive should not host it.
 */
import { loadTypeScript } from "./semantic.mjs";
import { readConfig, confinedCompilerHost } from "./tsconfig.mjs";
import { SEMANTIC_DIMENSIONS } from "./dimensions-semantic.mjs";

process.on("message", async (job) => {
  try {
    const loaded = await loadTypeScript();
    if (!loaded) return process.send({ error: "typescript is not installed" });
    const { ts } = loaded;

    const config = readConfig(ts, job.root);
    const host = confinedCompilerHost(ts, job.root, config.options);
    const rootNames = job.files.map((f) => f.abs);
    const program = ts.createProgram({ rootNames, options: config.options, host });
    const checker = program.getTypeChecker();

    const resolution = measureResolution(ts, program, checker, job.files);
    process.send({ built: true, resolution, config: { status: config.status, reason: config.reason } });

    const dims = SEMANTIC_DIMENSIONS.filter((d) => !job.keys || job.keys.includes(d.key));
    for (const file of job.files) {
      const source = program.getSourceFile(file.abs);
      if (!source) continue;
      const hits = {};
      for (const dim of dims) {
        const out = [];
        try {
          dim.run({ ts, checker, source }, (h) => out.push({ conforming: !!h.conforming, where: h.where ?? null }));
        } catch {
          // A dimension that threw drops its own key for this file and leaves
          // the rest standing, the same rule the syntactic worker follows.
          continue;
        }
        if (out.length) hits[dim.key] = out;
      }
      process.send({ rel: file.rel, hits });
    }

    process.send({ done: true });
  } catch (err) {
    process.send({ error: String(err && err.message ? err.message : err) });
  }
});

/**
 * How much of this corpus the checker could actually resolve.
 *
 * A broken tsconfig does not fail: it drops typed resolution from 89.5% to
 * 39.8% and says nothing, and every claim built on the checker is then counted
 * over types it did not have. Property accesses are the population because they
 * are what the semantic dimensions read.
 */
function measureResolution(ts, program, checker, files) {
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

process.send({ ready: true });
