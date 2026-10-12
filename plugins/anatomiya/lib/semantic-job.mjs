/**
 * The checker's job, in process: one program over the whole corpus, and
 * per-file hits and resolution handed to `send` as they come.
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
import { SEMANTIC_DIMENSIONS, siteStubs } from "./dimensions-semantic.mjs";
import { crossing } from "./walk.mjs";

/**
 * Run one job and report through `send`: `{ error }` and nothing after it,
 * or `{ built, config }`, then two passes over the files the program holds
 * and `{ done }`. The first pass answers `{ rel, hits: {}, resolution, sites }`
 * per file, `sites` being the stubs `siteStubs` reads off the tree, and ends
 * with `{ sited }`: the rate and where each row has a site are all a reader
 * needs to know the tier is degraded. The second walks the rows and answers
 * `{ rel, hits, resolution }` again, with what the checker counted. Under a
 * refused config there is one pass, its `hits` the stubs. The rate is summed by
 * the reader, which is the side that knows which files a claim is counted over.
 *
 * `stopped` is asked before each file of the second pass: a reader that took
 * the tier for degraded keeps none of its rows, so once it answers true the
 * job says `{ done }` with the rest unwalked.
 *
 * Every failure is one message on the channel rather than a dead one: the
 * parent reads a channel that closes with nothing said as a crash.
 */
export async function runJob(job, send, { load = loadTypeScript, stopped = () => false } = {}) {
  try {
    const loaded = await load();
    if (!loaded) return send({ error: "typescript is not installed" });
    const { ts } = loaded;

    const config = readConfig(ts, job.root);
    // The scan hands this job every js and jsx file and law_of_demeter's
    // denominator counts them all, but without allowJs the program never held
    // a .js file: six .ts beside six .js measured applicability 6 over a
    // langFileCount of 12, so the row read as narrow over files it never saw.
    // Held rather than checked: checkJs off, so a .js file lends its types and
    // is never charged a diagnostic. `maxNodeModuleJsDepth` stays at its 0, so
    // a dependency's JavaScript is still not read.
    const options = { ...config.options, allowJs: true, checkJs: false };
    const host = confinedCompilerHost(ts, job.root, options);
    const rootNames = job.files.map((f) => f.abs);
    const program = ts.createProgram({ rootNames, options, host });
    const checker = program.getTypeChecker();

    send({ built: true, config: { status: config.status, reason: config.reason } });

    // A refused config degrades the tier whatever resolves, and a degraded
    // tier keeps no type-checked row: where a row has a site is all the scan
    // reads, so the stubs are the answer and the checker is not asked.
    const refused = config.status === "degraded";
    const held = [];
    for (const file of job.files) {
      const source = program.getSourceFile(file.abs);
      if (!source) continue;
      const resolution = measureResolution(ts, program, checker, [file]);
      const sites = siteStubs(ts, source);
      send(refused ? { rel: file.rel, hits: sites, resolution } : { rel: file.rel, hits: {}, resolution, sites });
      held.push({ file, source, resolution });
    }

    if (!refused) {
      send({ sited: true });
      for (const { file, source, resolution } of held) {
        // A stop comes down the channel, which is read on a turn of the loop.
        await new Promise(setImmediate);
        if (stopped()) break;
        const hits = {};
        for (const dim of SEMANTIC_DIMENSIONS) {
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
        send({ rel: file.rel, hits, resolution });
      }
    }

    send({ done: true });
  } catch (err) {
    send({ error: String(err?.message ?? err) });
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
