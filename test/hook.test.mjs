import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, execFileSync } from "node:child_process";

import { needsPosixSpecialFiles, needsUnreadableDirs } from "./platform.mjs";
import { aboutDir, echoContext, fieldsIn, ownLayout, planRemoval, commitRemoval, targetIn, HOOK_COMMAND, NOTICE_COMMAND, PAYLOAD_WAIT_MS, SETTINGS_PATH } from "../plugins/anatomiya/lib/hook.mjs";
import { FACTS_PATH, FACTS_SCHEMA } from "../plugins/anatomiya/lib/facts.mjs";
import { pluginPaths } from "../scripts/validate.mjs";
import { HEAD_BYTES } from "../plugins/anatomiya/lib/rules.mjs";
import { ANATOMIYA } from "../scripts/plugins.mjs";

/** The three entries 0.2.4 through 0.2.6 wrote into a scanned repository. */
const OLD_SETTINGS = {
  hooks: {
    UserPromptSubmit: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo' }] }],
    PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo' }] }],
    PostToolUseFailure: [{ matcher: "*", hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo' }] }],
  },
};

/** A repository with a map already written, the state a scan leaves behind. */
function mapped(t, body = "---\ngenerator: anatomiya\n---\n\n# Repository map\n\n- lib: 3 .mjs\n") {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-hook-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".claude", "rules"), { recursive: true });
  writeFileSync(join(dir, ".claude", "rules", "anatomiya-overview.md"), body);
  return dir;
}

const settings = (dir) => JSON.parse(readFileSync(join(dir, SETTINGS_PATH), "utf8"));

// --- what the hook says ------------------------------------------------------

/** A repository with a record of its counts, the other half of what a scan leaves. */
function recorded(t, layout = { tests: [], roots: [] }, record = {}) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-layout-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".claude", "anatomiya"), { recursive: true });
  writeFileSync(join(dir, FACTS_PATH), JSON.stringify({ schema: FACTS_SCHEMA, areas: [], layout, ...record }));
  return dir;
}

test("a record from a build ahead of this one is refused rather than read", (t) => {
  // The rule `readFacts` states and this walk did not: fields move between
  // versions, and a record read against a shape this build does not know
  // enforces a convention nobody stated. `check` named the schema and enforced
  // nothing while the notice, one command over, spoke off the same file.
  const ahead = recorded(t, { tests: [], roots: [{ dir: "app", path: "app" }] }, { schema: FACTS_SCHEMA + 1 });
  const nonsense = recorded(t, { tests: [], roots: [] }, { areas: "not a list" });

  assert.equal(ownLayout(ahead), null);
  assert.equal(ownLayout(nonsense), null);
});

test("the write target is read from the key each tool spells it with", (t) => {
  // Measured on 2.1.250: Write and Edit carry `tool_input.file_path`,
  // NotebookEdit carries `tool_input.notebook_path`. A hook reading one key
  // sees nothing on the other tool and says nothing, silently.
  const dir = recorded(t);

  assert.equal(targetIn({ tool_name: "Write", tool_input: { file_path: join(dir, "a/b.ts") } }, dir), "a/b.ts");
  assert.equal(targetIn({ tool_name: "Edit", tool_input: { file_path: join(dir, "a/b.ts") } }, dir), "a/b.ts");
  assert.equal(targetIn({ tool_name: "NotebookEdit", tool_input: { notebook_path: join(dir, "a/n.ipynb") } }, dir), "a/n.ipynb");
});

test("a path longer than one a filesystem can hold names no place, in constant time", () => {
  // The walk costs a `stat` and a copy per segment and had no bound. A payload
  // under the one megabyte this reads held 400,000 segments and took 7.8s,
  // against the 5 the declaration asks for: the turn loses its map and a
  // process burns the budget, before every tool call. No filesystem holds a
  // path this long, so it names nothing and is refused before the walk.
  const absurd = `/${"a/".repeat(200_000)}b`;
  const started = Date.now();

  assert.equal(aboutDir({ tool_name: "Read", tool_input: { file_path: absurd } }, "/tmp"), null);
  // Both fields, because the walk runs on the two joined and the payload
  // carries both: a gate on the target alone was got round with a short target
  // and a long `cwd`, at 10.5s.
  assert.equal(aboutDir({ tool_name: "Read", cwd: absurd, tool_input: { file_path: "a.js" } }, "/tmp"), null);
  assert.equal(aboutDir({ tool_name: "Bash", cwd: absurd, tool_input: { command: "ls" } }, "/tmp"), null);

  // The notice's own reader takes the same bound one segment deeper, where
  // `resolveLinks` recurses per segment and a path this long overflowed the
  // stack rather than costing seconds.
  assert.equal(targetIn({ tool_name: "Write", tool_input: { file_path: absurd } }, "/r"), null);
  assert.equal(targetIn({ tool_name: "Write", cwd: absurd, tool_input: { file_path: "a.js" } }, "/r"), null);
  // The bound itself, at the byte it refuses on. Built out from a path the
  // platform already calls absolute, so `resolve` is the identity on it: a
  // POSIX-shaped `/aaa...` counted 4095 here and 4097 on Windows, where
  // `resolve` puts a drive letter in front, and the case failed on the bound
  // being right rather than wrong.
  const root = resolve(tmpdir());
  const ofLength = (n) => `${root}${sep}${"a".repeat(n - root.length - 1)}`;
  assert.equal(ofLength(4096).length, 4096, "the fixture measures what it says");
  assert.equal(resolve(ofLength(4096)), ofLength(4096), "and resolving it changes nothing");

  assert.notEqual(aboutDir({ tool_name: "Read", tool_input: { file_path: ofLength(4096) } }, root), null);
  assert.equal(aboutDir({ tool_name: "Read", tool_input: { file_path: ofLength(4097) } }, root), null);

  assert.ok(Date.now() - started < 1000, `refusing them took ${Date.now() - started}ms`);
});

test("a target outside the repository, or absent, is not this repository's business", (t) => {
  const dir = recorded(t);

  assert.equal(targetIn({ tool_name: "Write", tool_input: {} }, dir), null);
  assert.equal(targetIn({ tool_name: "Write" }, dir), null);
  assert.equal(targetIn({}, dir), null);
  assert.equal(targetIn({ tool_name: "Write", tool_input: { file_path: "/elsewhere/x.ts" } }, dir), null);
  assert.equal(targetIn({ tool_name: "Write", tool_input: { file_path: join(dir, "../escape.ts") } }, dir), null);
  // A relative path with nothing to read it against. Measured on 2.1.251 the
  // payload carries its own `cwd`, and the tool resolved the path against that
  // one, so a payload holding it is answered rather than refused; this is the
  // payload that holds neither, where there is no base to pick and silence is
  // the only honest answer.
  assert.equal(targetIn({ tool_name: "Write", tool_input: { file_path: "spec/x_spec.rb" } }, "/r"), null);
  assert.equal(
    targetIn({ tool_name: "Write", cwd: "/r/app", tool_input: { file_path: "../spec/x_spec.rb" } }, "/r"),
    "spec/x_spec.rb",
    "and one that does carry a base is read against it"
  );
});

test("both readers answer a payload with no base to fall back to", (t) => {
  // The entry point used to hand these `process.cwd()`, which refuses once the
  // directory a session started in is unlinked. The base is now allowed to be
  // absent, so both have to answer without one rather than throw: a throw here
  // reaches the guard, which answers the empty object, and the turn loses its
  // map over a payload that named a live file.
  const dir = recorded(t);
  mkdirSync(join(dir, "a"), { recursive: true });

  assert.equal(
    aboutDir({ tool_name: "Read", tool_input: { file_path: join(dir, "a/b.ts") } }, undefined),
    join(dir, "a"),
    "an absolute path needs no base"
  );
  assert.equal(
    aboutDir({ tool_name: "Read", cwd: dir, tool_input: { file_path: "a/b.ts" } }, undefined),
    join(dir, "a"),
    "and a relative one is read against the payload's own directory"
  );
  // The node behaviour the reader is written around, pinned rather than
  // relied on: `resolve` walks its arguments from the right and stops at the
  // first one it can finish from, so it never looks at an absent base behind
  // one, while a relative path leaves it looking and it throws. The reader
  // passes `"/"` rather than the absent base either way, so it depends on
  // neither, and this is what would have to change for that to stop being belt
  // and braces.
  //
  // Built out from a path the platform already resolves to itself, the way the
  // length case above is. `isAbsolute` and "resolve can finish here" are not
  // the same test on Windows: `/abs` answers true to the first and still sends
  // `resolve` looking for a drive, so it reaches the absent base and throws
  // where POSIX had already returned.
  const rooted = join(resolve(tmpdir()), "abs");
  assert.equal(resolve(rooted), rooted, "the fixture is a path resolve is the identity on");
  assert.equal(resolve(undefined, rooted), rooted, "an absolute path is reached before the base is read");
  assert.throws(() => resolve(undefined, "rel"), { code: "ERR_INVALID_ARG_TYPE" });
  assert.equal(
    aboutDir({ tool_name: "Read", tool_input: { file_path: "a/b.ts" } }, undefined),
    null,
    "a relative path with no base names no place, rather than throwing"
  );
  assert.equal(aboutDir({ tool_name: "Bash", tool_input: { command: "ls" } }, undefined), null);
  assert.equal(aboutDir({}, undefined), null);

  assert.equal(targetIn({ tool_name: "Write", tool_input: { file_path: join(dir, "a/b.ts") } }, dir, undefined), "a/b.ts");
  assert.equal(targetIn({ tool_name: "Write", tool_input: { file_path: "a/b.ts" } }, dir, undefined), null);
});

test("a base that is not absolute is no base, since reading it needs the directory this may not have", () => {
  // `resolve` reaches `process.cwd()` for any argument list with nothing
  // absolute in it, which is the one call A46 exists to keep off this path: a
  // payload carrying a relative `cwd` would throw there in the removed-worktree
  // case, and answer against the hook process's own directory in every other,
  // which is what `aboutDir` says it refuses to do. Measured on 2.1.251 the
  // field arrives resolved, so this is the shape a salvaged or hand-written
  // payload could take rather than one the build sends.
  assert.equal(aboutDir({ tool_name: "Read", cwd: "rel/dir", tool_input: { file_path: "a.ts" } }, undefined), null);
  assert.equal(aboutDir({ tool_name: "Bash", cwd: "rel/dir", tool_input: { command: "ls" } }, undefined), null);
  assert.equal(targetIn({ tool_name: "Write", cwd: "rel/dir", tool_input: { file_path: "a.ts" } }, "/r", undefined), null);
  // An absolute path needs no base at all, so it is answered whatever the
  // payload said about where it was.
  assert.equal(targetIn({ tool_name: "Write", cwd: "rel/dir", tool_input: { file_path: "/r/a.ts" } }, "/r", undefined), "a.ts");
});

test("a file the payload spells through a link is the same file the root was resolved to", (t) => {
  // The root arrives already resolved, and `resolve` follows no link, so the
  // two never met: a payload carrying `/tmp/x` against a root reading
  // `/private/tmp/x` read as another repository's file and the hook, which
  // exists to say something before a write, said nothing at all.
  const real = recorded(t);
  const link = join(mkdtempSync(join(tmpdir(), "anatomiya-link-")), "repo");
  t.after(() => rmSync(link, { recursive: true, force: true }));
  symlinkSync(real, link, "dir");

  assert.equal(targetIn({ tool_name: "Write", tool_input: { file_path: join(link, "spec/x_spec.rb") } }, real), "spec/x_spec.rb");
  assert.equal(targetIn({ tool_name: "Write", tool_input: { file_path: join(real, "spec/x_spec.rb") } }, link), "spec/x_spec.rb");
});

test("a name that merely starts with two dots is inside the repository", (t) => {
  const dir = recorded(t);

  assert.equal(targetIn({ tool_name: "Write", tool_input: { file_path: join(dir, "..keep") } }, dir), "..keep");
});

// --- the counts a write is answered from -------------------------------------

test("the record is found from anywhere inside the repository, and only inside it", (t) => {
  const dir = recorded(t, { tests: [], roots: [{ dir: "app", path: "app" }] });
  mkdirSync(join(dir, "src", "deep"), { recursive: true });

  assert.deepEqual(ownLayout(join(dir, "src", "deep")).layout.roots, [{ dir: "app", path: "app" }]);
  assert.equal(ownLayout(tmpdir()), null);
});

test("a record for a checkout that is not this one is not read across the boundary", (t) => {
  // The same rule the map's own walk holds: a worktree below a scanned
  // repository was handed counts taken over a branch it never had.
  const dir = recorded(t, { tests: [], roots: [] });
  const nested = join(dir, "worktree");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, ".git"), "gitdir: /elsewhere\n");

  assert.equal(ownLayout(nested), null);
});

test("a record reached through a link out of the repository is not this repository's record", (t) => {
  // F2, the same reason `readFacts` asks it: `join` resolves no link, so a
  // tracked `.claude/anatomiya -> /tmp/x` put a directory outside the checkout
  // in charge of what a write inside it was judged against.
  const dir = recorded(t, { tests: [], roots: [{ dir: "app", path: "app" }] });
  const outside = recorded(t, { tests: [], roots: [{ dir: "elsewhere", path: "elsewhere" }] });
  rmSync(join(dir, ".claude", "anatomiya"), { recursive: true });
  symlinkSync(join(outside, ".claude", "anatomiya"), join(dir, ".claude", "anatomiya"), "dir");

  assert.equal(ownLayout(dir), null);
});

test("a record this cannot read leaves the walk to keep going rather than throwing", (t) => {
  const dir = recorded(t);
  writeFileSync(join(dir, FACTS_PATH), "{ not json");

  assert.equal(ownLayout(dir), null);
});

test("a record with no layout in it is not a record", (t) => {
  // `areas` and the schema are both here, so this reaches the layout branch
  // rather than stopping at the gate above it. Without them the case passed on
  // the gate and said nothing about the branch its name is about.
  const dir = recorded(t);
  writeFileSync(join(dir, FACTS_PATH), JSON.stringify({ schema: FACTS_SCHEMA, areas: [] }));

  assert.equal(ownLayout(dir), null);
});

test("a named pipe at the record's path answers nothing rather than blocking", needsPosixSpecialFiles, (t) => {
  // The reason the read goes through `readHead`: this runs before every write,
  // and a plain read of a fifo never returns at all. Run as a process with a
  // budget, because a synchronous call that hangs cannot be failed from inside
  // this one; measured, the plain read held the whole file open.
  const dir = recorded(t);
  rmSync(join(dir, FACTS_PATH));
  execFileSync("mkfifo", [join(dir, FACTS_PATH)]);

  const run = spawnSync(process.execPath, [fileURLToPath(new URL("../plugins/anatomiya/bin/anatomiya.mjs", import.meta.url)), "notice"], {
    cwd: dir,
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: join(dir, "spec/x_spec.rb") } }),
    encoding: "utf8",
    timeout: 10_000,
  });

  assert.equal(run.signal, null, "it came back on its own");
  assert.equal(run.status, 0);
  assert.deepEqual(JSON.parse(run.stdout), {});
});


test("the echoed map is stamped with the moment it was read", (t) => {
  const dir = mapped(t);
  const now = new Date("2026-08-19T04:20:00Z");

  const out = echoContext(dir, { now });

  assert.match(out, /delivered="2026-08-19T04:20:00\.000Z"/);
  assert.match(out, /# Repository map/);
  assert.doesNotMatch(out, /generator: anatomiya/, "the frontmatter is delivery metadata, not content");
});

test("the map is found from anywhere inside the repository, not only from its root", (t) => {
  // A hook fires with the session's own working directory, which is wherever
  // the model happens to be, and the map is written once at the root. Joining
  // the two without walking up answered `{}` from one directory down, silently,
  // for the rest of the session. Walked rather than asked of git: this runs on
  // every tool call, and a subprocess per call to learn a path is a subprocess
  // per call.
  const dir = mapped(t);
  mkdirSync(join(dir, "src", "deep", "deeper"), { recursive: true });

  assert.match(echoContext(join(dir, "src", "deep", "deeper"), {}), /# Repository map/);
  assert.match(echoContext(join(dir, "src"), {}), /# Repository map/);
});

test("the walk stops at a repository boundary: a worktree or submodule below the scanned checkout gets nothing", (t) => {
  // A worktree and a submodule both mark their root with a `.git` file, and the
  // hook fires with the session's cwd, which may be inside either. The walk
  // crossed that marker and served the enclosing checkout's map, stamped as
  // re-read just now, into a session whose branch the counts never described.
  // Probed with `git worktree add` inside the checkout (Claude Code's own
  // `.claude/worktrees/` layout): the main checkout's map came back every time.
  const dir = mapped(t);
  const wt = join(dir, ".claude", "worktrees", "w");
  mkdirSync(join(wt, "src"), { recursive: true });
  writeFileSync(join(wt, ".git"), "gitdir: /elsewhere\n");

  assert.equal(echoContext(wt, {}), null);
  assert.equal(echoContext(join(wt, "src"), {}), null);
});

test("the walk stops at a repository boundary: a nested repository gets nothing, not the parent's map", (t) => {
  // An independent repository nested below the scanned one carries a `.git`
  // directory, the other shape of the same boundary. The walk crossed it too,
  // so the nested repo's sessions were handed the parent's counts.
  const dir = mapped(t);
  mkdirSync(join(dir, "nested", ".git"), { recursive: true });
  mkdirSync(join(dir, "nested", "src"));

  assert.equal(echoContext(join(dir, "nested", "src"), {}), null);
});

test("the checkout that owns the map still answers from anywhere below its root", (t) => {
  // The boundary stop must not eat the ordinary case: a scanned checkout holds
  // its marker at the same level its map is found at, so the map has to win
  // there before the boundary is consulted. Both shapes of the marker, since a
  // scanned worktree's own is the file one.
  for (const [name, mark] of [
    ["directory", (dir) => mkdirSync(join(dir, ".git"))],
    ["file", (dir) => writeFileSync(join(dir, ".git"), "gitdir: /elsewhere\n")],
  ]) {
    const dir = mapped(t);
    mark(dir);
    mkdirSync(join(dir, "src", "deep"), { recursive: true });

    assert.match(echoContext(dir, {}), /# Repository map/, name);
    assert.match(echoContext(join(dir, "src", "deep"), {}), /# Repository map/, name);
  }
});

test("a nested repository that was scanned answers with its own map, not the one above it", (t) => {
  // The other side of the boundary: the stop is what a nested checkout hears
  // when nobody scanned it, and its own map is what it hears when somebody did.
  const dir = mapped(t);
  mkdirSync(join(dir, ".git"));
  const nested = join(dir, "nested");
  mkdirSync(join(nested, ".git"), { recursive: true });
  mkdirSync(join(nested, ".claude", "rules"), { recursive: true });
  writeFileSync(
    join(nested, ".claude", "rules", "anatomiya-overview.md"),
    "---\ngenerator: anatomiya\n---\n\n# Nested map\n"
  );
  mkdirSync(join(nested, "src"));

  assert.match(echoContext(nested, {}), /# Nested map/, "the nearest map wins, not the parent's");
  assert.match(echoContext(join(nested, "src"), {}), /# Nested map/, "and from below its own root too");
});

test("a boundary marker that is a broken link is still a boundary", (t) => {
  // `existsSync` follows a link, so a `.git` pointing at a target that has gone
  // answered no-marker and the walk crossed into the enclosing checkout's map:
  // the failure this stop exists to prevent, through a rarer door. A worktree
  // whose repository moved leaves exactly that shape.
  const dir = mapped(t);
  const wt = join(dir, "wt");
  mkdirSync(wt);
  symlinkSync(join(dir, "gone"), join(wt, ".git"));

  assert.equal(echoContext(wt, {}), null);
});

test("a working directory reached through a link is read where it really is", (t) => {
  // `resolve` normalises `..` and follows no link, so a session whose cwd
  // reaches the checkout through a link walked the link's own parents instead
  // of the repository's: the boundary is stepped around entirely, and a map
  // above the link's location is served for code that is not under it. Same
  // reasoning F2 already applies to the settings write one function down.
  const dir = mapped(t);
  const real = mkdtempSync(join(tmpdir(), "anatomiya-real-"));
  t.after(() => rmSync(real, { recursive: true, force: true }));
  mkdirSync(join(real, ".git"));
  mkdirSync(join(real, "src"));
  symlinkSync(join(real, "src"), join(dir, "link"));

  assert.equal(echoContext(join(dir, "link"), {}), null, "the link's parents are not the code's");
});

test("a level this cannot read is a boundary, not a thrown hook", needsUnreadableDirs, (t) => {
  // `existsSync` answered false for a path it may not look at; `lstat` refuses
  // with EACCES, and nothing between here and the process catches it, so the
  // hook exited 1 with a stack on its way out, which is the one thing a hook
  // must never do. Two answers cover it, because they cover different levels:
  // the start of the walk cannot be resolved, and a level reached later cannot
  // be looked at. Either alone answers this fixture; what is pinned here is the
  // guarantee rather than which of them delivered it.
  const dir = mapped(t);
  const locked = join(dir, "locked");
  mkdirSync(join(locked, "inner"), { recursive: true });
  chmodSync(locked, 0o000);

  // Restored here rather than in an `after`: the fixture registers its own
  // removal first, and a directory nobody may read cannot be removed.
  try {
    // Two levels, because each answer covers one of them and the other is
    // where it never runs. Below the denial the walk cannot resolve its own
    // start; at the denial it resolves, and asking for the marker is what
    // refuses.
    assert.equal(echoContext(join(locked, "inner"), {}), null, "below the level nobody may read");
    assert.equal(echoContext(locked, {}), null, "and at it, where the marker is what refuses");
  } finally {
    chmodSync(locked, 0o755);
  }
});

test("a working directory that will not resolve answers no map, rather than one from the path it was spelled", (t) => {
  // The lexical spelling of an unresolvable path still has parents, and one of
  // them here holds a map. Walking it would deliver counts for code the cwd is
  // not under, which is the hole this closes from the other side: the reader
  // cannot say where it is, so it cannot say the map above is about it.
  const dir = mapped(t);
  symlinkSync(join(dir, "nowhere"), join(dir, "broken"));

  assert.equal(echoContext(join(dir, "broken", "deep"), {}), null);
});

test("the walk up stops at the filesystem root rather than running off it", (t) => {
  // A path with no map above it anywhere answers null, and does so without
  // walking forever or throwing at the top.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-hook-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "a", "b", "c"), { recursive: true });

  assert.equal(echoContext(join(dir, "a", "b", "c"), {}), null);
});

test("the frontmatter comes off however the file's line endings are written", (t) => {
  // `isOwned` in rules.mjs already reads a leading BOM and CRLF, because a map
  // written or re-saved on Windows has both. This strip did not, so the
  // delivery metadata leaked into the echoed body as content.
  for (const [name, body] of [
    ["CRLF", "---\r\ngenerator: anatomiya\r\n---\r\n\r\n# Repository map\r\n"],
    ["BOM", "﻿---\ngenerator: anatomiya\n---\n\n# Repository map\n"],
    ["BOM and CRLF", "﻿---\r\ngenerator: anatomiya\r\n---\r\n\r\n# Repository map\r\n"],
  ]) {
    const dir = mapped(t, body);
    const out = echoContext(dir, {});
    assert.doesNotMatch(out, /generator: anatomiya/, name);
    assert.match(out, /# Repository map/, name);
  }
});

test("a file at our path this tool did not write is not echoed", (t) => {
  // The writer refuses to touch a file it does not own and the check reports
  // one, while the read path went by filename alone: anything at that exact
  // path reached the model on every turn. It matters more now that the hook is
  // the plugin's and runs in every session rather than only in a scanned one.
  const dir = mapped(t, "---\ngenerator: somebody-else\n---\n\n# not ours\n");

  assert.equal(echoContext(dir), null);
});

test("a map with no frontmatter at all is not echoed either", (t) => {
  const dir = mapped(t, "# Repository map\n\n- lib: 3 .mjs\n");

  assert.equal(echoContext(dir), null);
});

test("a map past the size a rule file may be is not echoed", (t) => {
  // Ownership is a frontmatter test, so a file carrying our key and five
  // megabytes of anything else passed it and all five megabytes went into the
  // model's context, on every prompt and every tool call. `HEAD_BYTES` is the
  // size this repository already decided a rule file may be, measured off its
  // own longest cover; past it the file is not one this tool wrote.
  const dir = mapped(t);
  const path = join(dir, ".claude", "rules", "anatomiya-overview.md");
  writeFileSync(path, `---\ngenerator: anatomiya\n---\n\n# Repository map\n\n${"x".repeat(HEAD_BYTES)}\n`);

  assert.equal(echoContext(dir), null);
});

test("a map filling the cap exactly is still echoed", (t) => {
  // The boundary in the direction that matters: a real map is kilobytes, and a
  // cap that refused one at its own edge is a map that vanishes for a reason
  // nobody can see.
  const dir = mapped(t);
  const head = "---\ngenerator: anatomiya\n---\n\n";
  writeFileSync(join(dir, ".claude", "rules", "anatomiya-overview.md"), head + "x".repeat(HEAD_BYTES - head.length));

  assert.match(echoContext(dir), /<repository-map delivered="/);
});

test("a named pipe at the map's path answers nothing rather than blocking", (t) => {
  // The read runs on every turn and every tool call, so a path that never
  // returns is a session that never returns: measured, the read on a fifo there
  // never came back at all. Run as a process with a budget, because a
  // synchronous call that hangs cannot be failed from inside this one.
  const dir = mapped(t);
  const path = join(dir, ".claude", "rules", "anatomiya-overview.md");
  rmSync(path);
  execFileSync("mkfifo", [path]);

  const run = spawnSync(process.execPath, [fileURLToPath(new URL("../plugins/anatomiya/bin/anatomiya.mjs", import.meta.url)), "echo"], {
    cwd: dir,
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit" }),
    encoding: "utf8",
    timeout: 10_000,
  });

  assert.equal(run.signal, null, "it came back on its own");
  assert.equal(run.status, 0);
  assert.deepEqual(JSON.parse(run.stdout), {});
});

test("a foreign map below the root does not hide the real one above it", (t) => {
  // The walk committed to the first file it found and only then asked whose it
  // was, so a hand-written file in a subdirectory silenced the repository's own
  // map for every session under that directory. Whose it is decides whether the
  // walk stops, not only whether it answers.
  const dir = mapped(t);
  const below = join(dir, "sub");
  mkdirSync(join(below, ".claude", "rules"), { recursive: true });
  writeFileSync(join(below, ".claude", "rules", "anatomiya-overview.md"), "---\ngenerator: nobody\n---\n\n# theirs\n");

  assert.match(echoContext(below), /# Repository map/, "the root's map, walked past the foreign one");
});

test("a repository with no map echoes nothing rather than an empty map", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-hook-"));
  assert.equal(echoContext(dir, {}), null);
  rmSync(dir, { recursive: true, force: true });
});

test("the echo says the code outranks it, because a stale map is the failure it has", (t) => {
  const dir = mapped(t);
  const out = echoContext(dir, {});
  assert.match(out, /the code is right and the map is stale/);
  assert.match(out, /anatomiya scan/);
});

// --- what it writes ----------------------------------------------------------

// --- where the hook is declared ---------------------------------------------

test("the plugin declares the hook itself, in the one file the variable works in", () => {
  // `${CLAUDE_PLUGIN_ROOT}` is substituted only for hooks a plugin declares in
  // its own `hooks/hooks.json`. Written into a repository's settings it is not
  // substituted at all: Claude Code refuses the hook by name on every prompt
  // and every tool call, which is worse than no hook, and it shipped that way
  // in 0.2.4 through 0.2.6.
  const declared = JSON.parse(readFileSync(new URL("../plugins/anatomiya/hooks/hooks.json", import.meta.url), "utf8"));

  // The top-level key is not decoration: without it the file loads nothing and
  // says nothing about it.
  assert.deepEqual(Object.keys(declared), ["hooks"]);
  assert.deepEqual(Object.keys(declared.hooks).sort(), ["PostToolUse", "PostToolUseFailure", "PreToolUse", "UserPromptSubmit"]);

  for (const [event, groups] of Object.entries(declared.hooks)) {
    assert.ok(Array.isArray(groups) && groups.length === 1, event);
    assert.deepEqual(groups[0].hooks.map((h) => h.type), ["command"], event);
    // The write-time hook runs the other verb; every other event re-delivers
    // the map. Both are held to the same `${CLAUDE_PLUGIN_ROOT}` spelling,
    // which is the half that shipped broken in 0.2.4 through 0.2.6.
    assert.equal(groups[0].hooks[0].command, event === "PreToolUse" ? NOTICE_COMMAND : HOOK_COMMAND, event);
  }
});

test("the declared command runs a file this plugin actually ships", () => {
  // The whole defect was a command nothing resolved. The path inside it is
  // checked here rather than trusted, against the tree this test runs in.
  const declared = JSON.parse(readFileSync(new URL("../plugins/anatomiya/hooks/hooks.json", import.meta.url), "utf8"));
  const command = declared.hooks.UserPromptSubmit[0].hooks[0].command;
  const [target] = pluginPaths(command);

  assert.ok(target, command);
  // Resolved against the plugin's own root, which is what the loader
  // substitutes the variable for.
  assert.ok(existsSync(join(ANATOMIYA, target)), target);
});

test("the declared command, run the way the loader runs it, echoes the map", (t) => {
  // The one end-to-end this can do without a session: substitute the variable
  // the loader substitutes, run the command it declares, and read what comes
  // back. Every other test here calls the function directly, which is exactly
  // why the broken declaration shipped three times.
  const dir = mapped(t);
  const declared = JSON.parse(readFileSync(new URL("../plugins/anatomiya/hooks/hooks.json", import.meta.url), "utf8"));
  const root = ANATOMIYA.replace(/\/$/, "");
  const command = declared.hooks.UserPromptSubmit[0].hooks[0].command.replace("${CLAUDE_PLUGIN_ROOT}", root);

  const run = spawnSync(command, {
    cwd: dir,
    shell: true,
    // `node --test` has no per-case timeout of its own, so a hook that never
    // answers holds this file open with nothing said about which case.
    timeout: 10_000,
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit" }),
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.signal === null ? run.stderr : `killed by ${run.signal}: the hook did not answer`);
  const answer = JSON.parse(run.stdout);
  assert.equal(answer.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(answer.hookSpecificOutput.additionalContext, /<repository-map delivered="/);
  assert.match(answer.hookSpecificOutput.additionalContext, /# Repository map/);
});

/** The `notice` verb, run exactly as the loader would run its declaration. */
function fireNotice(dir, filePath, event = "PreToolUse") {
  const declared = JSON.parse(readFileSync(new URL("../plugins/anatomiya/hooks/hooks.json", import.meta.url), "utf8"));
  const root = ANATOMIYA.replace(/\/$/, "");
  const command = declared.hooks.PreToolUse[0].hooks[0].command.replace("${CLAUDE_PLUGIN_ROOT}", root);
  return spawnSync(command, {
    cwd: dir,
    shell: true,
    timeout: 10_000,
    input: JSON.stringify({
      ...(event === null ? {} : { hook_event_name: event }),
      tool_name: "Write",
      tool_input: { file_path: filePath },
    }),
    encoding: "utf8",
  });
}

/** A Rails-shaped repository: mailers nobody tests, services everybody does. */
function railsish(t) {
  const dir = recorded(t, {
    tests: [{ runner: "RSpec", files: 6, sub: null, under: 6 }],
    roots: [
      { path: "app/mailers", dir: "app/mailers", files: 4, tests: [], testRoot: false, companions: { with: 0, of: 4, root: null } },
      { path: "app/services", dir: "app/services", files: 6, tests: [], testRoot: false, companions: { with: 6, of: 6, root: "spec/services" } },
    ],
  });
  mkdirSync(join(dir, "spec", "mailers"), { recursive: true });
  return dir;
}

test("the declared notice, run the way the loader runs it, answers for the path about to be written", (t) => {
  const dir = railsish(t);

  const run = fireNotice(dir, join(dir, "spec/mailers/cim_share_mailer_spec.rb"));

  assert.equal(run.status, 0, run.signal === null ? run.stderr : `killed by ${run.signal}: the hook did not answer`);
  const answer = JSON.parse(run.stdout);
  assert.equal(answer.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(answer.hookSpecificOutput.additionalContext, /app\/mailers: 4 files, 0 with a namesake test/);
  assert.equal(answer.hookSpecificOutput.permissionDecision, undefined, "it informs and never refuses");
});

test("a path something is already at is not a path being chosen", (t) => {
  // Every `Edit` names a file that exists, and a `Write` over one is a rewrite.
  // Answering there repeats the same block on each edit of the same spec, which
  // is the unchanged banner this hook exists instead of (A44).
  //
  // The same path, before and after, so only the file's own existence differs.
  // The directory holds no other test either way, which is what keeps this case
  // on the guard it is named for rather than on the one a level below it.
  const dir = railsish(t);
  const spec = join(dir, "spec/mailers/cim_share_mailer_spec.rb");

  assert.match(JSON.parse(fireNotice(dir, spec).stdout).hookSpecificOutput.additionalContext, /holds no other test/);

  writeFileSync(spec, "RSpec.describe CimShareMailer do; end\n");
  assert.deepEqual(JSON.parse(fireNotice(dir, spec).stdout), {});
});

test("a directory nobody can list is not a directory with nothing in it", needsUnreadableDirs, (t) => {
  // C33 again, at a new reader. What decides whether the finding prints is
  // whether the directory holds another test, and a directory that could not be
  // read answers neither yes nor no. Reported as holding none, it stated a fact
  // it had not read: the sibling spec was in git the whole time.
  const dir = railsish(t);
  mkdirSync(join(dir, "spec/mailers"), { recursive: true });
  writeFileSync(join(dir, "spec/mailers/admin_mailer_spec.rb"), "RSpec.describe Admin do; end\n");
  chmodSync(join(dir, "spec/mailers"), 0o111);

  let out;
  try {
    out = fireNotice(dir, join(dir, "spec/mailers/user_mailer_spec.rb")).stdout;
  } finally {
    // Put it back here rather than in an `after`, which runs too late for the
    // cleanup that removes the directory.
    chmodSync(join(dir, "spec/mailers"), 0o755);
  }

  assert.deepEqual(JSON.parse(out), {});
});



test("the notice answers an object and exits 0 for anything it cannot decide", (t) => {
  const dir = railsish(t);
  const cases = [
    ["a path in another repository", "/elsewhere/spec/mailers/x_spec.rb"],
    ["a spec whose siblings have theirs", join(dir, "spec/services/dispatcher_spec.rb")],
    ["a file that is not a test at all", join(dir, "app/mailers/report_mailer.rb")],
  ];

  for (const [what, path] of cases) {
    const run = fireNotice(dir, path);
    assert.equal(run.status, 0, `${what}: ${run.stderr}`);
    assert.deepEqual(JSON.parse(run.stdout), {}, what);
  }
});

test("the notice answers an object and exits 0 with no event, no payload and a payload past the bound", (t) => {
  const dir = railsish(t);
  const spec = join(dir, "spec/mailers/cim_share_mailer_spec.rb");

  assert.deepEqual(JSON.parse(fireNotice(dir, spec, null).stdout), {}, "no event name");

  const declared = JSON.parse(readFileSync(new URL("../plugins/anatomiya/hooks/hooks.json", import.meta.url), "utf8"));
  const command = declared.hooks.PreToolUse[0].hooks[0].command.replace("${CLAUDE_PLUGIN_ROOT}", ANATOMIYA.replace(/\/$/, ""));
  // The oversized one has to be valid json, or it is refused for its syntax and
  // says nothing about the bound: `"x".repeat(...)` is not json at three bytes
  // either. This is a real payload with a megabyte of padding past the cap.
  const past = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: spec, padding: "x".repeat(2 * 1024 * 1024) },
  });
  for (const [what, input] of [["not json", "{ not json"], ["nothing at all", ""]]) {
    const run = spawnSync(command, { cwd: dir, shell: true, timeout: 10_000, input, encoding: "utf8" });
    assert.equal(run.status, 0, `${what}: ${run.stderr}`);
    assert.deepEqual(JSON.parse(run.stdout), {}, what);
  }

  // Past the bound this used to answer the empty object, and the case asserted
  // it. That was the reader's limit written down as though it were the rule: a
  // `Write` whose content runs past the cap is the write this hook has most to
  // say about, and the fields it needs are the short ones in front of it.
  const run = spawnSync(command, { cwd: dir, shell: true, timeout: 10_000, input: past, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(
    JSON.parse(run.stdout).hookSpecificOutput.additionalContext,
    /spec\/mailers holds no other test/,
    "a write bigger than the cap is still a write this repository has something to say about"
  );
});

test("the same command in a repository with no map answers an empty object", (t) => {
  // A plugin hook runs in every session, so this is the answer most of the time
  // and it has to cost nothing and disturb nothing.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-nomap-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const declared = JSON.parse(readFileSync(new URL("../plugins/anatomiya/hooks/hooks.json", import.meta.url), "utf8"));
  const root = ANATOMIYA.replace(/\/$/, "");
  const command = declared.hooks.PostToolUse[0].hooks[0].command.replace("${CLAUDE_PLUGIN_ROOT}", root);

  const run = spawnSync(command, {
    cwd: dir,
    shell: true,
    // `node --test` has no per-case timeout of its own, so a hook that never
    // answers holds this file open with nothing said about which case.
    timeout: 10_000,
    input: JSON.stringify({ hook_event_name: "PostToolUse" }),
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.signal === null ? run.stderr : `killed by ${run.signal}: the hook did not answer`);
  assert.deepEqual(JSON.parse(run.stdout), {});
});

// --- what a scan does to a repository that carries the old one ---------------

test("the hook an older version wrote is taken out, and the file with it when nothing is left", (t) => {
  // 0.2.4 through 0.2.6 wrote this, and Claude Code refuses it by name on every
  // prompt and every tool call. An upgrade has to unbreak the repositories the
  // older version broke, or the fix reaches only repositories nobody scanned.
  const dir = mapped(t);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), JSON.stringify(OLD_SETTINGS, null, 2));

  const plan = planRemoval(dir);
  commitRemoval(dir, plan);

  assert.equal(plan.changed, true);
  assert.equal(existsSync(join(dir, SETTINGS_PATH)), false, "the file held nothing else");
});

test("a hook a person installed by hand is not one an older version wrote", (t) => {
  // The sweep may only take out what a version of this tool put there. No
  // shipped version ever wrote a `notice` entry, so recognising that verb here
  // would delete somebody's own hook while saying it removed a stale one.
  const dir = mapped(t);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(
    join(dir, SETTINGS_PATH),
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: NOTICE_COMMAND }] }] } })
  );

  const plan = planRemoval(dir);

  assert.equal(plan.changed, false);
  assert.deepEqual(settings(dir).hooks.PreToolUse[0].hooks[0].command, NOTICE_COMMAND);
});

test("settings this did not write are left exactly as they were", (t) => {
  const dir = mapped(t);
  const mine = {
    permissions: { allow: ["Bash(bundle exec rspec:*)"], deny: [], ask: [] },
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "bash ./block-heroku.sh" }] }],
      PostToolUse: [
        { matcher: "Edit", hooks: [{ type: "command", command: "bash ./fmt.sh" }] },
        { matcher: "*", hooks: [{ type: "command", command: HOOK_COMMAND }] },
      ],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: HOOK_COMMAND }] }],
    },
  };
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), JSON.stringify(mine, null, 2));

  commitRemoval(dir, planRemoval(dir));

  const s = settings(dir);
  assert.deepEqual(s.permissions, mine.permissions, "the permission lists are untouched");
  assert.deepEqual(s.hooks.PreToolUse, mine.hooks.PreToolUse, "another event's hook is untouched");
  assert.equal(s.hooks.PostToolUse.length, 1, "ours goes and the sibling stays");
  assert.equal(s.hooks.PostToolUse[0].hooks[0].command, "bash ./fmt.sh");
  assert.equal("UserPromptSubmit" in s.hooks, false, "an event holding only ours goes with it");
});

test("a repository with no settings of its own is left without one", (t) => {
  const dir = mapped(t);

  const plan = planRemoval(dir);
  commitRemoval(dir, plan);

  assert.equal(plan.changed, false);
  assert.equal(existsSync(join(dir, SETTINGS_PATH)), false, "nothing is created to then be emptied");
});

test("taking it out twice is the same as taking it out once", (t) => {
  const dir = mapped(t);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), JSON.stringify({ permissions: { allow: [] }, ...OLD_SETTINGS }, null, 2));

  commitRemoval(dir, planRemoval(dir));
  const after = readFileSync(join(dir, SETTINGS_PATH), "utf8");
  const again = planRemoval(dir);

  assert.equal(again.changed, false);
  commitRemoval(dir, again);
  assert.equal(readFileSync(join(dir, SETTINGS_PATH), "utf8"), after, "byte-identical");
});

test("a command that names this tool is ours however it was spelled", (t) => {
  // The removal has to reach what an older version wrote, not only what this
  // one would write, and the quoting around the path has changed once already.
  const dir = mapped(t);
  const spellings = [
    'node "${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs" echo',
    "node ${CLAUDE_PLUGIN_ROOT}/bin/anatomiya.mjs echo",
    'node "/Users/somebody/.claude/plugins/cache/crisnahine/anatomiya/0.2.5/bin/anatomiya.mjs" echo',
  ];
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(
    join(dir, SETTINGS_PATH),
    JSON.stringify({ hooks: { UserPromptSubmit: spellings.map((command) => ({ hooks: [{ type: "command", command }] })) } })
  );

  commitRemoval(dir, planRemoval(dir));

  assert.equal(existsSync(join(dir, SETTINGS_PATH)), false, "every spelling of ours went");
});

test("a settings path that leaves the repository is refused, and the file it pointed at is untouched", (t) => {
  // F2, applied to the file this no longer writes but still has to clean. A
  // tracked `.claude/settings.local.json -> ../../victim.json` survives a
  // clone, and `join` normalises `..` while resolving no link, so a rewrite
  // here would land in a file the repository does not own.
  const dir = mapped(t);
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-victim-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const victim = join(outside, "important.json");
  const body = JSON.stringify(OLD_SETTINGS);
  writeFileSync(victim, body);

  mkdirSync(join(dir, ".claude"), { recursive: true });
  symlinkSync(victim, join(dir, SETTINGS_PATH));

  assert.throws(() => planRemoval(dir), /outside|escape|left alone/i);
  assert.equal(readFileSync(victim, "utf8"), body, "the file it pointed at is untouched");
});

test("a .claude directory that is a link out of the repository is refused too", (t) => {
  const dir = mapped(t);
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-victim-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "settings.local.json"), JSON.stringify(OLD_SETTINGS));

  rmSync(join(dir, ".claude"), { recursive: true, force: true });
  symlinkSync(outside, join(dir, ".claude"));

  assert.throws(() => planRemoval(dir), /outside|escape|left alone/i);
  assert.ok(existsSync(join(outside, "settings.local.json")), "nothing there was removed");
});

test("settings that do not parse are refused, never rewritten", (t) => {
  const dir = mapped(t);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), "{ this is not json");

  assert.throws(() => planRemoval(dir), /could not be read/);
  assert.equal(readFileSync(join(dir, SETTINGS_PATH), "utf8"), "{ this is not json", "left alone");
});

test("a hooks block that is not an object is refused, not spread into one", (t) => {
  // A25's rule, on the reading side: a writer that reads a shape it does not
  // understand as the shape it expected is a writer that mangles it.
  for (const hooks of ['"PreToolUse"', '[{"matcher":"Bash"}]', "42"]) {
    const dir = mapped(t);
    const body = `{"permissions":{"allow":["Bash(x)"]},"hooks":${hooks}}`;
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, SETTINGS_PATH), body);

    assert.throws(() => planRemoval(dir), /hooks/, hooks);
    assert.equal(readFileSync(join(dir, SETTINGS_PATH), "utf8"), body, `${hooks} left alone`);
  }
});

test("a file that holds no hooks at all is nothing to change", (t) => {
  const dir = mapped(t);
  const body = '{"permissions":{"allow":["Bash(x)"]},"hooks":null}';
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), body);

  const plan = planRemoval(dir);

  assert.equal(plan.changed, false);
  commitRemoval(dir, plan);
  assert.equal(readFileSync(join(dir, SETTINGS_PATH), "utf8"), body, "left alone");
});

test("an event whose value is not a list is refused, not spread into characters", (t) => {
  const dir = mapped(t);
  const body = '{"hooks":{"PostToolUse":"bash ./fmt.sh"}}';
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), body);

  assert.throws(() => planRemoval(dir), /PostToolUse/);
  assert.equal(readFileSync(join(dir, SETTINGS_PATH), "utf8"), body, "left alone");
});

test("the plan is committed to the root it was planned for and no other", (t) => {
  const a = mapped(t);
  const b = mapped(t);
  assert.throws(() => commitRemoval(b, planRemoval(a)), /planned for/);
});

// --- what the hook survives --------------------------------------------------

const ECHO = fileURLToPath(new URL("../plugins/anatomiya/bin/anatomiya.mjs", import.meta.url));

/** The timeout the declaration asks Claude Code for, in milliseconds. */
const DECLARED =
  JSON.parse(readFileSync(new URL("../plugins/anatomiya/hooks/hooks.json", import.meta.url), "utf8")).hooks.UserPromptSubmit[0].hooks[0].timeout * 1000;

/**
 * A close, or a failure that names the wait rather than hanging the file.
 *
 * `node --test` has no per-case timeout of its own, so a hook that never
 * answers takes the whole run with it and says nothing about which case. The
 * child is killed on the way out: left running, it holds its pipes open and the
 * run hangs after the case has already been reported, which is the failure this
 * is here to avoid, one step later.
 */
async function within({ child, closed }, ms) {
  let timer;
  const raced = await Promise.race([
    closed,
    new Promise((r) => { timer = setTimeout(() => r("hung"), ms); }),
  ]);
  clearTimeout(timer);
  if (raced === "hung") child.kill("SIGKILL");
  assert.notEqual(raced, "hung", `the hook had not answered after ${ms}ms`);
  return raced;
}

/** The hook as a process, with its two pipes under the test's control. */
function hookProcess(dir) {
  const child = spawn(process.execPath, [ECHO, "echo"], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.on("error", () => {});
  return { child, closed: new Promise((r) => child.on("close", (code) => r({ code, stderr }))) };
}

test("the hook exits 0 when its reader goes away before it answers", async (t) => {
  // A hook that fails is worse than a hook nobody read: a non-zero exit
  // interrupts the run it exists to help, on every turn and every tool call for
  // the life of that session. The ordering is forced rather than timed, since
  // the hook cannot write before it has read the payload.
  const dir = mapped(t);

  // Three times, because the forcing is an argument and not a measurement: if
  // the read ever did finish before the destroy landed, once would be a pass
  // and the defect would come back as a flake nobody could place.
  for (let i = 0; i < 3; i++) {
    const hook = hookProcess(dir);
    const { child } = hook;
    child.stdout.on("error", () => {});
    child.stdout.destroy();
    child.stdin.end(JSON.stringify({ hook_event_name: "UserPromptSubmit" }));

    const { code, stderr } = await within(hook, 8000);
    assert.equal(code, 0, stderr);
  }
});

test("the hook gives up on a payload that never arrives", async (t) => {
  // A caller that opens the pipe and writes nothing held an unbounded read for
  // as long as it kept the handle. The bound is the hook's own and well under
  // the five seconds the declaration asks Claude Code for.
  const dir = mapped(t);
  const hook = hookProcess(dir);
  const { child } = hook;
  child.stdout.resume();

  const started = Date.now();
  let timer;
  const raced = await Promise.race([
    hook.closed,
    new Promise((r) => { timer = setTimeout(() => r("hung"), DECLARED); }),
  ]);
  clearTimeout(timer);
  if (raced === "hung") child.kill("SIGKILL");

  assert.notEqual(raced, "hung", `the hook was still waiting on an empty pipe after the ${DECLARED}ms it declares`);
  assert.equal(raced.code, 0, raced.stderr);
  // Against the hook's own bound, not the declaration: the race above already
  // caps at the declaration, so measuring against it was an assertion nothing
  // could fail. The slack is process start and module load, which a cold run
  // pays. The bound itself is held to the declaration by the case below, since
  // read from the module this alone would move with whatever it was set to.
  const elapsed = Date.now() - started;
  assert.ok(elapsed < PAYLOAD_WAIT_MS + 1500, `the hook's own bound is ${PAYLOAD_WAIT_MS}ms and it answered after ${elapsed}ms`);
});

// Two numbers, each read from where it lives: what the hook gives itself and
// what the declaration asks Claude Code for. The one has to leave room for the
// other, or a read that ends in time is a hook that answers too late anyway,
// and the elapsed check above cannot see it because it reads the same constant.
test("the payload read gives itself less than half the timeout the declaration asks for", () => {
  assert.ok(
    PAYLOAD_WAIT_MS * 2 <= DECLARED,
    `the read waits ${PAYLOAD_WAIT_MS}ms of the ${DECLARED}ms declared, leaving ${DECLARED - PAYLOAD_WAIT_MS}ms for everything else`
  );
});

test("a payload that arrived whole is answered even when the pipe stays open", async (t) => {
  // The bound exists for a caller that says nothing, not for one that said
  // everything and did not close the handle. Throwing away what arrived costs
  // that turn its map for no reason, and the second plugin's copy of the same
  // bound keeps what it has.
  const dir = mapped(t);
  const hook = hookProcess(dir);
  const { child } = hook;
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stdin.write(JSON.stringify({ hook_event_name: "UserPromptSubmit" }));

  const { code, stderr } = await within(hook, 8000);
  child.stdin.destroy();

  assert.equal(code, 0, stderr);
  assert.match(JSON.parse(stdout).hookSpecificOutput.additionalContext, /# Repository map/);
});

test("half a payload is still not a payload, however long the pipe stays open", async (t) => {
  const dir = mapped(t);
  const hook = hookProcess(dir);
  const { child } = hook;
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stdin.write('{"hook_event_name":"UserProm');

  const { code, stderr } = await within(hook, 8000);
  child.stdin.destroy();

  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), {});
});

test("a payload past the cap is answered rather than read whole", async (t) => {
  // Whatever the far end sends, the hook pays for a megabyte of it at most: it
  // runs on every tool call, and the writer decides the size. That bound is
  // what this holds. It used to assert the empty object as well, which was the
  // reader's limit standing in for the rule: the event is named in the first
  // hundred bytes and the three megabytes after it are padding, so the turn was
  // losing a map it had everything it needed to deliver.
  const dir = mapped(t);
  const hook = hookProcess(dir);
  const { child } = hook;
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stdin.end(`{"hook_event_name":"UserPromptSubmit","pad":"${"x".repeat(3 * 1024 * 1024)}"}`);

  const { code, stderr } = await within(hook, 8000);
  assert.equal(code, 0, stderr);
  const said = JSON.parse(stdout);
  assert.equal(said.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(said.hookSpecificOutput.additionalContext, /<repository-map delivered="/);
  assert.equal(said.hookSpecificOutput.additionalContext.includes("xxxx"), false, "and none of the padding came back with it");
});

test("a member sitting past the cap is one the reader never reaches", async (t) => {
  // The bound itself, asserted by what it costs rather than by a number: this
  // payload names a repository, and it names it a megabyte in. A reader with no
  // cap, or with a larger one, answers that map; this one has stopped reading
  // by then and answers the empty object. Without a case like this the cap
  // could be deleted outright and every case in this file would still pass.
  const dir = mapped(t);
  mkdirSync(join(dir, ".git"), { recursive: true });
  const hook = hookProcess(dir);
  const { child } = hook;
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stdin.end(
    `{"tool_name":"Read","pad":"${"x".repeat(2 * 1024 * 1024)}","hook_event_name":"PostToolUse","cwd":${JSON.stringify(dir)}}`,
  );

  const { code, stderr } = await within(hook, 8000);

  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), {}, "a field a megabyte in was read, so the bound is not being kept");
});


test("a settings path that is not a file is refused rather than opened and waited on", needsPosixSpecialFiles, (t) => {
  // `readFileSync` types nothing and waits for a writer, and this runs on every
  // scan, so a fifo left at that path holds the command for ever with nothing
  // printed. The module's own `readHead` opens with O_NONBLOCK and stats the
  // handle before a byte is read, which is the rule the docstring above states
  // and this one read did not follow.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-settings-fifo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  execFileSync("mkfifo", [join(dir, SETTINGS_PATH)]);

  // Driven in a child with a bound, because the read is synchronous: an
  // unbounded open stops this process's event loop, so a case that waits in
  // place takes the whole file down before it can assert anything, and the
  // reporter never flushes the cases that already passed.
  const script = `import { planRemoval } from ${JSON.stringify(new URL("../plugins/anatomiya/lib/hook.mjs", import.meta.url).href)};
    try { planRemoval(${JSON.stringify(dir)}); process.stdout.write("no refusal"); }
    catch (err) { process.stdout.write(err.message); }`;

  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 8000 });

  assert.equal(run.signal, null, `still waiting on the fifo after 8 seconds: killed by ${run.signal}`);
  assert.match(run.stdout, /could not be read/, run.stdout || run.stderr);
});

test("a settings file larger than the cap is refused, not read whole", (t) => {
  // The read had no bound at all, so whatever sits at that path is the cost of
  // every scan. Everything else this module reads goes through one cap.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-settings-big-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, SETTINGS_PATH), `{"pad":"${"x".repeat(2 * 1024 * 1024)}"}`);

  assert.throws(() => planRemoval(dir), /could not be read/);
});

// --- what is left of a payload that will not parse whole ----------------------

/** The envelope Claude Code sends, in the field order 2.1.251 builds it in. */
const envelope = (extra = {}) => ({
  session_id: "abc",
  cwd: "/repo",
  hook_event_name: "PostToolUse",
  tool_name: "Read",
  tool_input: { file_path: "/repo/src/a.ts" },
  ...extra,
});

test("a whole payload followed by anything still answers the fields it carried", () => {
  // `JSON.parse` refuses trailing bytes that are not whitespace, so the cap's
  // own case, a complete document and then padding, threw and the turn lost its
  // map. The document is there; the reader was the thing that could not use it.
  const said = fieldsIn(`${JSON.stringify(envelope())}${"x".repeat(200)}`);

  assert.equal(said.hook_event_name, "PostToolUse");
  assert.equal(said.tool_name, "Read");
  assert.equal(said.cwd, "/repo");
  assert.equal(said.tool_input.file_path, "/repo/src/a.ts");
});

test("a payload cut in the middle of the bulk keeps what came before the cut", () => {
  // A `Write` of a large file, or a `Read` whose response carries one: the
  // fields these hooks read are short and come first, and the megabyte after
  // them is what the cap refuses. Cut inside the long value, the short ones are
  // still whole.
  const whole = JSON.stringify(envelope({ tool_input: { file_path: "/repo/src/a.ts", content: "y".repeat(5000) } }));

  const said = fieldsIn(whole.slice(0, whole.indexOf("yyy") + 40));

  assert.equal(said.cwd, "/repo");
  assert.equal(said.tool_input.file_path, "/repo/src/a.ts");
  assert.equal(said.tool_input.content, undefined, "the value the cut fell inside is not one it read");
});

test("a key spelled inside a value is a value, not a key", () => {
  // The whole reason this reads the grammar rather than matching a pattern: a
  // file being written can contain anything, and a reader that found `"cwd"`
  // inside it would answer another repository's path for a live write.
  const said = fieldsIn(`${JSON.stringify(envelope({ tool_input: { file_path: "/repo/a.ts", content: '{"cwd":"/evil","tool_name":"Bash"}' } }))}x`);

  assert.equal(said.cwd, "/repo");
  assert.equal(said.tool_name, "Read");
  assert.equal(said.tool_input.file_path, "/repo/a.ts");
});

test("a value the cut falls inside is not half a value", () => {
  assert.deepEqual(fieldsIn('{"cwd":"/repo","tool_name":"Re'), { cwd: "/repo" });
  assert.deepEqual(fieldsIn('{"cwd":"/repo","tool_na'), { cwd: "/repo" });
  assert.deepEqual(fieldsIn('{"cwd":"/repo",'), { cwd: "/repo" });
  assert.deepEqual(fieldsIn('{"cwd"'), {});
});

test("escapes are decoded by the parser rather than by this", () => {
  // A Windows path is backslashes all the way down, and every one of them is an
  // escape in JSON. Read by hand they come back halved or the string ends early.
  const said = fieldsIn(`{"cwd":"C:\\\\Users\\\\a","tool_name":"Read","tool_input":{"file_path":"C:\\\\Users\\\\a\\\\say \\"hi\\".ts"}}x`);

  assert.equal(said.cwd, "C:\\Users\\a");
  assert.equal(said.tool_input.file_path, 'C:\\Users\\a\\say "hi".ts');
});

test("a brace inside a value the reader steps over does not end the object", () => {
  // The decoy in the case above sits in `tool_input.content`, which is read as
  // a string rather than stepped over, so it never reaches `skipValue`. This is
  // the other half: the cargo is under a member the reader skips, and the
  // structure characters are inside its own strings. Without `skipValue`
  // reading a string as a string, the first `}` ends the payload and everything
  // after it is lost.
  const said = fieldsIn('{"cwd":"/repo","tool_response":{"content":"}]}\\" oh"},"tool_name":"Read"}x');

  assert.equal(said.cwd, "/repo");
  assert.equal(said.tool_name, "Read", "the walk carried on past the cargo");
  assert.equal(said.tool_response, undefined);
});

test("what is skipped is skipped whole, whatever shape it is", () => {
  const said = fieldsIn(
    `${JSON.stringify({
      effort: { level: "medium" },
      permission_mode: "bypassPermissions",
      cwd: "/repo",
      tool_response: { file: { filePath: "/elsewhere/x.ts", content: "z" } },
      duration_ms: 12,
      is_interrupt: false,
      nothing: null,
      list: [1, "two", { three: 4 }],
      tool_name: "Read",
    })}x`,
  );

  assert.equal(said.cwd, "/repo");
  assert.equal(said.tool_name, "Read");
  assert.equal(said.permission_mode, "bypassPermissions");
  assert.equal(said.effort, undefined, "an object at the top is not a field this reads");
  assert.equal(said.tool_response, undefined);
  assert.equal(said.duration_ms, undefined);
});

test("a value too long to be a path is bulk, and is passed over", () => {
  // The bound `targetIn` already refuses a path on. Anything longer names no
  // place and is the payload's cargo, so recovering it would copy the megabyte
  // this stopped reading to avoid.
  const long = "a".repeat(5000);
  const said = fieldsIn(`{"cwd":"/repo","prompt":"${long}","tool_name":"Read"}x`);

  assert.equal(said.cwd, "/repo");
  assert.equal(said.tool_name, "Read", "and the reading goes on past it");
  assert.equal(said.prompt, undefined);
});

test("nesting deep enough to end a recursive reader does not end this one", () => {
  const deep = `{"cwd":"/repo","list":${"[".repeat(50_000)}${"]".repeat(50_000)},"tool_name":"Read"}x`;

  const said = fieldsIn(deep);

  assert.equal(said.cwd, "/repo");
  assert.equal(said.tool_name, "Read");
});

test("a chain of the one member this reads into is not a chain of calls", () => {
  // The case above is stepped over by `skipValue`, which counts depth in a loop
  // of its own, so it says nothing about the one place that does call itself.
  // `tool_input` is read one level in and no further, and without that bound a
  // payload nesting it throws `RangeError` out of a hook that runs before every
  // tool call. Nothing else in this file reaches that branch at depth.
  const deep = `{"cwd":"/repo",${'"tool_input":{'.repeat(20_000)}"file_path":"/a"${"}".repeat(20_000)},"tool_name":"Read"}x`;

  const said = fieldsIn(deep);

  assert.equal(said.cwd, "/repo");
  assert.equal(said.tool_name, "Read", "the walk carried on past it");
  // One level in is where the read stops, so the chain below that is stepped
  // over and the path at the bottom of it is not this call's target.
  assert.equal(said.tool_input?.file_path, undefined);
});

test("a member named for something on the prototype is a member like any other", () => {
  // `fields[name] = value` runs the setter for `__proto__` rather than making a
  // property, so the member vanished while `JSON.parse` keeps it as its own. No
  // payload is worse for it today, since nothing reads that name, but the two
  // readers of one document disagreeing about what is in it is the thing this
  // whole reader exists not to do.
  const said = fieldsIn('{"__proto__":"x","constructor":"y","cwd":"/repo"}z');

  assert.equal(Object.hasOwn(said, "__proto__"), true, "the member is the object's own");
  assert.equal(said.__proto__, "x");
  assert.equal(said.constructor, "y");
  assert.equal(said.cwd, "/repo");
  // The value is a string, so the setter could not have moved a prototype
  // anywhere; this holds that it stays that way if the shape it reads widens.
  assert.equal(Object.getPrototypeOf(said), Object.prototype, "and nothing was reparented");
  assert.equal({}.x, undefined, "and nothing reached Object.prototype");
});

test("a member said twice answers what the last one said, as the parser would", () => {
  // The docstring calls this a strict subset of what `JSON.parse` answers, and
  // it was not: a repeated key whose second value is not a string left the
  // first one standing, while the parser takes the last whatever its type. On
  // a payload the parser refused, that is a reader reporting a `cwd` the
  // document does not have.
  assert.deepEqual(fieldsIn('{"cwd":"/a","cwd":"/b"}z'), { cwd: "/b" }, "two strings: the last one");
  assert.deepEqual(fieldsIn('{"cwd":"/a","cwd":123}z'), {}, "a later number is not a string, so there is nothing to report");
  assert.deepEqual(fieldsIn('{"cwd":"/a","cwd":null}z'), {});
  assert.deepEqual(fieldsIn('{"cwd":"/a","cwd":{"x":"y"}}z'), {});
  assert.deepEqual(fieldsIn('{"tool_input":{"file_path":"/a"},"tool_input":"x"}z'), { tool_input: "x" });
  assert.deepEqual(fieldsIn('{"tool_input":{"file_path":"/a"},"tool_input":{}}z'), {}, "an object with nothing in it says nothing");
  assert.deepEqual(
    fieldsIn('{"tool_input":{"file_path":"/a"},"tool_input":{"file_path":"/b"}}z'),
    { tool_input: { file_path: "/b" } },
  );
});

test("anything that is not an object at all is nothing to read", () => {
  assert.deepEqual(fieldsIn(""), {});
  assert.deepEqual(fieldsIn("not json"), {});
  assert.deepEqual(fieldsIn("[1,2]"), {});
  assert.deepEqual(fieldsIn("null"), {});
  assert.deepEqual(fieldsIn("  {  }  "), {});
});
