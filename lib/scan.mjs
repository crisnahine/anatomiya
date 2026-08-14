import { collect, gitRoot, countUntrackedSource, frameworksIn } from "./corpus.mjs";
import { discover, areaFloor, areaCeiling } from "./areas.mjs";
import { createPool } from "./pool.mjs";
import { reduceArea, applyGates } from "./reduce.mjs";
import { applyPairings } from "./pairing.mjs";
import { authorsByFile } from "./authors.mjs";
import { parseRuby } from "./ruby.mjs";
import { dimensionsFor } from "./dimensions.mjs";
import { resolveBaseline, baselinePopulation, baselineStates, materialize, changedSinceWorktree, loadPin, filesAt } from "./baseline.mjs";

/**
 * One whole-corpus pass, attributed to areas in the reducer.
 *
 * Scanning per area was measured costing 3 to 4.4x for nothing: the reducer
 * already owns the file-to-area mapping, and splitting the corpus into small
 * invocations throws away the parallelism.
 *
 * `rubyGuards` overrides the Ruby parser's limits. It exists because the
 * whole-map suppression a partial corpus triggers has exactly one reachable
 * cause now that no repository size truncates anything, and leaving the path
 * that silences every directive untested was the worse trade.
 */
export async function scan(cwd, { onProgress = () => {}, baseRef = null, rubyGuards = null } = {}) {
  const started = Date.now();
  const root = await gitRoot(cwd);

  const { files, truncated: corpusTruncated, dropped } = await collect(root);
  // An empty corpus with source on disk is a repository whose first commit has
  // not landed, not a repository with nothing in it. Which of the two it is
  // changes what every line below means, so it is asked before anything else.
  const untracked = files.length === 0 ? await countUntrackedSource(root) : 0;
  onProgress({ stage: "corpus", files: files.length });

  // The layout comes from the corpus the pin was built over where there is one.
  // The floor is a step function of the corpus size, so deriving it from today's
  // file count re-partitions the repository on one added file and every area
  // then reads as a population change against a pin that knew the old layout.
  const pin = loadPin(root);
  const layout = Number.isFinite(pin?.corpus) ? pin.corpus : files.length;
  const areas = discover(files, { minFiles: areaFloor(layout), maxAreas: areaCeiling(layout) });
  onProgress({ stage: "areas", areas: areas.length });

  // A claim that belongs to a framework cannot be judged without knowing the
  // repository uses it, and one file never says. Read from the corpus, so a
  // fixture cannot make a repository look like a Rails application.
  const frameworks = [...frameworksIn(files)];

  const head = await parseFiles(files, { rubyGuards, frameworks });
  // An obligation is answered by the corpus, not by a tree, so it is merged in
  // after the parse rather than counted inside the worker.
  applyPairings(head.parsed, new Set(files.map((f) => f.rel)), langsIn(files));
  const truncated = corpusTruncated || head.truncated;
  onProgress({
    stage: "parse",
    parsed: head.parsed.size,
    crashed: head.crashed,
    skipped: head.skipped,
  });

  const authors = await authorsByFile(root);
  onProgress({ stage: "authors", files: authors.size });
  // Unread history and empty history both give every file zero authors, which
  // fails the author gate on every dimension. Only one of them is a real answer.
  const authorsError = authors.error ?? null;
  const historyRead = !authorsError;
  // Read at HEAD and never at the pin: it answers whether this repository has
  // more than one person in it now, not how many it had when it was pinned.
  const repoAuthors = historyRead ? repoAuthorCount(files, authors) : null;

  const state = await resolveBaseline(root, { pin, baseRef });
  const populations = new Map();
  if (!state.countsOnly) {
    for (const area of areas) populations.set(area.id, baselinePopulation(state, area));
  }
  const measured = await measureBaseline(root, state, areas, populations, head.parsed, rubyGuards, frameworks);
  onProgress({ stage: "baseline", status: state.status, areas: measured.size });

  const out = [];
  for (const area of areas) {
    const areaParsed = area.files.map((f) => head.parsed.get(f.rel)).filter(Boolean);
    if (areaParsed.length === 0) continue;

    const dims = reduceArea(area, areaParsed, { frameworks });
    if (dims.length === 0) continue;

    const population = populations.get(area.id) || null;
    const baseline = measured.get(area.id) || null;
    const current = { fileCount: area.fileCount, dirCount: dirCount(area.files.map((f) => f.rel)) };
    // The pinned file list, its directory spread and the map back to today's
    // paths, so a gate that reads the baseline reads all of it and not just the
    // counts.
    const pinned = baseline && !baseline.gate
      ? {
          fileCount: population.files.length,
          dirCount: dirCount(population.files.map((f) => f.rel)),
          toCurrent: new Map(population.files.map((f) => [f.rel, f.currentRel ?? f.rel])),
        }
      : null;

    const gated = dims.map((d) => {
      const baselineDim = pinned ? baseline.dims.find((b) => b.key === d.key) || null : null;
      // Every gate reads the baseline population where there is one (D6). The
      // current counts print beside it but decide nothing: an agent that adds
      // conforming sites would otherwise raise the bar it is judged against.
      const source = baselineDim || d;
      const scope = baselineDim ? pinned : current;
      const who = authorCount(source.files, authors, baselineDim ? pinned.toCurrent : null);
      const g = applyGates(source, {
        authors: who,
        repoAuthors,
        historyRead,
        areaFileCount: scope.fileCount,
        areaDirCount: scope.dirCount,
      });
      // A capped corpus answered for part of the repository, and a ratio over
      // an arbitrary subset rendered as a convention is worse than counts (F7).
      // Suppressed here rather than at render time, so the facts store and the
      // rendered map agree on what was stated.
      const blocked = truncated ? "corpus-truncated" : suppression(state, population, baseline, baselineDim);

      return {
        ...d,
        ...g,
        // Blocking has to close both sides. Forcing `directive` alone leaves a
        // greenfield or unreachable-baseline area stating its inverse, which is
        // the same directive from a population nobody accepted (D6, E3, E4).
        states: blocked ? null : g.states,
        directive: blocked ? false : g.directive,
        gate: blocked || g.gate,
        counterGate: blocked || g.counterGate,
        authors: who,
        baseline: baselineDim
          ? {
              candidates: baselineDim.candidates,
              conforming: baselineDim.conforming,
              exceptions: baselineDim.exceptions,
              // The check exempts a file the map already named. On the counter
              // side that list is the flipped one, and reusing the positive one
              // exempts the files that never broke the stated sentence.
              ...(baselineDim.counterExceptions
                ? { counterExceptions: baselineDim.counterExceptions }
                : {}),
            }
          : null,
      };
    });

    out.push({
      id: area.id,
      path: area.path,
      globs: area.globs,
      fileCount: area.fileCount,
      baseline: population
        ? { status: population.status, files: population.files.length, missing: population.missing.length }
        : { status: state.status, files: 0, missing: 0 },
      dimensions: gated,
    });
  }

  return {
    root,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    // `orphaned` is the files discovery found nowhere to put. The rest of the
    // uncovered count is files whose area was discovered and then dropped for
    // counting nothing, which is a different fact with a different fix.
    corpus: { files: files.length, untracked, truncated, dropped, orphaned: areas.orphaned.length, frameworks },
    authors: { files: authors.size, error: authorsError, repo: repoAuthors },
    parse: {
      parsed: head.parsed.size,
      crashed: head.crashed,
      skipped: head.skipped,
      failed: head.failed,
      syntaxErrors: head.syntaxErrors,
      missingParser: head.missingParser,
      unreadable: unreadableLangs(files, head.parsed),
    },
    baseline: {
      status: state.status,
      sha: state.sha,
      countsOnly: state.countsOnly,
      baseRef: state.baseRef,
      baseRefReason: state.baseRefReason,
      drift: state.drift ? state.drift.total : null,
    },
    // A truncated corpus suppresses every directive: counting over an
    // arbitrary subset and rendering it like a complete scan is worse than
    // reporting nothing.
    suppressAll: truncated,
    areas: out,
  };
}

const langsIn = (files) => [...new Set(files.map((f) => f.lang))];

/**
 * Parse a file set, oxc in a pool of child processes and prism in one streamed
 * subprocess. Used for the corpus and again for the baseline blobs, which reach
 * the parser as ordinary files on disk.
 */
async function parseFiles(files, { rubyGuards = null, frameworks } = {}) {
  const parsed = new Map();
  let crashed = 0;
  let syntaxErrors = 0;
  let skipped = 0;
  let failed = 0;
  let missingParser = null;
  let truncated = false;

  const take = (r) => {
    if (r.crashed) crashed++;
    if (r.skipped) skipped++;
    // A file that answered `ok: false` without dying was counted as parsed,
    // so a repository where nothing parsed reported a clean empty map. The
    // parser answering "this is not valid syntax" is a different fact from a
    // file it could not read at all, and the reader's next move differs: one is
    // the repository's own code, the other is this tool or the filesystem.
    if (!r.ok && !r.crashed && !r.skipped) {
      if (r.errors) syntaxErrors++;
      else failed++;
    }
    // An absent parser is every file at once. Reported as an install problem
    // rather than as a repository with no conventions in it.
    if (r.missingParser && !missingParser) missingParser = r.error;
    parsed.set(r.rel, r);
  };

  const js = files.filter((f) => f.lang !== "ruby");
  const ruby = files.filter((f) => f.lang === "ruby");

  if (js.length) {
    const pool = createPool();
    try {
      for (const r of await Promise.all(js.map((f) => pool.parse(f)))) take(r);
    } finally {
      await pool.close();
    }
  }
  // prism is safe in-process and needs no pool, unlike oxc.
  if (ruby.length) {
    const out = await parseRuby(ruby, {
      dimensions: dimensionsFor(["ruby"], { frameworks }),
      ...(rubyGuards ? { guards: rubyGuards } : {}),
    });
    for (const r of out.results) take(r);
    // A Ruby run that hit its output or line cap answered for part of the
    // corpus, which is the same condition the file cap describes and carries
    // the same suppression (F7).
    truncated = truncated || out.truncated;
  }

  return { parsed, crashed, skipped, failed, syntaxErrors, missingParser, truncated };
}

/**
 * The baseline counts per area, read from the pinned file list at the pinned
 * commit (E1, E2).
 *
 * One materialisation and one parser pool for the whole repository: an area at
 * a time would fork a pool per area, which is the cost the single-pass corpus
 * scan exists to avoid.
 */
async function measureBaseline(root, state, areas, populations, headParsed, rubyGuards, frameworks) {
  const out = new Map();
  if (state.countsOnly) return out;

  const wanted = new Map();
  for (const area of areas) {
    const population = populations.get(area.id);
    if (!population || !population.directive) continue;
    for (const f of population.files) if (!wanted.has(f.rel)) wanted.set(f.rel, f);
  }
  if (wanted.size === 0) return out;

  const { parsed, stale } = reuseUnchanged(await changedSinceWorktree(root, state.sha), wanted, headParsed);

  let blobs = null;
  try {
    if (stale.length) {
      blobs = await materialize(root, state.sha, stale);
      for (const [rel, r] of (await parseFiles(blobs.files, { rubyGuards, frameworks })).parsed) parsed.set(rel, r);
    }

    // Against the pinned file list, never the working tree's. A branch that
    // deletes a companion changes the answer without touching the producer, and
    // the producer's bytes being unchanged is exactly why its corpus record was
    // reused here.
    applyPairings(parsed, await filesAt(root, state.sha), langsIn(areas.flatMap((a) => a.files)));

    for (const area of areas) {
      const population = populations.get(area.id);
      if (!population || !population.directive) continue;

      const usable = [];
      let unread = 0;
      for (const f of population.files) {
        const p = parsed.get(f.rel);
        if (p && p.ok && p.hits) usable.push(p);
        else unread++;
      }

      // A baseline file that would not come back or would not parse hides its
      // sites, and the sites it hides are the violating ones as often as the
      // conforming ones. That is a population this cannot count, handled like
      // any other population change: report and suppress.
      out.set(
        area.id,
        unread ? { gate: "population-change", dims: [] } : { gate: null, dims: reduceArea(area, usable, { frameworks }) }
      );
    }
  } finally {
    blobs?.dispose();
  }
  return out;
}

/**
 * Split the baseline population into what the corpus pass already answered and
 * what still has to be read out of the pinned commit.
 *
 * A file absent from `changed` has the same bytes in the working tree as at the
 * pinned sha, so the corpus already parsed exactly the content the baseline
 * asks about. Re-reading it costs one `git cat-file` process per file: measured
 * at 6.9s against 1.4s to parse the whole corpus, on a repository where nothing
 * had changed.
 *
 * Reuse needs three things to hold, and anything short of all three
 * materialises instead: git answered at all, the path is not in the changed
 * set, and the path is the same on both sides, since a rename makes the
 * corpus entry a different file's parse.
 */
function reuseUnchanged(changed, wanted, headParsed) {
  const parsed = new Map();
  const stale = [];

  for (const f of wanted.values()) {
    const same = changed && !changed.has(f.rel) && (f.currentRel ?? f.rel) === f.rel;
    const hit = same && headParsed ? headParsed.get(f.rel) : null;
    if (hit && hit.ok) parsed.set(f.rel, hit);
    else stale.push(f);
  }

  return { parsed, stale };
}

/**
 * Which condition, if any, stops this dimension stating a directive, before the
 * gates are consulted at all.
 *
 * An unreachable pin drops the whole scan to counts (E3). No pin at all is a
 * repository nobody has accepted a baseline for yet: the gates read the current
 * population, and with no baseline recorded the check phase cannot raise any
 * finding above FIX.
 */
function suppression(state, population, baseline, baselineDim) {
  if (state.status === "unreachable") return "unreachable";
  if (state.countsOnly) return null;
  if (!population) return state.status;
  if (baseline && baseline.gate) return baseline.gate;
  const allowed = baselineStates(population, baselineDim);
  return allowed.directive ? null : allowed.gate;
}

// GitHub mints `[bot]` into the local part, and brackets are illegal in a real
// unquoted address, so this excludes nothing a person can be called.
const isPerson = (email) => !email.includes("[bot]");

/**
 * How many people could supply author evidence at all: the authors of the files
 * this tool counts over.
 *
 * Someone who has only ever touched documentation can never appear in a
 * dimension's author set, so counting them raises a bar they cannot help clear.
 * Measured: 15 emails in one repository's log against 13 who ever touched a
 * counted source file, 154 against 131 on another.
 */
export function repoAuthorCount(files, authors) {
  const who = new Set();
  for (const f of files) for (const a of authors.get(f.rel) || []) if (isPerson(a)) who.add(a);
  return who.size;
}

/** Distinct authors over the files carrying the counted sites (D4). */
function authorCount(files = [], authors, toCurrent) {
  const who = new Set();
  for (const rel of files) {
    const path = toCurrent ? toCurrent.get(rel) ?? rel : rel;
    // The same predicate on both sides, or one person plus a bot clears a bar
    // set from a population the bot was excluded from.
    for (const a of authors.get(path) || []) if (isPerson(a)) who.add(a);
  }
  return who.size;
}

function dirCount(paths) {
  return new Set(paths.map(dirOf)).size;
}

function dirOf(rel) {
  const i = rel.lastIndexOf("/");
  return i < 0 ? "." : rel.slice(0, i);
}

/**
 * Languages whose parser never ran, though the corpus holds files for it.
 *
 * The condition is a crash on every file, which is what a missing interpreter
 * looks like: `env -i PATH=/usr/bin:/bin` charges all 200 Ruby files as crashed
 * because the process cannot start. A blind run's areas all count nothing and
 * would otherwise be deleted as gone, so this is what stops a container without
 * ruby erasing a correct map.
 *
 * Not "no file came back ok". A syntax error also fails a file, and counting
 * that here was measured freezing a healthy repository's whole map: six good
 * .ts files and one broken .jsx, where jsx is its own language and that one
 * file is the whole population of it. The parser ran and answered; the answer
 * was that the file is broken, which is a fact about the repository and not a
 * reason to stop describing it.
 */
function unreadableLangs(files, parsed) {
  const total = new Map();
  const crashed = new Map();
  for (const f of files) {
    total.set(f.lang, (total.get(f.lang) || 0) + 1);
    const r = parsed.get(f.rel);
    if (r && r.crashed) crashed.set(f.lang, (crashed.get(f.lang) || 0) + 1);
  }
  return [...total.keys()].filter((lang) => crashed.get(lang) === total.get(lang)).sort();
}
