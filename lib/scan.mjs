import { collect, gitRoot, countUntrackedSource, frameworksIn, capabilitiesIn, langsIn } from "./corpus.mjs";
import { discover, areaFloor, areaCeiling, dirCount } from "./areas.mjs";
import { parseAll } from "./parse.mjs";
import { runSemantic } from "./semantic.mjs";
import { reduceArea, verdictFor } from "./reduce.mjs";
import { applyPairings } from "./pairing.mjs";
import { authorsByFile } from "./authors.mjs";
import { resolve as resolveBaseline, measure as measureBaseline } from "./baseline.mjs";

/**
 * One whole-corpus pass, attributed to areas in the reducer.
 *
 * Scanning per area was measured costing 3 to 4.4x for nothing: the reducer
 * already owns the file-to-area mapping, and splitting the corpus into small
 * invocations throws away the parallelism.
 *
 * `rubyGuards` overrides the Ruby parser's limits. It is the one end-to-end
 * reach for F7: no repository size truncates a corpus any more, so the Ruby
 * per-line guard is the only cause left, and leaving the path that silences
 * every directive untested was the worse trade. What the block then does to a
 * slot is asked of `verdictFor` directly, which is why this is one test and not
 * the way that branch is covered.
 */
export async function scan(cwd, { onProgress = () => {}, baseRef = null, rubyGuards = null, deep = false } = {}) {
  const started = Date.now();
  const root = await gitRoot(cwd);

  const { files, truncated: corpusTruncated, dropped } = await collect(root);
  // An empty corpus with source on disk is a repository whose first commit has
  // not landed, not a repository with nothing in it. Which of the two it is
  // changes what every line below means, so it is asked before anything else.
  const untracked = files.length === 0 ? await countUntrackedSource(root) : 0;
  onProgress({ stage: "corpus", files: files.length });

  const state = await resolveBaseline(root, { baseRef });
  // The layout comes from the corpus the pin was built over where there is one.
  // The floor is a step function of the corpus size, so deriving it from today's
  // file count re-partitions the repository on one added file and every area
  // then reads as a population change against a pin that knew the old layout.
  const layout = state.layout ?? files.length;
  const areas = discover(files, { minFiles: areaFloor(layout), maxAreas: areaCeiling(layout) });
  onProgress({ stage: "areas", areas: areas.length });

  // A claim that belongs to a framework cannot be judged without knowing the
  // repository uses it, and one file never says. Read from the corpus, so a
  // fixture cannot make a repository look like a Rails application.
  const frameworks = [...frameworksIn(files)];
  // Which routing claims this repository can be asked at all, from the corpus
  // the same way the framework signal is (C8).
  const capabilities = capabilitiesIn(files);

  const head = await parseAll(files, { rubyGuards, frameworks });

  // The second tier, opt-in and never the default (B7). It runs once for the
  // whole corpus, because narrowing the file set was measured saving 3% and
  // driving unresolved types from 3.1% to 36.2%.
  const semantic = deep ? await runSemantic(root, files.filter((f) => f.lang !== "ruby")) : null;
  if (semantic) mergeSemanticHits(head.records, semantic.records);
  // An obligation is answered by the corpus, not by a tree, so it is merged in
  // after the parse rather than counted inside the worker.
  applyPairings(head.records, new Set(files.map((f) => f.rel)), langsIn(files));
  const headTruncated = corpusTruncated || head.truncated;
  onProgress({
    stage: "parse",
    parsed: head.records.size,
    crashed: head.tallies.crashed,
    skipped: head.tallies.oversize,
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

  // The parser and the reducer go in as closures over this scan's settings, so
  // the baseline module measures without knowing what a framework or a Ruby
  // guard is.
  const measured = await measureBaseline(root, state, areas, {
    headParsed: head.records,
    parse: (blobs) => parseAll(blobs, { rubyGuards, frameworks }),
    reduce: (area, usable) => reduceArea(area, usable, { frameworks, capabilities }),
  });
  onProgress({ stage: "baseline", status: state.status, areas: measured.size });
  // Either corpus read answering for only part of what it was asked suppresses
  // every directive (F7). The baseline is the second read, over blobs from the
  // pinned commit, and it can hit the same per-line guard the first one can.
  const truncated = headTruncated || measured.truncated;

  const out = [];
  for (const area of areas) {
    const areaParsed = area.files.map((f) => head.records.get(f.rel)).filter(Boolean);
    if (areaParsed.length === 0) continue;

    const dims = reduceArea(area, areaParsed, { frameworks, capabilities, tier: deep ? "all" : "syntactic" });
    if (dims.length === 0) continue;

    // `measure` writes a record for every area it was handed, so a miss is a
    // caller measuring one list and reading another. Said out loud, because the
    // four reads below would otherwise fail as `Cannot read properties of
    // undefined` partway through a scan.
    const measuredArea = measured.get(area.id);
    if (!measuredArea) throw new Error(`no baseline record for area ${area.path}, so its gates read nothing`);
    const current = { fileCount: area.fileCount, dirCount: dirCount(area.files.map((f) => f.rel)) };

    const gated = dims.map((d) => {
      const baselineDim = measuredArea.dims.find((b) => b.key === d.key) || null;
      return verdictFor(d, {
        baselineDim,
        current,
        authors: authorCount((baselineDim || d).files, authors, baselineDim ? measuredArea.pinned.toCurrent : null),
        repoAuthors,
        historyRead,
        measured: measuredArea,
        truncated,
        // A tier that answered badly closes its own dimensions and nothing
        // else. Without this the record said degraded and the map stated the
        // claims anyway (B8).
        semantic,
      });
    });

    out.push({
      id: area.id,
      path: area.path,
      globs: area.globs,
      fileCount: area.fileCount,
      baseline: measuredArea.population,
      dimensions: gated,
    });
  }

  return {
    root,
    // Whether the checker ran, and how it went. Absent is not the same as
    // clean: a reader has to be able to tell a scan that never asked from one
    // that asked and got a bad answer (B8).
    semantic: semantic
      ? {
          ran: true,
          status: semantic.status,
          reason: semantic.reason,
          typedResolutionRate: semantic.typedResolutionRate,
        }
      : { ran: false, status: null, reason: null, typedResolutionRate: null },
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    // `orphaned` is the files discovery found nowhere to put. The rest of the
    // uncovered count is files whose area was discovered and then dropped for
    // counting nothing, which is a different fact with a different fix.
    corpus: {
      files: files.length,
      untracked,
      truncated,
      dropped,
      orphaned: areas.orphaned.length,
      frameworks,
      // Stored so the check can answer the offering question without reading
      // the corpus again, the same reason frameworks is.
      capabilities: [...capabilities],
    },
    authors: { files: authors.size, error: authorsError, repo: repoAuthors },
    parse: {
      parsed: head.records.size,
      crashed: head.tallies.crashed,
      skipped: head.tallies.oversize,
      failed: head.tallies.unreadable,
      syntaxErrors: head.tallies.rejected,
      missingParser: head.missingParser,
      missingStripper: head.missingStripper,
      unreadable: unreadableLangs(files, head.records),
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

/**
 * Fold the checker's hits into the records the reducer already reads.
 *
 * Merged rather than kept apart, because a slot is a dimension in an area and
 * which tier answered it is not the reducer's question. A file the checker
 * never saw keeps the hits it has: the two tiers answer different keys, so
 * neither can overwrite the other.
 */
function mergeSemanticHits(records, semanticRecords) {
  for (const [rel, r] of semanticRecords) {
    const existing = records.get(rel);
    if (!existing || !existing.ok) continue;
    existing.hits = { ...existing.hits, ...r.hits };
  }
}
