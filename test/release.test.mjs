import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { RELEASES, TAG_GLOBS, notesFor, releaseFor, sectionFor } from "../scripts/release.mjs";
import { REL } from "../scripts/plugins.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * The tag this repository's own manifests carry, read rather than spelled.
 *
 * Every case below that drives the real command needs a tag it accepts, and a
 * literal one rots the day the version moves: seven of these refuse at the
 * argument gate and passed anyway, and the eighth, which gets as far as the
 * manifests, is the one that failed on the release it was meant to be run
 * before.
 */
const TAG = `v${JSON.parse(readFileSync(join(ROOT, REL.anatomiya, "package.json"), "utf8")).version}`;

/**
 * A directory of the case's own to run the command in.
 *
 * Every spawn here passes one, because a regression in this module writes a
 * file: `--notes --notes-file x` once left a file literally named
 * `--notes-file` in the repository root, from a case whose whole purpose was
 * to prove that cannot happen.
 */
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-release-cwd-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A marketplace with both plugins, each carrying its own version and changelog. */
function repository(t, { anatomiya = "1.2.3", second = "0.4.0", changelogs = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-release-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // The shape the marketplace has: a plugin per directory under `plugins/`,
  // each with its own manifests, and one lockfile at the marketplace root.
  mkdirSync(join(dir, REL.anatomiya, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, REL.anatomiya, "package.json"), JSON.stringify({ name: "anatomiya", version: anatomiya }));
  writeFileSync(
    join(dir, "package-lock.json"),
    JSON.stringify({
      name: "anatomiya",
      version: anatomiya,
      packages: { "": { name: "anatomiya", version: anatomiya }, [REL.anatomiya]: { version: anatomiya } },
    }),
  );
  writeFileSync(join(dir, REL.anatomiya, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "anatomiya", version: anatomiya }));
  mkdirSync(join(dir, REL.ultracode, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(dir, REL.ultracode, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "ultracode-anywhere", version: second }),
  );

  writeFileSync(join(dir, "CHANGELOG.md"), changelogs.anatomiya ?? `# Changelog\n\n## [Unreleased]\n\n## [${anatomiya}] - 2026-01-01\n\nWhat anatomiya did.\n`);
  writeFileSync(
    join(dir, REL.ultracode, "CHANGELOG.md"),
    changelogs.second ?? `# Changelog\n\n## [Unreleased]\n\n## [${second}] - 2026-01-01\n\nWhat the second plugin did.\n`,
  );
  return dir;
}

test("a bare version tag names anatomiya, which has always carried it", () => {
  assert.equal(releaseFor("v1.2.3")?.plugin, "anatomiya");
  assert.equal(releaseFor("v1.2.3")?.version, "1.2.3");
});

test("a prefixed tag names the plugin it is prefixed with", () => {
  assert.equal(releaseFor("ultracode-anywhere-v0.4.0")?.plugin, "ultracode-anywhere");
  assert.equal(releaseFor("ultracode-anywhere-v0.4.0")?.version, "0.4.0");
});

test("a tag no plugin claims is nobody's release", () => {
  assert.equal(releaseFor("nightly"), null);
  assert.equal(releaseFor("v1.2"), null, "a version is three numbers");
  assert.equal(releaseFor("1.2.3"), null, "and it carries the v");
});

test("each plugin reads its own changelog, not the one next to it", (t) => {
  // The failure this exists for: run the old workflow's matcher for 0.1.0
  // against the shared changelog and it answers with anatomiya's 0.1.0 section,
  // silently, as the second plugin's release notes.
  const dir = repository(t, {
    anatomiya: "0.1.0",
    second: "0.1.0",
    changelogs: {
      anatomiya: "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-01-01\n\nAnatomiya's own notes.\n",
      second: "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-01-02\n\nThe second plugin's own notes.\n",
    },
  });

  assert.match(notesFor(dir, "v0.1.0").notes, /Anatomiya's own notes/);
  assert.match(notesFor(dir, "ultracode-anywhere-v0.1.0").notes, /The second plugin's own notes/);
});

test("a tag a manifest does not carry is refused, and says which", (t) => {
  const dir = repository(t, { anatomiya: "1.2.3" });

  const refused = notesFor(dir, "v9.9.9");

  assert.equal(refused.notes, null);
  assert.match(refused.problem, /package\.json/);
  assert.match(refused.problem, /9\.9\.9/);
});

/** The lockfile, with one edit applied to it. */
function relock(dir, edit) {
  const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
  edit(lock);
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lock));
}

test("the lockfile entry read is the plugin's own, not the marketplace root's", (t) => {
  const dir = repository(t);
  relock(dir, (lock) => {
    lock.packages[REL.anatomiya].version = "1.2.2";
  });

  assert.match(notesFor(dir, "v1.2.3").problem, /package-lock\.json says 1\.2\.2/);
});

// The marketplace root is not what a plugin release moves, so a root sitting at
// another version is not this plugin's business and must not refuse its tag.
test("a marketplace root at some other version does not refuse a plugin whose own entry agrees", (t) => {
  const dir = repository(t);
  relock(dir, (lock) => {
    lock.version = "9.9.9";
    lock.packages[""].version = "9.9.9";
  });

  const answered = notesFor(dir, "v1.2.3");

  assert.equal(answered.problem, null, answered.problem ?? "");
  assert.match(answered.notes, /What anatomiya did/);
});

test("a lockfile with no entry for the plugin says nothing about it, rather than lending it the root's version", (t) => {
  const dir = repository(t);
  relock(dir, (lock) => {
    delete lock.packages[REL.anatomiya];
  });

  assert.match(notesFor(dir, "v1.2.3").problem, /package-lock\.json says nothing/);
});

test("a lockfile whose entry for the plugin is not an object says nothing rather than throwing", (t) => {
  const dir = repository(t);
  relock(dir, (lock) => {
    lock.packages[REL.anatomiya] = null;
  });

  assert.match(notesFor(dir, "v1.2.3").problem, /package-lock\.json says nothing/);
});

test("a version with no section of its own is refused rather than released bare", (t) => {
  const dir = repository(t, { second: "0.4.0", changelogs: { second: "# Changelog\n\n## [Unreleased]\n" } });

  const refused = notesFor(dir, "ultracode-anywhere-v0.4.0");

  assert.equal(refused.notes, null);
  assert.match(refused.problem, /ultracode-anywhere\/CHANGELOG\.md/);
});

test("a version is matched as a whole number, not as a substring of another", () => {
  const body = "## [10.1.0] - 2026-01-01\n\nThe wrong one.\n\n## [0.1.0] - 2026-01-02\n\nThe right one.\n";

  assert.match(sectionFor(body, "0.1.0"), /The right one/);
  assert.doesNotMatch(sectionFor(body, "0.1.0"), /The wrong one/);
});

test("a section ends at the next version, not at the end of the file", () => {
  const body = "## [2.0.0] - 2026-01-02\n\nSecond.\n\n## [1.0.0] - 2026-01-01\n\nFirst.\n";

  assert.equal(sectionFor(body, "2.0.0").trim(), "Second.");
});

test("a release is not answered with a pre-release or a build of the same number", () => {
  // `0.1.0` and `0.1.0-rc.1` are different releases, and a boundary that counts
  // the hyphen as a separator reads the second heading as the first one's.
  const body = "## [0.1.0-rc.1] - 2026-01-01\n\nThe candidate.\n\n## [0.1.0] - 2026-01-02\n\nThe release.\n";

  assert.match(sectionFor(body, "0.1.0"), /The release/);
  assert.doesNotMatch(sectionFor(body, "0.1.0"), /The candidate/);
  assert.match(sectionFor(body, "0.1.0-rc.1"), /The candidate/);
});

test("a flag with no value after it is refused rather than passed over", (t) => {
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "release.mjs"), TAG, "--notes"], {
    cwd: scratch(t),
    encoding: "utf8",
  });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /--notes/);
});

test("an option this does not know is a typo, not a tag", (t) => {
  // `--notes-file` released the right version and wrote no notes: the unknown
  // flag became the tag and its path was dropped.
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "release.mjs"), TAG, "--notes-file", "/tmp/x.md"], {
    cwd: scratch(t), encoding: "utf8",
  });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /unknown option: --notes-file/);
});

test("a second tag is refused rather than dropped", (t) => {
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "release.mjs"), TAG, "v0.1.0"], { cwd: scratch(t), encoding: "utf8" });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /only one tag/);
});

test("a flag handed an empty path is refused, not answered with silence", (t) => {
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "release.mjs"), TAG, "--notes", ""], {
    cwd: scratch(t), encoding: "utf8",
  });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /--notes needs a path/);
});

// The sibling gate refuses any dash and says why in its own comment: `-x` was
// taken as the path, the file the reader meant was never written, and a
// dash-named one appeared beside it. This one knew two dashes and not one.
test("a single-dash option is not a path either, and nothing is written under its name", (t) => {
  const dir = scratch(t);
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "release.mjs"), TAG, "--notes", "-x"], {
    cwd: dir, encoding: "utf8",
  });

  assert.equal(run.status, 2, run.stdout);
  assert.match(run.stderr, /--notes needs a path/);
  assert.deepEqual(readdirSync(dir), []);
});

test("a mistyped option is not a path the notes are written to", (t) => {
  // `--notes --notes-file x.md` wrote the notes to a file literally named
  // `--notes-file`, and the release step read the empty one it meant. The value
  // check knew the three flags it takes and nothing about the shape of a typo.
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "release.mjs"), TAG, "--notes", "--notes-file"], {
    cwd: scratch(t), encoding: "utf8",
  });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /--notes needs a path/);
});

test("the link definitions at the bottom are not the oldest release's notes", () => {
  // Nothing follows the first release, so a section that runs to the end of the
  // file ships the compare URLs as its body.
  const body = "## [1.0.0] - 2026-01-01\n\nFirst.\n\n[Unreleased]: https://example.test/compare\n[1.0.0]: https://example.test/tag\n";

  assert.equal(sectionFor(body, "1.0.0").trim(), "First.");
});

test("the workflow fires on every tag a plugin here can carry", () => {
  // Two copies of one fact: the module decides what a tag means, and the
  // workflow decides which tags start a run. A tag the module knows and the
  // workflow ignores is a release that never happens.
  const workflow = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  const declared = workflow.match(/tags:\s*\[(.*)\]/)?.[1] ?? "";

  assert.deepEqual(
    declared.split(",").map((glob) => glob.trim().replace(/^["']|["']$/g, "")),
    TAG_GLOBS,
  );
});

test("the release checklist's table says what the code says", () => {
  // The page a person works through, against the table the workflow runs. Two
  // copies of one contract is the failure this repository keeps writing tests
  // against, and this one is only read when somebody is already mid-release.
  const page = readFileSync(join(ROOT, "docs", "releasing.md"), "utf8");
  const rows = [...page.matchAll(/^\| `([a-z-]+)` \| `(.+?)` \| (.+?) \| `(.+?)` \|$/gm)].map((row) => ({
    plugin: row[1],
    tag: row[2].replace("x.y.z", "*"),
    manifests: row[3].split(",").map((cell) => cell.trim().replace(/`/g, "")),
    changelog: row[4],
  }));

  assert.deepEqual(rows, RELEASES.map(({ plugin, tag, manifests, changelog }) => ({ plugin, tag, manifests, changelog })));
});

test("every plugin the marketplace lists can be released", () => {
  // A plugin nobody can tag is a plugin that ships whenever another one does.
  const marketplace = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "marketplace.json"), "utf8"));

  assert.deepEqual(
    marketplace.plugins.map((entry) => entry.name).sort(),
    RELEASES.map((release) => release.plugin).sort(),
  );
});

test("this repository's own tags resolve to the versions its manifests carry", () => {
  for (const release of RELEASES) {
    const version = JSON.parse(readFileSync(join(ROOT, release.manifests[0]), "utf8")).version;
    const answered = notesFor(ROOT, release.tag.replace("*", version));

    assert.equal(answered.problem, null, `${release.plugin}: ${answered.problem}`);
    assert.ok(answered.notes.length > 0, `${release.plugin} has no notes for ${version}`);
  }
});

test("the release resolver runs as a command and writes the notes it found", (t) => {
  const dir = repository(t);
  const out = join(dir, "notes.md");

  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "release.mjs"), "v1.2.3", "--notes", out, "--root", dir], {
    cwd: scratch(t), encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(readFileSync(out, "utf8"), /What anatomiya did/);
  assert.match(run.stdout, /anatomiya/);
});

test("the command refuses a tag it cannot release, with the reason on stderr", (t) => {
  const dir = repository(t);

  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "release.mjs"), "v9.9.9", "--root", dir], { cwd: scratch(t), encoding: "utf8" });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /9\.9\.9/);
});

test("the command writes the plugin and version where a workflow reads them", (t) => {
  const dir = repository(t);
  const out = join(dir, "outputs.txt");

  // Written before the run, the way another step in the same job would have.
  writeFileSync(out, "earlier=kept\n");

  const run = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "release.mjs"), "ultracode-anywhere-v0.4.0", "--github-output", out, "--root", dir],
    { cwd: scratch(t), encoding: "utf8" },
  );

  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(out, "utf8"), "earlier=kept\nplugin=ultracode-anywhere\nversion=0.4.0\n");
});

test("the command with no tag prints what it takes", (t) => {
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "release.mjs")], { cwd: scratch(t), encoding: "utf8" });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /usage: node scripts\/release\.mjs/);
});

test("a tag nobody claims names no plugin rather than guessing at one", (t) => {
  const dir = repository(t);

  assert.match(notesFor(dir, "nightly").problem, /no plugin/);
});

test("a manifest that is missing or unreadable is named rather than skipped", (t) => {
  const missing = repository(t);
  rmSync(join(missing, "package-lock.json"));
  assert.match(notesFor(missing, "v1.2.3").problem, /package-lock\.json is missing/);

  const unreadable = repository(t);
  writeFileSync(join(unreadable, REL.anatomiya, ".claude-plugin", "plugin.json"), "{not json");
  assert.match(notesFor(unreadable, "v1.2.3").problem, /could not be read/);
});

test("a changelog that is not there is named rather than read as empty", (t) => {
  const dir = repository(t);
  rmSync(join(dir, REL.ultracode, "CHANGELOG.md"));

  assert.match(notesFor(dir, "ultracode-anywhere-v0.4.0").problem, /is missing/);
});


test("one version rule, and it is the one the manifest gate uses", () => {
  // A second copy of the pattern is a second answer to one question, which is
  // what `validate.mjs`'s own docstring says. The copy here was looser: it took
  // pre-release forms the manifest gate calls not-semver, so a version could
  // pass the tag and fail the check on the branch, or the reverse.
  for (const loose of ["1.0.0-01", "1.0.0-.", "1.0.0-a..b", "1.0.0+a..b"]) {
    assert.equal(releaseFor(`v${loose}`), null, `${loose} was taken as a version`);
  }
  assert.notEqual(releaseFor("v1.0.0-rc.1"), null, "and a real pre-release still resolves");

  // And it is the same rule, not a second one that happens to agree today: the
  // probes above pass for any correct copy, and two copies are what the
  // manifest gate's own docstring says must not exist.
  const source = readFileSync(join(ROOT, "scripts", "release.mjs"), "utf8");
  assert.match(source, /import \{[^}]*\bSEMVER\b[^}]*\} from "\.\/validate\.mjs"/, "release.mjs spells its own version rule");
  assert.doesNotMatch(source, /(?:const|let)\s+SEMVER\s*=/, "release.mjs holds a second copy of the pattern");
});

test("a changelog that cannot be read is an answer, not a throw", (t) => {
  // The manifest half already answers. The docstring says one answer carries
  // both, because the caller is a workflow step that has to say which half
  // failed, and half of it threw instead.
  const dir = repository(t);
  rmSync(join(dir, "CHANGELOG.md"));
  mkdirSync(join(dir, "CHANGELOG.md"));

  const answered = notesFor(dir, "v1.2.3");

  assert.equal(answered.notes, null);
  assert.match(answered.problem, /CHANGELOG\.md could not be read/);
});

test("a repeated flag is refused rather than taking the last one", (t) => {
  // The first path is silently dropped and the step that reads it finds the
  // file it meant never written, which is the failure this module exists to
  // stop happening at a tag.
  const run = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "release.mjs"), TAG, "--notes", "/tmp/one.md", "--notes", "/tmp/two.md"],
    { cwd: scratch(t), encoding: "utf8" },
  );

  assert.equal(run.status, 2);
  assert.match(run.stderr, /--notes was given twice/);
});

test("a notes path that cannot be written is a sentence, not a stack", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-release-notes-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "adir"));

  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "release.mjs"), TAG, "--notes", join(dir, "adir")], {
    cwd: scratch(t), encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.doesNotMatch(run.stderr, /at \w+ \(/, "a stack reached the reader");
  assert.match(run.stderr, /could not write the notes/);
});

test("the two readers answer for anything, rather than throwing on it", () => {
  // Both are exported, so a caller outside this file may hand them anything.
  for (const wrong of [undefined, null, 42, {}]) {
    assert.equal(releaseFor(wrong), null, JSON.stringify(wrong) ?? "undefined");
    assert.equal(sectionFor(wrong, "1.0.0"), null, JSON.stringify(wrong) ?? "undefined");
  }
});


test("no tag this marketplace can push is claimed by two plugins", () => {
  // The property that makes the resolution safe, rather than the ordering that
  // was written to enforce it: the semver test refuses the remainder a shorter
  // prefix leaves, so the walk carries on. Asked of every pair in the table and
  // of an overlap the table does not hold yet, in both orders.
  // Asked through the resolver only: a helper that recomputes the rule is a
  // second copy of the thing under test, and it agrees with the code by
  // construction rather than by being right.
  for (const release of RELEASES) {
    const tag = release.tag.replace("*", "1.2.3");
    assert.equal(releaseFor(tag)?.plugin, release.plugin, tag);
  }

  // A plugin named for a prefix of an existing one is the shape the ordering
  // was written for, and it resolves the same either way round.
  const table = [
    { plugin: "anatomiya", tag: "v*", manifests: [], changelog: "CHANGELOG.md" },
    { plugin: "va", tag: "va-v*", manifests: [], changelog: "va/CHANGELOG.md" },
  ];
  for (const order of [table, [...table].reverse()]) {
    assert.equal(releaseFor("va-v1.2.3", order)?.plugin, "va");
    assert.equal(releaseFor("v1.2.3", order)?.plugin, "anatomiya");
  }
});


test("the lockfile entry that mirrors the plugin is the one that is read", (t) => {
  // A workspace lockfile carries the marketplace root's version at `packages[""]`
  // and each member's under its own path. Reading the root's alone let the
  // member drift: every other file said 1.2.4, that entry said 1.2.3, and the
  // tag, the manifest gate and the docs gate all passed.
  const dir = repository(t, { anatomiya: "1.2.4" });
  const path = join(dir, "package-lock.json");
  const lock = JSON.parse(readFileSync(path, "utf8"));
  lock.packages[REL.anatomiya] = { name: "anatomiya", version: "1.2.3" };
  writeFileSync(path, JSON.stringify(lock));

  const answered = notesFor(dir, "v1.2.4");

  assert.match(answered.problem ?? "", /version mismatch: the tag says 1\.2\.4, package-lock\.json says 1\.2\.3/);
});

test("the marketplace root's own version is not what a plugin's tag is checked against", (t) => {
  // The root declares the workspaces and carries a version of its own, which no
  // plugin release moves. Held against the tag, the runbook's own steps left a
  // tree that would not tag until a file no row named was edited too.
  const dir = repository(t, { anatomiya: "1.2.4" });
  const path = join(dir, "package-lock.json");
  const lock = JSON.parse(readFileSync(path, "utf8"));
  lock.version = "0.0.1";
  lock.packages[""] = { name: "crisnahine", version: "0.0.1" };
  lock.packages[REL.anatomiya] = { name: "anatomiya", version: "1.2.4" };
  writeFileSync(path, JSON.stringify(lock));

  assert.equal(notesFor(dir, "v1.2.4").problem, null);
});
