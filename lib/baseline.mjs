import { gitBuffered as git, parseNameStatusZ } from "./git.mjs";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, existsSync,
} from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

import { language, langsIn } from "./corpus.mjs";
import { encodePath } from "./encode.mjs";
import { applyPairings } from "./pairing.mjs";

export const PIN_PATH = ".claude/anatomiya/baseline.json";
export const PIN_SCHEMA = 1;

// The same per-file ceiling the parser pool enforces. A blob over it is a file
// we would not have parsed anyway.
const MAX_BLOB_BYTES = 4 * 1024 * 1024;

// A sha reaches a git argument, so it is validated as a sha rather than trusted
// as a string: a pin file is a repository-controlled input like any other.
export function isSha(sha) {
  return typeof sha === "string" && /^[0-9a-f]{7,40}$/.test(sha);
}

// A ref name cannot begin with a dash. `rev-parse` takes revisions before any
// `--`, so a ref of `--upload-pack=...` would be read as an option; a tracked
// file with that name already exfiltrated a secret through the same class of
// argument elsewhere.
function safeRef(ref) {
  return typeof ref === "string" && ref.length > 0 && !ref.startsWith("-");
}

/**
 * Is the baseline commit still in this repository at all?
 *
 * Squash-merge-to-main is the common workflow, not the edge: the branch's
 * commits never land, and after the branch is deleted the pinned sha names an
 * object that no longer exists. Every caller checks this before reading a blob,
 * and drops to counts-only when it fails (E3).
 */
export async function shaReachable(root, sha) {
  if (!isSha(sha)) return false;
  const r = await git(root, ["cat-file", "-e", `${sha}^{commit}`]);
  return r.ok;
}

/**
 * The commit a pin would record. Never a ref name: a pin holds a sha because a
 * branch moves and the population it named would move with it.
 */
export async function headSha(root) {
  const r = await git(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  const sha = r.ok ? r.stdout.trim() : "";
  return isSha(sha) ? sha : null;
}

/**
 * The contents of one path as of the baseline commit (E2).
 *
 * Never the working tree. Reading the working tree makes the baseline and the
 * current population the same numbers, so an agent that edits three of fourteen
 * baseline files moves the baseline it is being measured against.
 *
 * `git cat-file blob` is `git show <sha>:<path>` with the object type asserted,
 * so a path that has since become a directory errors instead of quietly
 * yielding a tree listing that would then be parsed as source.
 *
 * An empty file returns ok with empty content; an absent path returns not-ok.
 * The two must never collapse into the same value.
 */
export async function showBlob(root, sha, path) {
  if (!isSha(sha)) return { ok: false, reason: "bad sha" };
  const r = await git(root, ["cat-file", "blob", `${sha}:${path}`], {
    encoding: "buffer",
    maxBytes: MAX_BLOB_BYTES,
  });
  if (r.ok) return { ok: true, content: r.stdout };
  return { ok: false, reason: r.oversize ? "over size cap" : "absent" };
}

export async function readBaselineText(root, sha, path) {
  const blob = await showBlob(root, sha, path);
  return blob.ok ? blob.content.toString("utf8") : null;
}

/**
 * The merge base of two commits, with the three outcomes kept apart: found,
 * genuinely no common ancestor (exit 1, empty stdout, no stderr), and the
 * command failing for some other reason.
 */
export async function mergeBase(root, a, b) {
  if (!safeRef(a) || !safeRef(b)) return { found: false, failed: true, sha: null };
  const r = await git(root, ["merge-base", a, b]);
  if (r.ok) {
    const sha = r.stdout.trim();
    return { found: sha.length > 0, failed: false, sha: sha || null };
  }
  return { found: false, failed: r.code !== 1, sha: null };
}

/**
 * The refs a base is looked for in, in order. `origin/HEAD` names the remote's
 * default branch, which is what a change is actually reviewed against.
 *
 * `@{upstream}` is deliberately absent: a pushed feature branch tracks itself,
 * and the merge base of HEAD with itself is HEAD.
 */
export const BASE_REFS = ["origin/HEAD", "origin/main", "origin/master", "main", "master"];

/**
 * The commit the change under review is built on.
 *
 * Never HEAD (E6). Over `<baseline>..HEAD` the branch's own edits count as map
 * drift, so a claim's reported staleness rises with the size of the change
 * being reviewed and bundling more files into a branch walks it past the
 * threshold. The literal ref is refused rather than quietly accepted.
 *
 * This is the only base resolver: scan and check measuring drift against
 * different refs is two different answers to one question.
 */
export async function resolveBaseRef(root, ref = null) {
  if (ref === "HEAD" || ref === "@") {
    return { ok: false, reason: "base ref must not be HEAD" };
  }
  if (ref !== null && !safeRef(ref)) {
    return { ok: false, reason: `not a ref name: ${ref}` };
  }

  const tried = ref ? [ref] : BASE_REFS;
  for (const candidate of tried) {
    const r = await git(root, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
    const sha = r.ok ? r.stdout.trim() : "";
    if (!sha) continue;

    // The fork point, where one exists, so the branch's own commits sit outside
    // the range. Unrelated histories fall back to the ref tip rather than to "".
    const base = await mergeBase(root, "HEAD", sha);
    return { ok: true, ref: candidate, sha: base.found ? base.sha : sha, forkPoint: base.found };
  }
  return { ok: false, reason: ref ? `cannot resolve ${ref}` : "no base branch found" };
}

/**
 * Renames and changed paths between two commits, in one pass.
 *
 * NUL-delimited because git permits newlines in paths, the same reason the
 * corpus is collected with `ls-files -z`. Rename records arrive as three
 * fields, everything else as two.
 */
/**
 * Paths whose working-tree content differs from `sha`.
 *
 * Everything tracked and absent from this set is byte-identical to the commit,
 * so its baseline parse and its corpus parse are the same parse. Without this
 * the baseline stage re-reads and re-parses the whole population through one
 * `git cat-file` process per file, which measured 6.9s against 1.4s to parse
 * the entire corpus, on a repository where nothing had changed at all.
 *
 * `null` rather than an empty set when git will not answer: an empty set claims
 * every file is unchanged, which is the unsafe direction.
 */

export async function changedSinceWorktree(root, sha) {
  if (!safeRef(sha)) return null;
  // No `--find-renames`: a rename lands here as both paths, and both are then
  // materialised rather than reused. Cheap, and it keeps the reuse rule simple.
  const r = await git(root, ["diff", "--name-only", "-z", sha, "--"]);
  if (!r.ok) return null;
  return new Set(r.stdout.split("\0").filter(Boolean));
}

/**
 * Every tracked path at one commit.
 *
 * A file-to-file obligation is answered by which files exist, so measuring it
 * against the baseline needs the baseline's file list and not the working
 * tree's. An unreadable commit comes back empty, which the caller reads as a
 * population it cannot count rather than as a repository with no files.
 */
export async function filesAt(root, sha) {
  // The rev goes before the separator: git reads anything past `--` as a path.
  const r = await git(root, ["ls-tree", "-r", "--name-only", "-z", sha, "--"]);
  if (!r.ok) return new Set();
  return new Set(r.stdout.split("\0").filter(Boolean));
}

export async function diffRange(root, from, to) {
  // `${from}..` puts a leading dash at the head of the argument, where git
  // reads it as an option.
  if (!safeRef(from) || !safeRef(to)) return null;

  const r = await git(root, ["diff", "--find-renames", "--name-status", "-z", `${from}..${to}`, "--"]);
  if (!r.ok) return null;

  const renames = new Map();
  const changed = new Set();

  for (const row of parseNameStatusZ(r.stdout)) {
    changed.add(row.to);
    // Both names count as changed: at the pinned commit only the old one
    // exists, and the map is what lets a renamed file find its own baseline
    // instead of reading as greenfield (E7).
    if (row.from) {
      renames.set(row.to, row.from);
      changed.add(row.from);
    }
  }

  return { renames, changed };
}

/**
 * The pin: which files each area held at the moment a human accepted it.
 *
 * The file list is the whole point (E1). A baseline recomputed by re-running
 * today's glob against the old commit re-selects only the files that are still
 * there, so moving the violating files into a new directory or a denied one
 * lifts the baseline ratio to 1.00 with every other guard still holding.
 *
 * It deliberately stores no counts. There is nothing to fall back to when the
 * sha goes unreachable, and stored counts are exactly the numbers this guard
 * exists to verify (E3).
 */
export function buildPin(areas, { sha, corpus = null }) {
  if (!isSha(sha)) throw new Error(`baseline sha is not a sha: ${sha}`);
  return {
    schema: PIN_SCHEMA,
    sha,
    // The corpus size the layout was resolved from. The area floor is a step
    // function of it, so without it one added file re-partitions the repository
    // and every area reads as a population change.
    ...(Number.isFinite(corpus) ? { corpus } : {}),
    areas: [...areas]
      .map((a) => ({ id: a.id, path: a.path, files: a.files.map((f) => f.rel).sort() }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function loadPin(root) {
  const path = join(root, PIN_PATH);
  if (!existsSync(path)) return null;
  try {
    const pin = JSON.parse(readFileSync(path, "utf8"));
    if (!pin || pin.schema !== PIN_SCHEMA || !isSha(pin.sha) || !Array.isArray(pin.areas)) return null;
    // A half-shaped area is a pin that reads as a smaller population than the
    // one a human accepted, which is the direction that manufactures claims.
    // Refusing the whole file drops to counts-only instead.
    if (!pin.areas.every(isPinnedArea)) return null;
    return pin;
  } catch {
    return null;
  }
}

function isPinnedArea(a) {
  return !!a
    && typeof a.path === "string" && a.path.length > 0
    && Array.isArray(a.files) && a.files.every((f) => typeof f === "string" && f.length > 0);
}

export function writePin(root, pin) {
  const path = join(root, PIN_PATH);
  mkdirSync(dirname(path), { recursive: true });
  const body = JSON.stringify(pin, null, 2) + "\n";
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, body);
  renameSync(tmp, path);
  return path;
}

/**
 * What a re-pin would accept.
 *
 * Re-pinning is a separate command and nothing in the scan path calls this or
 * points a human at it (E5). An earlier design suggested re-pinning exactly
 * when post-baseline sites outnumbered baseline sites, which is the moment the
 * agent's own output is largest and the suggestion launders it.
 */
export function pinDelta(oldPin, newPin) {
  const before = oldPin ? indexAreas(oldPin) : new Map();
  const after = indexAreas(newPin);

  const areas = [];
  for (const [path, next] of after) {
    const prev = before.get(path);
    const added = [...next.files].filter((f) => !prev || !prev.files.has(f)).sort();
    const removed = prev ? [...prev.files].filter((f) => !next.files.has(f)).sort() : [];
    if (!prev || added.length || removed.length) {
      areas.push({ path, added, removed, isNew: !prev });
    }
  }
  for (const [path, prev] of before) {
    if (!after.has(path)) areas.push({ path, added: [], removed: [...prev.files].sort(), gone: true });
  }

  areas.sort((a, b) => a.path.localeCompare(b.path));
  return {
    from: oldPin ? oldPin.sha : null,
    to: newPin.sha,
    areas,
    addedFiles: areas.reduce((s, a) => s + a.added.length, 0),
    removedFiles: areas.reduce((s, a) => s + a.removed.length, 0),
  };
}

/**
 * The delta a re-pin prints before it writes. Facts only, no recommendation.
 *
 * The paths come out of the pin file, so they are repository-controlled and go
 * through the encoder like every other such value (F4).
 */
export function formatDelta(delta) {
  const lines = [
    delta.from
      ? `baseline ${short(delta.from)} -> ${short(delta.to)}`
      : `baseline pinned at ${short(delta.to)}`,
    `${delta.addedFiles} files enter the baseline population, ${delta.removedFiles} leave it`,
    "",
  ];
  for (const a of delta.areas) {
    const tag = a.isNew ? " (new area)" : a.gone ? " (area gone)" : "";
    lines.push(`${encodePath(a.path)}${tag}  +${a.added.length} -${a.removed.length}`);
    for (const f of a.removed.slice(0, 5)) lines.push(`  - ${encodePath(f)}`);
    if (a.removed.length > 5) lines.push(`  - and ${a.removed.length - 5} more`);
  }
  return lines.join("\n");
}

function short(sha) {
  return sha ? sha.slice(0, 8) : "none";
}

function indexAreas(pin) {
  const m = new Map();
  for (const a of pin.areas) m.set(a.path, { id: a.id, path: a.path, files: new Set(a.files) });
  return m;
}

/**
 * Everything the scan needs to know about the baseline, resolved once.
 *
 * `countsOnly` is the hard stop: no pin, or a pinned sha this repository can no
 * longer reach, and every directive drops to counts (E3).
 */
export async function resolveBaseline(root, { pin = loadPin(root), baseRef = null } = {}) {
  // A pin handed in directly has not been through `loadPin`, and an area list
  // this cannot index is not a smaller baseline, it is no baseline.
  if (!pin || !Array.isArray(pin.areas) || !pin.areas.every(isPinnedArea)) {
    return state({ status: "unpinned", countsOnly: true });
  }

  const reachable = await shaReachable(root, pin.sha);
  if (!reachable) {
    return state({ status: "unreachable", sha: pin.sha, countsOnly: true, areas: indexAreas(pin) });
  }

  const areas = indexAreas(pin);
  const base = await resolveBaseRef(root, baseRef);

  // Two ranges, because they answer different questions. The rename map runs to
  // HEAD: the scan reads the files at HEAD, so a directory renamed on this very
  // branch has to be followed or the area reads as greenfield (E7). Drift runs
  // to the base ref and never to HEAD (E6).
  const identity = await diffRange(root, pin.sha, "HEAD");
  const moved = base.ok ? await diffRange(root, pin.sha, base.sha) : null;

  return state({
    status: "ok",
    sha: pin.sha,
    countsOnly: false,
    areas,
    baseRef: base.ok ? { ref: base.ref, sha: base.sha, forkPoint: base.forkPoint } : null,
    baseRefReason: base.ok ? null : base.reason,
    renames: identity ? identity.renames : new Map(),
    drift: moved ? driftIn(areas, moved.changed) : null,
  });
}

function state(o) {
  return {
    status: o.status,
    sha: o.sha ?? null,
    countsOnly: o.countsOnly,
    areas: o.areas ?? new Map(),
    baseRef: o.baseRef ?? null,
    baseRefReason: o.baseRefReason ?? null,
    renames: o.renames ?? new Map(),
    drift: o.drift ?? null,
  };
}

/**
 * Drift is files changed inside mapped areas over `<baseline>..<base-ref>`
 * (E6). Files outside every mapped area are not drift: nothing claims them.
 */
function driftIn(areas, changed) {
  const byArea = new Map();
  let total = 0;
  for (const path of changed) {
    let owner = null;
    for (const [areaPath] of areas) {
      // "." is the repository root as an area path, and contains every path
      // without being a prefix of any of them.
      const inside = areaPath === "." || path === areaPath || path.startsWith(areaPath + "/");
      if (!inside) continue;
      // Nested areas both contain the path; the deepest one is the one whose
      // claims the file actually carries.
      if (!owner || areaPath.length > owner.length) owner = areaPath;
    }
    if (!owner) continue;
    byArea.set(owner, (byArea.get(owner) || 0) + 1);
    total++;
  }
  return { total, byArea };
}

/**
 * The baseline population for one current area, and whether it may state
 * anything at all.
 *
 * Current paths are mapped back through the rename map first (E7). A path is
 * the key and a path cannot tell a rename from a delete-plus-add, so without
 * that step a renamed directory finds nothing at the baseline sha and silently
 * loses every claim it had.
 *
 * Statuses that block a directive:
 *   postdates-baseline  nothing in this area existed at the pin (E4). Greenfield
 *                       directories are where agents write most, and there the
 *                       baseline would be the agent's own output at 100%.
 *   population-change   a pinned file is no longer in this area (E1). Reported,
 *                       and suppressed until a human re-pins.
 */
export function baselinePopulation(state, area) {
  if (state.countsOnly) {
    return { status: state.status, directive: false, areaPath: null, files: [], missing: [], added: [] };
  }

  const currentByBaselinePath = new Map();
  for (const f of area.files) {
    currentByBaselinePath.set(state.renames.get(f.rel) ?? f.rel, f.rel);
  }

  const matched = bestMatch(state.areas, currentByBaselinePath);
  if (!matched) {
    return {
      status: "postdates-baseline",
      directive: false,
      areaPath: null,
      files: [],
      missing: [],
      added: [...currentByBaselinePath.values()],
    };
  }

  const missing = [...matched.files].filter((p) => !currentByBaselinePath.has(p)).sort();
  const added = [...currentByBaselinePath]
    .filter(([baselinePath]) => !matched.files.has(baselinePath))
    .map(([, current]) => current)
    .sort();

  return {
    status: missing.length ? "population-change" : "ok",
    directive: missing.length === 0,
    areaPath: matched.path,
    // The pinned list, not today's glob. This is the whole guard.
    files: [...matched.files].sort().map((rel) => ({
      rel,
      currentRel: currentByBaselinePath.get(rel) ?? null,
      lang: language(rel),
    })),
    missing,
    added,
  };
}

/**
 * The pinned area a current area descends from, by shared files rather than by
 * path, so a renamed directory still finds itself. An area split across two
 * current areas matches the same pin twice and both report a population change,
 * which is the conservative answer.
 */
function bestMatch(areas, currentByBaselinePath) {
  let best = null;
  let bestHits = 0;
  for (const entry of areas.values()) {
    let hits = 0;
    for (const path of currentByBaselinePath.keys()) if (entry.files.has(path)) hits++;
    if (hits > bestHits) {
      best = entry;
      bestHits = hits;
    }
  }
  return bestHits > 0 ? best : null;
}

/**
 * A dimension may state a directive only if the baseline population supplied
 * candidates for it. A dimension whose sites all arrived after the pin has a
 * baseline of zero, and a ratio over zero sites is the agent's own output (E4).
 */
export function baselineStates(population, baselineDim) {
  if (!population.directive) return { directive: false, gate: population.status };
  if (!baselineDim || !baselineDim.candidates) {
    return { directive: false, gate: "postdates-baseline" };
  }
  return { directive: true, gate: null };
}

/**
 * Write the baseline population's blobs to a throwaway directory so the
 * existing parser pool can read them like any other file.
 *
 * The pool reads a path and hands the parser one string; going through disk
 * keeps that single-read shape rather than opening a second decoding path for
 * baseline content (B5).
 *
 * A blob that will not come back is a population problem, not a parse problem:
 * the caller suppresses on `missing` the same way it does on a population
 * change.
 */
export async function materialize(root, sha, files, { concurrency = 8 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-baseline-"));
  const out = [];
  const missing = [];

  await pooled(files, concurrency, async (f) => {
    const abs = underTemp(dir, f?.rel);
    if (!abs) return void missing.push({ rel: f?.rel ?? null, reason: "unsafe path" });

    const blob = await showBlob(root, sha, f.rel);
    if (!blob.ok) return void missing.push({ rel: f.rel, reason: blob.reason });

    // A file the temporary directory will not take is one absent baseline file,
    // reported like any other. Throwing here would lose the whole population.
    try {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, blob.content);
    } catch {
      return void missing.push({ rel: f.rel, reason: "unwritable" });
    }
    out.push({ rel: f.rel, abs, lang: f.lang ?? language(f.rel) });
  });

  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return {
    dir,
    files: out,
    missing,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// Lexical containment only. The destination is a directory this process just
// created and every subdirectory under it is ours, so there is no symlink to
// follow; the corpus reader resolves both sides because it reads paths it did
// not create.
function underTemp(dir, rel) {
  if (typeof rel !== "string" || rel.length === 0) return null;
  const root = resolve(dir);
  const full = resolve(root, rel);
  return full.startsWith(root + sep) ? full : null;
}

async function pooled(items, size, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(size, queue.length)) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

/**
 * The baseline counts per area, read from the pinned file list at the pinned
 * commit (E1, E2).
 *
 * The parser and the reducer are handed in rather than imported, because both
 * carry scan-wide settings this module has no business knowing: which
 * frameworks the corpus shows, and what the Ruby guards were overridden to.
 * That injection is also what makes the reuse rule testable without running the
 * whole pipeline over a real repository.
 *
 * One materialisation and one parser pool for the whole repository: an area at
 * a time would fork a pool per area, which is the cost the single-pass corpus
 * scan exists to avoid.
 */
export async function measureBaseline(root, state, areas, populations, { headParsed = null, parse, reduce }) {
  // Named here rather than as a TypeError from inside the loop, after the blob
  // directory has already been created: this is a public seam whose whole point
  // is being callable without a repository behind it.
  if (typeof parse !== "function" || typeof reduce !== "function") {
    throw new TypeError("measureBaseline needs a parse and a reduce function");
  }
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
      for (const [rel, r] of (await parse(blobs.files)).records) parsed.set(rel, r);
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
        unread ? { gate: "population-change", dims: [] } : { gate: null, dims: reduce(area, usable) }
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
 * set, and the path is the same on both sides, since a rename makes the corpus
 * entry a different file's parse.
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
