/**
 * A scenario: one task both arms are given, and the checks its result is
 * scored on, all written down before any trial runs (G18).
 *
 * A dimension claim is scored by the map's own predicate, as `score.mjs` does.
 * What no dimension counts, a companion file a change ships with or an existing
 * function the new code calls, is scored by a pattern over the files the trial
 * wrote. Both are fixed in the scenario file, so the scorer cannot be tuned to
 * the answers after they are in.
 */
import { scoreFile } from "./score.mjs";
import { language } from "../../plugins/anatomiya/lib/langs.mjs";
import { rowByKey } from "../../plugins/anatomiya/lib/registry.mjs";

const SHA = /^[0-9a-f]{40}$/;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHECK_KINDS = ["changed", "unchanged", "contains", "lacks", "dimension"];

/**
 * A scenario file read, or `{ error }` naming the first thing that would leave
 * a trial unscorable, since one found after the trials costs all of them.
 */
export function parseScenario(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { error: `the scenario is not JSON: ${err.message}` };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "the scenario is not an object" };
  for (const field of ["name", "repo", "commit", "area", "prompt"]) {
    if (typeof raw[field] !== "string" || !raw[field].trim()) return { error: `the scenario has no ${field}` };
  }
  if (!NAME.test(raw.name)) return { error: `the scenario name is not kebab-case: ${raw.name}` };
  if (!SHA.test(raw.commit)) return { error: "the scenario commit is not a full 40-character sha" };
  if (raw.probe !== undefined && (typeof raw.probe !== "string" || !raw.probe.startsWith(`${raw.area}/`))) {
    return { error: "the scenario probe is not a path under its area" };
  }
  const did = compileList(raw.did, "did");
  if (did.error) return did;
  const checks = compileList(raw.checks, "checks");
  if (checks.error) return checks;
  const names = checks.list.map((c) => c.name);
  if (new Set(names).size !== names.length) return { error: "two checks share a name" };
  const { name, repo, commit, area, prompt } = raw;
  return { scenario: { name, repo, commit, area, probe: raw.probe ?? null, prompt, did: did.list, checks: checks.list } };
}

function compileList(list, field) {
  if (!Array.isArray(list) || !list.length) return { error: `the scenario has no ${field}` };
  const out = [];
  for (const [i, entry] of list.entries()) {
    const c = compileCheck(entry, `${field}[${i}]`);
    if (c.error) return c;
    out.push(c.check);
  }
  return { list: out };
}

function compileCheck(entry, at) {
  if (!entry || typeof entry !== "object") return { error: `${at} is not an object` };
  const kinds = CHECK_KINDS.filter((k) => k in entry);
  if (kinds.length !== 1) return { error: `${at} names ${kinds.length ? kinds.join(" and ") : "no kind"}; one of ${CHECK_KINDS.join(", ")}` };
  const [kind] = kinds;
  const name = entry.name ?? `${kind} ${entry[kind]}`;
  if (typeof name !== "string" || !name.trim()) return { error: `${at} has an empty name` };
  const claim = typeof entry.claim === "string" ? entry.claim : null;
  const pattern = (source, flags, what) => {
    if (typeof source !== "string" || !source) return { error: `${at} ${what} is not a pattern` };
    try {
      return { re: new RegExp(source, flags) };
    } catch (err) {
      return { error: `${at} ${what} does not compile: ${err.message}` };
    }
  };

  if (kind === "changed" || kind === "unchanged") {
    const path = pattern(entry[kind], "", kind);
    return path.error ? path : { check: { kind, name, claim, path: path.re } };
  }
  const where = pattern(entry.in, "", "in");
  if (where.error) return where;
  if (kind === "dimension") {
    const row = typeof entry.dimension === "string" ? rowByKey(entry.dimension) : null;
    if (!row) return { error: `${at} names no dimension the registry holds: ${entry.dimension}` };
    // A learned row is scored against the class one map learned, which a
    // scenario fixed in advance cannot know; `scripts/ab.mjs` measures those.
    if (row.learnedClasses) return { error: `${at} names a learned row, which scripts/ab.mjs measures: ${entry.dimension}` };
    return { check: { kind, name, claim, key: entry.dimension, path: where.re } };
  }
  const text = pattern(entry[kind], "m", kind);
  return text.error ? text : { check: { kind, name, claim, path: where.re, text: text.re } };
}

/** The plugin's own state, which arm A's hooks rewrite and no task asks for. */
const OWN = /^\.claude\/(?:anatomiya\/|rules\/anatomiya-)/;

/** The files a trial wrote that a task can be judged on, at `/`-separated paths. */
const judged = (run) =>
  run.wrote.map((f) => ({ ...f, rel: f.rel.split("\\").join("/") })).filter((f) => !OWN.test(f.rel));

/**
 * One check against one trial's files: true, false, or null where the check
 * had nothing to judge (a dimension that found no site in what was written).
 */
export async function runCheck(check, files, frameworks = []) {
  const at = files.filter((f) => check.path.test(f.rel));
  if (check.kind === "changed") return at.length > 0;
  if (check.kind === "unchanged") return at.length === 0;
  if (check.kind === "contains") return at.some((f) => check.text.test(f.source));
  if (check.kind === "lacks") return !at.some((f) => check.text.test(f.source));
  let candidates = 0;
  let conforming = 0;
  for (const f of at) {
    const lang = language(f.rel);
    if (!lang) continue;
    const s = await scoreFile({ rel: f.rel, source: f.source, lang }, { key: check.key, frameworks });
    if (!s) continue;
    candidates += s.candidates;
    conforming += s.conforming;
  }
  return candidates ? conforming === candidates : null;
}

/**
 * One arm's trials scored. A trial counts toward a check only when it did the
 * task (every `did` check holds) and the check had something to judge, so an
 * arm cannot pass a check by writing nothing.
 */
export async function scoreScenario(runs, scenario, frameworks = []) {
  const out = {
    trials: runs.length,
    endedEarly: 0,
    did: 0,
    allPassed: 0,
    checks: Object.fromEntries(scenario.checks.map((c) => [c.name, { passed: 0, of: 0 }])),
    perTrial: [],
  };
  for (const run of runs) {
    if (!run.ok) out.endedEarly++;
    const files = judged(run);
    let did = true;
    for (const c of scenario.did) if ((await runCheck(c, files, frameworks)) !== true) did = false;
    const checks = {};
    if (did) {
      out.did++;
      for (const c of scenario.checks) {
        checks[c.name] = await runCheck(c, files, frameworks);
        if (checks[c.name] === null) continue;
        out.checks[c.name].of++;
        if (checks[c.name]) out.checks[c.name].passed++;
      }
      if (Object.values(checks).every((r) => r === true)) out.allPassed++;
    }
    out.perTrial.push({ ok: run.ok, reason: run.reason ?? null, wrote: files.map((f) => f.rel), did, checks, spent: run.spent ?? null });
  }
  return out;
}

/** The middle value, or null for none: a cost nobody reported is not zero. */
export function median(values) {
  const xs = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((x, y) => x - y);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * Fisher's exact test, two-sided: the chance of a split at least as uneven as
 * `a` of `n1` against `b` of `n2` when both arms share one rate. Exact rather
 * than a chi-square, since an arm here holds ten trials, not hundreds.
 */
export function fisherExact(a, n1, b, n2) {
  if (![a, n1, b, n2].every((x) => Number.isInteger(x) && x >= 0) || a > n1 || b > n2) return null;
  const n = n1 + n2;
  const k = a + b;
  const logFact = [0];
  for (let i = 1; i <= n; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  const choose = (m, r) => logFact[m] - logFact[r] - logFact[m - r];
  const p = (x) => Math.exp(choose(n1, x) + choose(n2, k - x) - choose(n, k));
  const observed = p(a);
  let sum = 0;
  for (let x = Math.max(0, k - n2); x <= Math.min(k, n1); x++) {
    const px = p(x);
    // The slack keeps a table exactly as likely as the observed one from
    // dropping out on floating-point noise.
    if (px <= observed * (1 + 1e-7)) sum += px;
  }
  return Math.min(1, sum);
}
