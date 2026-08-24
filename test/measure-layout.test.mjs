import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LEARNED_ROWS,
  checkOutput,
  foldCounts,
  learnedRows,
  learnedTables,
  overviewFor,
  parseArgs,
  selectRepos,
} from "../scripts/measure-layout.mjs";
import { namesakeClause } from "../plugins/anatomiya/lib/render-layout.mjs";
import { OVERVIEW_FILE, RULES_DIR } from "../plugins/anatomiya/lib/rules.mjs";
import { planMap, writeMap } from "../plugins/anatomiya/lib/write.mjs";

/**
 * The per-repository numbers the dimension bar asks for, off a scan result.
 *
 * The bar wants `applicability`, `candidates`, `conforming`, `ratio` and the
 * area, per repository, and a summary is what it refuses. So the harness prints
 * a line per area that carried a site, and these are the rules that line obeys.
 */
const dim = (key, over = {}) => ({
  key,
  applicability: 8,
  langFileCount: 40,
  candidates: 20,
  conforming: 19,
  ratio: 0.95,
  learned: "ApplicationRecord",
  gate: null,
  states: "claim",
  ...over,
});

const area = (path, dimensions) => ({ path, dimensions });

test("every learned row gets a table, whether or not the corpus counted one", () => {
  assert.deepEqual(LEARNED_ROWS, [
    "extends_base",
    "class_base",
    "module_include",
    "interface_prefix",
    "type_alias_prefix",
  ]);

  const tables = learnedTables(LEARNED_ROWS.map(() => []).map((rows, i) => [LEARNED_ROWS[i], rows]));
  for (const key of LEARNED_ROWS) assert.match(tables, new RegExp(`### ${key}`));
});

test("an area that carried no site of the row is not a line", () => {
  const areas = [
    area("app/models", [dim("class_base")]),
    area("app/jobs", [dim("class_base", { candidates: 0, conforming: 0, ratio: 0 })]),
    area("lib", [dim("extends_base")]),
  ];

  const rows = learnedRows("api", areas);

  assert.deepEqual(rows.get("class_base").map((r) => r.area), ["app/models"]);
  assert.deepEqual(rows.get("module_include"), []);
});

test("a repository is capped at its five biggest areas, biggest first", () => {
  // A repository with sixty leaf areas holding one class each is not what the
  // bar is asking about, and a table nobody reads to the end proves nothing.
  const areas = [10, 90, 50, 70, 30, 20].map((n, i) =>
    area(`app/a${i}`, [dim("class_base", { candidates: n, conforming: n })])
  );

  const rows = learnedRows("api", areas);

  assert.deepEqual(rows.get("class_base").map((r) => r.candidates), [90, 70, 50, 30, 20]);
});

test("two areas at one candidate count order by code unit, not by the host's locale", () => {
  // The five learned tables are recorded in the measurement document, and
  // `localeCompare` orders case by whatever ICU tables the host was built with.
  const areas = ["app/foo", "app/Foo"].map((path) => area(path, [dim("class_base", { candidates: 5 })]));

  assert.deepEqual(
    learnedRows("api", areas).get("class_base").map((r) => r.area),
    ["app/Foo", "app/foo"]
  );
});

test("the stated column carries the gate that stopped the row", () => {
  const areas = [
    area("app/models", [dim("class_base", { candidates: 30, conforming: 29 })]),
    area("app/controllers", [dim("class_base", { candidates: 20, states: null, gate: "ratio" })]),
    area("app/workers", [dim("class_base", { candidates: 10, conforming: 9, matchesDefault: true })]),
  ];

  const rows = learnedRows("api", areas);

  assert.deepEqual(rows.get("class_base").map((r) => r.stated), ["yes", "no (ratio)", "no (model default)"]);
});

test("the table prints one line per area, with the numbers the bar asks for", () => {
  const rows = learnedRows("api", [area("app/models", [dim("class_base", { learned: "ApplicationRecord" })])]);
  const line = learnedTables([...rows]).split("\n").find((l) => l.startsWith("| api |"));

  assert.equal(line, "| api | app/models | 8 | 40 | 20 | 19 | 0.950 | ApplicationRecord | yes |");
});

test("the namesake clause the recount reads back is the renderer's own", () => {
  // The recount held a copy of this sentence, the renderer took the singular
  // for a count of one, and babel's true line read back as a failure. There is
  // one spelling now, and this is the harness reading it.
  assert.equal(namesakeClause({ with: 1, of: 95, root: "test" }), "1 of 95 has a namesake test under test");
  assert.equal(namesakeClause({ with: 8, of: 651, root: null }), "8 of 651 have a namesake test");
  assert.equal(
    namesakeClause({ with: 1, of: 4, root: null }, ".js file"),
    "1 of 4 .js files has a namesake test"
  );
});

test("the clause names the directory the denominator was counted over, and both sides read it alike", () => {
  // The renderer and the recount each pick which field of the root record to
  // name. Reading different ones is invisible to every unit test and fails all
  // 35 repositories at once, which is how it was found: the renderer moved from
  // the printed label to the directory and the recount kept the label, which it
  // does not carry. Both take `dir`, and a shell's own files carry a label that
  // is not a path.
  assert.equal(
    namesakeClause({ with: 41, of: 53, root: null }, ".mjs file", "lib"),
    "41 of 53 .mjs files under lib have a namesake test"
  );
  assert.equal(
    namesakeClause({ with: 41, of: 53, root: null }, ".mjs file", "lib (files at this level)"),
    "41 of 53 .mjs files under lib (files at this level) have a namesake test",
    "the label would read as a directory name, which is why the record carries dir beside path"
  );
  assert.equal(
    namesakeClause({ with: 8, of: 651, root: null }, ".ts file", null),
    "8 of 651 .ts files have a namesake test",
    "a root with no directory of its own names none"
  );
});

test("the corpus directory is an argument, never a path off this machine", () => {
  // It read a home directory of the author's when nothing was passed, which
  // runs the acceptance over whatever happens to be there or over nothing at
  // all. The two other scripts in here take their input the same way.
  assert.equal(parseArgs(["/corpus"]).corpus, "/corpus");
  assert.match(parseArgs([]).error, /corpus/);
  assert.match(parseArgs(["--only", "webpack"]).error, /corpus/);
  assert.match(parseArgs(["--nope", "/corpus"]).error, /--nope/);
});

test("the options a run takes are read off the arguments beside the corpus", () => {
  const opts = parseArgs(["--md", "out.md", "/corpus", "--only", "webpack,eslint", "--facts", "f"]);

  assert.deepEqual(opts, {
    corpus: "/corpus",
    md: "out.md",
    facts: "f",
    only: "webpack,eslint",
    force: false,
  });
  assert.equal(parseArgs(["/corpus", "--force"]).force, true);
});

test("an option last on the line read the argument that was not there", () => {
  // `--only` read nothing and measured all thirty-five, which is the run the
  // one name was meant to replace.
  assert.match(parseArgs(["/corpus", "--only"]).error, /--only/);
  assert.match(parseArgs(["/corpus", "--md"]).error, /--md/);
});

test("a --only name the corpus does not hold is an error, not a shorter run", () => {
  // The e2e harness got this rule first: a typo measured nothing and printed
  // `0 of 0 repositories passed`, which is exit 0 and reads as an acceptance.
  const repos = ["errbit", "eslint"];

  assert.deepEqual(selectRepos(repos, null).repos, repos);
  assert.deepEqual(selectRepos(repos, "eslint").repos, ["eslint"]);
  assert.match(selectRepos(repos, "errbti").error, /errbti/);
  assert.match(selectRepos(repos, "errbit,eslnit").error, /eslnit/);
});

test("the overview the recount reads back is the file a write puts on disk", () => {
  // The recount used to derive this body itself, because the writer would not
  // hand one back. The drift that hid in there is the rules directory: the
  // overview names the files it did not write, and the copy had to be told to.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-layout-"));
  mkdirSync(join(dir, RULES_DIR), { recursive: true });
  writeFileSync(join(dir, RULES_DIR, "house-style.md"), "# theirs\n");
  const result = {
    root: dir,
    scannedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 12,
    corpus: { files: 20, truncated: false, dropped: {}, orphaned: 8 },
    parse: { parsed: 20, crashed: 0, skipped: 0 },
    suppressAll: false,
    areas: [],
  };

  writeMap(result);

  const written = readFileSync(join(dir, RULES_DIR, OVERVIEW_FILE), "utf8");
  assert.match(written, /^- "house-style\.md"$/m);
  assert.equal(overviewFor(result), written);
  rmSync(dir, { recursive: true, force: true });
});

test("a --md target that is already there is refused, and --force is how a rerun says it meant it", () => {
  // The file is a run of record somebody merged into a document by hand, and
  // this script writes its target whole.
  assert.equal(checkOutput("/out/run.md", false, false), null);
  assert.equal(checkOutput("/out/run.md", true, true), null);
  assert.equal(checkOutput(null, false, true), null);
  assert.match(checkOutput("/out/run.md", false, true), /\/out\/run\.md/);
  assert.match(checkOutput("/out/run.md", false, true), /--force/);
});

test("the recount reads every clause the fold line can carry", () => {
  // Nothing runs this parser until a corpus run does, and a spelling it cannot
  // read fails 35 repositories at once, eighteen minutes in. The reconciliation
  // it feeds counts files, so every clause has to add to the same number.
  assert.deepEqual(foldCounts("- and 2 more directories holding 3400 files"), { folded: 2, files: 3400 });
  assert.deepEqual(foldCounts("- and 1 more directory holding 1 file"), { folded: 1, files: 1 });
  assert.deepEqual(
    foldCounts("- and 2 more directories holding 3400 files, and 147 files in 26 directories under the floor"),
    { folded: 2, files: 3547 }
  );
  assert.deepEqual(
    foldCounts(
      "- and 1 more directory holding 3 files, 4 files in 4 directories under the floor, and 14 at the repository root"
    ),
    { folded: 1, files: 21 }
  );
  assert.deepEqual(foldCounts("- and 14 files at the repository root"), { folded: 0, files: 14 });
  assert.deepEqual(
    foldCounts("- and 12 more files in directories under the floor"),
    { folded: 0, files: 12 },
    "a map written before the three were counted apart still reconciles"
  );
  assert.equal(foldCounts("- and something else entirely"), null);
});
