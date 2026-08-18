import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

import { parseAll } from "./parse.mjs";
import { dimensionsFor } from "./dimensions.mjs";
import { GATES, groupKey, wilsonLower } from "./reduce.mjs";
import {
  collect as collectCorpus,
  frameworksIn,
  capabilitiesIn,
  gitRoot,
  isSource,
  isDenied,
  isExcludedDir,
  safeResolve,
} from "./corpus.mjs";
import { language, MISSING_STRIPPER } from "./langs.mjs";
import { areaOwner } from "./areas.mjs";
import { encode, encodePath, quotePath, sanitisePath } from "./encode.mjs";
import { unexaminedPhrase } from "./render.mjs";
import { auditRules, knownNames, listSome, LISTED, RULES_DIR } from "./rules.mjs";
import { readFacts, statedSide } from "./facts.mjs";
import { MAX_FILE_BYTES } from "./limits.mjs";
import { resolve as resolveBaseline } from "./baseline.mjs";
import { pairingsFor, pairingViolations } from "./pairing.mjs";
import { fillClass, claimFor, CLASSES } from "./dimensions-naming.mjs";
import { rowsOfKind } from "./registry.mjs";
import { couldSignal } from "./frameworks.mjs";
import {
  gitBuffered, gitStreamed, nameStatusReader, parsePorcelainRows, resolveBaseRef, mergeBase, filesAt,
  showBlob, headSha, BASE_REFS, GIT,
} from "./git.mjs";

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
  snippetChars: 100,
};

// The shape of the report, so a reader older than the record refuses it rather
// than reading fields that moved. Same rule the facts record already carries.
export const CHECK_SCHEMA = 1;

/**
 * Why a run could not answer in full, as a code rather than as a sentence.
 *
 * The sentence is still there and is what a human reads. The code is what
 * anything else reads: with prose alone, telling "the diff could not be read"
 * from "one file was read from the working tree" is a substring match on
 * wording nobody promised to keep.
 */
export const CAVEATS = Object.freeze({
  MAP_UNREADABLE: "map-unreadable",
  NO_MAP: "no-map",
  NO_BASE_REF: "no-base-ref",
  NO_MERGE_BASE: "no-merge-base",
  NOTHING_EXAMINED: "nothing-examined",
  SHALLOW_NO_HISTORY: "shallow-no-history",
  SHALLOW_UNFETCHED: "shallow-unfetched",
  DIFF_UNREADABLE: "diff-unreadable",
  ADDED_RANGES_UNREADABLE: "added-ranges-unreadable",
  PENDING_UNLISTED: "pending-unlisted",
  PENDING_UNJUDGED: "pending-unjudged",
  READ_FROM_TREE: "read-from-tree",
  FRAMEWORKS_UNKNOWN: "frameworks-unknown",
  CAPABILITIES_UNKNOWN: "capabilities-unknown",
  HEAD_UNREADABLE: "head-unreadable",
  BASE_UNREADABLE: "base-unreadable",
  // One per cause, matching the four sentences `unreadReason` states, because
  // the reader's next move differs for each: a crash is this tool's, rejected
  // syntax is the branch's own code, and the cap is a generated file.
  HEAD_CRASHED: "head-crashed",
  HEAD_REJECTED: "head-rejected",
  HEAD_OVERSIZE: "head-oversize",
  HEAD_UNPARSED: "head-unparsed",
  BASE_UNPARSED: "base-unparsed",
  STRIPPER_MISSING: "stripper-missing",
  OBLIGATIONS_UNCHECKED: "obligations-unchecked",
  RULES_ESCAPED: "rules-escaped",
  RULES_UNLISTED: "rules-unlisted",
  RULES_UNREADABLE: "rules-unreadable",
});

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
    caveat(caveats, CAVEATS.SHALLOW_UNFETCHED, "shallow clone and the base commit could not be fetched");
  } else {
    caveat(caveats, CAVEATS.NO_BASE_REF, `no base ref resolved from ${candidates.join(", ")}`);
  }

  // No ref, not the first candidate: the caveat above already names what was
  // tried, and reporting a base the run did not use reads as one it did.
  return { ref: null, sha: null, mergeBase: null, shallow, boundary: await boundary(root) };
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

async function collect(root, { examined, areas, base, mode, added, fresh, caveats, frameworks, capabilities, pending }) {
  const areaFor = areaIndex(areas);
  // Resolved once. A blob is read by object name rather than by ref, so a pin
  // file cannot name something else and have it read as source.
  const head = await headSha(root);
  const jobs = [];
  for (const file of examined) {
    const lang = language(file.path);
    if (dimensionsFor([lang], { frameworks, capabilities }).length === 0) continue; // nothing is claimed about this language

    const source = file.tree ? await treeSource(root, file.path) : await blob(root, head, file.path);
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
    const job = { file, lang, source, base: null };

    // The base version is read with the rename map applied: at the merge base
    // the new path does not exist, and a path hash cannot tell a rename from a
    // delete plus an add. Only the head side is ever read from the tree, so no
    // edit of an agent's can move the base it is judged against.
    if (mode === "compare" && file.from) {
      job.base = await blob(root, base.mergeBase, file.from);
      // Without the base version every site in the file reads as new, which is
      // the forgery this design exists to prevent. Say so and check nothing.
      if (job.base === null) {
        caveat(
          caveats,
          CAVEATS.BASE_UNREADABLE,
          `could not read ${file.from} at the merge base, so ${file.path} was skipped`
        );
        continue;
      }
    }
    jobs.push(job);
  }

  const entries = [];
  for (const job of jobs) {
    entries.push({ rel: `head:${job.file.path}`, lang: job.lang, source: job.source });
    if (job.base !== null) {
      entries.push({ rel: `base:${job.file.path}`, lang: job.lang, source: job.base });
    }
  }

  const { records: parsed, missingEngines, missingParser, missingStripper } = await parseAll(entries, { withProgram: true });
  const findings = [];

  for (const job of jobs) {
    const path = job.file.path;
    const area = areaFor(path);
    // A corpus row's site is the name itself, which needs no tree, so these
    // are judged before the parse guards can skip the file.
    for (const row of CORPUS_ROWS) {
      const named = filenameFinding(row, job, area, fresh);
      if (named) findings.push(named);
    }

    const headParse = parsed.get(`head:${path}`);
    if (!headParse || !headParse.ok || !headParse.program) {
      caveat(caveats, unreadCode(headParse), `${path} ${unreadReason(headParse)}, so it was not checked`);
      continue;
    }

    // The fingerprint carries the base path so a pure rename produces the same
    // key on both sides. Never a path plus a line number: one added import
    // shifts every line and a `git mv` changes every path, and either would
    // forge a whole file of new findings.
    const keyPath = job.file.from || path;
    // Which sentence this area was told, per dimension. Read before either
    // analysis and handed to both, so a site that exists on both sides is
    // judged against one polarity: read separately, a file whose area states
    // the inverse would show every pre-existing site as newly introduced.
    const { sides, learned } = sidesFor(area);
    const head = violations(headParse.program, job.source, job.lang, keyPath, { sides, learned, frameworks, capabilities, comments: headParse.comments, stripped: headParse.stripped });

    const baseParse = parsed.get(`base:${path}`);
    const baseUsable = !baseParse || (baseParse.ok && baseParse.program);
    // A base version that exists but will not parse is not an empty base
    // version. Treating it as one would charge the author with every site the
    // file already held.
    if (!baseUsable) {
      caveat(caveats, CAVEATS.BASE_UNPARSED, `${path} did not parse at the merge base, so it was skipped`);
      continue;
    }

    let introduced;
    if (mode === "added-lines") {
      const ranges = (added && added.get(path)) || [];
      introduced = head.filter((f) => ranges.some(([a, b]) => f.line >= a && f.line <= b));
    } else {
      introduced = newlyIntroduced(
        head,
        baseParse ? violations(baseParse.program, job.base, job.lang, keyPath, { sides, learned, frameworks, capabilities, comments: baseParse.comments, stripped: baseParse.stripped }) : []
      );
    }

    for (const f of introduced) {
      const dim = area && (area.dimensions || []).find((d) => d.key === f.dimension);
      // Inside a mapped area the scan recorded every dimension it found a site
      // of, so one missing from that list is a convention the map measured and
      // said nothing about. The check enforces what the map stated; outside
      // every area nothing was measured at all, which is what the NIT is for.
      if (area && !dim) continue;
      const verdict = severityFor({ path, oldPath: job.file.from }, { dim, fresh });
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
        snippet: f.text,
      });
    }

  }

  await addPairingFindings(root, findings, { examined, areas, fresh, caveats, pending });
  // The scan says this on its own summary, and a check runs in CI where nobody
  // read that. Without it a Flow file reads as a broken file.
  if (missingStripper) {
    caveat(caveats, CAVEATS.STRIPPER_MISSING, MISSING_STRIPPER);
  }

  return { findings, missingParser, missingEngines };
}

/**
 * Obligations the branch broke.
 *
 * Kept apart from the loop above because that loop runs a dimension against a
 * parsed program and an obligation has none. Without this the check ran every
 * claim it could execute, reported clean, and said nothing about the one it
 * could not: the same shape as reporting clean for a file that was never read.
 */
async function addPairingFindings(root, findings, { examined, areas, fresh, caveats, pending }) {
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
      const verdict = severityFor({ path, oldPath: null }, { dim, fresh });
      findings.push({
        severity: verdict.severity,
        reason: `${verdict.reason}; no ${encodePath(companion)}`,
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
function filenameFinding(row, job, area, fresh) {
  const path = job.file.path;
  const nameDim = area && (area.dimensions || []).find((d) => d.key === row.key);
  if (!nameDim || typeof nameDim.learned !== "string" || !CLASSES.includes(nameDim.learned)) return null;
  const cls = row.classify(path);
  const from = job.file.from;
  const answers = !from || (from !== path && row.classify(from) !== cls);
  if (!answers || cls === null || cls === nameDim.learned) return null;
  const oldPath = from && from !== path ? from : null;
  const verdict = severityFor({ path, oldPath }, { dim: nameDim, fresh });
  return {
    severity: verdict.severity,
    reason: verdict.reason,
    path,
    oldPath,
    line: 1,
    area: area.path,
    dimension: row.key,
    claim: fillClass(row.claim, nameDim.learned),
    precision: nameDim.precision ?? "precise",
    where: null,
    snippet: path.slice(path.lastIndexOf("/") + 1),
  };
}

/**
 * The side each dimension of this area was rendered on, keyed by dimension.
 * A path in no area yields an empty map, and the claim side is the default,
 * which is what every one-sided dimension and every schema-1 map reads as.
 */
function sidesFor(area) {
  const sides = new Map();
  const learned = new Map();
  for (const d of (area && area.dimensions) || []) {
    sides.set(d.key, statedSide(d).side);
    // The class the map measured is the only sentence a learned row may be
    // enforced as; a hit's own flag is a placeholder the reducer overwrites.
    if (typeof d.learned === "string") learned.set(d.key, d.learned);
  }
  return { sides, learned };
}

/**
 * Whether the class the map stored may be enforced as this row's sentence.
 *
 * The value comes off a repository-committed record, so it is refused here
 * rather than where it is rendered (F4). A row whose class is a name out of the
 * source is encoded by `claimFor`, and what the encoder empties would state a
 * sentence naming nothing. Every other row votes inside a closed vocabulary,
 * and a value from outside it enforces nothing.
 */
function enforceableClass(dim, cls) {
  if (typeof cls !== "string") return false;
  if (dim.learnedFromSource) return encode(cls) !== "";
  // A row that can learn an absence is a prefix row: its vocabulary is one
  // capital or none at all. The rest vote for one of the four naming classes.
  return typeof dim.noneClaim === "string" ? /^(?:[A-Z]|none)$/.test(cls) : CLASSES.includes(cls);
}

function violations(program, source, lang, keyPath, { sides = new Map(), learned = new Map(), frameworks, capabilities, comments = [], stripped = false } = {}) {
  const out = [];
  // A tree that came back from the Flow retry has its annotations blanked, so
  // the dimensions whose question is the annotation would report a violation
  // beside the line that satisfies it. The scan drops them for such a file and
  // this has to agree, or the map and the check disagree about the same file.
  for (const dim of dimensionsFor([lang], { frameworks, capabilities })) {
    if (stripped && dim.blindWhenStripped) continue;
    // A learned row with no class the map may state has no sentence to
    // enforce: every hit is a vote, and a vote is not a violation.
    const cls = learned.get(dim.key);
    if (dim.learnedClasses && !enforceableClass(dim, cls)) continue;
    const counter = sides.get(dim.key) === "counter" && typeof dim.counterClaim === "string";
    const found = [];
    const conformingOf = (hit) => (dim.learnedClasses ? hit.class === cls : hit.conforming);
    const site = (hit) => {
      const node = hit.node || {};
      // Slice the same in-memory string the parser was handed. oxc reports
      // UTF-16 code units, a disk buffer is bytes, and 5.4% of real files are
      // non-ASCII, so indexing a buffer with a parser offset corrupts silently.
      const located = typeof node.start === "number" && typeof node.end === "number";
      const text = located ? normalise(source.slice(node.start, node.end)) : "";
      return {
        dimension: dim.key,
        claim: counter ? dim.counterClaim : dim.learnedClasses ? claimFor(dim, cls) : dim.claim,
        precision: dim.precision,
        where: hit.where || null,
        line: located ? lineAt(source, node.start) : node.line || 1,
        text,
        // A parser that reports no offset into the string above leaves the
        // node's own name as the site's identity. The line is never part of it:
        // one added import shifts every line below it.
        fp: fingerprint(keyPath, dim.key, node.type, text || node.name || ""),
      };
    };
    // A grouped row answers per enclosing body, so its hits are held until the
    // walk is over: one include out of two matching is the body conforming, and
    // reporting per constant would charge the author twice for one class.
    const bodies = dim.groupedSites ? new Map() : null;
    // A dimension that throws on this program loses its own findings for this
    // file. Both sides of the comparison run the same dimensions over the same
    // shapes, so a failure that is not symmetric can only lose a finding, never
    // manufacture one.
    try {
      dim.run(program, (hit) => {
        if (bodies) {
          const key = groupKey(hit, bodies.size);
          if (bodies.has(key)) bodies.get(key).push(hit);
          else bodies.set(key, [hit]);
          return;
        }
        // On the counter side the conforming sites are the ones that break what
        // the map said. Enforcing `!conforming` there charges an author for
        // writing the sentence the area handed them.
        if (counter ? !conformingOf(hit) : conformingOf(hit)) return;
        found.push(site(hit));
      }, { comments, source });
    } catch {
      continue;
    }
    for (const hits of bodies ? bodies.values() : []) {
      const conforming = hits.some(conformingOf);
      if (counter ? !conforming : conforming) continue;
      // The body's first hit is where the reader is sent, because that is where
      // the body says what it mixes in.
      const at = site(hits[0]);
      // The whole body is the site, so its identity is what it mixes in, sorted:
      // the first hit's own node is `include` in every body of the file, and
      // swapping two includes is not a violation anyone introduced. Adding one
      // to a body that already violated is charged, which is accepted: the
      // branch did edit the violating body.
      at.fp = fingerprint(keyPath, dim.key, "body", constantsOf(hits));
      found.push(at);
    }
    out.push(...found);
  }
  return out;
}

/**
 * Identical sites in one file are distinguished by count, not by identity: two
 * copies of the same violation at the base absorb two at HEAD, and a third one
 * is new. The enclosing declaration's name is deliberately not part of the key,
 * because renaming a function does not introduce the violation inside it.
 */
function newlyIntroduced(head, base) {
  const remaining = new Map();
  for (const f of base) remaining.set(f.fp, (remaining.get(f.fp) || 0) + 1);

  const out = [];
  for (const f of head) {
    const left = remaining.get(f.fp) || 0;
    if (left > 0) {
      remaining.set(f.fp, left - 1);
      continue;
    }
    out.push(f);
  }
  return out;
}

// What a grouped body declares, in one order whatever order it was written in.
// A body that declares nothing has no constants to be told apart by, so it
// answers with its own name: every bare body in a file was otherwise the same
// site, and a new one absorbed an older one's finding, which put the report on
// a body the branch never touched.
const constantsOf = (hits) => {
  const constants = hits.map((h) => h.class).filter(Boolean).sort().join(" ");
  return constants || `body ${hits[0]?.where ?? ""}`;
};

function fingerprint(path, key, kind, text) {
  return createHash("sha256").update([path, key, kind, text].join("\0")).digest("hex").slice(0, 16);
}

const normalise = (s) => s.replace(/\s+/g, " ").trim();

function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === "\n") line++;
  return line;
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
export function severityFor(file, { dim, fresh }) {
  if (!dim) return { severity: "NIT", reason: "no convention counted here" };
  const side = statedSide(dim);
  if (side.states === null) {
    return { severity: "NIT", reason: `no convention stated here (${side.gate || dim.gate || "suppressed"})` };
  }
  if (!fresh) return { severity: "FIX", reason: "capped by this run: stale map or no merge base" };
  if (dim.precision !== "precise") {
    return { severity: "FIX", reason: "partial predicate: some sites are not visible statically" };
  }
  if (isException(dim, side, file)) {
    return { severity: "FIX", reason: "the map already names this file as an exception" };
  }

  const base = baselineSide(dim, side);
  if (!base) return { severity: "FIX", reason: "no baseline population recorded" };
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
  if (share >= CHECK.driftShare) {
    return { reason: `${state.drift.total} of ${mapped} mapped files changed since the pin` };
  }
  return { reason: null, share };
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
 * One path's content at one revision, or null.
 *
 * Through `showBlob` rather than `git show`, which prints a tree listing for a
 * path that has since become a directory and would be parsed here as source.
 */
async function blob(root, rev, path) {
  const r = await showBlob(root, rev, path, { timeout: GIT.checkTimeoutMs });
  return r.ok ? r.content.toString("utf8") : null;
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

/**
 * One group of rule files, bounded.
 *
 * The count is the whole signal past a handful, and this report is read by an
 * agent: a repository holding ten thousand `.md` files in `.claude/rules/`
 * would otherwise spend ten thousand lines of its context saying so.
 */
function listRules(lines, names, what) {
  if (names.length === 0) return;
  const { shown, rest } = listSome(names, LISTED.report);
  lines.push("", `${names.length} file(s) in ${RULES_DIR} ${what}:`);
  for (const name of shown) lines.push(`  ${quotePath(name)}`);
  if (rest) lines.push(`  and ${rest} more`);
}

function tally(findings) {
  const counts = { "MUST-FIX": 0, FIX: 0, NIT: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

/**
 * The report with every repository-controlled value neutralised: paths,
 * enclosing names, matched source text, and the sentences the run's own
 * caveats quote them in.
 *
 * A pass of its own rather than the renderer's last step, because
 * `JSON.stringify` escapes neither a bidi override nor a zero-width joiner
 * (they are category Cf), so a writer that is not the text renderer would put
 * them into a file unaltered.
 *
 * The claim is the one string left alone: it is this tool's own sentence
 * rather than a repository-controlled value, and the encoder strips the `|`
 * that "defaults are taken with ??, not ||" needs.
 */
export function encodeReport(report) {
  return {
    ...report,
    base: { ...report.base, ref: report.base.ref == null ? null : encode(report.base.ref) },
    staleReason: report.staleReason == null ? null : encode(report.staleReason),
    changed: report.changed.map((row) => encodeRow(row)),
    examined: report.examined.map((row) => encodeRow(row)),
    findings: report.findings.map((f) => encodeFinding(f)),
    counts: { ...report.counts },
    caveats: report.caveats.map((c) => ({ code: c.code, message: encode(c.message) })),
    parse: { ...report.parse },
    semantic: { ...report.semantic },
    // Each of these passes one argument on purpose: `map` hands its callback
    // an index, and `sanitisePath` reads a second argument as the cap.
    foreign: report.foreign.map((name) => sanitisePath(name)),
    unknown: report.unknown.map((name) => sanitisePath(name)),
    rules: { ...report.rules, unreadable: report.rules.unreadable.map((name) => sanitisePath(name)) },
  };
}

// Sanitised rather than quoted, so a writer with a field to put a path in is
// not handed one wrapped in the quoting the text line needs.
function encodeRow(row) {
  return { ...row, path: sanitisePath(row.path), from: row.from == null ? null : sanitisePath(row.from) };
}

function encodeFinding(f) {
  return {
    ...f,
    path: sanitisePath(f.path),
    oldPath: f.oldPath == null ? null : sanitisePath(f.oldPath),
    area: f.area == null ? null : sanitisePath(f.area),
    where: f.where == null ? null : encode(f.where),
    reason: encode(f.reason),
    snippet: f.snippet == null ? null : encode(f.snippet, { max: CHECK.snippetChars }),
  };
}

/** The report as the terminal shows it. */
export function formatReport(report) {
  return renderText(encodeReport(report));
}

/** The report as the record it is, for a reader that is not a terminal. */
export function formatReportJson(report) {
  return JSON.stringify(encodeReport(report), null, 2) + "\n";
}

const ANNOTATION = { "MUST-FIX": "error", FIX: "warning", NIT: "notice" };

/**
 * The report as GitHub workflow commands: one annotation per finding, on the
 * file and line it is about, and the counts as the last line.
 *
 * The counts go out even with nothing to annotate, because a job whose whole
 * output is an empty file reads as one that did not run.
 */
export function formatReportGithub(report) {
  const r = encodeReport(report);
  const lines = r.findings.map((f) => {
    const props = `file=${escapeProperty(f.path)},line=${f.line},title=${escapeProperty(f.claim)}`;
    return `::${ANNOTATION[f.severity]} ${props}::${escapeMessage(f.reason)}`;
  });
  lines.push(`::notice::${r.counts["MUST-FIX"]} MUST-FIX, ${r.counts.FIX} FIX, ${r.counts.NIT} NIT`);
  return lines.join("\n") + "\n";
}

// The percent first, or every escape below it is escaped a second time.
const escapeMessage = (s) =>
  String(s ?? "").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

// A comma ends a property and a colon ends the property list, so a value
// carrying either would move the rest of the line into the grammar.
const escapeProperty = (s) => escapeMessage(s).replace(/,/g, "%2C").replace(/:/g, "%3A");

/** Every value here is encoded already, so nothing in this function encodes. */
function renderText(report) {
  const lines = [];
  const { base, counts } = report;
  const at = base.sha ? ` (${base.sha.slice(0, 7)})` : "";
  const n = report.changed.length;
  // Compared as sets, not as sizes. `examined` drops what is not source and
  // adds what only the working tree has, so two counts can agree while naming
  // different files, and the header then hides the file a finding is about.
  const same =
    report.examined.length === n && report.examined.every((f, i) => f.path === report.changed[i]?.path);
  const examined = same ? "" : `, ${report.examined.length} examined`;
  lines.push(
    `base ${base.ref ?? "none"}${at}, ` +
      `${n} changed file${n === 1 ? "" : "s"}${examined}, ${report.mode}`
  );
  lines.push(`${counts["MUST-FIX"]} MUST-FIX, ${counts.FIX} FIX, ${counts.NIT} NIT`);
  if (report.stale) {
    lines.push(`severity capped at FIX: ${report.staleReason}`);
  }
  for (const c of report.caveats) lines.push(`note: ${c.message}`);
  // Rendered beside the other caveats rather than folded into them, because it
  // is about a whole class of claim rather than about one file.
  if (report.semantic?.claims) {
    const n = report.semantic.claims;
    lines.push(
      `note: ${n} type-checked claim${n === 1 ? " is" : "s are"} stated in the map and not enforced on a branch: ` +
        "the checker is whole-program, so it runs on `anatomiya scan --deep` and not here"
    );
  }

  for (const f of report.findings) {
    lines.push("");
    lines.push(`${f.severity}  ${quotePath(f.path)}:${f.line}  ${String(f.claim ?? "").replace(/\s+/g, " ").trim()}`);
    lines.push(`  ${f.where ? `${f.where}: ` : ""}${f.reason}`);
    if (f.snippet) lines.push(`  ${f.snippet}`);
  }

  listRules(lines, report.foreign, "this tool did not write");
  // Named apart from the above, because the reader's next move differs: one is
  // somebody else's context to read, the other is this tool's own output from a
  // scan whose record is gone, and re-scanning is what clears it.
  listRules(lines, report.unknown, "the map on disk does not name");

  return lines.join("\n") + "\n";
}
