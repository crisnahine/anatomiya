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
const rails = (key, claim, from, to, { companionSuffix = "_spec.rb", ext = ".rb" } = {}) => ({
  key,
  kind: "pairing",
  // An obligation is a set-membership test over the corpus and needs no parser,
  // let alone a checker. The field is here so every registry row answers the
  // same question about which tier it belongs to.
  tier: "syntactic",
  claim,
  counterClaim: null, // a missing companion is an absence, not a style anyone picked
  precision: "precise",
  applicabilityPredicate: {
    // The clause after the comma is not decoration. Producers exist whatever a
    // repository tests with, so without it the RSpec row and the minitest row
    // both find producers in every Rails tree and one of them can only ever
    // read zero, which is a false statement rather than a measurement.
    sites: `a ${ext} file anywhere under ${from} whose own name does not end in ${companionSuffix}, once the repository is seen using that suffix at all`,
    blind: null,
  },
  langs: ["ruby"],
  from,
  to,
  ext,
  companionSuffix,
});

export const PAIRINGS = [
  rails("rake_task_spec", "a rake task ships with a spec", "lib/tasks", "spec/lib/tasks", { ext: ".rake" }),
  rails("model_spec", "a model ships with a spec", "app/models", "spec/models"),
  rails("service_spec", "a service ships with a spec", "app/services", "spec/services"),
  rails("job_spec", "a job ships with a spec", "app/jobs", "spec/jobs"),
  rails("worker_spec", "a worker ships with a spec", "app/workers", "spec/workers"),
  rails("controller_spec", "a controller ships with a spec", "app/controllers", "spec/controllers"),
  rails("serializer_spec", "a serializer ships with a spec", "app/serializers", "spec/serializers"),
  // Minitest spells the same obligation under test/ with the other suffix. A
  // repository is only asked the question for the suffix it actually uses.
  rails("model_test", "a model ships with a test", "app/models", "test/models", { companionSuffix: "_test.rb" }),
  rails("job_test", "a job ships with a test", "app/jobs", "test/jobs", { companionSuffix: "_test.rb" }),
];

/**
 * Where this repository actually keeps the companions for one obligation,
 * inside one package.
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
 * `prefix` scopes both producer and companion to one package: producers are
 * read from `<prefix>/<from>` rather than the bare `from`, and a companion may
 * only vote when it sits under `<prefix>` too, so decidim-admin's spec of the
 * same basename can never win the vote for a decidim-core model. The empty
 * prefix is the flat repository, and is exactly the original computation.
 *
 * Null when nothing matches: a repository with no companion of this shape is
 * not asked the question rather than told it fails.
 */
export function companionRoot(corpus, { from, to, ext, companionSuffix }, prefix = "", siblings = []) {
  const pFrom = prefix === "" ? from : `${prefix}/${from}`;
  const pTo = prefix === "" ? to : `${prefix}/${to}`;

  const bySuffix = [];
  for (const rel of corpus) {
    if (!rel.endsWith(companionSuffix)) continue;
    if (prefix !== "" && !rel.startsWith(`${prefix}/`)) continue;
    // The root is a package too, the one holding everything not inside another,
    // and restricting only the named prefixes left it seeing every spec in the
    // repository: a nested package's spec then satisfied a root-level model
    // that has none of its own.
    if (prefix === "" && siblings.some((p) => rel.startsWith(`${p}/`))) continue;
    bySuffix.push(rel);
  }
  if (!bySuffix.length) return null;

  const votes = new Map();
  for (const rel of corpus) {
    if (!rel.startsWith(`${pFrom}/`) || !rel.endsWith(ext) || rel.endsWith(companionSuffix)) continue;
    const tail = `/${rel.slice(pFrom.length + 1, -ext.length)}${companionSuffix}`;
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
  if (tied.length === 1) return tied[0];
  // A tie is a repository that has not said anything, so nothing is learned
  // from it and the caller keeps the declared pair. Returning the alphabetical
  // winner would decide an obligation by a filename, which is the one thing
  // this is here to refuse. Where the declared pair is itself among the tied,
  // it wins on being the prior rather than on its name.
  return tied.includes(pTo) ? pTo : null;
}

/**
 * Every package this obligation reaches, each learning its own companion root.
 *
 * `from` is learned the same way `companionRoot` learns `to`: found where it
 * actually sits in the corpus, once per package prefix, rather than assumed to
 * sit at the repository root. decidim nests every gem's `app/` one level down,
 * so the literal `from` never matched and the producer set was empty on all 28
 * gems; a package is a prefix under which `from` genuinely occurs, and the flat
 * repository is the prefix `""`.
 *
 * Falling back to the declared pair, mirrored under the same prefix, when
 * nothing lines up inside a package is what keeps the honest zero: a gem that
 * writes specs and none for its models still reads 0 of N for that gem, which
 * is a fact about the gem. Learning would turn that into silence.
 */
function packagedPairings(corpus, pairing) {
  const prefixes = new Set();
  const marker = `/${pairing.from}/`;
  for (const rel of corpus) {
    // A package is named by a producer under it, never by a companion: a
    // repository that mirrors its whole source tree under the test root writes
    // the producer path there too, and whitehall's `test/unit/app/models` would
    // otherwise read as a package of its own holding every spec it answers.
    if (!rel.endsWith(pairing.ext) || rel.endsWith(pairing.companionSuffix)) continue;
    if (rel.startsWith(`${pairing.from}/`)) prefixes.add("");
    else {
      const at = rel.indexOf(marker);
      if (at !== -1) prefixes.add(rel.slice(0, at));
    }
  }

  const named = [...prefixes].filter((p) => p !== "");
  return [...prefixes].map((prefix) => {
    const from = prefix === "" ? pairing.from : `${prefix}/${pairing.from}`;
    const declared = prefix === "" ? pairing.to : `${prefix}/${pairing.to}`;
    return { from, root: companionRoot(corpus, pairing, prefix, named) ?? declared };
  });
}

export function pairingsFor(langs) {
  return PAIRINGS.filter((p) => p.langs.some((l) => langs.includes(l)));
}

/**
 * One site per eligible file, so the site is the file. The hit shape is the one
 * every dimension produces, so the fold counts this without knowing it differs.
 */
export function pairingHits(corpus, pairing) {
  const shaped = new Set();
  for (const rel of corpus) {
    if (rel.endsWith(pairing.companionSuffix)) shaped.add(basename(rel));
  }

  const hits = new Map();
  for (const { from, root } of packagedPairings(corpus, pairing)) {
    for (const rel of corpus) {
      const companion = companionOf(rel, { ...pairing, from }, root);
      if (companion === null) continue;
      const conforming = corpus.has(companion);
      // `elsewhere` rides the hit so the fold counts it per area. Taken over the
      // corpus and attached to every area, it told a nine-file directory that the
      // repository's other 185 belonged to it.
      hits.set(rel, [{ conforming, elsewhere: !conforming && shaped.has(basename(companion)) }]);
    }
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
    applied.add(pairing.key);
    for (const [rel, hits] of pairingHits(corpus, pairing)) {
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
export function pairingViolations(changed, corpus, pairing) {
  const packages = packagedPairings(corpus, pairing);
  const out = [];
  for (const path of changed) {
    for (const { from, root } of packages) {
      const companion = companionOf(path, { ...pairing, from }, root);
      if (companion === null) continue;
      if (!corpus.has(companion)) out.push({ path, companion });
      break;
    }
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
