import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SHADOWABLE, agentDirsFor, shadowLine, shadowsFor } from "../plugins/ultracode-anywhere/hooks/shadows.mjs";

/**
 * A tree with a build and an agents directory, both at times this test chose.
 *
 * Real files rather than a stubbed filesystem: what is under test is a
 * comparison of two mtimes and a read of a file's first lines, and a stub of
 * either would be a test of the stub. The times are fixed so the answer does
 * not depend on how long the suite took.
 */
const BUILD_AT = Date.UTC(2026, 7, 29, 0, 39) / 1000;
const BEFORE = Date.UTC(2026, 7, 28, 0, 0) / 1000;
const AFTER = Date.UTC(2026, 7, 31, 10, 20) / 1000;

function tree(t) {
  const dir = mkdtempSync(join(tmpdir(), "uc-shadows-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const build = join(dir, "2.1.251");
  writeFileSync(build, "build");
  utimesSync(build, BUILD_AT, BUILD_AT);

  const agents = join(dir, "agents");
  mkdirSync(agents);
  return { dir, build, agents };
}

/**
 * A shadow file as a person writes one: frontmatter, then the copied prompt.
 *
 * The description is there because the build requires it and refuses a file
 * without one. A fixture that left it out was not a shadow, and the cases
 * built on it were asking about a file that never becomes an agent.
 */
function shadow(agents, type, { effort = "medium", at = AFTER, eol = "\n", body = "copied prompt" } = {}) {
  const path = join(agents, `${type}.md`);
  const lines = [
    "---",
    `name: ${type}`,
    `description: What ${type} is for.`,
    ...(effort === null ? [] : [`effort: ${effort}`]),
    "---",
    "",
    body,
    "",
  ];
  writeFileSync(path, lines.join(eol));
  utimesSync(path, at, at);
  return path;
}

const stateOf = (seen, type) => seen.find((s) => s.type === type)?.state;

// --- what a shadow is ---------------------------------------------------------

test("the shadowable types are the three built-ins a markdown file can replace", () => {
  // Spelled out rather than read off the constant. `claude` is not among them:
  // it sets `appendSystemPrompt`, so a shadow would replace the base prompt
  // instead of adding to it, which is a different agent rather than a copy.
  assert.deepEqual(SHADOWABLE, ["general-purpose", "Explore", "Plan"]);
});

test("no agents directory anywhere leaves every type absent", (t) => {
  const { build } = tree(t);

  const seen = shadowsFor({ level: "medium", dirs: [], build });

  assert.deepEqual(seen.map((s) => s.state), ["absent", "absent", "absent"]);
});

test("a directory that is not there is not an error", (t) => {
  const { dir, build } = tree(t);

  const seen = shadowsFor({ level: "medium", dirs: [join(dir, "nothing-here")], build });

  assert.deepEqual(seen.map((s) => s.state), ["absent", "absent", "absent"]);
});

// --- the level ----------------------------------------------------------------

test("a shadow carrying the asked-for level, written after the build, is in step", (t) => {
  const { agents, build } = tree(t);
  shadow(agents, "Explore", { effort: "medium", at: AFTER });

  const seen = shadowsFor({ level: "medium", dirs: [agents], build });

  assert.equal(stateOf(seen, "Explore"), "current");
});

test("a shadow carrying a different level is not a shadow for the level asked", (t) => {
  // It is somebody's file and it works; it just does not answer the question
  // this switch asked, so saying "present" about it would be a lie.
  const { agents, build } = tree(t);
  shadow(agents, "Plan", { effort: "high" });

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Plan"), "other-level");
});

test("a shadow with no effort line names no level, whatever else it carries", (t) => {
  const { agents, build } = tree(t);
  shadow(agents, "Plan", { effort: null });

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Plan"), "no-level");
});

test("the level is read past case and the spaces an editor leaves", (t) => {
  const { agents, build } = tree(t);
  shadow(agents, "Plan", { effort: "  Medium  " });

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Plan"), "current");
});

test("a shadow checked out with CRLF endings reads the same as one with LF", (t) => {
  // This repository ships no `.gitattributes`, so a shadow that travelled
  // through a Windows checkout carries CRLF, and a frontmatter reader that
  // splits on "\n" alone reads `medium\r`, which is no level.
  const { agents, build } = tree(t);
  shadow(agents, "Explore", { effort: "medium", eol: "\r\n" });

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("an effort line below the frontmatter is not the frontmatter's", (t) => {
  // The copied prompt is prose and may say anything, this line included.
  const { agents, build } = tree(t);
  shadow(agents, "Explore", { effort: null, body: "effort: medium\nand the rest of the prompt" });

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "no-level");
});

// --- the age ------------------------------------------------------------------

test("a shadow older than the build it shadows is the one worth saying", (t) => {
  // The whole point of the switch. The file is right, the level is right, and
  // the prompt inside it is a copy of a build that is no longer installed.
  const { agents, build } = tree(t);
  shadow(agents, "Explore", { effort: "medium", at: BEFORE });

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "older");
});

test("a build nobody can read leaves the age unanswered rather than guessed", (t) => {
  // A missing build is not evidence that a shadow is current. Reporting one as
  // current here would be the gate going quiet on the case it exists for.
  const { dir, agents } = tree(t);
  shadow(agents, "Explore", { effort: "medium", at: BEFORE });

  const seen = shadowsFor({ level: "medium", dirs: [agents], build: join(dir, "no-such-build") });

  assert.equal(stateOf(seen, "Explore"), "unknown-age");
});

test("no build named at all leaves the age unanswered too", (t) => {
  const { agents } = tree(t);
  shadow(agents, "Explore", { effort: "medium" });

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build: null }), "Explore"), "unknown-age");
});

// --- where it looks -----------------------------------------------------------

test("the first directory holding a type is the one that answers for it", (t) => {
  // The build resolves an agent name against the directories in one order and
  // stops at the first hit. Reading a later one would report on a file the
  // spawn never sees.
  const { dir, build, agents } = tree(t);
  const project = join(dir, "project-agents");
  mkdirSync(project);
  shadow(project, "Explore", { effort: "medium" });
  shadow(agents, "Explore", { effort: "high" });

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [project, agents], build }), "Explore"), "current");
});

test("a type absent from the first directory is still found in the second", (t) => {
  const { dir, build, agents } = tree(t);
  const project = join(dir, "project-agents");
  mkdirSync(project);
  shadow(agents, "Plan", { effort: "medium" });

  const seen = shadowsFor({ level: "medium", dirs: [project, agents], build });

  assert.equal(stateOf(seen, "Plan"), "current");
});

test("every shadowable type is answered for, in a fixed order", (t) => {
  const { agents, build } = tree(t);

  const seen = shadowsFor({ level: "medium", dirs: [agents], build });

  assert.deepEqual(seen.map((s) => s.type), SHADOWABLE);
});

// --- what it refuses ----------------------------------------------------------

test("a directory standing where a shadow should be is not a shadow", (t) => {
  const { agents, build } = tree(t);
  mkdirSync(join(agents, "Explore.md"));

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "absent");
});

test("a shadow behind a symlink is the shadow, because the build follows one", (t) => {
  // A dotfiles repository keeps these behind links, and Claude Code follows
  // them and loads the agent. `hook-io.mjs` already says so for the other
  // user file this plugin reads. Refusing the link reported a working setup as
  // having no agent files at all, every session.
  const { dir, agents, build } = tree(t);
  const elsewhere = join(dir, "elsewhere.md");
  writeFileSync(elsewhere, "---\nname: Explore\ndescription: What Explore is for.\neffort: medium\n---\nbody\n");
  utimesSync(elsewhere, AFTER, AFTER);
  symlinkSync(elsewhere, join(agents, "Explore.md"));

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("a symlink pointing nowhere is absent rather than an error", (t) => {
  const { dir, agents, build } = tree(t);
  symlinkSync(join(dir, "no-such-file.md"), join(agents, "Plan.md"));

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Plan"), "absent");
});

test("a big file is read at its head, so a long prompt below the frontmatter costs nothing", (t) => {
  // The whole file is never read: the prompt under the fence runs to hundreds
  // of kilobytes and a hook has five seconds. Refusing the file outright was
  // the first attempt, and it reported a working 9 KB shadow as carrying
  // another level.
  const { agents, build } = tree(t);
  const path = join(agents, "Explore.md");
  writeFileSync(path, `---\nname: Explore\ndescription: What Explore is for.\neffort: medium\n---\n${"x".repeat(200_000)}\n`);
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("frontmatter that runs past the head read defines no agent at all", (t) => {
  // Two different moves. "Another level" sends a reader to change a line; this
  // one is a file nothing could parse, and saying the first about the second
  // is how a reader is sent to fix a file that already works.
  const { agents, build } = tree(t);
  const path = join(agents, "Explore.md");
  writeFileSync(path, `---\nname: Explore\n${"x".repeat(20_000)}\neffort: medium\n---\nbody\n`);
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "absent");
});

test("a file with no frontmatter at all defines no agent either", (t) => {
  const { agents, build } = tree(t);
  const path = join(agents, "Plan.md");
  writeFileSync(path, "just a prompt, no fence\n");
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Plan"), "absent");
});

test("a value in quotes is the level it quotes", (t) => {
  // The build YAML-parses this block. The shipped Explore.md on the machine
  // this was written on carries a double-quoted description with escaped
  // quotes inside and a flow sequence, neither of which a line match survives.
  const { agents, build } = tree(t);
  const path = join(agents, "Explore.md");
  writeFileSync(path, '---\nname: Explore\ndescription: What Explore is for.\neffort: "medium"\n---\nbody\n');
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("a value in single quotes is the level it quotes", (t) => {
  const { agents, build } = tree(t);
  const path = join(agents, "Explore.md");
  writeFileSync(path, "---\nname: Explore\ndescription: What Explore is for.\neffort: 'medium'\n---\nbody\n");
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("a comment after the value is not part of the value", (t) => {
  const { agents, build } = tree(t);
  const path = join(agents, "Explore.md");
  writeFileSync(path, "---\nname: Explore\ndescription: What Explore is for.\neffort: medium # keep in step with the build\n---\nbody\n");
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("a hash inside a quoted value is not a comment", (t) => {
  const { agents, build } = tree(t);
  const path = join(agents, "Explore.md");
  writeFileSync(path, '---\nname: Explore\ndescription: What Explore is for.\neffort: "med#ium"\n---\nbody\n');
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "other-level");
});

test("a byte-order mark before the fence does not hide the frontmatter", (t) => {
  const { agents, build } = tree(t);
  const path = join(agents, "Explore.md");
  writeFileSync(path, '\uFEFF---\nname: Explore\ndescription: What Explore is for.\neffort: medium\n---\nbody\n');
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("blank lines before the fence do not hide the frontmatter", (t) => {
  const { agents, build } = tree(t);
  const path = join(agents, "Explore.md");
  writeFileSync(path, '\n\n---\nname: Explore\ndescription: What Explore is for.\neffort: medium\n---\nbody\n');
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("a level asked for that is no level answers nothing at all", (t) => {
  // The caller reads the switch first and only asks with one of the five. A
  // call with anything else is a bug in the caller, and inventing an answer
  // for it would hide that.
  const { agents, build } = tree(t);
  shadow(agents, "Explore", { effort: "medium" });

  assert.deepEqual(shadowsFor({ level: null, dirs: [agents], build }), []);
  assert.deepEqual(shadowsFor({ level: "deep", dirs: [agents], build }), []);
});

// --- what a session is told ---------------------------------------------------

const seenAs = (states) => SHADOWABLE.map((type, i) => ({ type, state: states[i], path: null }));

test("nothing is said when every shadow is there at the level asked", () => {
  // The switch is the opt-in and silence is the answer it earns. A line every
  // session saying the setting still works is a line nobody reads by the third.
  assert.equal(shadowLine("medium", seenAs(["current", "current", "current"])), null);
});

test("nothing is said when the build's own age could not be read", () => {
  // Not actionable: the files are there and carry the level, and no move a
  // reader could make would answer the question this could not.
  assert.equal(shadowLine("medium", seenAs(["unknown-age", "unknown-age", "unknown-age"])), null);
});

test("nothing is said when there is nothing to report on", () => {
  assert.equal(shadowLine("medium", []), null);
});

test("a shadow older than the build is named, with what that costs", () => {
  const said = shadowLine("medium", seenAs(["current", "older", "current"]));

  assert.match(said, /Explore/);
  assert.match(said, /written before the installed build/);
  assert.doesNotMatch(said, /general-purpose/);
  assert.doesNotMatch(said, /Plan/);
});

test("the age line says what a timestamp knows and stops there", () => {
  // A file older than the build was written against an older one. Whether the
  // prompt inside it actually differs is not knowable from a timestamp, and
  // the first draft asserted it did.
  const said = shadowLine("medium", seenAs(["older", "current", "current"]));

  assert.doesNotMatch(said, /is behind|are behind/);
  assert.match(said, /unchecked|cannot say|not knowable/);
});

test("a file the build refuses is named apart from one carrying another level", () => {
  const said = shadowLine("medium", seenAs(["refused", "other-level", "current"]));

  assert.match(said, /general-purpose[^.]*description/);
  assert.match(said, /Explore[^.]*another level/);
});

test("a file the build refuses is not left silent", () => {
  // One line short of working. Silence would read as "all in order".
  assert.notEqual(shadowLine("medium", seenAs(["refused", "current", "current"])), null);
});

test("every type missing a shadow is named in one line, not one line each", () => {
  const said = shadowLine("medium", seenAs(["absent", "absent", "absent"]));

  assert.equal(said.split(". ").filter((s) => s.includes("no agent file")).length, 1);
  assert.match(said, /general-purpose, Explore and Plan/);
});

test("a file carrying another level is named apart from one that is missing", () => {
  // Two different moves: one is a file to write, the other is a file to look
  // at. Folding them into "not set up" would send a reader to the wrong one.
  const said = shadowLine("medium", seenAs(["absent", "other-level", "current"]));

  assert.match(said, /no agent file[^.]*general-purpose/);
  assert.match(said, /Explore[^.]*another level/);
});

test("the level asked for is named, since the line is about that level alone", () => {
  assert.match(shadowLine("high", seenAs(["absent", "absent", "absent"])), /high/);
});

test("the line says where the lever is and what it cannot carry", () => {
  const said = shadowLine("medium", seenAs(["absent", "absent", "absent"]));

  assert.match(said, /\.claude\/agents/);
  assert.match(said, /effort: medium/);
  assert.match(said, /README/);
});

test("the line names no state it is not reporting", () => {
  const said = shadowLine("medium", seenAs(["older", "current", "current"]));

  assert.doesNotMatch(said, /no agent file/);
  assert.doesNotMatch(said, /another level/);
});

// --- where the build would look -----------------------------------------------

test("a project's own agents directory is asked before the user's", () => {
  // The build resolves a name against the project first, so a repository that
  // ships an agent file is the one a spawn there reads. Asking in the other
  // order would report on the user's file while the project's was in use.
  const dirs = agentDirsFor({ HOME: "/home/me" }, "/work/repo");

  assert.equal(dirs[0], "/work/repo/.claude/agents");
  assert.equal(dirs[dirs.length - 1], "/home/me/.claude/agents");
});

test("CLAUDE_CONFIG_DIR moves the user's agents directory with the rest of its state", () => {
  const dirs = agentDirsFor({ HOME: "/home/me", CLAUDE_CONFIG_DIR: "/elsewhere/cc" }, "/work/repo");

  // Not `$CLAUDE_CONFIG_DIR/.claude/agents`: the build takes the variable as
  // the configuration directory itself.
  assert.equal(dirs[dirs.length - 1], "/elsewhere/cc/agents");
  assert.equal(dirs.includes("/elsewhere/cc/.claude/agents"), false);
});

test("no working directory leaves the user's directory alone to answer", () => {
  assert.deepEqual(agentDirsFor({ HOME: "/home/me" }, ""), ["/home/me/.claude/agents"]);
});

test("a machine with no home named yields no user directory rather than a bad path", () => {
  // The same reading the state directory takes: an environment that names HOME
  // as empty means it, and joining "" would build a path at the filesystem root.
  const dirs = agentDirsFor({ HOME: "" }, "/work/repo");

  // The walk still runs, and every entry it yields is some directory's own
  // `.claude/agents`. What must not appear is the user-level one, which with
  // no home to hang off would be the bare "/agents".
  assert.equal(dirs.every((d) => d.endsWith("/.claude/agents")), true, dirs.join(" "));
  assert.equal(dirs[0], "/work/repo/.claude/agents");
});

test("the same directory named twice is asked once", () => {
  // A session whose working directory is the home directory would otherwise ask
  // the same path twice and could report one file as two.
  const dirs = agentDirsFor({ HOME: "/home/me" }, "/home/me");

  assert.deepEqual(dirs, ["/home/me/.claude/agents"]);
});


// --- walking up to the shadows a spawn would actually read ---------------------

test("every .claude/agents from the working directory up to the home is asked", () => {
  // The build walks up from the working directory and stops at the home
  // directory, so a repository whose agent files sit at its root answers for a
  // session started three directories down. Asking only the working directory
  // reported those files absent.
  const dirs = agentDirsFor({ HOME: "/home/me" }, "/home/me/work/repo/src/deep");

  assert.deepEqual(dirs, [
    "/home/me/work/repo/src/deep/.claude/agents",
    "/home/me/work/repo/src/.claude/agents",
    "/home/me/work/repo/.claude/agents",
    "/home/me/work/.claude/agents",
    "/home/me/.claude/agents",
  ]);
});

test("the walk stops at the home directory rather than climbing to the root", () => {
  const dirs = agentDirsFor({ HOME: "/home/me" }, "/home/me/work");

  assert.deepEqual(dirs, ["/home/me/work/.claude/agents", "/home/me/.claude/agents"]);
});

test("a working directory outside the home yields itself and the user's", () => {
  // The stop is the home directory, and a working directory outside it never
  // reaches one, so the walk runs to the root and the user's comes last.
  const dirs = agentDirsFor({ HOME: "/home/me" }, "/srv/checkout");

  assert.equal(dirs[0], "/srv/checkout/.claude/agents");
  assert.equal(dirs[dirs.length - 1], "/home/me/.claude/agents");
  assert.equal(dirs.includes("/srv/.claude/agents"), true);
});

test("the deepest directory comes first, since that is the one the build prefers", () => {
  const dirs = agentDirsFor({ HOME: "/home/me" }, "/home/me/a/b");

  assert.equal(dirs[0], "/home/me/a/b/.claude/agents");
  assert.equal(dirs[dirs.length - 1], "/home/me/.claude/agents");
});

// --- files the build itself will not load --------------------------------------

test("a file with no description is one the build refuses, not one in step", (t) => {
  // `ngr` returns null on a missing description: "Agent file ... is missing
  // required 'description' in frontmatter". Reporting it current was silence
  // over a file that never became an agent.
  const { agents, build } = tree(t);
  const path = join(agents, "Explore.md");
  writeFileSync(path, "---\nname: Explore\neffort: medium\n---\n\nprompt\n");
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "refused");
});

test("a description in quotes still counts as one", (t) => {
  const { agents, build } = tree(t);
  const path = join(agents, "Explore.md");
  writeFileSync(path, '---\nname: Explore\ndescription: What Explore is for.\ndescription: "Reads things."\neffort: medium\n---\n\nprompt\n');
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("an empty description is no description", (t) => {
  const { agents, build } = tree(t);
  const path = join(agents, "Plan.md");
  writeFileSync(path, "---\nname: Plan\ndescription:\neffort: medium\n---\n\nprompt\n");
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Plan"), "refused");
});

test("a refused file is named apart, since the move is to add a line", (t) => {
  const said = shadowLine("medium", [
    { type: "general-purpose", state: "refused", path: null },
    { type: "Explore", state: "current", path: null },
    { type: "Plan", state: "current", path: null },
  ]);

  assert.match(said, /general-purpose[^.]*description/);
});

test("a key with no space after the colon is not a key the build reads", (t) => {
  // YAML wants whitespace after the colon in a block mapping. Without it the
  // line is the plain scalar "effort:medium" and the build takes no effort at
  // all, so reporting the level as carried was the wrong direction entirely.
  const { agents, build } = tree(t);
  const path = join(agents, "Explore.md");
  writeFileSync(path, "---\nname: Explore\ndescription: Reads.\neffort:medium\n---\n\nprompt\n");
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "no-level");
});

// --- where the build looks that this did not ----------------------------------

test("a shadow in a subfolder of the agents directory is found", (t) => {
  // The build walks `.claude/agents` recursively for `*.md`, so a file kept in
  // a subfolder loads. Looking only at the top reported it absent.
  const { agents, build } = tree(t);
  mkdirSync(join(agents, "team"), { recursive: true });
  shadow(join(agents, "team"), "Explore");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("a file at the top wins over one in a subfolder of the same directory", (t) => {
  const { agents, build } = tree(t);
  mkdirSync(join(agents, "team"), { recursive: true });
  shadow(join(agents, "team"), "Explore", { effort: "high" });
  shadow(agents, "Explore", { effort: "medium" });

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("the home is matched past a trailing separator", () => {
  // A raw string compare let `HOME=/home/me/` miss `/home/me` and walk on to
  // the filesystem root.
  const dirs = agentDirsFor({ HOME: "/home/me/" }, "/home/me/work");

  assert.equal(dirs.includes("/.claude/agents"), false, dirs.join(" "));
  assert.equal(dirs[dirs.length - 1], "/home/me/agents".replace("/agents", "/.claude/agents"));
});

test("a working directory that is not an absolute path is not walked", () => {
  // A relative candidate would resolve against whatever directory this hook
  // process happens to be in, which is not the session's.
  assert.deepEqual(agentDirsFor({ HOME: "/home/me" }, "work/repo"), ["/home/me/.claude/agents"]);
  assert.deepEqual(agentDirsFor({ HOME: "/home/me" }, "C:\\Users\\me"), ["/home/me/.claude/agents"]);
});

// --- the key the build actually uses ------------------------------------------

/** A file at any name, carrying whatever frontmatter the case is about. */
function agentFile(dir, filename, frontmatter, at = AFTER) {
  const path = join(dir, filename);
  writeFileSync(path, `---\n${frontmatter}\n---\n\ncopied prompt\n`);
  utimesSync(path, at, at);
  return path;
}

test("a file named for a type but claiming another name shadows neither", (t) => {
  // The build keys an agent on its frontmatter `name:` and keeps the filename
  // only as a label. So this file becomes the agent `not-explore`, the
  // built-in Explore is untouched, and reporting Explore as in step was
  // silence over a setup that does nothing at all.
  const { agents, build } = tree(t);
  agentFile(agents, "Explore.md", "name: not-explore\ndescription: Something else.\neffort: medium");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "absent");
});

test("a file at any filename shadows the type its name claims", (t) => {
  const { agents, build } = tree(t);
  agentFile(agents, "my-plan.md", "name: Plan\ndescription: Plans things.\neffort: medium");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Plan"), "current");
});

test("a file with no name is no agent, whatever it is called", (t) => {
  const { agents, build } = tree(t);
  agentFile(agents, "Explore.md", "description: Reads things.\neffort: medium");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "absent");
});

test("a name in quotes is the name it quotes", (t) => {
  const { agents, build } = tree(t);
  agentFile(agents, "x.md", 'name: "Plan"\ndescription: Plans.\neffort: medium');

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Plan"), "current");
});

test("the first directory holding a name answers, whatever the files are called", (t) => {
  const { dir, agents, build } = tree(t);
  const project = join(dir, "project-agents");
  mkdirSync(project);
  agentFile(project, "a.md", "name: Explore\ndescription: Reads.\neffort: medium");
  agentFile(agents, "Explore.md", "name: Explore\ndescription: Reads.\neffort: high");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [project, agents], build }), "Explore"), "current");
});

// --- the levels the build takes -----------------------------------------------

test("med is medium, because the build's own alias table says so", (t) => {
  const { agents, build } = tree(t);
  agentFile(agents, "Explore.md", "name: Explore\ndescription: Reads.\neffort: med");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("a file naming no effort is one line short, not one line wrong", (t) => {
  // Two different moves again: add a line, or change one. The sentence said
  // "carries another level" about a file that carries none.
  const { agents, build } = tree(t);
  agentFile(agents, "Plan.md", "name: Plan\ndescription: Plans.");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Plan"), "no-level");
});

test("a file naming no effort is named apart in the sentence", () => {
  const said = shadowLine("medium", [
    { type: "general-purpose", state: "no-level", path: null },
    { type: "Explore", state: "other-level", path: null },
    { type: "Plan", state: "current", path: null },
  ]);

  assert.match(said, /general-purpose[^.]*no effort/);
  assert.match(said, /Explore[^.]*another level/);
});

test("a file written in the same moment as the build is not older than it", (t) => {
  // The comparison is strict, so a tie reads as current. An installer that
  // writes both inside one timestamp tick should not nag.
  const { agents, build } = tree(t);
  agentFile(agents, "Explore.md", "name: Explore\ndescription: Reads.\neffort: medium", BUILD_AT);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

// --- what the last round found ------------------------------------------------

test("a description continued on the next line is still a description", (t) => {
  // Plain YAML: a value may sit on the lines under its key. Reading the key's
  // own line alone saw an empty value and called the file one the build
  // refuses, which sends a reader to add a line that is already there.
  const { agents, build } = tree(t);
  agentFile(agents, "e.md", "name: Explore\ndescription:\n  Reads a lot of files and reports back.\neffort: medium");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("a block scalar description is a description", (t) => {
  const { agents, build } = tree(t);
  agentFile(agents, "e.md", "name: Explore\ndescription: |\n  Reads things.\neffort: medium");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("a description followed by another key at the same indent is still empty", (t) => {
  // The continuation has to be indented. A key at column zero ends the value,
  // so this file really has none and the build really does refuse it.
  const { agents, build } = tree(t);
  agentFile(agents, "e.md", "name: Explore\ndescription:\neffort: medium");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "refused");
});

test("the home directory is not walked as a project directory", () => {
  // The build breaks at the home directory before pushing it, so `~/.claude`
  // is reached only as the user directory. Walking into it put a stale file
  // there above the one CLAUDE_CONFIG_DIR points at.
  const dirs = agentDirsFor({ HOME: "/home/me", CLAUDE_CONFIG_DIR: "/home/me/custom" }, "/home/me/repo");

  assert.deepEqual(dirs, ["/home/me/repo/.claude/agents", "/home/me/custom/agents"]);
});

test("a session started in the home directory reads only the user's own", () => {
  assert.deepEqual(agentDirsFor({ HOME: "/home/me" }, "/home/me"), ["/home/me/.claude/agents"]);
});

test("the first description in a block wins, the way the name and the level do", (t) => {
  // All three keys are read first-wins, so a duplicate cannot turn a described
  // file into an undescribed one.
  const { agents, build } = tree(t);
  agentFile(agents, "e.md", "name: Explore\ndescription: Reads things.\ndescription:\neffort: medium");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

// --- cases that kill a mutant -------------------------------------------------

test("prose that merely mentions the keys is not an agent file", (t) => {
  // Without the opening fence check, any document saying `name:` in passing
  // becomes an agent definition.
  const { agents, build } = tree(t);
  const path = join(agents, "notes.md");
  writeFileSync(path, "Some notes.\n\nname: Explore\ndescription: not really\neffort: medium\n");
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "absent");
});

test("a name key with no space after the colon is not the name key", (t) => {
  const { agents, build } = tree(t);
  agentFile(agents, "e.md", "name:Explore\ndescription: Reads.\neffort: medium");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "absent");
});

test("a description key with no space after the colon is not the description key", (t) => {
  const { agents, build } = tree(t);
  agentFile(agents, "e.md", "name: Explore\ndescription:Reads.\neffort: medium");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "refused");
});

test("the level asked for is the level the sentence names", () => {
  // A sentence that hardcoded one level would still pass every other case.
  for (const level of ["low", "high", "xhigh", "max"]) {
    const said = shadowLine(level, seenAs(["absent", "absent", "absent"]));
    assert.match(said, new RegExp(`names ${level},`), level);
    assert.match(said, new RegExp(`effort: ${level}\``), level);
  }
});

test("a file whose name merely contains .md is not a markdown file", (t) => {
  const { agents, build } = tree(t);
  const path = join(agents, "Explore.md.bak");
  writeFileSync(path, "---\nname: Explore\ndescription: Reads.\neffort: medium\n---\nbody\n");
  utimesSync(path, AFTER, AFTER);

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "absent");
});

test("the first file to claim a name keeps it, later ones do not overwrite", (t) => {
  const { agents, build } = tree(t);
  agentFile(agents, "a-first.md", "name: Explore\ndescription: Reads.\neffort: medium");
  agentFile(agents, "z-second.md", "name: Explore\ndescription: Reads.\neffort: high");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "current");
});

test("a file the build refuses is reported as refused before its level is judged", (t) => {
  // The branches are ordered, and a reordering would report the level of a
  // file that never becomes an agent.
  const { agents, build } = tree(t);
  agentFile(agents, "e.md", "name: Explore\neffort: high");

  assert.equal(stateOf(shadowsFor({ level: "medium", dirs: [agents], build }), "Explore"), "refused");
});
