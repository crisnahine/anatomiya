import { collect, gitRoot, countUntrackedSource, frameworksIn, langsIn } from "./corpus.mjs";
import { embeddedIn, langHas } from "./langs.mjs";
import { discover, areaFloor, areaCeiling, dirCount } from "./areas.mjs";
import { adoptedCapabilities } from "./dimensions.mjs";
import { parseAll } from "./parse.mjs";
import { defaultPoolSize } from "./pool.mjs";
import { buildVersion } from "./readiness.mjs";
import { checkerBlocked, failuresIn, runSemantic, semanticOver, standsIn, verdictStamp } from "./semantic.mjs";
import { blockOf, reduceArea, verdictFor } from "./reduce.mjs";
import { applyPairings } from "./pairing.mjs";
import { authorsByFile, isPerson, repoAuthorCount } from "./authors.mjs";
import { resolve as resolveBaseline, measure as measureBaseline } from "./baseline.mjs";
import { roster } from "./layout-scan.mjs";
import { tally } from "./layout.mjs";
import { extOf, extOrName } from "./paths.mjs";
import { commonImports, mostImported } from "./siblings.mjs";

/**
 * What a repository-wide pool counts under.
 *
 * The sentence and the population it was measured over, not the row. A learned
 * row's `conforming` means a different thing per class, so "interfaces are
 * named with an I prefix" and "interfaces carry no prefix" are two populations
 * under one key and pooling them would lend each the other's confidence. The
 * kind is part of it for the same reason: a directory of helpers that happens
 * to learn the same class as the components would otherwise borrow a prior
 * built almost entirely from component directories.
 */
const poolKey = (d) => `${d.key}\u0000${d.learned ?? ""}\u0000${d.learnedKind ?? ""}`;

/**
 * One whole-corpus pass, attributed to areas in the reducer.
 *
 * Scanning per area was measured costing 3 to 4.4x for nothing: the reducer
 * already owns the file-to-area mapping, and splitting the corpus into small
 * invocations throws away the parallelism.
 *
 * `guards` is the per-language override bag `parseAll` takes, `{ ruby: ... }`.
 * It is the one end-to-end reach for F7: no repository size truncates a corpus
 * any more, so the Ruby per-line guard is the only cause left, and leaving the
 * path that silences every directive untested was the worse trade. What the
 * block then does to a slot is asked of `verdictFor` directly, which is why
 * this is one test and not the way that branch is covered. `runChecker` is the
 * seam that shows a failed scan stops the checker running beside it, and
 * `resolveState` and `parseFiles` the two that show the baseline and the parse
 * run side by side. `carried` is a degraded verdict measured by an earlier run
 * (`carriedVerdict`): where the checker could run it is not run, and the verdict
 * is recorded as carried. No type-checked row is counted then, since the counts
 * are the checker's, and none is kept from a run that measures the tier degraded.
 * A failed run's verdict is carried from its second failure under one stamp
 * (`standsIn`): handed the first, the checker runs and the scan records the count.
 */
export async function scan(cwd, { guards = null, runChecker = runSemantic, resolveState = resolveBaseline, parseFiles = parseAll, carried = null } = {}) {
  const started = Date.now();
  const scannedAt = new Date().toISOString();
  const root = await gitRoot(cwd);

  const { files, others, uncounted, truncated: corpusTruncated, dropped } = await collect(root);
  // An empty corpus with source on disk is a repository whose first commit has
  // not landed, not a repository with nothing in it. Which of the two it is
  // changes what every line below means, so it is asked before anything else.
  const untracked = files.length === 0 ? await countUntrackedSource(root) : 0;

  // The second tier, where the repository can use it (B7). It runs once for the
  // whole corpus, because narrowing the file set was measured saving 3% and
  // driving unresolved types from 3.1% to 36.2%. Its verdict is taken once the
  // fold below knows which areas the map describes.
  const checked = files.filter((f) => langHas(f.lang, "semantic"));
  const kept = carried !== null && standsIn(carried) ? carried : null;
  const stopChecker = new AbortController();
  const startChecker = async () => {
    const offReason = checked.length === 0 ? "no-checked-files" : await checkerBlocked(root, { checkedRels: checked.map((f) => f.rel) });
    if (offReason || kept !== null || stopChecker.signal.aborted) return { offReason, whole: null, measuredUnder: null };
    // Read before the checker starts, so a config edited under a long run is
    // not recorded as the one it measured, and only where it runs: a scan that
    // leaves the checker off reads no config.
    const measuredUnder = verdictStamp(root, buildVersion());
    return { offReason, whole: await runChecker(root, checked, { signal: stopChecker.signal }), measuredUnder };
  };
  // Neither needs the parse, so both start first; the checker only with a core
  // to spare, or it slows the parse's one worker. The catches are for a throw below.
  const semanticRun = defaultPoolSize() > 1 ? startChecker() : null;
  const authorsRun = authorsByFile(root);
  semanticRun?.catch(() => {});
  authorsRun.catch(() => {});

  // The baseline's git reads need nothing the parse makes, and the parse needs
  // only the files and the frameworks, so neither waits on the other.
  const stateRun = resolveState(root);
  stateRun.catch(() => {});

  let state, areas, frameworks, head, headRun;
  try {
    // A claim that belongs to a framework cannot be judged without knowing the
    // repository uses it, and one file never says. Read from the corpus, so a
    // fixture cannot make a repository look like a Rails application.
    frameworks = [...frameworksIn(files)];
    headRun = parseFiles(files, { guards, frameworks });
    headRun.catch(() => {});

    state = await stateRun;
    // The areas are partitioned over the corpus the pin was built over where
    // there is one. The floor is a step function of the corpus size, so deriving
    // it from today's file count re-partitions the repository on one added file
    // and every area then reads as a population change against a pin that knew
    // the old one.
    const partitionSize = state.partitionSize ?? files.length;
    areas = discover(files, {
      minFiles: areaFloor(partitionSize),
      maxAreas: areaCeiling(partitionSize),
      uncounted,
    });

    head = await headRun;
  } catch (err) {
    // Otherwise the process stays up until a checker nobody will read finishes.
    stopChecker.abort();
    // The parse has no such signal, so a baseline that failed waits for it
    // rather than leaving its workers running behind the error.
    await headRun?.catch(() => {});
    throw err;
  }
  const { offReason, whole, measuredUnder } = await (semanticRun ?? startChecker());
  // Which routing claims this repository can be asked at all: at least three
  // files already routing through a wrapper is what makes the habit real (C14).
  const capabilities = adoptedCapabilities(head.records);
  const tier = whole ? "all" : "syntactic";
  if (whole) mergeSemanticHits(head.records, whole.records);
  // An obligation is answered by the corpus, not by a tree, so it is merged in
  // after the parse rather than counted inside the worker.
  const corpusRels = new Set(files.map((f) => f.rel));
  applyPairings(head.records, corpusRels, langsIn(files));
  const headTruncated = corpusTruncated || head.truncated;

  const authors = await authorsRun;
  // Unread history and empty history both give every file zero authors, which
  // fails the author gate on every dimension. Only one of them is a real answer.
  const authorsError = authors.error ?? null;
  const historyRead = !authorsError;
  // A shallow clone's history *was* read; what it holds is a window nobody
  // chose. Kept apart from `historyRead` for that reason: conflating the two
  // would route every dimension to the history-unread gate and print the wrong
  // reason for it.
  const shallow = authors.shallow ?? null;
  // Read at HEAD and never at the pin: it answers whether this repository has
  // more than one person in it now, not how many it had when it was pinned.
  const repoAuthors = historyRead ? repoAuthorCount(files, authors) : null;

  // The parser and the reducer go in as closures over this scan's settings, so
  // the baseline module measures without knowing what a framework or a Ruby
  // guard is.
  const measured = await measureBaseline(root, state, areas, {
    headParsed: head.records,
    parse: (blobs) => parseFiles(blobs, { guards, frameworks }),
    // A file unchanged since the pin reuses its working-tree record, semantic
    // hits and all. One read back from the pin has none, so dropping it would let
    // an edit take a violation out of the baseline: an area holding one is not
    // baselined for type-checked rows at all.
    reduce: (area, usable, { moved = [] } = {}) =>
      reduceArea(area, usable, {
        frameworks,
        capabilities,
        tier: moved.some((f) => langHas(f.lang, "semantic")) ? "syntactic" : tier,
      }),
  });
  // Either corpus read answering for only part of what it was asked suppresses
  // every directive (F7). The baseline is the second read, over blobs from the
  // pinned commit, and it can hit the same per-line guard the first one can.
  const truncated = headTruncated || measured.truncated;

  // Which kinds of file live where, over every tracked path and not only the
  // parsed ones. It is a description of the tree as it is, so it is read at
  // HEAD and never from the pin.
  const { layout, kinds } = roster({ files, others, records: head.records, truncated });

  // A language this run read no file of is decided on its own, not for the
  // whole repository (B41). An area holding any file of it is held: this run
  // cannot say what that area holds, so the writer leaves its file as the last
  // run that could wrote it. Every other area is described as usual. A mixed
  // area is held rather than described from half its files, because
  // describing it would write over claims this run had no way to measure.
  const unreadable = unreadableLangs(files, head.records);
  const unanswered = unansweredFiles(files, head.records);
  const held = areas.filter((a) => a.langs.some((l) => unreadable.includes(l)));
  const heldIds = new Set(held.map((a) => a.id));

  // Three passes over the areas, because two answers need every area folded
  // first: which files the checker's rate is taken over, and how the whole
  // repository answers a dimension. The first folds, the second adds each
  // area's slots to that pool, the third asks the gates.
  //
  // The pool is a sum, so it does not depend on the order the areas were folded
  // in and two scans of unchanged source still agree (A5). What it does change
  // is that an area's map now depends on the rest of the repository, so
  // scanning a subtree answers differently from scanning the whole of it.
  const folded = [];
  for (const area of areas) {
    const areaParsed = area.files.map((f) => head.records.get(f.rel)).filter(Boolean);
    if (areaParsed.length === 0) continue;

    const dims = reduceArea(area, areaParsed, { frameworks, capabilities, tier });
    if (dims.length === 0) continue;

    // `measure` writes a record for every area it was handed, so a miss is a
    // caller measuring one list and reading another. Said out loud, because the
    // four reads below would otherwise fail as `Cannot read properties of
    // undefined` partway through a scan.
    const measuredArea = measured.get(area.id);
    if (!measuredArea) throw new Error(`no baseline record for area ${area.path}, so its gates read nothing`);

    folded.push({ area, areaParsed, dims, measuredArea });
  }

  // Over the files a claim is counted in: an area dropped above is one the map
  // says nothing was counted in, so its bundles may not close every other
  // area's type-checked rows either. When no folded file was checked, the files
  // in no area stand in, so root code below the floor is still measured whether
  // the areas beside it were folded or held.
  const inArea = new Set(areas.flatMap((a) => a.files.map((f) => f.rel)));
  const areaFiles = folded.flatMap(({ area }) => area.files.map((f) => f.rel));
  const counted = areaFiles.some((rel) => whole?.records.has(rel))
    ? areaFiles
    : files.map((f) => f.rel).filter((rel) => !inArea.has(rel));
  const semantic = semanticOver(whole, counted);
  // A checker that resolved too few types counted nothing to print, so its
  // rows leave the fold here, as they never enter it where the verdict is
  // carried: the two scans write the same map.
  const described =
    semantic?.status === "degraded"
      ? folded.map((f) => ({ ...f, dims: f.dims.filter((d) => d.tier !== "semantic") })).filter((f) => f.dims.length > 0)
      : folded;

  const pool = new Map();
  for (const { dims, measuredArea } of described) {
    for (const d of dims) {
      const baselineDim = measuredArea.dims.find((b) => b.key === d.key) || null;
      // Only slots nothing else has closed. A greenfield area's population is
      // the agent's own output, so lending it to a prior would let the agent
      // supply the confidence that states a claim about it (E4).
      if (blockOf(d, { baselineDim, measured: measuredArea, truncated, semantic })) continue;
      // The same object the gates read, so the leave-one-out subtraction in
      // `applyGates` is exact rather than approximately right.
      const source = baselineDim || d;
      const at = pool.get(poolKey(d));
      if (at) {
        at.candidates += source.candidates ?? 0;
        at.conforming += source.conforming ?? 0;
      } else {
        pool.set(poolKey(d), { candidates: source.candidates ?? 0, conforming: source.conforming ?? 0 });
      }
    }
  }

  // A held area is still folded into the pool above: the slots it could be
  // measured on are the languages that were read, which a run that read
  // everything counts the same way, so the priors every other area borrows do
  // not move with the machine the scan ran on.
  const out = [];
  for (const { area, areaParsed, dims, measuredArea } of described) {
    if (heldIds.has(area.id)) continue;
    // A language with no static import surface is asked neither question: an
    // empty roster there would read as a measured "imports nothing". Ruby
    // names its dependencies in a Gemfile and reaches them through `require`,
    // which is why its declaration answers no.
    const hasImports = area.langs.some((l) => langHas(l, "importGraph"));

    const current = { fileCount: area.fileCount, dirCount: dirCount(area.files.map((f) => f.rel)) };

    const gated = dims.map((d) => {
      const baselineDim = measuredArea.dims.find((b) => b.key === d.key) || null;
      const source = baselineDim || d;
      const toCurrent = baselineDim ? measuredArea.pinned.toCurrent : null;
      return verdictFor(d, {
        baselineDim,
        current,
        // Counted per side over the files carrying that side's sites (D4).
        authors: authorCount(source.claimFiles, authors, toCurrent),
        counterAuthors: authorCount(source.counterFiles, authors, toCurrent),
        repoAuthors,
        historyRead,
        shallow,
        measured: measuredArea,
        truncated,
        // A tier that answered badly closes its own dimensions and nothing
        // else. Without this the record said degraded and the map stated the
        // claims anyway (B8).
        semantic,
        pooled: pool.get(poolKey(d)) ?? null,
      });
    });

    out.push({
      id: area.id,
      path: area.path,
      globs: area.globs,
      fileCount: area.fileCount,
      baseline: measuredArea.population,
      // The same counts a root line carries, over this area's own files.
      kinds: kinds(area),
      // For the renderer alone, which says where an area holds files a claim's
      // row is never asked of. Not in the record: the map is written from this
      // object, and nothing reads the scope back.
      extsByLang: extsByLang(area.files),
      filesByLang: Object.fromEntries(tally(area.files.map((f) => f.lang))),
      // What a new file in here would import, and what to check for before
      // writing one. Read at HEAD like the roster: both are counts, and neither
      // is a claim anything is gated against.
      imports: hasImports ? commonImports(areaParsed) : null,
      // Over every record in the repository, not this area's: the question is
      // who else reaches in here.
      reused: hasImports ? mostImported(new Set(area.files.map((f) => f.rel)), head.records, corpusRels) : null,
      dimensions: gated,
    });
  }

  // Off the corpus and not off what parsed, so the count holds on a busy machine.
  const scriptOnly = tally(files.filter((f) => embeddedIn(f.lang)).map((f) => extOf(f.rel)));

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
          carried: false,
          measuredAt: scannedAt,
          measuredUnder,
          failures: failuresIn(semantic, carried, measuredUnder),
        }
      : kept !== null && offReason === null
        ? { ran: false, ...kept, carried: true }
        : { ran: false, status: null, reason: offReason, typedResolutionRate: null, carried: false, measuredAt: null, measuredUnder: null, failures: 0 },
    scannedAt,
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
      // Every tracked file this scan has no language for, by extension. The
      // roster prints a root's top two and folds the rest away, so the row
      // naming an unread language cannot be counted back off it.
      otherExts: tally(others.map((o) => extOf(o.rel))),
      // Absent where there is none, so a repository with no component keeps its record.
      ...(scriptOnly.length > 0 ? { scriptOnly } : {}),
    },
    authors: { files: authors.size, error: authorsError, repo: repoAuthors, shallow },
    parse: {
      parsed: head.records.size,
      // Less the files no engine or grammar was there for: those are counted under `unanswered`, by the language that went unread.
      crashed: head.tallies.crashed - unanswered.charged.crashed,
      skipped: head.tallies.oversize,
      failed: head.tallies.unreadable - unanswered.charged.unreadable,
      syntaxErrors: head.tallies.rejected,
      // Only where a rejection means something other than the file's own
      // syntax, so the record of a run no grammar read for is unchanged.
      ...(Object.keys(head.rejections ?? {}).some((means) => means !== "syntax") ? { rejections: head.rejections } : {}),
      // Which engine read this repository and at what version, and which one
      // was not there at all. The remedy differs per engine, and the summary
      // names the version so a map that moved under unchanged source has
      // somewhere to look first.
      engines: head.engines,
      missingEngines: head.missingEngines,
      // Only where one did not load, so the record of a healthy run is unchanged.
      ...(head.missingGrammars.length ? { missingGrammars: head.missingGrammars } : {}),
      missingParser: head.missingParser,
      missingStripper: head.missingStripper,
      // Only where a file was read that way, so the record of a run that read every file whole is unchanged.
      ...(head.oneBranch ? { oneBranch: head.oneBranch } : {}),
      unreadable,
      ...(Object.keys(unanswered.byLang).length ? { unanswered: unanswered.byLang } : {}),
    },
    // The areas the writer leaves as they are, and whether this run read any
    // file at all. Beside the record rather than in it: both say what this run
    // could not do, and the facts on disk describe the repository.
    held: held.map((a) => ({ id: a.id, path: a.path, fileCount: a.fileCount })),
    readNothing: unreadable.length > 0 && files.every((f) => unreadable.includes(f.lang)),
    baseline: {
      status: state.status,
      sha: state.sha,
      countsOnly: state.countsOnly,
      baseRef: state.baseRef,
      baseRefReason: state.baseRefReason,
      drift: state.drift ? state.drift.total : null,
      unreadable: state.unreadable,
    },
    // A truncated corpus suppresses every directive: counting over an
    // arbitrary subset and rendering it like a complete scan is worse than
    // reporting nothing.
    suppressAll: truncated,
    layout,
    areas: out,
  };
}

/** Each language's extensions among these files, and the whole name of a file that has none. */
function extsByLang(files) {
  const out = {};
  for (const f of files) (out[f.lang] ??= new Set()).add(extOrName(f.rel));
  return Object.fromEntries(Object.entries(out).map(([lang, exts]) => [lang, [...exts]]));
}

/** Distinct authors over the files carrying one side's sites (D4). */
function authorCount(files = [], authors, toCurrent) {
  const who = new Set();
  for (const rel of files) {
    const path = toCurrent ? toCurrent.get(rel) ?? rel : rel;
    // The same predicate on both sides, or one person plus a bot clears a bar
    // set from a population the bot was excluded from.
    for (const a of authors.get(path) ?? []) if (isPerson(a)) who.add(a);
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
 *
 * An engine whose install is absent never answered either, whichever outcome
 * its bridge charged the file as: oxc's records classify unreadable and
 * prism's crashed (`parse.mjs`). Before a missing engine stopped costing the
 * whole run, the scan refused on it before this was asked; now it is how the
 * writer learns that language's areas are not this run's to describe.
 *
 * A file skipped for its size never reached the engine, so it is left out of
 * both counts: counted as an answer, one generated bundle beside a missing
 * engine let the scan remove every area of that language.
 */
function unreadableLangs(files, parsed) {
  const total = new Map();
  const unanswered = new Map();
  for (const f of files) {
    const r = parsed.get(f.rel);
    if (r?.skipped) continue;
    total.set(f.lang, (total.get(f.lang) || 0) + 1);
    if (r && (r.crashed || r.missingParser)) unanswered.set(f.lang, (unanswered.get(f.lang) || 0) + 1);
  }
  return [...total.keys()].filter((lang) => unanswered.get(lang) === total.get(lang)).sort();
}

/** The files no engine or grammar was there for, per language and by the outcome their bridge charged them as, so each is counted once. */
function unansweredFiles(files, parsed) {
  const byLang = {};
  const charged = { crashed: 0, unreadable: 0 };
  for (const f of files) {
    const r = parsed.get(f.rel);
    if (!r?.missingParser || !(r.kind in charged)) continue;
    byLang[f.lang] = (byLang[f.lang] ?? 0) + 1;
    charged[r.kind]++;
  }
  return { byLang, charged };
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
