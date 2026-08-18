import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { check, encodeReport, formatReport, CAVEATS, CHECK_SCHEMA } from "../lib/check.mjs";
import { writeFacts } from "../lib/facts.mjs";

/**
 * The report as something other than a rendering: a machine reader gets a
 * schema, a code per caveat and the rules audit's own fields, and every string
 * in it has been through the encoder before any writer sees it.
 */
function repo(t, build) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-report-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("checkout", "-q", "-b", "main");

  const write = (rel, body) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  const commit = (msg) => {
    git("add", "-A");
    git("commit", "-qm", msg);
  };

  build({ dir, git, write, commit });
  return dir;
}

const clean = (n) =>
  Array.from({ length: n }, (_, i) => `export function g${i}() { try { go${i}() } catch (e) { log(e) } }`).join("\n") + "\n";

const swallow = (n) =>
  Array.from({ length: n }, (_, i) => `export function f${i}() { try { go${i}() } catch (e) { } }`).join("\n") + "\n";

/** The map on disk, through the writer, so the shape is one the scan produces. */
function facts(dir) {
  writeFacts(dir, {
    root: dir,
    scannedAt: "2026-01-01T00:00:00.000Z",
    corpus: { files: 8, frameworks: [], capabilities: [] },
    parse: { parsed: 8 },
    suppressAll: false,
    areas: [
      {
        id: "aaaaaaaa",
        path: "src",
        globs: [{ negated: false, dir: "src", tail: "**/*.ts" }],
        fileCount: 8,
        dimensions: [
          {
            key: "swallowed_error",
            precision: "precise",
            directive: true,
            gate: null,
            applicability: 6,
            candidates: 60,
            conforming: 60,
            exceptions: [],
            baseline: { candidates: 60, conforming: 60, exceptions: [] },
          },
        ],
      },
    ],
  });
}

/**
 * One branch with a violation committed, a second violation left in the tree,
 * a rule file this tool did not write, and a map with no pin. Every part of the
 * rendered report has something in it: the header's examined count, the stale
 * line, a caveat, two findings and the rules listing.
 */
function reportRepo(t) {
  return repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    write(".claude/rules/house.md", "someone else's\n");
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
    write("src/b.ts", swallow(1));
  });
}

/** Every value in the record a writer could not serialise, named by its path. */
function unserialisable(value, at = "report") {
  if (typeof value === "function") return [at];
  if (value === null || typeof value !== "object") return [];
  if (value instanceof Map || value instanceof Set) return [at];
  if (Array.isArray(value)) return value.flatMap((v, i) => unserialisable(v, `${at}[${i}]`));
  return Object.entries(value).flatMap(([k, v]) => unserialisable(v, `${at}.${k}`));
}

test("a caveat carries a code, so a reader never has to match prose", async (t) => {
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts", clean(2));
    commit("init");
    git("checkout", "-q", "-b", "work");
    write("src/a.ts", clean(2) + swallow(1));
    commit("swallow");
  });

  const r = await check(dir, { baseRef: "main" });

  assert.deepEqual(r.caveats[0], {
    code: "no-map",
    message: "no map on disk, so nothing was stated and nothing can be enforced",
  });
  const codes = new Set(Object.values(CAVEATS));
  for (const c of r.caveats) {
    assert.ok(codes.has(c.code), `${c.code} is not one of the declared caveats`);
    assert.equal(typeof c.message, "string");
  }
});

test("the report says which shape it is, and the rules audit reaches it whole", async (t) => {
  const dir = reportRepo(t);
  facts(dir);

  const r = await check(dir, { baseRef: "main" });

  // A reader older than the record refuses it rather than reading fields that
  // moved, the way `readFacts` already refuses a map from a later build.
  assert.equal(r.schema, CHECK_SCHEMA);
  assert.equal(r.schema, 1);
  // `escaped` and `listed` were folded into caveat prose and never reached the
  // report, so a writer could report a clean rules directory for one nobody
  // could list.
  assert.deepEqual(r.rules, { escaped: false, listed: true, unreadable: [] });
  assert.deepEqual(unserialisable(r), [], "a writer has to be able to serialise this");
});

test("no caveat reaches the report without a code", () => {
  // The codes are the record's, so one site left pushing a bare string is a
  // caveat a machine reader can only tell apart by matching its sentence.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "check.mjs"), "utf8");

  // One `push`, inside the helper that takes a code. Everywhere else calls it.
  assert.equal((src.match(/caveats\.push\(/g) ?? []).length, 1, "a caveat is still pushed without a code");

  const named = [...src.matchAll(/(?<!function )\bcaveat\(\s*caveats,\s*([^,]+),/g)].map((m) => m[1].trim());
  assert.ok(named.length >= 23, `only ${named.length} coded caveat sites`);
  for (const name of named) {
    // `code` is the one site that takes its caller's, since an unread corpus
    // costs the framework claims or the routing claims depending on who asked.
    assert.match(name, /^(?:CAVEATS\.\w+|code)$/, `${name} is not a code from the table`);
  }
  for (const [, name] of src.matchAll(/CAVEATS\.(\w+)/g)) {
    assert.ok(CAVEATS[name], `CAVEATS.${name} is not declared`);
  }
});

test("encodeReport neutralises the values a writer would otherwise emit raw", async (t) => {
  const dir = reportRepo(t);
  facts(dir);
  const r = await check(dir, { baseRef: "main" });

  // A bidi override reverses the visual order of the rest of the line, and
  // JSON.stringify does not escape one, so a JSON writer needs the value
  // neutralised before it is handed the record.
  r.findings[0].path = "src/ev‮li.ts";
  // The claim is this tool's own sentence rather than a repository-controlled
  // value, and the encoder strips the `|` that "not ||" needs.
  r.findings[0].claim = "defaults are taken with ??, not ||";
  const before = JSON.stringify(r);

  const e = encodeReport(r);

  assert.equal(e.findings[0].path.includes("‮"), false, "the override is gone from the record");
  assert.equal(e.findings[0].claim, "defaults are taken with ??, not ||");
  assert.equal(JSON.stringify(r), before, "the input is not mutated");
});

test("an ASCII report comes back from the encoder unchanged", async (t) => {
  const dir = reportRepo(t);
  facts(dir);
  const r = await check(dir, { baseRef: "main" });

  const e = encodeReport(r);

  assert.equal(e.base.ref, r.base.ref);
  assert.equal(e.staleReason, r.staleReason);
  assert.deepEqual(e.caveats, r.caveats);
  assert.deepEqual(e.changed, r.changed);
  assert.deepEqual(e.examined, r.examined);
  assert.deepEqual(e.foreign, r.foreign);
  assert.deepEqual(e.findings, r.findings);
  assert.deepEqual(e.rules, r.rules);
});

test("the rendered report has not moved", async (t) => {
  // One pass through the encoder now happens before the renderer rather than
  // inside it, so what is pinned is every byte the renderer used to produce.
  const dir = reportRepo(t);
  facts(dir);

  const r = await check(dir, { baseRef: "main" });

  // The base sha is the one part of the line no fixture can fix: a commit
  // carries the second it was made in.
  const rendered = formatReport(r).replace(/\(([0-9a-f]{7})\)/, "(<sha>)");
  assert.equal(
    rendered,
    "base main (<sha>), 1 changed file, 2 examined, compare\n" +
      "0 MUST-FIX, 2 FIX, 0 NIT\n" +
      "severity capped at FIX: no baseline pinned\n" +
      "note: 1 file(s) were read from the working tree rather than from a commit, so this run answers for the work as it stands\n" +
      "\n" +
      'FIX  "src/a.ts":3  catch blocks use the error they caught\n' +
      "  f0: capped by this run: stale map or no merge base\n" +
      "  catch (e) { }\n" +
      "\n" +
      'FIX  "src/b.ts":1  catch blocks use the error they caught\n' +
      "  f0: capped by this run: stale map or no merge base\n" +
      "  catch (e) { }\n" +
      "\n" +
      "1 file(s) in .claude/rules this tool did not write:\n" +
      '  "house.md"\n'
  );
});
