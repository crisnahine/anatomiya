import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { READS, pathsThatMoved, readGlossary, sitesOwed } from "../scripts/check-docs.mjs";
import { PARSE_OUTCOMES } from "../plugins/anatomiya/lib/parse.mjs";
import { REL } from "../scripts/plugins.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const row = (over = {}) => ({ key: "k", counterClaim: null, ...over });

const sites = (over = {}) => ({
  defaults: new Set(["k"]),
  intake: new Map([["k", { key: "k", status: "shipped" }]]),
  dropped: new Set(),
  eligible: new Set(),
  refused: new Set(["k"]),
  ...over,
});

test("a row that reached every site owes nothing", () => {
  assert.deepEqual(sitesOwed(row(), sites()), []);
  assert.deepEqual(sitesOwed(row({ counterClaim: "handlers are named" }), sites({ eligible: new Set(["k"]), refused: new Set() })), []);
});

test("every site the row missed is reported, not the first one", () => {
  // An author misses more than one at a time, and two of the sites fail far
  // from the row. Reporting one per run sends them round the loop per site.
  const owed = sitesOwed(row(), sites({ defaults: new Set(), intake: new Map(), refused: new Set() }));

  assert.deepEqual(owed.map((o) => o.site), [
    `${REL.anatomiya}/lib/model-defaults.json`,
    "docs/dimension-intake.md",
    "test/fixtures/counter-pins.mjs",
  ]);
});

test("a missing model-defaults entry names the seeder as its remedy", () => {
  const owed = sitesOwed(row(), sites({ defaults: new Set() }));

  assert.equal(owed.length, 1);
  assert.equal(owed[0].site, `${REL.anatomiya}/lib/model-defaults.json`);
  assert.match(owed[0].remedy, /npm run defaults:seed/);
});

test("the intake row and the counter pin are never handed a command to run", () => {
  // Both are review gates by decision (G2, C6). Naming a script beside them
  // would read as an offer to generate the decision they exist to force.
  const owed = sitesOwed(row({ counterClaim: "handlers are named" }), sites({ intake: new Map(), eligible: new Set() }));

  assert.equal(owed.length, 2);
  for (const o of owed) assert.doesNotMatch(o.remedy, /npm run/);
});

test("an intake row that does not say shipped is reported", () => {
  const owed = sitesOwed(row(), sites({ intake: new Map([["k", { key: "k", status: "planned" }]]) }));

  assert.equal(owed.length, 1);
  assert.match(owed[0].missing, /planned/);
});

test("a key that ships and is also dropped is reported", () => {
  const owed = sitesOwed(row(), sites({ dropped: new Set(["k"]) }));

  assert.equal(owed.length, 1);
  assert.match(owed[0].missing, /dropped/);
});

test("a row carrying a counter owes ELIGIBLE, and one refusing it owes REFUSED", () => {
  const carrying = sitesOwed(row({ counterClaim: "handlers are named" }), sites({ eligible: new Set(), refused: new Set(["k"]) }));
  assert.equal(carrying.length, 1);
  assert.match(carrying[0].missing, /ELIGIBLE/);

  const refusing = sitesOwed(row(), sites({ refused: new Set() }));
  assert.equal(refusing.length, 1);
  assert.match(refusing[0].missing, /REFUSED/);
});

/**
 * The checker run against a copy of this repository, so a test can break one
 * file and read what the checker says about it.
 */
/**
 * What git sees here, as absolute paths.
 *
 * A copy taken with `cp -r` carries whatever else is sitting in the tree, and
 * the gate under test reads the repository's own files. Filtering the copy
 * through this keeps the fixture a copy of the repository rather than of the
 * machine it was made on.
 */
function repositoryFiles() {
  try {
    return new Set(
      execFileSync("git", ["-C", ROOT, "ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean)
        .map((rel) => join(ROOT, rel))
    );
  } catch {
    return null;
  }
}

// The module under test answers `[]` where git cannot say, on purpose, and a
// suite that dies at import over the same question is a file whose other 30
// cases stop running with nothing said. A tree that is not a checkout is a real
// place to run this from: this repository is copied to one for review.
const REPOSITORY_FILES = repositoryFiles();
const needsCheckout = REPOSITORY_FILES
  ? {}
  : { skip: "git cannot list this tree, so there is no repository for the fixture to be a copy of" };
const isRepositoryFile = (src) => statSync(src).isDirectory() || REPOSITORY_FILES.has(src);

function repoCopy(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-check-docs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const filter = REPOSITORY_FILES ? isRepositoryFile : undefined;
  for (const part of ["plugins", "docs", "scripts", ".claude-plugin"]) {
    cpSync(join(ROOT, part), join(dir, part), { recursive: true, filter });
  }
  cpSync(join(ROOT, "test", "fixtures"), join(dir, "test", "fixtures"), { recursive: true, filter });
  for (const f of readdirSync(ROOT).filter((f) => f.endsWith(".md"))) cpSync(join(ROOT, f), join(dir, f));
  // The lockfile carries the version twice, and the checker reads both.
  for (const f of ["package.json", "package-lock.json"]) cpSync(join(ROOT, f), join(dir, f));
  return dir;
}

/**
 * The same copy, made a repository, so the path sweep has a file list to read.
 *
 * Nothing is staged or committed: the sweep asks git for the working tree, and
 * a commit would need an identity this suite has no business setting on the
 * machine it runs on.
 */
function repoCopyTracked(t) {
  const dir = repoCopy(t);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

function check(dir) {
  try {
    return { status: 0, output: execFileSync(process.execPath, [join(dir, "scripts", "check-docs.mjs")], { encoding: "utf8", stdio: "pipe" }) };
  } catch (err) {
    return { status: err.status, output: `${err.stdout}${err.stderr}` };
  }
}

/** The one count in `docs/how-it-works.md` this phrasing states, raised by one. */
function bumpCount(dir, phrasing) {
  const path = join(dir, "docs", "how-it-works.md");
  const text = readFileSync(path, "utf8");
  const stated = text.match(phrasing);
  assert.ok(stated, `the walkthrough states no count matching ${phrasing}`);
  const wrong = stated[0].replace(stated[1], String(Number(stated[1]) + 1));
  writeFileSync(path, text.replace(stated[0], wrong));
  return wrong;
}

test("an untouched copy of this repository passes", (t) => {
  // Every case below breaks one file in a copy. Without this one they would
  // all pass on a copy that was broken from the start.
  const { status, output } = check(repoCopy(t));

  assert.equal(status, 0, output);
  assert.match(output, /docs match the code/);
});

test("a registry key with no model-defaults entry is named, with the seeder as its remedy", (t) => {
  const dir = repoCopy(t);
  const path = join(dir, REL.anatomiya, "lib", "model-defaults.json");
  const table = JSON.parse(readFileSync(path, "utf8"));
  delete table.swallowed_error;
  writeFileSync(path, JSON.stringify(table, null, 2) + "\n");

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, /swallowed_error/);
  assert.match(output, /npm run defaults:seed/);
});

test("a shipping count in the walkthrough the registry does not hold fails", (t) => {
  const dir = repoCopy(t);
  const wrong = bumpCount(dir, /(\d+) ship\b/);

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, new RegExp(wrong));
});

test("a per-language count in the walkthrough the registry does not hold fails", (t) => {
  const dir = repoCopy(t);
  const wrong = bumpCount(dir, /(\d+) that speak Ruby/);

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, new RegExp(wrong));
});

test("the count of type-checked rows is read as a number even spelled as a word", (t) => {
  // Prose spells one row "one". A phrasing nothing parses is a number that
  // drifts silently, which is the whole reason this file exists.
  const dir = repoCopy(t);
  const path = join(dir, "docs", "how-it-works.md");
  writeFileSync(path, readFileSync(path, "utf8").replace("plus the one type-checked row", "plus the two type-checked rows"));

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, /type-checked/);
});

test("a caveat code the walkthrough does not document fails", (t) => {
  // The codes are a public surface as of `--format json`, and the one thing a
  // reader cannot do is tell a code the table forgot from one that was never
  // emitted.
  const dir = repoCopy(t);
  const path = join(dir, "docs", "how-it-works.md");
  // `\r?` because `.` does not match a carriage return: on a checkout with CRLF
  // endings `.*\n` never reached the newline, the row was never removed, and
  // the checker correctly reported a table with nothing missing from it.
  writeFileSync(path, readFileSync(path, "utf8").replace(/^\| `no-map` \|.*\r?\n/m, ""));

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, /does not document the caveat code no-map/);
});

test("a caveat-code count in the walkthrough the report does not hold fails", (t) => {
  // The table is held to the code in both directions and the sentence over it
  // was not, so a new code failed on the missing row and left the prose short.
  const dir = repoCopy(t);
  bumpCount(dir, /There\s+are (\d+)\./);

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, /does not say there are \d+ caveat codes/);
});

test("a documented code the report can never emit fails too", (t) => {
  const dir = repoCopy(t);
  const path = join(dir, "docs", "how-it-works.md");
  writeFileSync(path, readFileSync(path, "utf8").replace("| `no-map` |", "| `no-map-at-all` |"));

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, /documents no-map-at-all, which is not a caveat code/);
});

test("a decision row whose cells outnumber the header is named, with the escape as its remedy", (t) => {
  // GitHub drops every cell past the header count, silently, so an unescaped
  // `|` inside a code span takes the Status column off the end of the row. It
  // happened to three rows at once, one of them losing its whole `done` list.
  const dir = repoCopy(t);
  const path = join(dir, "DECISIONS.md");
  const body = readFileSync(path, "utf8");
  const broken = body.replace("| C1 |", "| C1 | an `a || b` chain |");
  assert.notEqual(broken, body, "the fixture edited something");
  writeFileSync(path, broken);

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, /row C1 on line \d+ has \d+ cells, not 4/);
  assert.match(output, /escape a `\|` inside a code span/);
});

test("a plugin whose manifest moved without its changelog is named", (t) => {
  // Every plugin the marketplace lists, not just the one at the root. The
  // second plugin's version was checked for semver and against nothing else,
  // so it could move to a version no changelog described and the only thing
  // that would have noticed was the tag, after it was pushed.
  const dir = repoCopy(t);
  const path = join(dir, REL.ultracode, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.version = "9.9.9";
  writeFileSync(path, JSON.stringify(manifest, null, 2));

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, /ultracode-anywhere\/CHANGELOG\.md/);
  assert.match(output, /9\.9\.9/);
});

test("a changelog with no Unreleased heading is named, whichever plugin it belongs to", (t) => {
  // The release checklist puts an empty one back, and a release that forgets
  // leaves the next change with nowhere to be written down.
  // Spelled with slashes rather than joined: this is matched against what the
  // gate printed, and the gate answers in slashes on every platform.
  for (const rel of ["CHANGELOG.md", `${REL.ultracode}/CHANGELOG.md`]) {
    const dir = repoCopy(t);
    const path = join(dir, ...rel.split("/"));
    writeFileSync(path, readFileSync(path, "utf8").replace("## [Unreleased]", "## [Coming up]"));

    const { status, output } = check(dir);

    assert.equal(status, 1, rel);
    assert.match(output, new RegExp(`${rel.replace(/[/.]/g, "\\$&")}.*Unreleased`), output);
  }
});

test("a changelog that is gone is one sentence about one file, said once", (t) => {
  // Two readers answer the same absence: the guard here, and `notesFor`, which
  // is asked afterwards whatever the guard found. The author has one thing to
  // do, and was told twice, in two wordings, one of which named the file inside
  // its own message and so printed the path twice on one line.
  const dir = repoCopy(t);
  rmSync(join(dir, REL.ultracode, "CHANGELOG.md"));

  const { status, output } = check(dir);
  const said = output.split("\n").filter((line) => line.includes(`${REL.ultracode}/CHANGELOG.md`));

  assert.equal(status, 1);
  assert.equal(said.length, 1, `said it ${said.length} times:\n${said.join("\n")}`);
  assert.equal(
    said[0].match(/ultracode-anywhere\/CHANGELOG\.md/g).length,
    1,
    `named the file twice in one sentence: ${said[0]}`,
  );
});

test("a changelog with no section for the version names the file once, not twice", (t) => {
  const dir = repoCopy(t);
  const path = join(dir, REL.ultracode, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.version = "9.9.9";
  writeFileSync(path, JSON.stringify(manifest, null, 2));

  const { output } = check(dir);
  const said = output.split("\n").filter((line) => line.includes("has no section for"));

  assert.equal(said.length, 1);
  assert.equal(said[0].match(/ultracode-anywhere\/CHANGELOG\.md/g).length, 1, `named the file twice: ${said[0]}`);
});

test("the marketplace's own changelog going missing is a sentence, not a stack trace", (t) => {
  // The guard the release loop reads through was added for the second plugin's
  // changelog, and anatomiya's, which sits at the marketplace root, was read
  // earlier by the count checks with no guard at all: half the table covered,
  // and the half that was not is the one every other read here already
  // touches. Both are on the list the gate checks first now.
  const dir = repoCopy(t);
  rmSync(join(dir, "CHANGELOG.md"));

  const { status, output } = check(dir);
  const said = output.split("\n").filter((line) => line.includes("CHANGELOG.md") && !line.includes("ultracode-anywhere"));

  assert.equal(status, 1);
  assert.doesNotMatch(output, /ENOENT|at readFileSync/, "the gate threw rather than reporting");
  assert.equal(said.length, 1, `said it ${said.length} times:\n${said.join("\n")}`);
});

test("a plugin with two things wrong is told both, not one release at a time", (t) => {
  // The skip that stopped the changelog being reported twice took the version
  // check with it, which is the failure the block's own comment says it avoids.
  const dir = repoCopy(t);
  const path = join(dir, REL.ultracode, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  delete manifest.version;
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  rmSync(join(dir, REL.ultracode, "CHANGELOG.md"));

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, /CHANGELOG\.md: is missing/);
  assert.match(output, /plugin\.json: has no version/);
});

test("a released heading that lost its brackets is named, and its link left dangling with it", (t) => {
  // A bracketed heading is the shape the link definitions at the bottom point at, and
  // the version loop matches the number as a token on any `##` line, so it
  // reads an unbracketed heading as a section and says nothing.
  const dir = repoCopy(t);
  const path = join(dir, "CHANGELOG.md");
  // The plugin's, not the marketplace's: the root publishes nothing and carries
  // no version, and the headings in this changelog are the plugin's.
  const version = JSON.parse(readFileSync(join(dir, REL.anatomiya, "package.json"), "utf8")).version;
  writeFileSync(path, readFileSync(path, "utf8").replace(`## [${version}]`, `## ${version}`));

  const { status, output } = check(dir);

  assert.equal(status, 1);
  // The sentence, not just the filename and the number: any message carrying
  // those two would have passed, including one about something else entirely.
  assert.match(
    output,
    new RegExp(`CHANGELOG\\.md: has no "## \\[${version.replace(/\./g, "\\.")}\\]" heading`),
    output,
  );
  // And what makes it worth catching: the link definition at the bottom is
  // still there, pointing at a heading that is not, which is what a reader
  // following it lands on.
  const after = readFileSync(path, "utf8");
  const escaped = version.replace(/\./g, "\\.");
  assert.match(after, new RegExp(`^\\[${escaped}\\]:`, "m"), "the link definition should still be there to dangle");
  assert.doesNotMatch(after, new RegExp(`^## \\[${escaped}\\]`, "m"), "and the heading it points at should be gone");
});

test("a version that is not semver is named as that, not as a tag namespace nobody claims", (t) => {
  // The guard asks only whether the field is a string, so `0.1` reaches the tag
  // resolver and the reader is told the namespace is unclaimed while the fault
  // is a field two files away.
  const dir = repoCopy(t);
  const path = join(dir, REL.ultracode, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.version = "0.1";
  writeFileSync(path, JSON.stringify(manifest, null, 2));

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.match(output, /version is not semver: 0\.1/);
  assert.doesNotMatch(output, /no plugin in this marketplace is released by the tag/);
});


test("a document this gate is about going missing is a sentence, whichever one it is", (t) => {
  // Every read here is unguarded on purpose, and a guard at each site is a
  // guard somebody forgets: two had one and four did not, so a missing README
  // died on a stack 44 lines past the check that would have named it. This
  // module is imported by this file, so that stack failed the whole suite at
  // load rather than the gate at runtime.
  //
  // Driven off the list rather than a copy of four of its entries, which is
  // what "whichever one it is" says: a path added to the list and never removed
  // by a case is a guard nobody has watched fail.
  assert.ok(READS.length > 4, `the gate names ${READS.length} paths`);
  for (const rel of READS) {
    const dir = repoCopy(t);
    rmSync(join(dir, rel), { recursive: true, force: true });

    const { status, output } = check(dir);

    assert.equal(status, 1, rel);
    assert.doesNotMatch(output, /ENOENT|at readFileSync/, `${rel} threw rather than reporting`);
    assert.match(output, new RegExp(`${rel.replace(/\./g, "\\.")}.*is missing`), rel);
  }
});

test("a manifest that parses to something that is not one is said, not stepped over", (t) => {
  // `null` parses. Read as "did not parse" it said nothing here and then threw
  // on the summary line, which names no file at all.
  const dir = repoCopy(t);
  writeFileSync(join(dir, REL.ultracode, ".claude-plugin", "plugin.json"), "null");

  const { status, output } = check(dir);

  assert.equal(status, 1);
  assert.doesNotMatch(output, /Cannot read properties of null/);
  assert.match(output, /plugin\.json: parses to something that is not a manifest/);
});

// ----------------------------------------------------------------------------

const TRACKED = new Set([
  `${REL.anatomiya}/lib/hook.mjs`,
  `${REL.anatomiya}/hooks/hooks.json`,
  `${REL.ultracode}/hooks/hooks.json`,
  `${REL.ultracode}/hooks/upstream.mjs`,
  "docs/why.md",
]);

test("a path this repository still holds somewhere else is named with where it is now", () => {
  assert.deepEqual(pathsThatMoved("the read is in `lib/hook.mjs` today", "docs/why.md", TRACKED), [
    { spelled: "lib/hook.mjs", now: `${REL.anatomiya}/lib/hook.mjs`, several: false },
  ]);
});

test("a path in some other repository is left alone, because nothing here says where it went", () => {
  assert.deepEqual(pathsThatMoved("a Rails app spells it `app/models/user.rb`", "docs/why.md", TRACKED), []);
});

test("a path is read from the document's own directory before the repository root", () => {
  const text = "run `hooks/upstream.mjs` from here";
  assert.deepEqual(pathsThatMoved(text, `${REL.ultracode}/VERIFYING.md`, TRACKED), []);
  assert.deepEqual(pathsThatMoved(text, "README.md", TRACKED), [
    { spelled: "hooks/upstream.mjs", now: `${REL.ultracode}/hooks/upstream.mjs`, several: false },
  ]);
});

// Both plugins declare hooks under that name, so the prose spelling it is
// naming the file each plugin has rather than one that moved. Rewritten to
// either one it stops being true of the other.
test("a path both plugins hold is the spelling their manifests use, not a move", () => {
  assert.deepEqual(pathsThatMoved("declared in its own `hooks/hooks.json`", "README.md", TRACKED), []);
});

// A tail matching two files switched the whole check off, and the shape that
// does it is a copy of the repository sitting inside it: a worktree taken out
// of git's hands, an unpacked archive. That is the same silence the rule exists
// to end, so it is said, and only the one both plugins genuinely hold is not.
test("a tail matching two files that are not the plugins' own spelling is said, not passed over", () => {
  const withCopy = new Set([...TRACKED, `copy/${REL.anatomiya}/lib/hook.mjs`]);

  assert.deepEqual(pathsThatMoved("the read is in `lib/hook.mjs` today", "docs/why.md", withCopy), [
    { spelled: "lib/hook.mjs", now: `copy/${REL.anatomiya}/lib/hook.mjs, ${REL.anatomiya}/lib/hook.mjs`, several: true },
  ]);
});

test("a path that is still where the prose says it is passes", () => {
  assert.deepEqual(pathsThatMoved("see `docs/why.md`", "README.md", TRACKED), []);
});

test("a document naming a file that lives somewhere else now is failed, with where it went", needsCheckout, (t) => {
  const dir = repoCopyTracked(t);
  const path = join(dir, "CONTRIBUTING.md");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n\nThe registry is \`lib/registry.mjs\`.\n`);

  const { status, output } = check(dir);

  assert.equal(status, 1, output);
  assert.match(output, new RegExp(`CONTRIBUTING\\.md: names .lib/registry\\.mjs., which is .${REL.anatomiya}/lib/registry\\.mjs. now`));
});

test("a tracked copy with nothing wrong still passes, so the sweep is not failing on its own reading", needsCheckout, (t) => {
  const { status, output } = check(repoCopyTracked(t));

  assert.equal(status, 0, output);
});

test("a document carrying the path of the machine it was written on is failed", needsCheckout, (t) => {
  const dir = repoCopyTracked(t);
  const path = join(dir, "docs", "why.md");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n\nRead from ${join(homedir(), "notes.md")}\n`);

  const { status, output } = check(dir);

  assert.equal(status, 1, output);
  assert.match(output, /docs\/why\.md: carries the path of the machine it was written on/);
});

// Each plugin has a changelog of its own, and a note about a past release is
// what one holds: the entry naming a file at the path it had then is true of
// that release and would be false rewritten to today's.
test("a changelog names the paths its releases had, at the root and inside a plugin", (t) => {
  const dir = repoCopyTracked(t);
  for (const rel of ["CHANGELOG.md", join(REL.ultracode, "CHANGELOG.md")]) {
    const path = join(dir, rel);
    writeFileSync(path, `${readFileSync(path, "utf8")}\n\nThe read was in \`lib/hook.mjs\` then.\n`);
  }

  const { status, output } = check(dir);

  assert.equal(status, 0, output);
});

// --- the glossary -----------------------------------------------------------

const entry = (name, body, avoid) => `**${name}**:\n${body}\n_Avoid_: ${avoid}\n`;

test("an entry parses to its definition and the words it displaces", () => {
  const { terms, problems } = readGlossary(entry("Area", "A directory holding enough source files.", "module, package"));

  assert.deepEqual(problems, []);
  assert.equal(terms.get("Area").body, "A directory holding enough source files.");
  assert.equal(terms.get("Area").avoid, "module, package");
});

test("a definition spanning several lines keeps all of them", () => {
  const { terms } = readGlossary(entry("Area", "One line.\nAnd a second.", "module"));

  assert.equal(terms.get("Area").body, "One line.\nAnd a second.");
});

test("an entry with no _Avoid_ line is named, and does not swallow the entry after it", (t) => {
  // A blank line closes an entry. Without that the parser reads the next
  // entry's definition as this one's and reports nothing at all.
  const text = `**Area**:\nA directory.\n\n${entry("Root", "A directory the roster names.", "folder")}`;
  const { terms, problems } = readGlossary(text);

  assert.deepEqual(problems, ["Area has no _Avoid_ line, so nothing says which words it displaces"]);
  assert.equal(terms.get("Area").body, "A directory.");
  assert.equal(terms.get("Root").avoid, "folder");
});

test("an entry with nothing under it is named", () => {
  const { problems } = readGlossary("**Area**:\n_Avoid_: module\n");

  assert.deepEqual(problems, ["Area has no definition under it"]);
});

test("an entry defined twice names both lines, so the author can delete one", () => {
  const { problems } = readGlossary(`${entry("Area", "First.", "module")}\n${entry("Area", "Second.", "package")}`);

  assert.deepEqual(problems, ["Area is defined twice, on line 1 and line 5"]);
});

test("bold words inside a definition are not entries", () => {
  // `Unexamined` names its four outcomes in bold mid-sentence. Reading those as
  // entries would report four definitions with no _Avoid_ line each.
  const { terms, problems } = readGlossary(entry("Unexamined", "Which of them: **crashed**, or **rejected**.", "failed"));

  assert.deepEqual(problems, []);
  assert.deepEqual([...terms.keys()], ["Unexamined"]);
});

test("the shipped glossary is whole", () => {
  // The unit cases above prove the parser reports; this one is the file.
  const { terms, problems } = readGlossary(readFileSync(join(ROOT, "CONTEXT.md"), "utf8"));

  assert.deepEqual(problems, []);
  assert.ok(terms.size > 30, `only ${terms.size} entries parsed`);
});

test("the glossary names every outcome the parser counts a file as", () => {
  const { terms } = readGlossary(readFileSync(join(ROOT, "CONTEXT.md"), "utf8"));
  const body = terms.get("Unexamined").body;

  for (const outcome of PARSE_OUTCOMES) {
    assert.match(body, new RegExp(`\\b${outcome}\\b`), `Unexamined does not name ${outcome}`);
  }
});

test("an entry that loses its _Avoid_ line fails the check", { ...needsCheckout }, (t) => {
  const dir = repoCopy(t);
  const path = join(dir, "CONTEXT.md");
  writeFileSync(path, readFileSync(path, "utf8").replace("_Avoid_: module, package, folder, scope\n", ""));

  const { status, output } = check(dir);

  assert.equal(status, 1, output);
  assert.match(output, /Area has no _Avoid_ line/);
});

test("an outcome the glossary stops naming fails the check", { ...needsCheckout }, (t) => {
  // The one claim here that reaches the code. A sixth outcome added to
  // `PARSE_OUTCOMES` and never written down reaches a reader as a word the
  // glossary does not hold, and this is what says so.
  const dir = repoCopy(t);
  const path = join(dir, "CONTEXT.md");
  writeFileSync(path, readFileSync(path, "utf8").replace("**oversize** past the per-file cap", "past the per-file cap"));

  const { status, output } = check(dir);

  assert.equal(status, 1, output);
  assert.match(output, /Unexamined does not name oversize/);
});
