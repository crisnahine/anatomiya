import { test } from "node:test";
import assert from "node:assert/strict";
import { needsPosixPaths } from "./platform.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  buildPin, loadPin, writePin, pinDelta, formatDelta,
  baselinePopulation, materialize, measure, resolve, PIN_PATH,
} from "../lib/baseline.mjs";
import {
  showBlob, mergeBase, diffRange, shaReachable, resolveBaseRef, isSha,
} from "../lib/git.mjs";

// The temporary repository is torn down through `t.after` rather than a call at
// the end of the body: a failing assertion throws, and a cleanup line below it
// never runs.
function repo(t, build) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-baseline-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  build(dir, { git, write, head, commit });
  return dir;

  function write(rel, body) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  function commit(msg) {
    git("add", "-A");
    git("commit", "-qm", msg);
    return head();
  }
  function head() {
    return git("rev-parse", "HEAD").trim();
  }
}

// The dimension stands in for any real one: a site is a file, and a file that
// throws does not conform. The guards under test are about which files get
// counted, not about what the parser sees inside them.
const CONFORMING = "export function f() { return { ok: true } }\n";
const VIOLATING = "export function f() { throw new Error('x') }\n";

async function countAtBaseline(root, sha, rels) {
  let candidates = 0;
  let conforming = 0;
  for (const rel of rels) {
    const blob = await showBlob(root, sha, rel);
    const text = blob.ok ? blob.content.toString("utf8") : null;
    if (text == null) continue;
    candidates++;
    if (!text.includes("throw ")) conforming++;
  }
  return { candidates, conforming, ratio: candidates ? conforming / candidates : 0 };
}

function area(path, rels) {
  return { id: "aaaaaaaa", path, files: rels.map((rel) => ({ rel })) };
}

// --- B12: the baseline reads only what differs from the pin ---

test("only the files that differ from the pin are read back out of it", async (t) => {
  // Every unchanged file has the same bytes in the working tree as at the
  // pinned commit, so the corpus pass already parsed exactly the content the
  // baseline asks about. Reading them again costs one `git cat-file` process
  // per file: measured at 6.9s against 1.4s to parse the whole corpus, on a
  // repository where nothing had changed.
  //
  // The parser is passed in, which is what lets this be asked at all: measuring
  // the baseline used to live in the scan, where the only way to reach it was
  // to build a repository and run the whole pipeline over it.
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("src/a.ts", CONFORMING);
    write("src/b.ts", CONFORMING);
    sha = commit("init");
  });
  // b.ts now differs from the pin; a.ts does not.
  writeFileSync(join(dir, "src", "b.ts"), VIOLATING);

  const rels = ["src/a.ts", "src/b.ts"];
  const areas = [area("src", rels)];
  writePin(dir, buildPin(areas, { sha }));
  const state = await resolve(dir, { baseRef: "main" });

  const asked = [];
  await measure(dir, state, areas, {
    headParsed: new Map(rels.map((rel) => [rel, { rel, ok: true, hits: {} }])),
    parse: async (files) => {
      asked.push(...files.map((f) => f.rel));
      return { records: new Map(files.map((f) => [f.rel, { rel: f.rel, ok: true, hits: {} }])) };
    },
    reduce: () => [],
  });

  assert.deepEqual(asked, ["src/b.ts"], "a.ts was already parsed at exactly these bytes");
});

// --- E1: the baseline is the pinned file list, never today's glob ---

test("moving the violating files out of the area does not lift the baseline", async (t) => {
  const services = Array.from({ length: 14 }, (_, i) => `src/services/s${i}.ts`);
  let sha;

  const dir = repo(t, (d, { write, commit, git }) => {
    for (const [i, rel] of services.entries()) write(rel, i < 3 ? VIOLATING : CONFORMING);
    sha = commit("init");

    // The laundering move: the three violating files go to a directory the
    // corpus denies, so today's glob over src/services selects only conformers.
    mkdirSync(join(d, "src/fixtures"), { recursive: true });
    for (let i = 0; i < 3; i++) git("mv", `src/services/s${i}.ts`, `src/fixtures/s${i}.ts`);
    commit("move fixtures");
  });

  const pin = buildPin([area("src/services", services)], { sha });
  const current = services.slice(3);

  // What the guard replaces: re-run the current glob against the old commit.
  const naive = await countAtBaseline(dir, sha, current);
  assert.equal(naive.candidates, 11);
  assert.equal(naive.ratio, 1, "re-globbing at the baseline sha reads a perfect convention");

  const pinned = await countAtBaseline(dir, sha, pin.areas[0].files);
  assert.equal(pinned.candidates, 14);
  assert.ok(pinned.ratio < 0.9, "the pinned population still carries the three violations");

  const state = await resolve(dir, { pin, baseRef: "main" });
  const population = baselinePopulation(state, area("src/services", current));

  assert.equal(population.status, "population-change");
  assert.equal(population.directive, false);
  assert.equal(population.missing.length, 3);
  assert.deepEqual(population.missing, ["src/services/s0.ts", "src/services/s1.ts", "src/services/s2.ts"]);
});

test("the baseline population is the pinned list even when the glob still matches it", async (t) => {
  const files = ["src/a/x.ts", "src/a/y.ts", "src/a/z.ts"];
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    for (const rel of files) write(rel, CONFORMING);
    sha = commit("init");
  });

  const pin = buildPin([area("src/a", files)], { sha });
  const state = await resolve(dir, { pin, baseRef: "main" });

  // A file added after the pin is visible as added, and never enters the
  // population the ratio is computed over.
  const population = baselinePopulation(state, area("src/a", [...files, "src/a/new.ts"]));

  assert.equal(population.status, "ok");
  assert.deepEqual(population.files.map((f) => f.rel), files);
  assert.deepEqual(population.added, ["src/a/new.ts"]);
});

// --- E2: baseline conformance comes from blobs, never the working tree ---

test("editing baseline files in the working tree does not move the baseline", async (t) => {
  const files = Array.from({ length: 14 }, (_, i) => `src/svc/s${i}.ts`);
  let sha;

  const dir = repo(t, (d, { write, commit }) => {
    for (const [i, rel] of files.entries()) write(rel, i < 3 ? VIOLATING : CONFORMING);
    sha = commit("init");
  });

  const before = await countAtBaseline(dir, sha, files);
  assert.equal(before.conforming, 11);

  // The agent fixes the three violations in place, uncommitted.
  for (let i = 0; i < 3; i++) writeFileSync(join(dir, `src/svc/s${i}.ts`), CONFORMING);

  const worktree = files.filter((rel) => !readFileSync(join(dir, rel), "utf8").includes("throw "));
  assert.equal(worktree.length, 14, "the working tree now reads as a perfect convention");

  const after = await countAtBaseline(dir, sha, files);
  assert.deepEqual(after, before, "the baseline is two populations or it is one population");
});

test("an empty blob and an absent path are different answers", async (t) => {
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("src/empty.ts", "");
    sha = commit("init");
  });

  const empty = await showBlob(dir, sha, "src/empty.ts");
  assert.equal(empty.ok, true);
  assert.equal(empty.content.length, 0);

  const absent = await showBlob(dir, sha, "src/gone.ts");
  assert.equal(absent.ok, false);
  assert.equal(absent.reason, "absent");
});

test("a path that is a directory at the baseline sha does not read back as source", async (t) => {
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("src/a/x.ts", CONFORMING);
    sha = commit("init");
  });

  // `git show <sha>:src/a` prints a tree listing and exits 0, and that listing
  // would go on to be parsed as a file. Asserting the object type is the whole
  // reason this is `cat-file blob`.
  const tree = await showBlob(dir, sha, "src/a");
  assert.equal(tree.ok, false);
  assert.equal((await showBlob(dir, sha, "src/a")).ok, false, "a tree is not a blob");
});

// --- E3: an unreachable baseline sha drops everything to counts ---

test("a squashed-away baseline commit drops every directive to counts", async (t) => {
  const files = ["src/a/x.ts", "src/a/y.ts"];
  let sha;

  const dir = repo(t, (d, { write, commit, git }) => {
    write("src/a/keep.ts", CONFORMING);
    commit("init");

    git("checkout", "-q", "-b", "feature");
    for (const rel of files) write(rel, CONFORMING);
    sha = commit("feature work");

    // Squash-merge to main: the branch's commits never land, and deleting the
    // branch leaves the pinned sha naming nothing.
    git("checkout", "-q", "main");
    git("branch", "-qD", "feature");
    git("reflog", "expire", "--expire=now", "--all");
    git("gc", "--prune=now", "-q");
  });

  const pin = buildPin([area("src/a", files)], { sha });

  assert.equal(await shaReachable(dir, sha), false);

  const state = await resolve(dir, { pin, baseRef: "main" });
  assert.equal(state.status, "unreachable");
  assert.equal(state.countsOnly, true);

  const population = baselinePopulation(state, area("src/a", files));
  assert.equal(population.directive, false);
  assert.equal(population.status, "unreachable");
});

test("the pin stores no counts, so there is nothing to fall back to", () => {
  const pin = buildPin([area("src/a", ["src/a/x.ts"])], { sha: "a".repeat(40) });
  const text = JSON.stringify(pin);

  for (const key of ["candidates", "conforming", "applicability", "ratio"]) {
    assert.ok(!text.includes(key), `a pinned ${key} is the number the guard exists to verify`);
  }
});

test("a pin file that will not load drops to counts-only, never to a smaller population", async (t) => {
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("src/a/x.ts", CONFORMING);
    write("src/a/y.ts", VIOLATING);
    sha = commit("init");
  });

  const good = buildPin([area("src/a", ["src/a/x.ts", "src/a/y.ts"])], { sha });
  writePin(dir, good);
  assert.deepEqual(loadPin(dir), good);

  const pinFile = join(dir, PIN_PATH);
  const broken = [
    JSON.stringify({ ...good, areas: [{ path: "src/a", files: ["src/a/x.ts", null] }] }),
    JSON.stringify({ ...good, areas: [{ path: "src/a" }] }),
    JSON.stringify({ ...good, areas: "src/a" }),
    JSON.stringify({ ...good, schema: 99 }),
    JSON.stringify({ ...good, sha: "not-a-sha" }),
    "{",
    "",
  ];

  for (const body of broken) {
    writeFileSync(pinFile, body);
    // Half a pin reads as a smaller accepted population than the human signed
    // off on, which is the direction that manufactures claims.
    assert.equal(loadPin(dir), null, body.slice(0, 60));

    const state = await resolve(dir, { baseRef: "main" });
    assert.equal(state.status, "unpinned");
    assert.equal(state.countsOnly, true);
    assert.equal(baselinePopulation(state, area("src/a", ["src/a/x.ts"])).directive, false);
  }
});

test("a sha reaching a git argument is validated as a sha", () => {
  for (const bad of ["", "HEAD", "main", "-", "--upload-pack=touch", "a".repeat(41), "A".repeat(40), null, 40]) {
    assert.equal(isSha(bad), false, String(bad));
  }
  assert.equal(isSha("a".repeat(40)), true);
  assert.equal(isSha("0f1e2d3"), true);

  assert.throws(() => buildPin([], { sha: "HEAD" }), /not a sha/);
});

test("an unreachable sha is refused before it reaches a blob read", async (t) => {
  const dir = repo(t, (d, { write, commit }) => {
    write("src/a/x.ts", CONFORMING);
    commit("init");
  });

  assert.equal(await shaReachable(dir, "--upload-pack=touch"), false);
  assert.equal(await shaReachable(dir, "b".repeat(40)), false);
  assert.equal(await shaReachable(dir, null), false);

  const blob = await showBlob(dir, "not-a-sha", "src/a/x.ts");
  assert.equal(blob.ok, false);
  assert.equal(blob.reason, "bad sha");
});

// --- E4: an area that postdates the baseline states nothing ---

test("a greenfield area emits no directive", async (t) => {
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("src/old/a.ts", CONFORMING);
    write("src/old/b.ts", CONFORMING);
    sha = commit("init");

    for (let i = 0; i < 8; i++) write(`src/new/n${i}.ts`, CONFORMING);
    commit("new area");
  });

  const pin = buildPin([area("src/old", ["src/old/a.ts", "src/old/b.ts"])], { sha });
  const state = await resolve(dir, { pin, baseRef: "main" });

  const fresh = Array.from({ length: 8 }, (_, i) => `src/new/n${i}.ts`);
  const population = baselinePopulation(state, area("src/new", fresh));

  assert.equal(population.status, "postdates-baseline");
  assert.equal(population.directive, false);
  assert.equal(population.files.length, 0);
});

// --- E5: re-pinning is a separate command that prints what it accepts ---

test("re-pinning prints the population delta and nothing suggests it", async (t) => {
  const first = ["src/a/x.ts", "src/a/y.ts", "src/a/z.ts"];
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    for (const rel of first) write(rel, VIOLATING);
    sha = commit("init");
  });

  const oldPin = buildPin([area("src/a", first)], { sha });
  writePin(dir, oldPin);
  assert.deepEqual(loadPin(dir), oldPin);

  const newPin = buildPin([area("src/a", ["src/a/x.ts", "src/a/w.ts"])], { sha });
  const delta = pinDelta(oldPin, newPin);

  assert.equal(delta.addedFiles, 1);
  assert.equal(delta.removedFiles, 2);
  const printed = formatDelta(delta);
  assert.match(printed, /2 leave it/);
  assert.match(printed, /src\/a\/y\.ts/);

  // The scan path never points a human at a re-pin. The prior design suggested
  // it exactly when post-baseline sites outnumbered baseline ones, which is the
  // moment the agent's own output is largest.
  const state = await resolve(dir, { pin: oldPin, baseRef: "main" });
  const population = baselinePopulation(state, area("src/a", ["src/a/x.ts"]));
  for (const s of [state.status, state.baseRefReason, population.status]) {
    assert.ok(!/re-?pin/i.test(String(s)), `a scan-path string invites a re-pin: ${s}`);
  }
});

// --- E6: drift is measured to the base ref, never to HEAD ---

test("the branch's own changes are not map drift", async (t) => {
  const files = Array.from({ length: 6 }, (_, i) => `src/app/a${i}.ts`);
  let sha;

  const dir = repo(t, (d, { write, commit, git }) => {
    for (const rel of files) write(rel, CONFORMING);
    sha = commit("init");

    write("src/app/a0.ts", CONFORMING + "// touched\n");
    write("src/app/a1.ts", CONFORMING + "// touched\n");
    commit("main moves on");

    git("checkout", "-q", "-b", "feature");
    for (let i = 2; i < 6; i++) write(`src/app/a${i}.ts`, CONFORMING + "// branch\n");
    for (let i = 0; i < 5; i++) write(`src/app/b${i}.ts`, CONFORMING);
    commit("branch work");
  });

  const pin = buildPin([area("src/app", files)], { sha });
  const state = await resolve(dir, { pin, baseRef: "main" });

  assert.equal(state.drift.total, 2, "drift is baseline..base-ref");
  assert.equal(state.drift.byArea.get("src/app"), 2);

  // Over ..HEAD the same repository reports the branch's own nine files as
  // drift, so a claim's severity would fall as the change under review grows.
  const overHead = await diffRange(dir, sha, "HEAD");
  assert.equal(overHead.changed.size, 11);
});

test("HEAD is refused as a base ref", async (t) => {
  const dir = repo(t, (d, { write, commit }) => {
    write("src/a/x.ts", CONFORMING);
    commit("init");
  });

  assert.equal((await resolveBaseRef(dir, "HEAD")).ok, false);
  assert.equal((await resolveBaseRef(dir, "@")).ok, false);
  assert.equal((await resolveBaseRef(dir, "--upload-pack=touch")).ok, false);
  assert.equal((await resolveBaseRef(dir, "")).ok, false);
  assert.equal((await resolveBaseRef(dir, "no-such-ref")).ok, false);

  // Nothing in BASE_REFS names @{upstream}: a pushed feature branch tracks
  // itself, and the merge base of HEAD with itself is HEAD.
  const found = await resolveBaseRef(dir);
  assert.equal(found.ok, true);
  assert.equal(found.ref, "main");
});

test("no base branch is a stated reason, not a thrown error or an empty sha", async (t) => {
  let sha;
  const dir = repo(t, (d, { write, commit, git }) => {
    write("src/a/x.ts", CONFORMING);
    sha = commit("init");
    git("branch", "-m", "main", "wip/nobody-reviews-this");
  });

  const base = await resolveBaseRef(dir);
  assert.equal(base.ok, false);
  assert.match(base.reason, /no base branch/);

  // The baseline itself still resolves: the pinned population is readable
  // without a base ref, only drift is unmeasurable.
  const state = await resolve(dir, { pin: buildPin([area("src/a", ["src/a/x.ts"])], { sha }) });
  assert.equal(state.status, "ok");
  assert.equal(state.countsOnly, false);
  assert.equal(state.baseRef, null);
  assert.equal(state.drift, null);
  assert.match(state.baseRefReason, /no base branch/);

  assert.equal(baselinePopulation(state, area("src/a", ["src/a/x.ts"])).directive, true);
});

test("no merge base is not an empty merge base", async (t) => {
  const dir = repo(t, (d, { write, commit, git }) => {
    write("src/a/x.ts", CONFORMING);
    commit("init");
    git("checkout", "-q", "--orphan", "other");
    git("rm", "-rqf", ".");
    write("src/b/y.ts", CONFORMING);
    commit("unrelated");
    git("checkout", "-q", "main");
  });

  const found = await mergeBase(dir, "main", "main");
  assert.equal(found.found, true);
  assert.ok(found.sha);

  // git exits 1 here with empty stdout and no stderr. Code that reads stdout
  // without the exit code passes "" downstream as if it were a sha.
  const none = await mergeBase(dir, "main", "other");
  assert.equal(none.found, false);
  assert.equal(none.failed, false);
  assert.equal(none.sha, null);

  const broken = await mergeBase(dir, "main", "no-such-ref");
  assert.equal(broken.found, false);
  assert.equal(broken.failed, true);
});

// --- E7: a renamed directory keeps its claims ---

test("a renamed directory keeps its baseline population", async (t) => {
  const before = Array.from({ length: 8 }, (_, i) => `src/services/s${i}.ts`);
  let sha;

  const dir = repo(t, (d, { write, commit, git }) => {
    for (const [i, rel] of before.entries()) write(rel, i === 0 ? VIOLATING : CONFORMING);
    sha = commit("init");
    git("mv", "src/services", "src/domain");
    commit("rename the directory");
  });

  const pin = buildPin([area("src/services", before)], { sha });
  const after = before.map((rel) => rel.replace("src/services/", "src/domain/"));

  const state = await resolve(dir, { pin, baseRef: "main" });
  assert.equal(state.renames.get("src/domain/s0.ts"), "src/services/s0.ts");

  const population = baselinePopulation(state, area("src/domain", after));
  assert.equal(population.status, "ok");
  assert.equal(population.areaPath, "src/services");
  assert.deepEqual(population.files.map((f) => f.rel), before);
  assert.equal(population.files[0].currentRel, "src/domain/s0.ts");

  const counts = await countAtBaseline(dir, sha, population.files.map((f) => f.rel));
  assert.equal(counts.candidates, 8);
  assert.equal(counts.conforming, 7, "the pre-rename violation is still counted");

  // Without the rename map the new paths do not exist at the baseline sha, so
  // the area matches no pin and loses every claim it had.
  const blind = baselinePopulation({ ...state, renames: new Map() }, area("src/domain", after));
  assert.equal(blind.status, "postdates-baseline");
});

test("a rename made on the branch under review is still followed", async (t) => {
  const before = Array.from({ length: 6 }, (_, i) => `src/services/s${i}.ts`);
  let sha;

  const dir = repo(t, (d, { write, commit, git }) => {
    for (const rel of before) write(rel, CONFORMING);
    sha = commit("init");
    git("checkout", "-q", "-b", "feature");
    git("mv", "src/services", "src/domain");
    commit("rename on the branch");
  });

  // The rename is not in baseline..main, only in baseline..HEAD. Following the
  // drift range alone would read this area as greenfield.
  const pin = buildPin([area("src/services", before)], { sha });
  const state = await resolve(dir, { pin, baseRef: "main" });

  assert.equal(state.drift.total, 0, "drift still ignores the branch's own moves");

  const population = baselinePopulation(state, area("src/domain", before.map((r) => r.replace("services", "domain"))));
  assert.equal(population.status, "ok");
  assert.equal(population.files.length, 6);
});

test("a path holding a newline stays one path through the rename map", needsPosixPaths, async (t) => {
  const odd = "src/services/we\nird.ts";
  const files = ["src/services/plain.ts", odd];
  let sha;

  const dir = repo(t, (d, { write, commit, git }) => {
    for (const rel of files) write(rel, CONFORMING);
    sha = commit("init");
    git("mv", "src/services", "src/domain");
    commit("rename the directory");
  });

  const pin = buildPin([area("src/services", files)], { sha });
  assert.equal(loadPin(dir), null, "nothing is written yet");
  writePin(dir, pin);
  assert.deepEqual(loadPin(dir).areas[0].files, [odd, "src/services/plain.ts"].sort());

  const state = await resolve(dir, { pin, baseRef: "main" });

  // A newline-split diff turns this one rename record into three junk entries,
  // and the moved file loses the claims it carried.
  assert.equal(state.renames.size, 2);
  assert.equal(state.renames.get("src/domain/we\nird.ts"), odd);

  const moved = files.map((rel) => rel.replace("src/services/", "src/domain/"));
  const population = baselinePopulation(state, area("src/domain", moved));
  assert.equal(population.status, "ok");
  assert.deepEqual(population.missing, []);
  assert.deepEqual(population.files.map((f) => f.rel).sort(), [...files].sort());

  const counts = await countAtBaseline(dir, sha, population.files.map((f) => f.rel));
  assert.equal(counts.candidates, 2, "both blobs come back by their pinned paths");
});

// --- the blob bridge into the parser pool ---

test("materialize writes baseline blobs the pool can read", async (t) => {
  const files = ["src/a/x.ts", "src/a/deep/y.ts"];
  let sha;

  const dir = repo(t, (d, { write, commit }) => {
    write("src/a/x.ts", VIOLATING);
    write("src/a/deep/y.ts", CONFORMING);
    sha = commit("init");
    writeFileSync(join(d, "src/a/x.ts"), CONFORMING);
  });

  const out = await materialize(dir, sha, files.map((rel) => ({ rel, lang: "js" })));
  t.after(out.dispose);

  assert.equal(out.files.length, 2);
  assert.equal(out.missing.length, 0);
  assert.deepEqual(out.files.map((f) => f.rel), ["src/a/deep/y.ts", "src/a/x.ts"]);
  assert.equal(readFileSync(out.files[0].abs, "utf8"), CONFORMING);
  assert.ok(readFileSync(out.files[1].abs, "utf8").includes("throw "), "the blob, not the fixed working tree");

  // The nested path is rebuilt under the temporary root rather than flattened,
  // so two baseline files with the same basename cannot overwrite each other.
  assert.ok(out.files[0].abs.endsWith(join("src", "a", "deep", "y.ts")));

  out.dispose();
  assert.equal(existsSync(out.dir), false, "the temporary tree outlives dispose");
});

test("a blob that will not come back is reported, not silently dropped", async (t) => {
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("src/a/x.ts", CONFORMING);
    sha = commit("init");
  });

  const out = await materialize(dir, sha, [
    { rel: "src/a/x.ts", lang: "js" },
    { rel: "src/a/gone.ts", lang: "js" },
    { rel: "../escape.ts", lang: "js" },
    { rel: "/etc/passwd", lang: "js" },
    { rel: "", lang: "js" },
    null,
  ]);
  t.after(out.dispose);

  assert.equal(out.files.length, 1);
  assert.equal(out.files[0].rel, "src/a/x.ts");
  assert.deepEqual(
    out.missing.map((m) => m.reason).sort(),
    ["absent", "unsafe path", "unsafe path", "unsafe path", "unsafe path"],
  );
  // An absolute rel resolves away from the temporary root without ever passing
  // through "..", so a prefix check on the joined string is not the guard.
  assert.ok(out.missing.some((m) => m.rel === "/etc/passwd"));
  assert.ok(out.missing.some((m) => m.rel === null), "a malformed entry is reported, not thrown on");
});

// --- the scan-facing seam ---

test("one call answers everything the scan needs about an area's baseline", async (t) => {
  // The scan used to assemble this itself: load the pin, resolve the state,
  // build a population per area, measure, and then read `population.files`,
  // `population.missing`, `f.currentRel ?? f.rel` and `population.status` back
  // out. Four record shapes and an ordering nobody wrote down.
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("src/a.ts", CONFORMING);
    write("src/b.ts", CONFORMING);
    sha = commit("init");
  });

  const rels = ["src/a.ts", "src/b.ts"];
  const areas = [area("src", rels)];
  writePin(dir, buildPin(areas, { sha }));
  const state = await resolve(dir, { baseRef: "main" });

  const measured = await measure(dir, state, areas, {
    headParsed: new Map(rels.map((rel) => [rel, { rel, ok: true, hits: {} }])),
    parse: async () => ({ records: new Map() }),
    reduce: () => [{ key: "d", candidates: 4, conforming: 4 }],
  });

  const one = measured.get("aaaaaaaa");
  assert.equal(one.gate, null, "nothing closes an area whose pinned files are all still there");
  assert.deepEqual(one.population, { status: "ok", files: 2, missing: 0 });
  assert.equal(one.pinned.fileCount, 2, "the gates read the pinned population's shape, not today's");
  assert.equal(one.pinned.dirCount, 1);
  assert.deepEqual(one.dims, [{ key: "d", candidates: 4, conforming: 4 }]);
});

test("an area holding a file the pin never had is closed before any gate is asked", async (t) => {
  // E1: a pinned file that left the area is a population a human has not
  // accepted, and it closes the area rather than being folded into the counts.
  let sha;
  const dir = repo(t, (d, { write, commit, git }) => {
    write("src/a.ts", CONFORMING);
    write("src/b.ts", CONFORMING);
    sha = commit("init");
    git("mv", "src/b.ts", "src/moved.ts");
    commit("move");
  });

  const areas = [area("src", ["src/a.ts", "src/b.ts"])];
  writePin(dir, buildPin(areas, { sha }));
  const state = await resolve(dir, { baseRef: "main" });

  const measured = await measure(dir, state, [area("src", ["src/a.ts"])], {
    headParsed: new Map(),
    parse: async () => ({ records: new Map() }),
    reduce: () => [],
  });

  assert.equal(measured.get("aaaaaaaa").gate, "population-change");
});

test("a file the parser rejects at the pin and rejects today has not changed population", async (t) => {
  // Suppressing the whole area on any unexamined pinned file reads a permanent
  // blind spot as a population that moved. React is written in Flow, which oxc
  // does not take: 287 of its files are rejected at either revision, and 507 of
  // its 986 slots were closed for it. Nothing about that population changed. A
  // file that has become examinable since the pin still closes the area,
  // because the baseline is then missing sites today can see.
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("src/a.ts", CONFORMING);
    write("src/flow.ts", CONFORMING);
    sha = commit("init");
  });

  const areas = [area("src", ["src/a.ts", "src/flow.ts"])];
  writePin(dir, buildPin(areas, { sha }));
  const state = await resolve(dir, { baseRef: "main" });

  // What the scan holds for HEAD: one file examined, one the parser rejected.
  const headParsed = new Map([
    ["src/a.ts", { rel: "src/a.ts", ok: true, hits: {}, kind: "ok" }],
    ["src/flow.ts", { rel: "src/flow.ts", ok: false, kind: "rejected" }],
  ]);

  // The pin side has to carry a record too: an empty map is a blob that never
  // came back, which is a different cause with a different answer.
  const pinned = new Map([
    ["src/a.ts", { rel: "src/a.ts", ok: true, hits: {}, kind: "ok" }],
    ["src/flow.ts", { rel: "src/flow.ts", ok: false, kind: "rejected" }],
  ]);

  const measured = await measure(dir, state, areas, {
    headParsed,
    parse: async () => ({ records: pinned }),
    reduce: () => [{ key: "d", candidates: 4, conforming: 4 }],
  });

  assert.equal(measured.get("aaaaaaaa").gate, null, "a file rejected at both revisions is a constant, not a change");
});

/**
 * The guard side of E8, which nothing reached: coverage named `unread++` as a
 * line the whole suite never executes, so every mutation to this branch
 * survived and the E1/E2 suppression could be deleted with CI green.
 */
const twoFiles = (t) => {
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("src/a.ts", CONFORMING);
    write("src/other.ts", CONFORMING);
    sha = commit("init");
  });
  return { dir, sha };
};

const measureWith = (dir, state, areas, pinned, head) =>
  measure(dir, state, areas, {
    headParsed: head,
    parse: async () => ({ records: pinned }),
    reduce: () => [{ key: "d", candidates: 4, conforming: 4 }],
  });

const rec = (rel, ok) => [rel, ok ? { rel, ok: true, hits: {}, kind: "ok" } : { rel, ok: false, kind: "rejected" }];

test("a pinned file readable today but not at the pin closes the area", async (t) => {
  // The baseline is then missing sites today can see, which is a population
  // this cannot count. The file has to differ between the two revisions or
  // `reuseUnchanged` hands the pin side today's record and the blob is never
  // read at all.
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("src/a.ts", CONFORMING);
    write("src/other.ts", CONFORMING);
    sha = commit("init");
    write("src/other.ts", `${CONFORMING}\nexport const changed = 1\n`);
    commit("edit");
  });
  const areas = [area("src", ["src/a.ts", "src/other.ts"])];
  writePin(dir, buildPin(areas, { sha }));
  const state = await resolve(dir, { baseRef: "main" });

  const measured = await measureWith(
    dir, state, areas,
    new Map([rec("src/a.ts", true), rec("src/other.ts", false)]),
    new Map([rec("src/a.ts", true), rec("src/other.ts", true)])
  );

  assert.equal(measured.get("aaaaaaaa").gate, "population-change");
});

test("a pinned file with no record at HEAD at all closes the area", async (t) => {
  // Absent is not the same as examined-and-rejected, and reading it as the
  // second is how a blob nobody fetched became a stated directive.
  const { dir, sha } = twoFiles(t);
  const areas = [area("src", ["src/a.ts", "src/other.ts"])];
  writePin(dir, buildPin(areas, { sha }));
  const state = await resolve(dir, { baseRef: "main" });

  const measured = await measureWith(
    dir, state, areas,
    new Map([rec("src/a.ts", true), rec("src/other.ts", false)]),
    new Map([rec("src/a.ts", true)])
  );

  assert.equal(measured.get("aaaaaaaa").gate, "population-change");
});

test("a pinned blob that never came back closes the area, whatever HEAD says of it", async (t) => {
  // `showBlob` refuses a file over the same 4 MiB cap the parser skips at, so
  // an oversize pinned file is refused at the pin and skipped at HEAD. Read as
  // a blind spot, the area stated a directive with that file's sites counted at
  // neither revision and nothing saying so.
  const { dir, sha } = twoFiles(t);
  const areas = [area("src", ["src/a.ts", "src/other.ts"])];
  writePin(dir, buildPin(areas, { sha }));
  const state = await resolve(dir, { baseRef: "main" });

  const measured = await measureWith(
    dir, state, areas,
    new Map([rec("src/a.ts", true)]),
    new Map([rec("src/a.ts", true), rec("src/other.ts", false)])
  );

  assert.equal(measured.get("aaaaaaaa").gate, "population-change");
});

test("resolve reads the pin itself, so the caller never holds one", async (t) => {
  // The corpus size the layout was resolved from travels with the state: the
  // area floor is a step function of it, so deriving it from today's file count
  // re-partitions the repository on one added file and every area then reads as
  // a population change against a pin that knew the old layout.
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("src/a.ts", CONFORMING);
    sha = commit("init");
  });
  writePin(dir, buildPin([area("src", ["src/a.ts"])], { sha, corpus: 41 }));

  const state = await resolve(dir, { baseRef: "main" });

  assert.equal(state.layout, 41);
  assert.equal(state.countsOnly, false);
});

test("a baseline pass that answered for part of its population says so", async (t) => {
  // F7 applies to both corpus reads, not just the first. The baseline
  // materialises blobs and parses them a second time, and the Ruby bridge can
  // hit its per-line guard there exactly as it can on the working tree. Dropped,
  // the scan states directives over a population it only partly counted.
  let sha;
  const dir = repo(t, (d, { write, commit }) => {
    write("src/a.ts", CONFORMING);
    sha = commit("init");
  });
  // The file differs from the pin, so it is materialised and reparsed rather
  // than reused from the corpus pass.
  writeFileSync(join(dir, "src", "a.ts"), VIOLATING);

  const areas = [area("src", ["src/a.ts"])];
  writePin(dir, buildPin(areas, { sha }));
  const state = await resolve(dir, { baseRef: "main" });

  const measured = await measure(dir, state, areas, {
    headParsed: new Map(),
    parse: async (files) => ({
      records: new Map(files.map((f) => [f.rel, { rel: f.rel, ok: true, hits: {} }])),
      truncated: true,
    }),
    reduce: () => [],
  });

  assert.equal(measured.truncated, true, "the second corpus read carries the same flag the first does");
});

test("the pin delta agrees with its own counts, at one and at many", () => {
  // This line is what a human reads before accepting a population, and the
  // first pass at the plural fixed the noun and left both verbs plural.
  const one = formatDelta({ from: null, to: "a".repeat(40), addedFiles: 1, removedFiles: 1, areas: [] });
  const many = formatDelta({ from: null, to: "a".repeat(40), addedFiles: 3, removedFiles: 2, areas: [] });

  assert.match(one, /^1 file enters the baseline population, 1 leaves it$/m);
  assert.match(many, /^3 files enter the baseline population, 2 leave it$/m);
});
