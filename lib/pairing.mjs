/**
 * A file-to-file obligation: a file of one shape ships with its companion.
 *
 * Every other dimension asks a question inside one file and runs against a
 * parsed tree. This one asks whether a second file exists, which is a set
 * membership test over the corpus and needs no parser. Nothing here is
 * reachable from `ALL_DIMENSIONS`, which is what the parse worker runs; the
 * reducer composes both lists.
 *
 * No row is a rule. Each is a question the corpus answers with a count, and the
 * same gates every dimension faces decide whether the count becomes a sentence.
 * A repository without the directory gives its row zero eligible files.
 */
const rails = (key, claim, from, to, companionSuffix = "_spec.rb") => ({
  key,
  kind: "pairing",
  claim,
  counterClaim: null, // a missing companion is an absence, not a style anyone picked
  precision: "precise",
  langs: ["ruby"],
  from,
  to,
  ext: ".rb",
  companionSuffix,
});

export const PAIRINGS = [
  {
    ...rails("rake_task_spec", "a rake task ships with a spec", "lib/tasks", "spec/lib/tasks"),
    ext: ".rake",
  },
  rails("model_spec", "a model ships with a spec", "app/models", "spec/models"),
  rails("service_spec", "a service ships with a spec", "app/services", "spec/services"),
  rails("job_spec", "a job ships with a spec", "app/jobs", "spec/jobs"),
  rails("worker_spec", "a worker ships with a spec", "app/workers", "spec/workers"),
  rails("controller_spec", "a controller ships with a spec", "app/controllers", "spec/controllers"),
  rails("serializer_spec", "a serializer ships with a spec", "app/serializers", "spec/serializers"),
  // Minitest spells the same obligation under test/ with the other suffix. A
  // repository is only asked the question for the suffix it actually uses.
  rails("model_test", "a model ships with a test", "app/models", "test/models", "_test.rb"),
  rails("job_test", "a job ships with a test", "app/jobs", "test/jobs", "_test.rb"),
];

/**
 * Where this repository actually keeps the companions for one obligation.
 *
 * The substitution was never the problem. `app/models/edition/auditable.rb` owes
 * `<root>/edition/auditable_test.rb`, and the rule only ever guessed `<root>`.
 * alphagov/whitehall keeps them under `test/unit/app/models` and scored 0 of 160
 * with 117 namesakes one prefix away; discourse answers its controllers in
 * `spec/requests`, a name no hardcoded pair reaches at all.
 *
 * Learned by asking each producer which file ends with its own path tail, and
 * taking the prefix the most producers agree on. A tail rather than a basename,
 * so the subtree has to match too: `app/models/edition/foo.rb` is not satisfied
 * by `spec/services/foo_spec.rb`, and the basename collisions this corpus is
 * full of never arise. The most common prefix rather than the first, so one
 * stray file in the wrong place cannot move the whole obligation.
 *
 * Null when nothing matches: a repository with no companion of this shape is
 * not asked the question rather than told it fails.
 */
export function companionRoot(corpus, { from, to, ext, companionSuffix }) {
  const bySuffix = [];
  for (const rel of corpus) if (rel.endsWith(companionSuffix)) bySuffix.push(rel);
  if (!bySuffix.length) return null;

  const votes = new Map();
  for (const rel of corpus) {
    if (!rel.startsWith(`${from}/`) || !rel.endsWith(ext) || rel.endsWith(companionSuffix)) continue;
    const tail = `/${rel.slice(from.length + 1, -ext.length)}${companionSuffix}`;
    for (const c of bySuffix) {
      if (!c.endsWith(tail)) continue;
      const root = c.slice(0, c.length - tail.length);
      votes.set(root, (votes.get(root) || 0) + 1);
    }
  }
  if (!votes.size) return null;
  // The declared pair is the prior and evidence has to beat it, not merely draw
  // with it. Two roots on one vote each is a repository that has said nothing,
  // and picking the alphabetical winner there would decide an obligation by a
  // filename. Ties below that break on the name so the answer never depends on
  // corpus order.
  const ranked = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked[0][1];
  const tied = ranked.filter(([, n]) => n === top).map(([root]) => root);
  return tied.includes(to) ? to : tied[0];
}

export function pairingsFor(langs) {
  return PAIRINGS.filter((p) => p.langs.some((l) => langs.includes(l)));
}

/**
 * One site per eligible file, so the site is the file. The hit shape is the one
 * every dimension produces, so the fold counts this without knowing it differs.
 */
export function pairingHits(corpus, pairing, root = pairing.to) {
  const shaped = new Set();
  for (const rel of corpus) {
    if (rel.endsWith(pairing.companionSuffix)) shaped.add(basename(rel));
  }

  const hits = new Map();
  for (const rel of corpus) {
    const companion = companionOf(rel, pairing, root);
    if (companion === null) continue;
    const conforming = corpus.has(companion);
    // `elsewhere` rides the hit so the fold counts it per area. Taken over the
    // corpus and attached to every area, it told a nine-file directory that the
    // repository's other 185 belonged to it.
    hits.set(rel, [{ conforming, elsewhere: !conforming && shaped.has(basename(companion)) }]);
  }
  return hits;
}

/**
 * Merge every applicable obligation into the records the fold already reads,
 * and answer with the keys that applied.
 *
 * The corpus is the membership set, not the parsed map: whether a spec exists
 * has nothing to do with whether it parsed. A producer that failed to parse is
 * skipped anyway, because it is unexamined and no other dimension speaks for an
 * unexamined file either. `corpus` holds source only, so an obligation whose
 * companion is not source would need the whole tracked list instead.
 */
export function applyPairings(parsed, corpus, langs) {
  const applied = new Set();
  for (const pairing of pairingsFor(langs)) {
    // Producers exist whatever the repository tests with: every Rails tree holds
    // app/models, so the RSpec row and the minitest row both find eligible files
    // and one can only ever read zero. One companion of that shape anywhere is
    // the evidence the habit exists at all.
    if (!usesCompanionShape(corpus, pairing)) continue;
    // Where this repository actually keeps them, not where the rule guessed.
    // Falling back to the declared pair when nothing lines up is what keeps the
    // honest zero: a repository that writes specs and none for its models still
    // reads 0 of N with the namesake count beside it, which is a fact about the
    // repository. Learning would turn that into silence.
    const root = companionRoot(corpus, pairing) ?? pairing.to;
    applied.add(pairing.key);
    for (const [rel, hits] of pairingHits(corpus, pairing, root)) {
      const record = parsed.get(rel);
      if (!record || !record.ok || !record.hits) continue;
      // Replaced, never written to. The baseline map and the corpus map hold
      // the same record object for every file unchanged since the pin, so a
      // mutation here would give the baseline today's answer and there would be
      // nothing left to compare the branch against.
      parsed.set(rel, { ...record, hits: { ...record.hits, [pairing.key]: hits } });
    }
  }
  return applied;
}

/**
 * Producers this branch touched whose companion is not in the tree.
 *
 * Only files the branch touched: an obligation the repository has carried for
 * years is what the map counts, not a finding against this diff.
 */
export function pairingViolations(changed, corpus, pairing, root = companionRoot(corpus, pairing) ?? pairing.to) {
  const out = [];
  for (const path of changed) {
    const companion = companionOf(path, pairing, root);
    if (companion === null || corpus.has(companion)) continue;
    out.push({ path, companion });
  }
  return out;
}


const usesCompanionShape = (corpus, pairing) => {
  for (const rel of corpus) if (rel.endsWith(pairing.companionSuffix)) return true;
  return false;
};

const basename = (path) => path.slice(path.lastIndexOf("/") + 1);


export function companionOf(rel, { from, to, ext, companionSuffix }, root = to) {
  if (!rel.startsWith(`${from}/`) || !rel.endsWith(ext)) return null;
  // A companion can satisfy the producer pattern itself when the two share a
  // root, and then every test file owes a test of its own. Those sites are
  // unsatisfiable by construction, so they are not sites.
  if (rel.endsWith(companionSuffix)) return null;
  const stem = rel.slice(from.length + 1, -ext.length);
  return `${root}/${stem}${companionSuffix}`;
}
