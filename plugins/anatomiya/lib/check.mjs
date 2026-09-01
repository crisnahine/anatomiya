import { open } from "node:fs/promises";
import { dirname } from "node:path";

import { parseAll } from "./parse.mjs";
import { dimensionsFor } from "./dimensions.mjs";
import { GATES, wilsonLower } from "./reduce.mjs";
import {
  collect as collectCorpus,
  frameworksIn,
  capabilitiesIn,
  gitRoot,
  isSource,
  isDenied,
  isExcludedDir,
  safeResolve,
  lsFiles,
} from "./corpus.mjs";
import { language, MISSING_STRIPPER } from "./langs.mjs";
import { areaOwner, globsReach } from "./areas.mjs";
import { droppedDirectives, unexaminedPhrase } from "./render.mjs";
import { auditRules, knownNames, RULES_DIR } from "./rules.mjs";
import { readFacts, statedSide } from "./facts.mjs";
import { MAX_FILE_BYTES } from "./limits.mjs";
import { resolve as resolveBaseline } from "./baseline.mjs";
import { pairingsFor, pairingViolations } from "./pairing.mjs";
import { isTestPath, precedentFindings } from "./precedent.mjs";
import { fillClass, CLASSES } from "./dimensions-naming.mjs";
import { rowsOfKind } from "./registry.mjs";
import { couldSignal } from "./frameworks.mjs";
import {
  gitBuffered, gitStreamed, nameStatusReader, parsePorcelainRows, resolveBaseRef, mergeBase, filesAt,
  headSha, BASE_REFS, GIT,
} from "./git.mjs";
import { readAtRevision } from "./revision.mjs";
import { CAVEATS } from "./check-report.mjs";
import { newlyIntroduced } from "./introduced.mjs";

/**
 * The check phase: which of the conventions the map stated did this branch
 * just break.
 *
 * Two properties carry the whole design. "Changed by this branch" is a
 * three-dot diff against the merge base, so a base branch that moved ahead
 * never puts someone else's file in front of the author. "Newly introduced"
 * cannot be derived from one run at HEAD at all, so the analysis runs twice,
 * at HEAD and at the merge base, and the two finding sets are differenced by
 * content fingerprint rather than by position.
 *
 * Nothing here blocks. The top severity is MUST-FIX, staleness caps severity
 * instead of refusing, and a refusal is exactly what a pull-request-time hook
 * would deliver at the worst possible moment.
 */

export const CHECK = {
  // A pinned population that has moved this far describes a different
  // repository than the one the agent was handed. No measurement sets this
  // number yet; it is one constant because its only effect is capping
  // severity at FIX.
  driftShare: 0.25,
};

// The shape of the report, so a reader older than the record refuses it rather
// than reading fields that moved. Same rule the facts record already carries.
export const CHECK_SCHEMA = 1;

function caveat(caveats, code, message) {
  caveats.push({ code, message });
}

const SEVERITY_ORDER = { "MUST-FIX": 0, FIX: 1, NIT: 2 };

export async function check(cwd, { baseRef = null } = {}) {
  const root = await gitRoot(cwd);
  const { facts, unreadable } = readFacts(root);
  const areas = facts ? facts.areas : [];
  const caveats = [];

  // One code for both sentences `readFacts` answers with: a store directory
  // that resolves outside the repository and a schema this build does not read
  // are the same fact to a reader, that there is a map and none of it was used.
  if (unreadable) caveat(caveats, CAVEATS.MAP_UNREADABLE, unreadable);
  else if (!facts) {
    caveat(caveats, CAVEATS.NO_MAP, "no map on disk, so nothing was stated and nothing can be enforced");
  }

  // A stated claim nobody measured is the failure this codebase keeps closing:
  // a check that reports no findings is what the command file tells the agent
  // to trust, so a whole class of claim going unasked has to be said out loud.
  const semanticClaims = (facts?.areas ?? [])
    .flatMap((a) => a.dimensions ?? [])
    .filter((d) => d.tier === "semantic" && d.directive).length;

  const base = await resolveBase(root, baseRef, caveats);
  const from = base.mergeBase || base.boundary;
  const mode = base.mergeBase ? "compare" : base.boundary ? "added-lines" : "none";

  if (mode === "added-lines") {
    caveat(
      caveats,
      CAVEATS.NO_MERGE_BASE,
      "no merge base, so findings are limited to lines added since the oldest " +
        "commit this clone holds and are not compared against the base"
    );
  }
  if (mode === "none") {
    caveat(
      caveats,
      CAVEATS.NOTHING_EXAMINED,
      "no merge base and no earlier commit to compare against, so nothing was examined"
    );
  }

  const diff = from ? await changedFiles(root, from) : { ok: true, rows: [] };
  if (!diff.ok) {
    caveat(
      caveats,
      CAVEATS.DIFF_UNREADABLE,
      `the diff against ${base.ref || from} could not be read, so no file was examined and this run found nothing it could look at`
    );
  }
  const changed = diff.rows.filter((c) => c.status !== "D");

  const status = await pendingPaths(root);
  if (status === null) {
    caveat(
      caveats,
      CAVEATS.PENDING_UNLISTED,
      "the working tree's pending edits could not be listed, so only committed content was read"
    );
  }
  // Only where a base exists to judge against. With no merge base nothing can
  // be called newly introduced, which is why the degraded modes report nothing
  // rather than everything, and reading the tree there would report every site
  // in an uncommitted file against an author who may not have written one.
  const pending = status !== null && mode === "compare" ? status : { present: [], deleted: [] };
  await resolvePendingBases(root, base.mergeBase, pending.present);
  const examined = withPendingEdits(changed.filter((c) => wanted(c.path)), pending.present);
  const fromTree = examined.filter((c) => c.tree).length;
  if (fromTree) {
    caveat(
      caveats,
      CAVEATS.READ_FROM_TREE,
      `${fromTree} file(s) were read from the working tree rather than from a commit, so this run answers for the work as it stands`
    );
  }
  const unread = status !== null && mode !== "compare" ? status.present.length : 0;
  if (unread) {
    caveat(
      caveats,
      CAVEATS.PENDING_UNJUDGED,
      `${unread} file(s) have uncommitted edits this run could not judge, because it found no base to compare them against`
    );
  }

  // The refusal reason travels, or the report prints "capped by this run: no
  // map on disk" above a note saying the map is a schema this build cannot
  // read. The first is false and points at the wrong fix.
  const stale = await staleness(root, facts, base, unreadable);
  const added = mode === "added-lines" ? await addedRanges(root, from) : null;
  if (mode === "added-lines" && added === null) {
    caveat(
      caveats,
      CAVEATS.ADDED_RANGES_UNREADABLE,
      "the added-line ranges could not be read, so nothing was attributed to this branch in the degraded mode"
    );
  }

  // A framework's claim is only asked where the corpus shows the framework
  // (C8). `[]` rather than an absent value on the cheap branch: absent means
  // "no filter" to `dimensionsFor`, and this caller can answer the question.
  const frameworks = examined.some((f) => couldSignal(language(f.path)))
    ? await frameworksHere(root, facts, caveats)
    : [];
  // The routing rows are offered the way a framework's are: only where the
  // repository shows an adopted wrapper to route through (C14). With no map on
  // disk the corpus fallback is filename vocabulary alone, which costs at most
  // a NIT in a repository that never adopted one. Nothing examined asks
  // nothing, so an empty diff never pays a corpus collect; a readable schema-9
  // map still does, once, until its repository is re-scanned.
  const capabilities = examined.length ? new Set(await capabilitiesHere(root, facts, caveats)) : new Set();

  const { findings, missingEngines, missingParser } = await collect(root, {
    examined,
    areas,
    base,
    mode,
    added,
    frameworks,
    capabilities,
    pending,
    // Only the two-run comparison establishes that a site is newly introduced,
    // so the degraded mode caps severity for the same reason a stale map does.
    fresh: !stale.reason && mode === "compare",
    caveats,
  });

  // Last, and outside the dimension collection above: this one asks about the
  // path rather than the contents, so it reads the diff instead of a parse
  // (H38).
  // What "already" means here is not what it means for the hook: a change that
  // invents a directory and fills it with four specs must not have three of
  // them excused by the first, so everything it brought is subtracted.
  const arrived = examined
    .filter((c) => c.status === "A" || (c.from && c.from !== c.path))
    .map((c) => ({ path: c.path, oldPath: c.from === c.path ? null : c.from }));
  const brought = new Set(arrived.map((c) => c.path));
  // Answered from what git tracks rather than off the disk, which is the
  // population every other reader here counts: one ignored `scratch_spec.rb`
  // sitting in a directory read as a test habit and silenced the rule for every
  // file in it. The hook cannot ask this, since a `git ls-files` per write is a
  // subprocess per write, so it reads the directory and is quieter where a
  // stray file sits there; this run catches what that one let past.
  const tracked = await trackedTests(root);
  const holdsTest = (dir) =>
    tracked === null || tracked.some((rel) => dirname(rel) === (dir || ".") && !brought.has(rel));

  findings.push(
    ...precedentFindings(
      // A relocation too: moving a test into a directory whose siblings have
      // none is the same deviation as writing it there. Read off `from` rather
      // than the status letter, which spells the same move two ways: `R` from
      // the diff, and `M` with an `orig` from a working tree where it is staged
      // and not yet committed.
      arrived,
      facts?.layout?.roots ?? [],
      {
        // The comparison alone is what says a file arrived; a stale map does
        // not bear on that, and it caps at FIX anyway, which is this rule's
        // ceiling.
        fresh: mode === "compare",
        holdsTest,
      }
    )
  );

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.path.localeCompare(b.path) ||
      a.line - b.line
  );

  // `.claude/rules/` is a repository directory, so a clone can ship a rule file
  // with no `paths` key that loads unconditionally from the moment of clone.
  // Everything in there this build did not write is named: the file nobody here
  // wrote, and the file an older build left behind that no map lists. The
  // prefix is not the test, because a hand-written file can take it.
  const { foreign, unknown, unreadable: unreadableRules, escaped, listed } = auditRules(root, knownNames(facts));
  // The scan refuses to write through a link out of the repository; the check
  // has nothing to refuse, so it says what it could not look at. A clean rules
  // directory reported here would be the same lie as a clean diff reported for
  // one git would not produce.
  if (escaped) {
    caveat(
      caveats,
      CAVEATS.RULES_ESCAPED,
      `${RULES_DIR} resolves outside the repository, so nothing there was examined: this is a symlink in the working tree`
    );
  } else if (!listed) {
    // Same rule again: a directory nobody could list is not one holding
    // nothing, and the files in it load whether or not this run saw them.
    caveat(caveats, CAVEATS.RULES_UNLISTED, `${RULES_DIR} could not be listed, so nothing there was examined`);
  }
  if (unreadableRules.length) {
    caveat(
      caveats,
      CAVEATS.RULES_UNREADABLE,
      `${unreadableRules.length} file(s) in ${RULES_DIR} could not be read, so whose they are is unknown`
    );
  }

  return {
    schema: CHECK_SCHEMA,
    root,
    mode,
    base: { ref: base.ref, sha: base.sha, mergeBase: base.mergeBase, shallow: base.shallow },
    stale: Boolean(stale.reason),
    staleReason: stale.reason,
    // How far the map has moved, whether or not that is far enough to cap
    // severity. Null where staleness never got as far as measuring it: no pin,
    // an unreachable one, or a drift range git would not produce.
    drift: stale.drift ?? null,
    changed,
    examined,
    findings,
    counts: tally(findings),
    caveats,
    // Which engine is absent, beside the message it produced: the remedy is
    // the engine's and npm cannot install an interpreter.
    parse: { missingParser, missingEngines },
    semantic: { claims: semanticClaims },
    foreign,
    unknown,
    // The audit's own three fields, beside the names it split. Folded into
    // caveat prose they were unreadable to anything but a human: four empty
    // lists and `listed: false` is a directory nobody looked in, which reads
    // exactly like one holding nothing foreign.
    rules: { escaped, listed, unreadable: unreadableRules },
  };
}

/* --- the diff --- */

/**
 * Three dots, never two.
 *
 * Two dots compares the endpoints, so the moment the base branch moves ahead
 * it lists files other people changed, as reverse deltas, and the check then
 * reports findings in code the author never touched.
 */
async function changedFiles(root, from) {
  const rows = [];
  // Streamed: a branch off a distant base lists every path in the repository,
  // and that is the read `execFile` answers with an uncatchable `RangeError`.
  //
  // A diff git refused to produce is not a branch that changed nothing, and the
  // two are the same empty list, so the failure is reported by exit code rather
  // than by output, the way unread history already is.
  try {
    await gitStreamed(
      root,
      ["diff", "--find-renames", "-z", "--name-status", `${from}...HEAD`],
      nameStatusReader((row) => {
        rows.push(namedRow(row));
        return true;
      }),
      { timeout: GIT.checkTimeoutMs, maxFieldBytes: GIT.checkMaxBytes }
    );
  } catch {
    return { ok: false, rows: [] };
  }
  return { ok: true, rows };
}

/**
 * The diff's own vocabulary: `path` is where the file is now, and `from` is
 * where its base version is read from, which for anything but an addition is
 * the file itself.
 */
function namedRow(row) {
  return {
    status: row.status[0],
    path: row.to,
    from: row.from ?? (row.status[0] === "A" ? null : row.to),
  };
}

function wanted(path) {
  return isSource(path) && !isDenied(path) && !isExcludedDir(path);
}

/**
 * Which frameworks this repository shows, for the two dimensions that cannot
 * see their own context (C8).
 *
 * The scan already answered this from the corpus and stored it, so a mapped
 * repository pays nothing; a check runs on repositories with no map too, and
 * there the corpus has to be read. Read from the corpus rather than the tracked
 * list, because a fixture directory full of `app/models` is not an application.
 *
 * A corpus that will not collect is a question left unanswered, not a run
 * refused: nothing else in this file throws, and refusing to report a branch
 * because a framework probe failed is the blocking behaviour this design
 * rejects. The answer costs the framework's claims, never a wrong one.
 */
async function frameworksHere(root, facts, caveats) {
  return storedOrCollected(root, facts, "frameworks", frameworksIn, caveats, CAVEATS.FRAMEWORKS_UNKNOWN,
    "the corpus could not be listed, so no framework's claims were checked");
}

/** The scan stored the answer; a repository with no map reads its own corpus. */
async function storedOrCollected(root, facts, field, derive, caveats, code, refusal) {
  const stored = facts && facts.corpus && facts.corpus[field];
  if (Array.isArray(stored)) return stored;
  try {
    return [...derive((await collectCorpus(root)).files)];
  } catch (err) {
    // The code is the caller's, because one unread corpus costs the framework
    // claims or the routing claims depending on who asked.
    caveat(caveats, code, `${refusal}: ${err && err.message ? err.message : err}`);
    return [];
  }
}

/**
 * Which capability wrappers this repository shows, same contract as
 * `frameworksHere`: the scan stored it, and a repository with no map reads its
 * own corpus. Unanswered costs the routing claims, never a wrong one.
 */
async function capabilitiesHere(root, facts, caveats) {
  return storedOrCollected(root, facts, "capabilities", capabilitiesIn, caveats, CAVEATS.CAPABILITIES_UNKNOWN,
    "the corpus could not be listed, so no routing claim was checked");
}

/* --- base resolution, including the shallow case --- */

/**
 * Resolve the base ref, fetching exactly one commit on a shallow clone.
 *
 * The candidate list, the ref and its fork point all come from `baseline.mjs`,
 * which is the one resolver in the product: the scan measures drift against
 * whatever it answers, and a second reading here would mean the two phases
 * judge a branch against different commits. Only the shallow fetch is the
 * check's own.
 *
 * Measured: on a shallow clone `origin/main` does not exist at all, and after
 * fetching it `merge-base` exits 1 with empty stdout and no stderr, so the
 * empty string is the signal rather than the exit code. Fetching the single
 * base commit costs 3.65s and 12 MB; `--unshallow` costs 56s and 305 MB and
 * `--deepen=500` measured the same, so bounded deepening is not real and
 * neither is offered.
 */
async function resolveBase(root, baseRef, caveats) {
  const candidates = (baseRef ? [baseRef] : BASE_REFS).filter((c) => c && !c.startsWith("-"));
  const shallow = (await git(root, ["rev-parse", "--is-shallow-repository"])).out.trim() === "true";
  // A ref somebody typed and a candidate this tool guessed are different
  // questions. The guessed list not resolving is a repository that keeps its
  // trunk somewhere else, which is what the added-lines degradation is for; a
  // typed ref not resolving is a typo, and answering it with a whole-branch
  // review at exit 0 is the one outcome the command file tells the agent to
  // trust as "nothing to report".
  // A repository with no commits has no ref to mistype against, and answering
  // "nothing was examined" is the truth about it rather than a degradation.
  const asked = baseRef !== null && (await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"])).out.trim() !== "";
  // Asked before anything is fetched. A remote holding a branch literally named
  // `HEAD` would otherwise be fetched and used as the base, which is the one
  // thing E6 refuses, and the refusal would arrive as a story about fetching.
  if (asked && (baseRef === "HEAD" || baseRef === "@")) throw new Error(refusal(baseRef, shallow));

  for (const c of candidates) {
    const r = await resolveBaseRef(root, c);
    if (!r.ok) continue;
    if (!r.forkPoint) caveat(caveats, CAVEATS.NO_MERGE_BASE, `no merge base between ${c} and HEAD`);
    return {
      ref: c,
      sha: r.sha,
      mergeBase: r.forkPoint ? r.sha : null,
      shallow,
      boundary: r.forkPoint ? null : await boundary(root),
    };
  }

  if (shallow) {
    for (const c of candidates) {
      const remote = await remoteSha(root, c);
      if (!remote) continue;
      const fetched = await git(root, ["fetch", "--depth=1", "origin", remote]);
      if (!fetched.ok) continue;
      const mb = await mergeBase(root, remote, "HEAD");
      if (!mb.found) {
        caveat(
          caveats,
          CAVEATS.SHALLOW_NO_HISTORY,
          "shallow clone: the base commit is present but shares no held history with HEAD"
        );
      }
      return {
        ref: c,
        sha: remote,
        mergeBase: mb.sha,
        shallow,
        boundary: mb.found ? null : await boundary(root),
      };
    }
    if (asked) throw new Error(refusal(baseRef, shallow));
    caveat(caveats, CAVEATS.SHALLOW_UNFETCHED, "shallow clone and the base commit could not be fetched");
  } else {
    if (asked) throw new Error(refusal(baseRef, shallow));
    caveat(caveats, CAVEATS.NO_BASE_REF, `no base ref resolved from ${candidates.join(", ")}`);
  }

  // No ref, not the first candidate: the caveat above already names what was
  // tried, and reporting a base the run did not use reads as one it did.
  return { ref: null, sha: null, mergeBase: null, shallow, boundary: await boundary(root) };
}

/**
 * Why a ref somebody typed cannot be the base, in the terms of what they typed.
 *
 * `HEAD` and `@` resolve locally in every repository that has a commit, so
 * reporting them as a base a shallow clone could not fetch names a cause that
 * is not the reason and a fix that would not work. They are refused for what
 * they are: this branch's own tip, over which the branch's own edits count as
 * map drift (E6).
 */
function refusal(ref, shallow) {
  if (ref === "HEAD" || ref === "@") {
    return `--base ${ref} names this branch's own tip, so there is nothing to compare against`;
  }
  const fetched = shallow ? ", and this shallow clone could not fetch it" : "";
  return `--base ${ref} resolves to no commit in this repository${fetched}`;
}

async function remoteSha(root, ref) {
  const branch = ref.replace(/^origin\//, "");
  const ls = await git(root, ["ls-remote", "origin", `refs/heads/${branch}`]);
  const m = /^([0-9a-f]{40})/.exec(ls.out.trim());
  return m ? m[1] : null;
}

/**
 * The oldest commit reachable from HEAD. On a shallow clone the boundary is
 * grafted as a root, so this is the earliest thing we hold, and it is an
 * ancestor of HEAD, which is what makes diffing against it legitimate.
 */
async function boundary(root) {
  const r = await git(root, ["rev-list", "--max-parents=0", "HEAD"]);
  const first = r.out.trim().split("\n").filter(Boolean).pop();
  if (!first) return null;
  const head = await git(root, ["rev-parse", "HEAD"]);
  return first === head.out.trim() ? null : first;
}

async function addedRanges(root, from) {
  const r = await git(root, [
    "-c", "core.quotePath=false",
    "diff", "--find-renames", "--unified=0", from, "HEAD",
  ]);
  // Same rule as `changedFiles` (F15): a diff git refused to produce reads as a
  // file with no added lines, which drops every finding in it. `null` says the
  // ranges are unknown; an empty map would say there are none.
  if (!r.ok) return null;
  const byFile = new Map();
  let current = null;
  for (const line of r.out.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      current = p === "/dev/null" ? null : p.replace(/^b\//, "");
      if (current && !byFile.has(current)) byFile.set(current, []);
      continue;
    }
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m || !current) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count > 0) byFile.get(current).push([start, start + count - 1]);
  }
  return byFile;
}

/* --- analysis, run once at HEAD and once at the merge base --- */

// What a check asks of a commit: eight blobs at a time, and the bytes kept in
// the parent as well, because the report quotes them and resolves line numbers
// against them.
const REVISION_READ = { concurrency: 8, withSource: true, timeout: GIT.checkTimeoutMs };

/**
 * Every test file git tracks, or null where the listing failed.
 *
 * Null rather than an empty list, and the caller reads it as "there is one":
  * an index this cannot read says nothing about what a directory holds, and
 * every other reader in this file that meets an unlistable corpus drops the
 * claims it cannot support rather than printing them anyway (C33). Nothing here
 * may throw either, since a rule that does takes the whole run with it.
 */
async function trackedTests(root) {
  const found = [];
  try {
    await lsFiles(root, (rel) => {
      if (isTestPath(rel)) found.push(rel);
      return true;
    });
  } catch {
    return null;
  }
  return found;
}

async function collect(root, { examined, areas, base, mode, added, fresh, caveats, frameworks, capabilities, pending }) {
  const areaFor = areaIndex(areas);
  const ancestorsOf = ancestorsIndex(areas);
  // Which directives each area's file had no room to state, recomputed from the
  // same layout the writer uses so the map and the check cannot disagree. A
  // hand-edited record with no globs throws from the renderer; a run that
  // cannot recompute the set enforces what it always did rather than failing
  // the whole check over a rendering question.
  const droppedIn = new Map(
    areas.map((a) => {
      try {
        return [a.path, droppedDirectives(a)];
      } catch {
        return [a.path, new Set()];
      }
    })
  );
  // Resolved once. A blob is read by object name rather than by ref, so a pin
  // file cannot name something else and have it read as source.
  const head = await headSha(root);

  // Asked before anything is read, so a language nothing is claimed about costs
  // no blob at either revision.
  const claimed = examined
    .map((file) => ({ file, lang: language(file.path) }))
    .filter(({ lang }) => dimensionsFor([lang], { frameworks, capabilities }).length > 0);

  const headWanted = new Map();
  const baseWanted = new Map();
  for (const { file, lang } of claimed) {
    if (!file.tree) headWanted.set(file.path, { rel: file.path, lang });
    // The base version is read with the rename map applied: at the merge base
    // the new path does not exist, and a path hash cannot tell a rename from a
    // delete plus an add. Only the head side is ever read from the tree, so no
    // edit of an agent's can move the base it is judged against.
    if (mode === "compare" && file.from) baseWanted.set(file.from, { rel: file.from, lang });
  }

  // The head tree is on disk while the base read runs and both are on disk
  // through the loop below, so the guard that removes them opens before the
  // first read rather than around the parse alone.
  let atHead = null;
  let atBase = null;
  try {
    // One read per revision rather than one per file: the committed side of every
    // examined file is the same question asked of one commit, and asking it a
    // file at a time spawned a `cat-file` that waited on the one before it.
    atHead = await readAtRevision(root, head, [...headWanted.values()], REVISION_READ);
    atBase = mode === "compare"
      ? await readAtRevision(root, base.mergeBase, [...baseWanted.values()], REVISION_READ)
      : null;
    const headBlobs = new Map(atHead.files.map((f) => [f.rel, f]));
    const baseBlobs = new Map((atBase?.files ?? []).map((f) => [f.rel, f]));

    const jobs = [];
    for (const { file, lang } of claimed) {
      const atHeadBlob = headBlobs.get(file.path);
      const source = file.tree ? await treeSource(root, file.path) : (atHeadBlob ? atHeadBlob.source : null);
      if (source === null) {
        // One code for both, because either way the head version is what this
        // run did not get; the sentence says which of the two it looked in.
        caveat(
          caveats,
          CAVEATS.HEAD_UNREADABLE,
          file.tree ? `could not read ${file.path} in the working tree` : `could not read ${file.path} at HEAD`
        );
        continue;
      }
      const job = { file, lang, source, abs: atHeadBlob?.abs ?? null, base: null, baseAbs: null };

      if (mode === "compare" && file.from) {
        const atMergeBase = baseBlobs.get(file.from);
        // Without the base version every site in the file reads as new, which is
        // the forgery this design exists to prevent. Say so and check nothing.
        if (!atMergeBase) {
          caveat(
            caveats,
            CAVEATS.BASE_UNREADABLE,
            `could not read ${file.from} at the merge base, so ${file.path} was skipped`
          );
          continue;
        }
        job.base = atMergeBase.source;
        job.baseAbs = atMergeBase.abs;
      }
      jobs.push(job);
    }

    const entries = [];
    for (const job of jobs) {
      // A file read from the working tree is the one side that arrives as bytes.
      // The parser gets a copy rather than the live path, because the text every
      // offset here is resolved against is the copy this run read.
      entries.push({ rel: `head:${job.file.path}`, lang: job.lang, ...(job.abs ? { abs: job.abs } : { source: job.source }) });
      if (job.base !== null) {
        entries.push({ rel: `base:${job.file.path}`, lang: job.lang, abs: job.baseAbs });
      }
    }

    const { records: parsed, missingEngines, missingParser, missingStripper } = await parseAll(entries, { withProgram: true });
    const findings = [];

    for (const job of jobs) {
      const path = job.file.path;
      const area = areaFor(path);
      // A corpus row's site is the name itself, which needs no tree, so these
      // are judged before the parse guards can skip the file.
      const headParse = parsed.get(`head:${path}`);
      for (const row of CORPUS_ROWS) {
        // The same fallback the tree rows get: an area with no slot for the
        // filename claim is one where nothing classified, not one that declined
        // the convention, and the nearest enclosing area that states one
        // measured a population this directory sits inside.
        const own = area && (area.dimensions || []).find((d) => d.key === row.key);
        const up = !own && area ? ancestorSlot(ancestorsOf, area, row.key) : null;
        const named = filenameFinding(row, job, up ? { ...area, dimensions: [up.dim] } : area, fresh, {
          dropped: area ? droppedIn.get(area.path)?.has(row.key) === true : false,
          // Null where the file went unread, which is a kind a narrowed row
          // declines to guess. The caveat below says the file went unread.
          facets: headParse?.facets ?? null,
          from: up ? up.from : null,
        });
        if (named) findings.push(named);
      }

      if (!headParse || !headParse.ok || !headParse.program) {
        caveat(caveats, unreadCode(headParse), `${path} ${unreadReason(headParse)}, so it was not checked`);
        continue;
      }

      const keyPath = job.file.from || path;
      const baseParse = parsed.get(`base:${path}`);
      const baseUsable = !baseParse || (baseParse.ok && baseParse.program);
      // A base version that exists but will not parse is not an empty base
      // version. Treating it as one would charge the author with every site the
      // file already held.
      if (!baseUsable) {
        caveat(caveats, CAVEATS.BASE_UNPARSED, `${path} did not parse at the merge base, so it was skipped`);
        continue;
      }

      const introduced = newlyIntroduced({
        area,
        ancestorsOf,
        path,
        keyPath,
        lang: job.lang,
        frameworks,
        capabilities,
        head: { program: headParse.program, source: job.source, comments: headParse.comments, stripped: headParse.stripped, facets: headParse.facets },
        base: mode === "added-lines" || !baseParse ? null : { program: baseParse.program, source: job.base, comments: baseParse.comments, stripped: baseParse.stripped },
        addedLines: mode === "added-lines" ? (added && added.get(path)) || [] : null,
      });

      for (const f of introduced) {
        const own = area && (area.dimensions || []).find((d) => d.key === f.dimension);
        // A slot the area does not hold is a construct its baseline never saw,
        // not a convention the map measured and said nothing about. The nearest
        // enclosing area that states one measured a population this directory
        // sits inside, so its sentence is the one to ask. Outside every area
        // nothing was measured at all, which is what the NIT is for.
        const up = !own && area ? ancestorSlot(ancestorsOf, area, f.dimension) : null;
        const dim = own ?? up?.dim;
        if (area && !dim) continue;
        // Capped at FIX, whatever the ancestor's own baseline says. MUST-FIX
        // means the map told this file's author and they are the first to break
        // it; the ancestor's area file is not delivered to this directory, so
        // the map did not tell. Same ladder position staleness and partial
        // precision already occupy.
        // The owning area's own file can miss this path the same way: ownership
        // is the directory prefix and delivery is the glob, so an area listing
        // only its own files owns a new subdirectory under it and delivers
        // nothing there. A cap rather than a verdict: replacing it raised a slot
        // the gates suppressed from NIT to FIX, on a claim the area file prints
        // as "no convention" and never delivered here either.
        const away = own && area && !globsReach(area.globs, path);
        const verdict = up
          ? { severity: "FIX", reason: `counted in ${up.from}, which this directory sits inside` }
          : cappedAway(
              severityFor(
                { path, oldPath: job.file.from },
                { dim, fresh, dropped: area ? droppedIn.get(area.path)?.has(f.dimension) === true : false }
              ),
              away,
              area
            );
        findings.push({
          severity: verdict.severity,
          reason: verdict.reason,
          path,
          oldPath: job.file.from === path ? null : job.file.from,
          line: f.line,
          area: area ? area.path : null,
          dimension: f.dimension,
          claim: f.claim,
          precision: f.precision,
          where: f.where,
          companion: null,
          snippet: f.text,
        });
      }

    }

    await addPairingFindings(root, findings, { examined, areas, fresh, caveats, pending, droppedIn });
    // The scan says this on its own summary, and a check runs in CI where nobody
    // read that. Without it a Flow file reads as a broken file.
    if (missingStripper) {
      caveat(caveats, CAVEATS.STRIPPER_MISSING, MISSING_STRIPPER);
    }

    return { findings, missingParser, missingEngines };
  } finally {
    // The sources the report quotes are held in the parent, so nothing past
    // here needs the files: leaving them until the run ends would keep two
    // copies of every examined file in the temporary directory.
    atHead?.dispose();
    atBase?.dispose();
  }
}

/**
 * Obligations the branch broke.
 *
 * Kept apart from the loop above because that loop runs a dimension against a
 * parsed program and an obligation has none. Without this the check ran every
 * claim it could execute, reported clean, and said nothing about the one it
 * could not: the same shape as reporting clean for a file that was never read.
 */
async function addPairingFindings(root, findings, { examined, areas, fresh, caveats, pending, droppedIn }) {
  const areaFor = areaIndex(areas);
  const changed = examined.map((f) => f.path);
  const langs = [...new Set(changed.map((p) => language(p)))];
  const pairings = pairingsFor(langs);
  if (pairings.length === 0) return;

  // The tree as this branch leaves it: a companion added in the same commit
  // satisfies the obligation, and one deleted in it breaks the obligation.
  //
  // A listing git would not produce is not a branch with no files in it. Read
  // as one, every changed producer owes a companion that is sitting right
  // there, at whatever severity the map's own confidence allows.
  //
  // No test reaches this branch, and that is a property of git rather than an
  // omission: `ls-tree -r HEAD` and the diff walk the same tree, so every
  // corruption that fails one fails the other, and the run reports the diff
  // first. What is pinned instead is `filesAt` answering null at all, in
  // `git.test.mjs`, and the obligation still firing on a tree git does answer.
  const tree = await filesAt(root, "HEAD", {
    timeout: GIT.checkTimeoutMs,
    maxFieldBytes: GIT.checkMaxBytes,
  });
  if (tree === null) {
    caveat(
      caveats,
      CAVEATS.OBLIGATIONS_UNCHECKED,
      "the file list at HEAD could not be read, so no file-to-file obligation was checked"
    );
    return;
  }

  // The producers come from the working tree now, so the companions have to as
  // well, or an author who wrote both halves and committed neither owes a spec
  // that is sitting right beside the model. Deleted the same way: a companion
  // removed in the tree is one this branch no longer has.
  const gone = new Set(pending?.deleted ?? []);
  const asItStands = new Set([...tree].filter((p) => !gone.has(p)));
  for (const row of pending?.present ?? []) asItStands.add(row.path);

  for (const pairing of pairings) {
    for (const { path, companion } of pairingViolations(changed, asItStands, pairing)) {
      const area = areaFor(path);
      const dim = area && (area.dimensions || []).find((d) => d.key === pairing.key);
      // Same rule as every other finding: the check enforces what the map
      // stated, and a dimension the map measured and said nothing about is not
      // a finding.
      if (!dim || !dim.directive) continue;
      // The third producer, capped on the same rule as the other two: an area
      // that owns a path by prefix and delivers no glob to it never handed this
      // file's author the obligation.
      const verdict = cappedAway(
        severityFor(
          { path, oldPath: null },
          { dim, fresh, dropped: area ? droppedIn?.get(area.path)?.has(pairing.key) === true : false }
        ),
        area && !globsReach(area.globs, path),
        area
      );
      findings.push({
        severity: verdict.severity,
        reason: verdict.reason,
        // A field of its own, so the one encoder pass over the record reaches
        // it and each writer places it in the shape that writer needs.
        companion,
        path,
        oldPath: null,
        // The site is the file, so there is no line to point at.
        line: 1,
        area: area ? area.path : null,
        dimension: pairing.key,
        claim: pairing.claim,
        precision: pairing.precision,
        where: null,
        snippet: null,
      });
    }
  }
}

// The rows whose site is the filename, found by kind rather than by key, so a
// second corpus row is enforced the day it is declared instead of stating in
// the map and enforcing nothing (the H12 asymmetry, structurally closed).
const CORPUS_ROWS = rowsOfKind("corpus");

/**
 * A corpus row's site is the name itself, which no tree walk sees. A file
 * this branch created answers it outright; a rename answers it only when the
 * name changed class, because the old name predates the branch and a same-class
 * rename kept the convention.
 */
/**
 * MUST-FIX withheld from a path the area's own globs never deliver to, and
 * every other verdict left alone. MUST-FIX means the map told this file's
 * author and they are the first to break it; here the map did not tell.
 */
function cappedAway(verdict, away, area) {
  if (!away || verdict.severity !== "MUST-FIX") return verdict;
  return { severity: "FIX", reason: `counted in ${area.path}, which this directory sits inside` };
}

/**
 * The template the map printed for this row: the plain sentence, or the one
 * naming the kind wherever the narrowing left something out.
 */
function claimTemplate(row, dim) {
  return (dim.narrowed === true && row.splitClaim?.[dim.learnedKind]) || row.claim;
}

function filenameFinding(row, job, area, fresh, { dropped = false, facets = null, from = null } = {}) {
  const path = job.file.path;
  const nameDim = area && (area.dimensions || []).find((d) => d.key === row.key);
  if (!nameDim || typeof nameDim.learned !== "string" || !CLASSES.includes(nameDim.learned)) return null;
  // The class was learned over one kind of file, so the other kind expressed no
  // opinion about it. A file this run could not read carries no facets, and its
  // kind is unknown rather than the one an absent facet spells: reading it as a
  // module judged an unread component at MUST-FIX, one line under the caveat
  // saying the file was not checked.
  if (row.splitBy && typeof nameDim.learnedKind === "string") {
    if (facets === null || row.splitBy({ facets }) !== nameDim.learnedKind) return null;
  }
  // A name spelling no class at all is a site with no vote, and it was the
  // violation this could not see: only a name spelling a different class was
  // caught. The two names that spell every class are still not sites.
  if (!row.isSite(path)) return null;
  const cls = row.classify(path);
  const renamedFrom = job.file.from;
  // A rename answers the claim only where the name changed what it says. Two
  // names can both classify to null for opposite reasons, so the comparison is
  // over the pair: `index.ts` is not a site and `TMP_FILE.ts` spells no class,
  // and comparing null against null read that rename as no change at all.
  const answers =
    !renamedFrom ||
    (renamedFrom !== path &&
      (row.isSite(renamedFrom) !== row.isSite(path) || row.classify(renamedFrom) !== cls));
  if (!answers || cls === nameDim.learned) return null;
  // A name spelling no class is the omission, and an omission is reported only
  // where the map stated the claim: "name this file differently" is advice, and
  // on a row the gates suppressed it is advice the map itself refuses to print.
  // A name spelling a different class is the count speaking and is reported
  // either way.
  if (cls === null && statedSide(nameDim).states === null) return null;
  const oldPath = renamedFrom && renamedFrom !== path ? renamedFrom : null;
  // Capped at FIX where the sentence came from an area above: that area's file
  // is not delivered here, so the map did not tell this file's author.
  const away = !from && !globsReach(area.globs, path);
  const verdict = from
    ? { severity: "FIX", reason: `counted in ${from}, which this directory sits inside` }
    : cappedAway(severityFor({ path, oldPath }, { dim: nameDim, fresh, dropped }), away, area);
  return {
    severity: verdict.severity,
    reason: verdict.reason,
    path,
    oldPath,
    line: 1,
    area: area.path,
    dimension: row.key,
    claim: fillClass(claimTemplate(row, nameDim), nameDim.learned),
    precision: nameDim.precision ?? "precise",
    where: null,
    companion: null,
    snippet: path.slice(path.lastIndexOf("/") + 1),
  };
}


/**
 * Why a file went unread, in the scan's own vocabulary and with the same four
 * causes kept apart, because the reader's next move differs for each: a crash
 * is this tool's problem, rejected syntax is the branch's own code, the cap is
 * a generated file nobody writes by hand, and the rest is this tool or the
 * filesystem.
 *
 * The sentence and the code sit in one table, so the split a human reads and
 * the split anything else branches on can never name different causes.
 */
const UNREAD = {
  crashed: { phrase: "crashed", code: CAVEATS.HEAD_CRASHED },
  oversize: { phrase: "skipped", code: CAVEATS.HEAD_OVERSIZE },
  rejected: { phrase: "syntaxErrors", code: CAVEATS.HEAD_REJECTED },
};

// A record naming none of the three, and no record at all, are one answer:
// this tool or the filesystem could not produce the file.
const UNREAD_ELSE = { phrase: "failed", code: CAVEATS.HEAD_UNPARSED };

const unreadOf = (parse) => UNREAD[parse && parse.kind] ?? UNREAD_ELSE;

/** The cause as a sentence. This surface names one file, so it is singular. */
export function unreadReason(parse) {
  return unexaminedPhrase(unreadOf(parse).phrase, 1);
}

/** The same cause as a code, for a reader that does not read the sentence. */
export function unreadCode(parse) {
  return unreadOf(parse).code;
}

/* --- severity --- */

/**
 * Severity, and every branch here repairs a reviewed defect.
 *
 * The counts come from the baseline population and never from the current one,
 * or the agent's own accumulated output raises the bar it is judged against. A
 * dimension a gate suppressed cannot reach the top severity, because the check
 * may only enforce what the map actually told the agent. A file the map named
 * as an exception is not held to the convention it is exempt from. And a stale
 * map caps severity rather than stopping the run.
 */
export function severityFor(file, { dim, fresh, dropped = false }) {
  if (!dim) return { severity: "NIT", reason: "no convention counted here" };
  const side = statedSide(dim);
  if (side.states === null) {
    return { severity: "NIT", reason: `no convention stated here (${side.gate || dim.gate || "suppressed"})` };
  }
  // The gates stated it and the file had no room to print it, so the agent was
  // never handed the sentence. MUST-FIX means the map told them and they are
  // the first to break it, and here the map did not tell. Same ladder position
  // staleness and a partial predicate already occupy.
  if (dropped) return { severity: "FIX", reason: "the area file had no room to state this claim" };
  if (!fresh) return { severity: "FIX", reason: "capped by this run: stale map or no merge base" };
  if (dim.precision !== "precise") {
    return { severity: "FIX", reason: "partial predicate: some sites are not visible statically" };
  }
  if (isException(dim, side, file)) {
    return { severity: "FIX", reason: "the map already names this file as an exception" };
  }

  const base = baselineSide(dim, side);
  if (!base) return { severity: "FIX", reason: "no baseline population recorded" };
  // A claim the map stated on the rest of the repository's confidence rather
  // than on this area's own sample. It is a real claim and it is enforced, but
  // not at the severity that means "this branch is the first violation in this
  // area's history", which is a statement about this area's sample alone.
  if (side.borrowed) {
    return {
      severity: "FIX",
      reason: `${base.conforming} of ${base.candidates} baseline sites here, on a claim the rest of the repository carries`,
    };
  }
  // The same bound the scan states a directive on, or the check would enforce
  // at top severity a claim the scan considered too thin to make.
  if (wilsonLower(base.conforming, base.candidates) < GATES.minRatio) {
    return {
      severity: "FIX",
      reason: `${base.conforming} of ${base.candidates} baseline sites is thin`,
    };
  }
  if (base.conforming !== base.candidates) {
    return {
      severity: "FIX",
      reason: `${base.conforming} of ${base.candidates} baseline sites conform`,
    };
  }
  return {
    severity: "MUST-FIX",
    reason: `all ${base.candidates} baseline sites conform`,
  };
}

/**
 * The baseline counts for the side the map actually stated. Reading the stored
 * pair on a counter area would measure the sentence the agent was never given,
 * and an area at 1 of 200 would come back as the strongest possible evidence
 * for the claim it suppressed.
 */
function baselineSide(dim, side) {
  const base = dim.baseline;
  if (!base) return null;
  if (side.side !== "counter") return base;
  const candidates = base.candidates ?? 0;
  return {
    candidates,
    conforming: candidates - (base.conforming ?? 0),
    exceptions: base.counterExceptions || [],
  };
}

function isException(dim, side, file) {
  const base = dim.baseline;
  const fromBaseline = side.side === "counter"
    ? (base && base.counterExceptions) || []
    : (base && base.exceptions) || [];
  const listed = [...(side.exceptions || []), ...fromBaseline];
  return listed.some((e) => e && (e.path === file.path || e.path === file.oldPath));
}

/**
 * Staleness caps severity at FIX. It is never a gate: a check that refuses to
 * run at pull-request time is the blocking hook this design rejects, arriving
 * at the moment it costs most.
 */
async function staleness(root, facts, base, unreadable = null) {
  if (unreadable) return { reason: "the map on disk could not be read by this build" };
  if (!facts) return { reason: "no map on disk" };
  if (facts.suppressAll) return { reason: "the scan was truncated, so no directive was stated" };

  // The pin, its reachability and the drift range all come from the baseline
  // module, so the check measures staleness against the same population and the
  // same base ref the scan pinned rather than a second reading of them.
  const state = await resolveBaseline(root, { baseRef: base.ref });
  if (state.status === "unpinned") return { reason: "no baseline pinned" };
  if (state.status === "unreachable") return { reason: "the pinned baseline commit is unreachable" };
  if (!state.drift) return { reason: state.baseRefReason || "drift could not be measured" };

  let mapped = 0;
  for (const area of state.areas.values()) mapped += area.files.size;
  if (!mapped) return { reason: "the pinned population is empty" };

  const share = state.drift.total / mapped;
  // The counts travel whichever side of the cliff this is: below it the caller
  // has nothing else to say how far the map has moved, and it was measured,
  // compared once and thrown away.
  const drift = { changed: state.drift.total, mapped, share };
  if (share >= CHECK.driftShare) {
    return { reason: `${state.drift.total} of ${mapped} mapped files changed since the pin`, drift };
  }
  return { reason: null, drift };
}

/* --- surroundings --- */

/**
 * Nested areas both contain the path; the deepest one carries its claims.
 *
 * Indexed once per area list rather than per call: this sits inside two
 * per-file loops, and rebuilding the path list there cost one allocation and a
 * second walk for every changed file.
 */
function areaIndex(areas = []) {
  const byPath = new Map(areas.map((a) => [a.path, a]));
  const paths = [...byPath.keys()];
  return (path) => {
    const owner = areaOwner(path, paths);
    return owner === null ? null : byPath.get(owner);
  };
}

/**
 * The areas one area sits inside, nearest first.
 *
 * A dimension that finds zero sites in an area produces no slot at all, so an
 * area whose baseline held no site of a construct has no sentence to ask and
 * the first one it ever sees is unaskable, at any severity. That is blinder
 * than an uncovered file, which at least gets the model-default NIT. The
 * ancestor's sentence was measured over a population this directory sits
 * inside, which is the smallest honest thing to fall back to.
 *
 * Built once per area list rather than per file: the lookup sits inside a
 * per-file loop and a repository's areas are a fixed list per run.
 */
function ancestorsIndex(areas = []) {
  const up = new Map();
  // A record somebody edited by hand can carry an area with no path at all, and
  // this runs before anything reads one. Guarded the way `knownNames` guards
  // its own list: the array is checked, its entries are not.
  for (const a of areas.filter((x) => x && typeof x.path === "string")) {
    const above = areas
      .filter((o) => o && typeof o.path === "string")
      .filter((o) => o.path !== a.path && (o.path === "." || a.path.startsWith(`${o.path}/`)))
      // Nearest first: the longest matching prefix is the closest enclosing
      // area, and the repository root is furthest of all.
      .sort((x, y) => (x.path === "." ? 1 : y.path === "." ? -1 : y.path.length - x.path.length));
    up.set(a.path, above);
  }
  return (area) => (area ? up.get(area.path) ?? [] : []);
}

/** The nearest enclosing area that states this dimension, and where it was counted. */
function ancestorSlot(ancestorsOf, area, key) {
  for (const up of ancestorsOf(area)) {
    const d = (up.dimensions || []).find((x) => x.key === key);
    if (d && statedSide(d).states !== null) return { dim: d, from: up.path };
  }
  return null;
}

/**
 * The paths carrying work that is not committed yet.
 *
 * Filtered by the same predicate that decides what the check would read, not by
 * intersection with the diff: work still only in the working tree is absent
 * from the diff by definition, and that is the state this exists to reach. An
 * agent writes, checks, fixes, then commits, so the moment the findings are
 * cheapest is the moment the work is not committed.
 */
async function pendingPaths(root) {
  // `-uall`, because the default collapses an untracked directory to a single
  // entry ending in `/`, which is not a source path and was dropped: a wholly
  // new directory checked before its first commit read clean.
  const r = await git(root, ["status", "--porcelain", "-uall", "-z"]);
  if (!r.ok) return null;
  const rows = parsePorcelainRows(r.out).filter((row) => wanted(row.path));
  const gone = (row) => row.x === "D" || row.y === "D";
  // Untracked, or added to the index: there is no committed version to compare
  // against, which is what an addition is.
  const isNew = (row) => row.x === "?" || row.x === "A";
  return {
    present: rows
      .filter((row) => !gone(row))
      .map((row) => ({
        path: row.path,
        status: isNew(row) ? "A" : "M",
        // Where the base version is read from. A rename keeps its old path, or
        // every site in the file reads as new and a `git mv` before committing
        // charges this branch for code it never wrote.
        from: isNew(row) ? null : (row.orig ?? row.path),
      })),
    // Listed as pending with nothing to read: examined as a file, it reported
    // one file read from the tree and one it could not read, about the same
    // path, in the same run. It still reaches the obligations, because a
    // companion deleted in the tree is a companion this branch owes. A rename
    // is a deletion of the path it moved away from and says no `D` at all, so
    // that path is taken from `orig` rather than from the status letters.
    deleted: [
      ...rows.filter(gone).map((row) => row.path),
      ...rows.map((row) => row.orig).filter((path) => path !== null && wanted(path)),
    ],
  };
}

/**
 * Which pending additions have a base version after all.
 *
 * The index letter says a path is an addition, which is a fact about the index
 * and not about the merge base: `git rm --cached` and a delete-then-restore
 * both report one for a path whose committed version is right there. Read as
 * having no base, every site in the file is charged to this branch.
 *
 * One listing, and only when a row claims to be new. What it cannot answer is a
 * file moved to a name it never had: `git status` rename-detects nothing for an
 * untracked path, so that file is new until the move is committed, where
 * `--find-renames` picks it up.
 */
async function resolvePendingBases(root, mergeBase, rows) {
  const claims = rows.filter((row) => row.from === null);
  if (!mergeBase || claims.length === 0) return;
  const atBase = await filesAt(root, mergeBase, {
    timeout: GIT.checkTimeoutMs,
    maxFieldBytes: GIT.checkMaxBytes,
  });
  if (atBase === null) return;
  for (const row of claims) {
    if (atBase.has(row.path)) row.from = row.path;
  }
}

/**
 * The diff rows, with the working tree's own edits folded in.
 *
 * A path already in the diff keeps its row, and `from` with it, so a rename
 * edited before it was committed still reads its base version from the old
 * path. A path only in the tree is a row of its own. Either way the row is
 * marked, because the head side of a marked row is read from disk and the run
 * is then not reproducible from git alone, which the report has to say.
 */
function withPendingEdits(rows, pending) {
  const byPath = new Map(rows.map((row) => [row.path, row]));
  for (const { path, status, from } of pending) {
    const row = byPath.get(path);
    // A row the diff already named keeps its own `from`: the diff resolved the
    // rename against the merge base, which is the comparison being made, and
    // `status` says nothing the diff has not already said better.
    if (row) byPath.set(path, { ...row, tree: true });
    else byPath.set(path, { status, path, from, tree: true });
  }
  return [...byPath.values()];
}

/**
 * One path as it stands on disk, or null.
 *
 * Resolved rather than joined. The scan refuses to write through a link out of
 * the repository, and this reads, so it refuses to read through one: the text
 * a dimension matches reaches a report the agent reads back, and a link is
 * enough to put a file from anywhere on the machine in it.
 */
async function treeSource(root, path) {
  const abs = safeResolve(root, path);
  if (abs === null) return null;
  // One handle, opened once and asked its own size: a path stat'd and then read
  // is two lookups of a name, and the file behind the name can be replaced
  // between them. The bound is the one the committed side reads under, because
  // the two sides disagreeing on what is too big is what `limits.mjs` stops.
  let handle = null;
  try {
    handle = await open(abs, "r");
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
    return await handle.readFile("utf8");
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/**
 * Every git call returns rather than throws. The check reports what it could
 * not determine; it does not refuse.
 */
async function git(root, args, maxBytes = GIT.checkMaxBytes) {
  const r = await gitBuffered(root, args, { maxBytes, timeout: GIT.checkTimeoutMs });
  return { ok: r.ok, out: r.stdout };
}

function tally(findings) {
  const counts = { "MUST-FIX": 0, FIX: 0, NIT: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

