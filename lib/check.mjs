import { createHash } from "node:crypto";

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
  language,
} from "./corpus.mjs";
import { areaOwner } from "./areas.mjs";
import { encode, encodePath } from "./encode.mjs";
import { unexaminedPhrase } from "./render.mjs";
import { auditRules, knownNames, listSome, LISTED, RULES_DIR } from "./rules.mjs";
import { readFacts, statedSide } from "./facts.mjs";
import { resolve as resolveBaseline } from "./baseline.mjs";
import { pairingsFor, pairingViolations } from "./pairing.mjs";
import { classifyBasename, fillClass, claimFor, CLASSES, NAMING_CORPUS } from "./dimensions-naming.mjs";
import {
  gitBuffered, gitStreamed, nameStatusReader, parsePorcelainZ, resolveBaseRef, mergeBase, filesAt,
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

const SEVERITY_ORDER = { "MUST-FIX": 0, FIX: 1, NIT: 2 };

export async function check(cwd, { baseRef = null } = {}) {
  const root = await gitRoot(cwd);
  const { facts, unreadable } = readFacts(root);
  const areas = facts ? facts.areas : [];
  const caveats = [];

  if (unreadable) caveats.push(unreadable);
  else if (!facts) caveats.push("no map on disk, so nothing was stated and nothing can be enforced");

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
    caveats.push(
      "no merge base, so findings are limited to lines added since the oldest " +
        "commit this clone holds and are not compared against the base"
    );
  }
  if (mode === "none") {
    caveats.push("no merge base and no earlier commit to compare against, so nothing was examined");
  }

  const diff = from ? await changedFiles(root, from) : { ok: true, rows: [] };
  if (!diff.ok) {
    caveats.push(
      `the diff against ${base.ref || from} could not be read, so no file was examined and this run found nothing it could look at`
    );
  }
  const changed = diff.rows.filter((c) => c.status !== "D");

  const examined = changed.filter((c) => wanted(c.path));

  await notePendingEdits(root, caveats);

  // The refusal reason travels, or the report prints "capped by this run: no
  // map on disk" above a note saying the map is a schema this build cannot
  // read. The first is false and points at the wrong fix.
  const stale = await staleness(root, facts, base, unreadable);
  const added = mode === "added-lines" ? await addedRanges(root, from) : null;
  if (mode === "added-lines" && added === null) {
    caveats.push(
      "the added-line ranges could not be read, so nothing was attributed to this branch in the degraded mode"
    );
  }

  // A framework's claim is only asked where the corpus shows the framework
  // (C8). `[]` rather than an absent value on the cheap branch: absent means
  // "no filter" to `dimensionsFor`, and this caller can answer the question.
  const frameworks = examined.some((f) => language(f.path) === "ruby")
    ? await frameworksHere(root, facts, caveats)
    : [];
  // The routing rows are offered the way a framework's are: only where the
  // repository shows an adopted wrapper to route through (C14). With no map on
  // disk the corpus fallback is filename vocabulary alone, which costs at most
  // a NIT in a repository that never adopted one. Nothing examined asks
  // nothing, so an empty diff never pays a corpus collect; a readable schema-9
  // map still does, once, until its repository is re-scanned.
  const capabilities = examined.length ? new Set(await capabilitiesHere(root, facts, caveats)) : new Set();

  const { findings, missingParser } = await collect(root, {
    examined,
    areas,
    base,
    mode,
    added,
    frameworks,
    capabilities,
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
    caveats.push(
      `${RULES_DIR} resolves outside the repository, so nothing there was examined: this is a symlink in the working tree`
    );
  } else if (!listed) {
    // Same rule again: a directory nobody could list is not one holding
    // nothing, and the files in it load whether or not this run saw them.
    caveats.push(`${RULES_DIR} could not be listed, so nothing there was examined`);
  }
  if (unreadableRules.length) {
    caveats.push(
      `${unreadableRules.length} file(s) in ${RULES_DIR} could not be read, so whose they are is unknown`
    );
  }

  return {
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
    parse: { missingParser },
    semantic: { claims: semanticClaims },
    foreign,
    unknown,
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
  return storedOrCollected(root, facts, "frameworks", frameworksIn, caveats,
    "the corpus could not be listed, so no framework's claims were checked");
}

/** The scan stored the answer; a repository with no map reads its own corpus. */
async function storedOrCollected(root, facts, field, derive, caveats, refusal) {
  const stored = facts && facts.corpus && facts.corpus[field];
  if (Array.isArray(stored)) return stored;
  try {
    return [...derive((await collectCorpus(root)).files)];
  } catch (err) {
    caveats.push(`${refusal}: ${err && err.message ? err.message : err}`);
    return [];
  }
}

/**
 * Which capability wrappers this repository shows, same contract as
 * `frameworksHere`: the scan stored it, and a repository with no map reads its
 * own corpus. Unanswered costs the routing claims, never a wrong one.
 */
async function capabilitiesHere(root, facts, caveats) {
  return storedOrCollected(root, facts, "capabilities", capabilitiesIn, caveats,
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
    if (!r.forkPoint) caveats.push(`no merge base between ${c} and HEAD`);
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
        caveats.push("shallow clone: the base commit is present but shares no held history with HEAD");
      }
      return {
        ref: c,
        sha: remote,
        mergeBase: mb.sha,
        shallow,
        boundary: mb.found ? null : await boundary(root),
      };
    }
    caveats.push("shallow clone and the base commit could not be fetched");
  } else {
    caveats.push(`no base ref resolved from ${candidates.join(", ")}`);
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

async function collect(root, { examined, areas, base, mode, added, fresh, caveats, frameworks, capabilities }) {
  const areaFor = areaIndex(areas);
  // Resolved once. A blob is read by object name rather than by ref, so a pin
  // file cannot name something else and have it read as source.
  const head = await headSha(root);
  const jobs = [];
  for (const file of examined) {
    const lang = language(file.path);
    if (dimensionsFor([lang], { frameworks, capabilities }).length === 0) continue; // nothing is claimed about this language

    const source = await blob(root, head, file.path);
    if (source === null) {
      caveats.push(`could not read ${file.path} at HEAD`);
      continue;
    }
    const job = { file, lang, source, base: null };

    // The base version is read with the rename map applied: at the merge base
    // the new path does not exist, and a path hash cannot tell a rename from a
    // delete plus an add.
    if (mode === "compare" && file.from) {
      job.base = await blob(root, base.mergeBase, file.from);
      // Without the base version every site in the file reads as new, which is
      // the forgery this design exists to prevent. Say so and check nothing.
      if (job.base === null) {
        caveats.push(`could not read ${file.from} at the merge base, so ${file.path} was skipped`);
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

  const { records: parsed, missingParser, missingStripper } = await parseAll(entries, { withProgram: true });
  const findings = [];

  for (const job of jobs) {
    const path = job.file.path;
    const area = areaFor(path);
    // The filename claim's site is the name itself, which needs no tree, so it
    // is judged before the parse guards can skip the file.
    const named = filenameFinding(job, area, fresh);
    if (named) findings.push(named);

    const headParse = parsed.get(`head:${path}`);
    if (!headParse || !headParse.ok || !headParse.program) {
      caveats.push(`${path} ${unreadReason(headParse)}, so it was not checked`);
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
      caveats.push(`${path} did not parse at the merge base, so it was skipped`);
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

  await addPairingFindings(root, findings, { examined, areas, fresh, caveats });
  // The scan says this on its own summary, and a check runs in CI where nobody
  // read that. Without it a Flow file reads as a broken file.
  if (missingStripper) {
    caveats.push("flow-remove-types is not installed, so a file written in Flow is rejected rather than read");
  }

  return { findings, missingParser };
}

/**
 * Obligations the branch broke.
 *
 * Kept apart from the loop above because that loop runs a dimension against a
 * parsed program and an obligation has none. Without this the check ran every
 * claim it could execute, reported clean, and said nothing about the one it
 * could not: the same shape as reporting clean for a file that was never read.
 */
async function addPairingFindings(root, findings, { examined, areas, fresh, caveats }) {
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
    caveats.push(
      "the file list at HEAD could not be read, so no file-to-file obligation was checked"
    );
    return;
  }

  for (const pairing of pairings) {
    for (const { path, companion } of pairingViolations(changed, tree, pairing)) {
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

/**
 * The filename claim's site is the name itself, which no tree walk sees. A file
 * this branch created answers it outright; a rename answers it only when the
 * name changed class, because the old name predates the branch and a same-class
 * rename kept the convention.
 */
function filenameFinding(job, area, fresh) {
  const path = job.file.path;
  const nameDim = area && (area.dimensions || []).find((d) => d.key === "file_naming_case");
  if (!nameDim || typeof nameDim.learned !== "string" || !CLASSES.includes(nameDim.learned)) return null;
  const cls = classifyBasename(path);
  const from = job.file.from;
  const answers = !from || (from !== path && classifyBasename(from) !== cls);
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
    dimension: "file_naming_case",
    claim: fillClass(NAMING_CORPUS.find((d) => d.key === "file_naming_case").claim, nameDim.learned),
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
    // A dimension that throws on this program loses its own findings for this
    // file. Both sides of the comparison run the same dimensions over the same
    // shapes, so a failure that is not symmetric can only lose a finding, never
    // manufacture one.
    try {
      dim.run(program, (hit) => {
        const conforming = dim.learnedClasses ? hit.class === cls : hit.conforming;
        // On the counter side the conforming sites are the ones that break what
        // the map said. Enforcing `!conforming` there charges an author for
        // writing the sentence the area handed them.
        if (counter ? !conforming : conforming) return;
        const node = hit.node || {};
        // Slice the same in-memory string the parser was handed. oxc reports
        // UTF-16 code units, a disk buffer is bytes, and 5.4% of real files are
        // non-ASCII, so indexing a buffer with a parser offset corrupts silently.
        const located = typeof node.start === "number" && typeof node.end === "number";
        const text = located ? normalise(source.slice(node.start, node.end)) : "";
        found.push({
          dimension: dim.key,
          claim: counter ? dim.counterClaim : dim.learnedClasses ? claimFor(dim, cls) : dim.claim,
          precision: dim.precision,
          where: hit.where || null,
          line: located ? lineAt(source, node.start) : node.line || 1,
          text,
          // A language whose parser reports no offset we may index with (B5)
          // leaves the node's own name as the site's identity. The line is never
          // part of it: one added import shifts every line below it.
          fp: fingerprint(keyPath, dim.key, node.type, text || node.name || ""),
        });
      }, { comments, source });
    } catch {
      continue;
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
 */
export function unreadReason(parse) {
  // This surface always names one file, so it always takes the singular form.
  const kind = { crashed: "crashed", oversize: "skipped", rejected: "syntaxErrors" }[parse && parse.kind];
  return kind ? unexaminedPhrase(kind, 1) : unexaminedPhrase("failed", 1);
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
 * The diff is committed content, so uncommitted edits are invisible to it.
 *
 * The dirty set is filtered by the same predicate that decides what the check
 * would have read, not by intersection with the diff. Work that is still only
 * in the working tree is absent from the diff by definition, and that is the
 * state this note exists to describe: an empty diff and a silent zero read as
 * "conforms" rather than as "nothing was examined".
 */
async function notePendingEdits(root, caveats) {
  const r = await git(root, ["status", "--porcelain", "-z"]);
  if (!r.ok) return;
  const dirty = parsePorcelainZ(r.out).filter(wanted);
  if (dirty.length) {
    caveats.push(`${dirty.length} file(s) have uncommitted edits the check did not read`);
  }
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
  for (const name of shown) lines.push(`  ${encodePath(name)}`);
  if (rest) lines.push(`  and ${rest} more`);
}

function tally(findings) {
  const counts = { "MUST-FIX": 0, FIX: 0, NIT: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

/**
 * Findings carry repository-controlled values: paths, enclosing names and
 * matched source text. They pass through the one encoder on the way out.
 */
export function formatReport(report) {
  const lines = [];
  const { base, counts } = report;
  const at = base.sha ? ` (${base.sha.slice(0, 7)})` : "";
  const n = report.changed.length;
  const examined = report.examined.length === n ? "" : `, ${report.examined.length} examined`;
  lines.push(
    `base ${encode(base.ref || "none")}${at}, ` +
      `${n} changed file${n === 1 ? "" : "s"}${examined}, ${report.mode}`
  );
  lines.push(`${counts["MUST-FIX"]} MUST-FIX, ${counts.FIX} FIX, ${counts.NIT} NIT`);
  if (report.stale) {
    lines.push(`severity capped at FIX: ${encode(report.staleReason)}`);
  }
  for (const c of report.caveats) lines.push(`note: ${encode(c)}`);
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
    lines.push(`${f.severity}  ${encodePath(f.path)}:${f.line}  ${String(f.claim ?? "").replace(/\s+/g, " ").trim()}`);
    lines.push(`  ${f.where ? `${encode(f.where)}: ` : ""}${encode(f.reason)}`);
    if (f.snippet) lines.push(`  ${encode(f.snippet, { max: CHECK.snippetChars })}`);
  }

  listRules(lines, report.foreign, "this tool did not write");
  // Named apart from the above, because the reader's next move differs: one is
  // somebody else's context to read, the other is this tool's own output from a
  // scan whose record is gone, and re-scanning is what clears it.
  listRules(lines, report.unknown, "the map on disk does not name");

  return lines.join("\n") + "\n";
}
