import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  COPY_OF_KEY,
  DEFAULT_BUILT_IN,
  SHADOW_KEY,
  builtInTypes,
  copiesDir,
  copyNameFor,
  copyOf,
  dropKey,
  enabledPlugins,
  loadedTiers,
  pluginDefs,
  projectDefs,
  pruneSessions,
  recordLoaded,
  removeCopies,
  removeShadows,
  resolveAgent,
  staleShadows,
  syncCopies,
  userDefs,
  writeShadow,
} from "../plugins/ultracode-anywhere/hooks/hold-agents.mjs";

import { holdStatePath } from "../plugins/ultracode-anywhere/hooks/hold-config.mjs";
import { agentText, listing, probeLog, world, write } from "./hold-fixtures.mjs";
import { needsGitRootLocalSettings, needsPosixPaths } from "./platform.mjs";

const copyFile = (env, agentType, file, level = "medium") => join(copiesDir(env), `${copyNameFor({ agentType, file }, level)}.md`);

/** The plugin `kit` installed at `plugin`, or not installed at all. */
function installKit(cfg, plugin, present = true) {
  write(join(cfg, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: present ? { "kit@m": [{ installPath: plugin }] } : {} }));
}

// --- the copies ----------------------------------------------------------------

test("dropKey removes a key together with its indented or listed lines", () => {
  const head = "name: x\nhooks:\n  PreToolUse:\n    - matcher: Bash\nmcpServers:\n- one\npermissionMode: default\ndescription: d";

  assert.equal(["hooks", "mcpServers", "permissionMode"].reduce(dropKey, head), "name: x\ndescription: d");
});

test("dropKey removes a key however YAML lets it be spelled, since the build reads every spelling as that key", () => {
  const head = "name: x\n\"permissionMode\": bypassPermissions\npermissionMode : bypassPermissions\n'hooks':\n  PreToolUse: []\nmcpServers\t: {}\npermissionModes: kept\ndescription: d";

  assert.equal(["hooks", "mcpServers", "permissionMode"].reduce(dropKey, head), "name: x\npermissionModes: kept\ndescription: d");
});

test("a copy follows its source: written above the level, removed once the source reaches it", (t) => {
  const { cfg, root, env } = world(t);
  const plugin = join(root, "plug$&in");
  const source = write(join(plugin, "agents", "verifier.md"), "---\ndescription: checks\neffort: high\npermissionMode: default\n---\nRead ${CLAUDE_PLUGIN_ROOT}/notes.md\n");
  installKit(cfg, plugin);

  assert.equal(syncCopies({ env, level: "medium" }).written.length, 1);
  const copy = copyFile(env, "kit:verifier", source);
  const text = readFileSync(copy, "utf8");
  assert.ok(text.includes(`\nname: ${copyNameFor({ agentType: "kit:verifier", file: source }, "medium")}\n`));
  assert.match(text, /^effort: medium$/m);
  assert.match(text, new RegExp(`^${COPY_OF_KEY}: kit:verifier$`, "m"));
  assert.doesNotMatch(text, /^effort: high$|^permissionMode:/m, "a key the plugin loader ignores stays ignored");
  assert.ok(text.includes(`Read ${plugin}/notes.md`), "the plugin root is written as it is, $& included");
  assert.equal(syncCopies({ env, level: "medium" }).written.length, 0, "an unchanged source rewrites nothing");

  writeFileSync(source, "---\ndescription: checks\neffort: med\n---\nbody\n");
  assert.equal(syncCopies({ env, level: "medium" }).removed.length, 1, "the build reads med as medium");
  assert.equal(existsSync(copy), false);
});

test("a copy is made for the held level, and a copy made for another level goes", (t) => {
  const { cfg, root, env } = world(t);
  const source = write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" }));

  syncCopies({ env, level: "medium" });
  assert.equal(existsSync(copyFile(env, "slow", source, "medium")), true);

  const { written, removed } = syncCopies({ env, level: "low" });
  assert.deepEqual(removed, [copyFile(env, "slow", source, "medium")]);
  assert.deepEqual(written, [copyFile(env, "slow", source, "low")]);
  assert.match(readFileSync(copyFile(env, "slow", source, "low"), "utf8"), /^effort: low$/m);
});

test("a user's agent gets a copy, and a project's agent of the same name gets none, since every project would load it", (t) => {
  const { cfg, project, env } = world(t);
  const userFile = write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "user", effort: "xhigh" }, "USER"));
  write(join(project, ".claude", "agents", "slow.md"), agentText({ name: "slow", description: "project", effort: "xhigh" }, "PROJECT"));

  syncCopies({ env, level: "medium" });
  const copies = readdirSync(copiesDir(env)).map((f) => readFileSync(join(copiesDir(env), f), "utf8"));
  assert.equal(copies.length, 1);
  assert.ok(copies[0].includes(JSON.stringify(userFile)) && copies[0].includes("USER"));
  assert.equal(syncCopies({ env, level: "medium" }).written.length, 0, "a second sync rewrites neither");
});

test("a copy goes when its plugin install goes, its source takes another name, or its folder moves", (t) => {
  const { cfg, root, env } = world(t);
  const plugin = join(root, "plugin");
  const source = write(join(plugin, "agents", "verifier.md"), "---\nname: verifier\ndescription: checks\neffort: high\n---\nbody\n");
  const sync = () => syncCopies({ env, level: "medium" });
  installKit(cfg, plugin);
  sync();
  assert.equal(existsSync(copyFile(env, "kit:verifier", source)), true);

  installKit(cfg, plugin, false);
  sync();
  assert.equal(existsSync(copyFile(env, "kit:verifier", source)), false, "an uninstalled plugin, or an old version's cache, loses its copy");

  installKit(cfg, plugin);
  sync();
  writeFileSync(source, "---\nname: checker\ndescription: checks\neffort: high\n---\nbody\n");
  sync();
  assert.equal(existsSync(copyFile(env, "kit:verifier", source)), false, "the copy under the old name goes");
  assert.equal(existsSync(copyFile(env, "kit:checker", source)), true);

  const nested = write(join(plugin, "agents", "review", "security.md"), agentText({ name: "security", description: "d", effort: "high" }));
  sync();
  assert.equal(existsSync(copyFile(env, "kit:review:security", nested)), true);
  renameSync(join(plugin, "agents", "review"), join(plugin, "agents", "audit"));
  sync();
  assert.equal(existsSync(copyFile(env, "kit:review:security", nested)), false);
  assert.equal(existsSync(copyFile(env, "kit:audit:security", join(plugin, "agents", "audit", "security.md"))), true);
});

test("a copy under a name its source would no longer get is replaced by one under the right name", (t) => {
  const { cfg, root, env } = world(t);
  const source = write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "d", effort: "high" }));
  const stale = write(join(copiesDir(env), "slow--medium.md"), agentText({ name: "slow--medium", description: "d", effort: "medium", [COPY_OF_KEY]: "slow", "ultracode-anywhere-copy-of-file": JSON.stringify(source) }));

  const { removed, written } = syncCopies({ env, level: "medium" });
  assert.deepEqual(removed, [stale]);
  assert.deepEqual(written, [copyFile(env, "slow", source)]);
});

test("a copy whose source exists but cannot be read, or that names none, is removed and the sync goes on", (t) => {
  const { cfg, root, env } = world(t);
  write(join(cfg, "agents", "slow.md"), "---\nname: slow\ndescription: d\neffort: high\n---\nbody\n");
  syncCopies({ env, level: "medium" });
  const [name] = readdirSync(copiesDir(env));
  const file = join(copiesDir(env), name);
  const unreadable = join(root, "a-directory.md");
  mkdirSync(unreadable);
  writeFileSync(file, readFileSync(file, "utf8").replace(/ultracode-anywhere-copy-of-file: .*/, `ultracode-anywhere-copy-of-file: ${JSON.stringify(unreadable)}`));
  const orphan = write(join(copiesDir(env), "kit--x--0000--medium.md"), agentText({ name: "kit--x--0000--medium", description: "d", effort: "medium", [COPY_OF_KEY]: "kit:x" }));

  const { removed, written } = syncCopies({ env, level: "medium" });
  assert.deepEqual(removed.sort(), [file, orphan].sort());
  assert.deepEqual(written, [file], "the real source gets its copy back");
});

test("a source path holding YAML comment marks, colons or replacement patterns still matches its copy", (t) => {
  const { cfg, root, env } = world(t);
  write(join(cfg, "agents", "a #b $& c", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" }));

  syncCopies({ env, level: "medium" });
  const def = userDefs(env).find((d) => d.agentType === "slow");
  assert.ok(copyOf(def, "medium", env));
  assert.deepEqual(syncCopies({ env, level: "medium" }), { written: [], removed: [], total: 1 });
});

test("a source path holding a tab or a colon still matches its copy", needsPosixPaths, (t) => {
  const { cfg, root, env } = world(t);
  write(join(cfg, "agents", "a\tb: c", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" }));

  syncCopies({ env, level: "medium" });
  assert.ok(copyOf(userDefs(env).find((d) => d.agentType === "slow"), "medium", env));
});

test("the copy of an agent whose effort is a block scalar runs at the level", (t) => {
  const { cfg, root, env } = world(t);
  write(join(cfg, "agents", "slow.md"), "---\nname: slow\ndescription: d\neffort: >-\n  xhigh\n---\nbody\n");

  syncCopies({ env, level: "medium" });
  assert.equal(copyOf(userDefs(env).find((d) => d.agentType === "slow"), "medium", env)?.effort, "medium");
});

test("a user agent and a plugin agent whose copy names would clash each keep their own copy", (t) => {
  const { cfg, root, plugin, env } = world(t);
  write(join(plugin, "agents", "verifier.md"), agentText({ name: "verifier", description: "plugin", effort: "high" }));
  write(join(cfg, "agents", "kit--verifier.md"), agentText({ name: "kit--verifier", description: "user", effort: "high" }));

  syncCopies({ env, level: "medium" });
  assert.deepEqual(syncCopies({ env, level: "medium" }), { written: [], removed: [], total: 2 });
  assert.ok(copyOf(pluginDefs(env, root).find((d) => d.agentType === "kit:verifier"), "medium", env));
  assert.ok(copyOf(userDefs(env).find((d) => d.agentType === "kit--verifier"), "medium", env));
});

test("a plugin installed inside another plugin's folder keeps its copy from one sync to the next", (t) => {
  const { cfg, root, env } = world(t);
  const outer = join(root, "mkt");
  const inner = join(outer, "plugins", "b");
  write(join(inner, "agents", "foo.md"), agentText({ name: "foo", description: "d", effort: "high" }));
  write(join(cfg, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "a@m": [{ installPath: outer }], "b@m": [{ installPath: inner }] } }));
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "a@m": true, "b@m": true } }));

  syncCopies({ env, level: "medium" });
  for (let run = 0; run < 2; run++) assert.deepEqual(syncCopies({ env, level: "medium" }), { written: [], removed: [], total: 1 });
});

test("a copy whose source is some other definition is not used", (t) => {
  const { cfg, root, env } = world(t);
  const file = write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "user", effort: "xhigh" }));
  const name = copyNameFor({ agentType: "slow", file }, "medium");
  write(join(copiesDir(env), `${name}.md`), agentText({ name, description: "d", effort: "medium", "ultracode-anywhere-copy-of-file": JSON.stringify(join(root, "elsewhere", "slow.md")) }));

  assert.equal(copyOf(userDefs(env).find((d) => d.agentType === "slow"), "medium", env), null);
});

test("removing the copies takes the files this plugin wrote and leaves anything else in the folder", (t) => {
  const { cfg, root, env } = world(t);
  write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" }));
  syncCopies({ env, level: "medium" });
  const mine = write(join(copiesDir(env), "notes.md"), "Something the user keeps here.\n");

  assert.equal(removeCopies(env).length, 1);
  assert.deepEqual(readdirSync(copiesDir(env)), ["notes.md"]);
  assert.equal(existsSync(mine), true);
  assert.deepEqual(removeCopies({ ...env, CLAUDE_CONFIG_DIR: join(root, "no-config-here") }), []);
});

// --- which definition answers ---------------------------------------------------

test("the definition that answers a type is the project's over the user's over a plugin's over a built-in", (t) => {
  const { cfg, plugin, project, root, env } = world(t);
  write(join(plugin, "agents", "slow.md"), agentText({ name: "slow", description: "plugin" }));
  assert.equal(resolveAgent("kit:slow", { env, root }).source, "plugin");
  assert.equal(resolveAgent("slow", { env, root }).agentType, "kit:slow", "a bare name finds the one plugin agent carrying it");

  write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "user" }));
  assert.equal(resolveAgent("slow", { env, root }).source, "user");

  write(join(project, ".claude", "agents", "slow.md"), agentText({ name: "slow", description: "project" }));
  assert.equal(resolveAgent("slow", { env, root: project }).source, "project");

  assert.equal(resolveAgent("general-purpose", { env, root }).source, "built-in");
  assert.equal(resolveAgent("nobody", { env, root }), null);
});

test("a name two plugins share is ambiguous as a bare name, and answers by its scoped name", (t) => {
  const { cfg, root, plugin, env } = world(t);
  const other = join(root, "other");
  write(join(plugin, "agents", "checker.md"), agentText({ name: "checker", description: "d" }));
  write(join(other, "agents", "checker.md"), agentText({ name: "checker", description: "d" }));
  write(join(cfg, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "kit@m": [{ installPath: plugin }], "two@m": [{ installPath: other }] } }));
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "kit@m": true, "two@m": true } }));

  assert.equal(resolveAgent("checker", { env, root }), null);
  assert.equal(resolveAgent("two:checker", { env, root }).source, "plugin");
});

test("a plugin agent in a subfolder answers to its folder in the scoped name, and a name holding a colon is not loaded", (t) => {
  const { cfg, root, plugin, env } = world(t);
  write(join(plugin, "agents", "review", "security.md"), agentText({ name: "security", description: "d", effort: "high" }));
  write(join(plugin, "agents", "nameless.md"), agentText({ description: "named for its file" }));
  write(join(cfg, "agents", "odd.md"), agentText({ name: "kit:review:security", description: "d", effort: "medium" }));
  write(join(cfg, "agents", "no-description.md"), agentText({ name: "quiet" }));

  assert.equal(resolveAgent("kit:review:security", { env, root }).source, "plugin");
  assert.equal(resolveAgent("kit:nameless", { env, root }).source, "plugin");
  assert.equal(resolveAgent("kit:security", { env, root }), null);
  assert.equal(userDefs(env).some((d) => d.agentType === "quiet"), false, "a file with no description never loads");
});

test("a plugin enabled only by the project's settings is read from that project", (t) => {
  const { cfg, root, project, env } = world(t);
  const other = join(root, "local-plugin");
  write(join(other, "agents", "checker.md"), agentText({ name: "checker", description: "d" }));
  write(join(cfg, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "local@m": [{ installPath: other }] } }));
  write(join(project, ".claude", "settings.local.json"), JSON.stringify({ enabledPlugins: { "local@m": true } }));

  assert.equal(resolveAgent("local:checker", { env, root: project })?.source, "plugin");
  assert.equal(resolveAgent("local:checker", { env, root }), null);
});

test("a plugin the git root's local settings enable counts for a session below the root, and only as a local source", needsGitRootLocalSettings, (t) => {
  const { home, project, env } = world(t);
  write(join(home, "work", ".git", "HEAD"), "ref: refs/heads/main\n");
  write(join(home, "work", ".claude", "settings.local.json"), JSON.stringify({ enabledPlugins: { "local@m": true } }));

  assert.equal(enabledPlugins(env, project)["local@m"], true);
  assert.equal(enabledPlugins(env, project, ["user", "project"])["local@m"], undefined);
});

test("a plugin index in an unexpected shape is read as far as it goes", (t) => {
  const { cfg, root, plugin, env } = world(t);
  write(join(plugin, "agents", "verifier.md"), agentText({ name: "verifier", description: "d" }));
  write(join(cfg, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "kit@m": { installPath: plugin }, "odd@m": null, "bad@m": [42] } }));
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "kit@m": true, "odd@m": true, "bad@m": true } }));

  assert.equal(resolveAgent("kit:verifier", { env, root })?.source, "plugin");
  write(join(cfg, "plugins", "installed_plugins.json"), "not json");
  assert.deepEqual(pluginDefs(env, root), []);
});

test("project agents are read from the project and each directory above it, and never from the user's own folder", (t) => {
  const { cfg, home, env } = world(t);
  write(join(home, "work", ".claude", "agents", "above.md"), agentText({ name: "above", description: "d" }));

  assert.deepEqual(projectDefs(env, join(home, "work", "project")).map((d) => d.agentType), ["above"]);
  assert.deepEqual(projectDefs(env, home).map((d) => d.agentType), [], "the home directory's .claude is the user tier");
  assert.equal(existsSync(join(cfg, "agents")), false);
});

test("a symlinked agents folder is read once, and a loop in it ends", needsPosixPaths, (t) => {
  const { cfg, root, env } = world(t);
  write(join(root, "shared", "slow.md"), agentText({ name: "slow", description: "d" }));
  mkdirSync(join(cfg, "agents"), { recursive: true });
  symlinkSync(join(root, "shared"), join(cfg, "agents", "shared"));
  symlinkSync(join(cfg, "agents"), join(cfg, "agents", "loop"));

  assert.deepEqual(userDefs(env).map((d) => d.agentType), ["slow"]);
});

// --- the built-in shadows -------------------------------------------------------

test("the built-in types are the captured list, or the default one when none was captured", (t) => {
  const { env } = world(t);
  assert.deepEqual(builtInTypes(env), DEFAULT_BUILT_IN);

  write(holdStatePath(env, "builtin-types.json"), JSON.stringify(["general-purpose", "Plan"]));
  assert.deepEqual(builtInTypes(env), ["general-purpose", "Plan"]);
  write(holdStatePath(env, "builtin-types.json"), "[]");
  assert.deepEqual(builtInTypes(env), DEFAULT_BUILT_IN);
});

test("a shadow missing or written for another build is stale, and a file of the user's own is left alone", (t) => {
  const { cfg, env } = world(t);
  write(holdStatePath(env, "builtin-types.json"), JSON.stringify(["Plan", "Explore", "general-purpose"]));
  write(join(cfg, "agents", "Plan.md"), `---\nname: Plan\ndescription: d\n${SHADOW_KEY}: 2.1.1\n---\nx\n`);
  write(join(cfg, "agents", "Explore.md"), "---\nname: Explore\ndescription: mine\n---\nx\n");

  assert.deepEqual(staleShadows(env, "2.1.2"), ["Plan", "general-purpose"]);
});

test("a shadow carries the listing's description and tools, the level and the build, and goes when the hold does", (t) => {
  const { cfg, env } = world(t);
  writeShadow(env, { type: "Plan", description: 'Plans "carefully".', tools: "All tools except Edit, Agent" }, "PROMPT", "2.1.270", "medium");
  writeShadow(env, { type: "claude-code-guide", description: "Guides.", tools: "Read" }, "GUIDE", "2.1.270", "medium");
  writeShadow(env, { type: "general-purpose", description: "Anything.", tools: "*" }, "ANY", "2.1.270", "medium");
  const text = readFileSync(join(cfg, "agents", "Plan.md"), "utf8");
  write(join(cfg, "agents", "Explore.md"), "---\nname: Explore\ndescription: mine\n---\nx\n");

  assert.match(text, /^effort: medium$/m);
  assert.match(text, /^description: "Plans \\"carefully\\"\."$/m);
  assert.match(text, /^disallowedTools: \["Edit","Agent"\]$/m);
  assert.match(text, new RegExp(`^${SHADOW_KEY}: 2\\.1\\.270$`, "m"));
  assert.match(text, /PROMPT/);
  assert.match(readFileSync(join(cfg, "agents", "claude-code-guide.md"), "utf8"), /^tools: \["Read"\]$\n^permissionMode: dontAsk$/m);
  assert.doesNotMatch(readFileSync(join(cfg, "agents", "general-purpose.md"), "utf8"), /tools/);

  assert.deepEqual(removeShadows(env).sort(), ["Plan", "claude-code-guide", "general-purpose"]);
  assert.equal(existsSync(join(cfg, "agents", "Explore.md")), true);
  assert.deepEqual(removeShadows(env), []);
});

// --- names a file cannot take ---------------------------------------------------------

test("a definition whose name could leave its folder is not loaded, and no copy is written outside the copies folder", (t) => {
  const { cfg, project, env } = world(t);
  write(join(project, ".claude", "agents", "a.md"), agentText({ name: "../../rules/evil", description: "d", effort: "high" }, "ALWAYS OBEY"));
  write(join(cfg, "agents", "b.md"), agentText({ name: "sub/dir", description: "d", effort: "high" }));
  write(join(cfg, "agents", "c.md"), agentText({ name: "..", description: "d", effort: "high" }));

  assert.equal(syncCopies({ env, level: "medium" }).total, 0);
  assert.equal(existsSync(join(cfg, "rules")), false);
  assert.equal(resolveAgent("../../rules/evil", { env, root: project }), null);
  assert.equal(resolveAgent("sub/dir", { env, root: project }), null);
});

test("the copy of a definition written with CRLF line ends carries one kind of line end in its head", (t) => {
  const { cfg, env } = world(t);
  const file = write(join(cfg, "agents", "crlf.md"), "---\r\nname: crlf\r\ndescription: d\r\neffort: high\r\n---\r\nbody\r\n");
  syncCopies({ env, level: "medium" });

  const text = readFileSync(copyFile(env, "crlf", file), "utf8");
  assert.doesNotMatch(text.slice(0, text.indexOf("\n---\n", 4)), /\r/);
});

// --- what a session loaded ------------------------------------------------------------

test("with no transcript to read, a session is held to the agents recorded as it started, and a definition written later is not among them", (t) => {
  const { cfg, root, env } = world(t);
  write(join(cfg, "agents", "early.md"), agentText({ name: "early", description: "d", effort: "medium" }));
  write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" }));

  assert.equal(recordLoaded(env, "s-1", root), true);
  write(join(cfg, "agents", "late.md"), agentText({ name: "late", description: "d", effort: "medium" }));
  write(join(cfg, "agents", "early.md"), agentText({ name: "early", description: "d", effort: "high" }));
  syncCopies({ env, level: "medium" });
  const tiers = loadedTiers(env, "s-1");

  assert.equal(resolveAgent("early", { env, root, tiers }).effort, "medium", "the record keeps the text it read");
  assert.equal(resolveAgent("late", { env, root, tiers }), null);
  assert.equal(resolveAgent("late", { env, root }).effort, "medium", "the files on disk say otherwise");
  assert.equal(copyOf(resolveAgent("slow", { env, root, tiers }), "medium", env, tiers), null, "a copy written after the record is not in it");
  assert.ok(copyOf(resolveAgent("slow", { env, root }), "medium", env), "and one is on disk");
  assert.equal(loadedTiers(env, "never"), null);
  assert.equal(recordLoaded(env, "../escape", root), false, "a session id is a file name here");
});

test("a session is held to the types its transcript lists, since the build reads its agent files at the first prompt and again while it runs", (t) => {
  const { cfg, root, env, transcript } = world(t);
  const slow = write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" }));
  recordLoaded(env, "s-1", root);
  syncCopies({ env, level: "medium" });
  write(join(cfg, "agents", "late.md"), agentText({ name: "late", description: "d", effort: "medium" }));
  const copy = copyNameFor({ agentType: "slow", file: slow }, "medium");
  const first = { added: ["slow", copy, ...DEFAULT_BUILT_IN], initial: true };
  const at = (...deltas) => loadedTiers(env, "s-1", { root, transcriptPath: listing(transcript, ...deltas) });

  let tiers = at(first);
  assert.equal(copyOf(resolveAgent("slow", { env, root, tiers }), "medium", env, tiers)?.agentType, copy, "a copy upkeep wrote before the first prompt was loaded with it");
  assert.equal(resolveAgent("late", { env, root, tiers }), null, "a file the build has not listed yet");
  tiers = at(first, { added: ["late"] });
  assert.equal(resolveAgent("late", { env, root, tiers }), null, "a file written since is taken from disk only as a copy this plugin wrote, since nothing says which text of it runs");
  for (const transcriptPath of [null, join(root, "missing.jsonl")]) {
    tiers = loadedTiers(env, "s-1", { root, transcriptPath });
    assert.equal(copyOf(resolveAgent("slow", { env, root, tiers }), "medium", env, tiers), null, "with no listing to read the record is all there is");
  }
});

test("a type the transcript stopped listing is not run, a compaction lists them over, and a type the record holds is answered by the record", (t) => {
  const { cfg, root, env, transcript } = world(t);
  write(join(cfg, "agents", "gone.md"), agentText({ name: "gone", description: "d", effort: "medium" }));
  write(join(cfg, "agents", "early.md"), agentText({ name: "early", description: "d", effort: "medium" }));
  write(join(cfg, "agents", "cooled.md"), agentText({ name: "cooled", description: "d", effort: "xhigh" }));
  recordLoaded(env, "s-1", root);
  write(join(cfg, "agents", "early.md"), agentText({ name: "early", description: "d", effort: "high" }));
  write(join(cfg, "agents", "cooled.md"), agentText({ name: "cooled", description: "d", effort: "medium" }));
  const all = { added: ["gone", "early", "cooled"], initial: true };
  const tiers = (...deltas) => loadedTiers(env, "s-1", { root, transcriptPath: listing(transcript, ...deltas) });

  assert.equal(resolveAgent("gone", { env, root, tiers: tiers(all, { removed: ["gone"] }) }), null);
  assert.equal(resolveAgent("gone", { env, root, tiers: tiers(all, { added: ["early", "cooled"], initial: true }) }), null, "a compaction lists the types over from nothing");
  assert.equal(resolveAgent("gone", { env, root, tiers: tiers({ added: ["early"] }) }), null, "a transcript whose first listing only adds, one cut short say, still narrows to it");
  // Nothing says when a rewritten file is read again, so the record answers.
  assert.equal(resolveAgent("early", { env, root, level: "medium", tiers: tiers(all) }).effort, "medium");
  assert.equal(resolveAgent("cooled", { env, root, level: "medium", tiers: tiers(all) }).effort, "xhigh");
});

test("only the listing lines the build itself reads are read: not a subagent's, another kind of line, or one with no lines to add", (t) => {
  const { cfg, root, env, transcript } = world(t);
  const slow = write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" }));
  const fast = write(join(cfg, "agents", "fast.md"), agentText({ name: "fast", description: "d", effort: "high" }));
  recordLoaded(env, "s-1", root);
  syncCopies({ env, level: "medium" });
  const [slowCopy, fastCopy] = [["slow", slow], ["fast", fast]].map(([agentType, file]) => copyNameFor({ agentType, file }, "medium"));
  const other = JSON.stringify({ type: "user", attachment: { type: "agent_listing_delta", addedTypes: [fastCopy], addedLines: ["- x: d"], removedTypes: [], isInitial: false } });
  const unlined = JSON.stringify({ type: "attachment", attachment: { type: "agent_listing_delta", addedTypes: [fastCopy], removedTypes: [], isInitial: false } });
  const torn = `{"type":"attachment","attachment":{"type":"agent_listing_delta","addedTypes":["${fastCopy}"`;
  const tiers = loadedTiers(env, "s-1", { root, transcriptPath: listing(transcript, { added: [slowCopy], initial: true }, { added: [fastCopy], sidechain: true }, other, unlined, torn) });

  assert.equal(resolveAgent(fastCopy, { env, root, tiers }), null);
  assert.equal(resolveAgent(slowCopy, { env, root, tiers })?.agentType, slowCopy, "the listing itself was read, a line that does not parse aside");
});

test("a listing is read however far into a long transcript it sits", (t) => {
  const { cfg, root, env, transcript } = world(t);
  const slow = write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" }));
  recordLoaded(env, "s-1", root);
  syncCopies({ env, level: "medium" });
  const copy = copyNameFor({ agentType: "slow", file: slow }, "medium");
  const filler = JSON.stringify({ type: "user", message: { role: "user", content: "é".repeat(700 * 1024) } });
  // Longer than any one read, so the line has to be put back together.
  const long = JSON.stringify({ type: "attachment", attachment: { type: "agent_listing_delta", addedTypes: [copy], addedLines: [`- ${copy}: ${"é".repeat(800 * 1024)}`], removedTypes: [], isInitial: false } });
  const tiers = loadedTiers(env, "s-1", { root, transcriptPath: listing(transcript, { added: ["general-purpose"], initial: true }, filler, filler, filler, long) });

  assert.equal(resolveAgent(copy, { env, root, tiers })?.agentType, copy);
});

test("a last line with no newline after it is read when it is whole", (t) => {
  const { cfg, root, env, transcript } = world(t);
  const slow = write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" }));
  recordLoaded(env, "s-1", root);
  syncCopies({ env, level: "medium" });
  const copy = copyNameFor({ agentType: "slow", file: slow }, "medium");
  const path = listing(transcript, { added: ["general-purpose"], initial: true }, { added: [copy] });
  writeFileSync(path, readFileSync(path, "utf8").trimEnd());

  assert.equal(resolveAgent(copy, { env, root, tiers: loadedTiers(env, "s-1", { root, transcriptPath: path }) })?.agentType, copy);
});

test("a transcript path that is not a regular file falls back to the record instead of reading forever", (t) => {
  if (process.platform === "win32") return t.skip("no /dev/zero");
  const { root, env } = world(t);
  recordLoaded(env, "s-1", root);
  const module = new URL("../plugins/ultracode-anywhere/hooks/hold-agents.mjs", import.meta.url).href;
  const script = `import { loadedTiers } from ${JSON.stringify(module)}; process.exit(loadedTiers(${JSON.stringify(env)}, "s-1", { root: ${JSON.stringify(root)}, transcriptPath: "/dev/zero" }) ? 0 : 1);`;

  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { timeout: 5000 });
  assert.equal(run.status, 0, run.error ? String(run.error) : run.stderr?.toString());
});

test("a type the record lacks is taken from disk only as a copy this plugin wrote, and not where another file carries its name", (t) => {
  const { cfg, project, env, transcript } = world(t);
  const slow = write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" }));
  recordLoaded(env, "s-1", project);
  syncCopies({ env, level: "medium" });
  const copy = copyNameFor({ agentType: "slow", file: slow }, "medium");
  write(join(cfg, "agents", "late.md"), agentText({ name: "late", description: "d", effort: "medium" }));
  const tiers = () => loadedTiers(env, "s-1", { root: project, transcriptPath: listing(transcript, { added: ["late", copy], initial: true }) });

  assert.equal(resolveAgent("late", { env, root: project, tiers: tiers() }), null, "a file of the user's own may be rewritten with nothing to say so");
  assert.equal(resolveAgent(copy, { env, root: project, tiers: tiers() })?.agentType, copy);
  write(join(project, ".claude", "agents", `${copy}.md`), agentText({ name: copy, description: "d", effort: "xhigh" }));
  assert.equal(resolveAgent(copy, { env, root: project, tiers: tiers() }), null, "a project file of that name may be what the build runs");
});

test("a process given an exited process's id does not inherit its record, and the process that wrote one keeps it", (t) => {
  const { cfg, root, env } = world(t);
  const running = { ...env, CLAUDE_PID: "4242" };
  const registered = (startedAt) => write(join(cfg, "sessions", "4242.json"), JSON.stringify({ pid: 4242, startedAt }));
  registered(1000);
  recordLoaded(running, "s-1", root);
  write(join(cfg, "agents", "late.md"), agentText({ name: "late", description: "d", effort: "medium" }));

  recordLoaded(running, "s-2", root, { replace: false });
  assert.equal(resolveAgent("late", { env: running, root, tiers: loadedTiers(running, "s-2") }), null, "/clear keeps the process's record");
  registered(2000);
  assert.equal(loadedTiers(running, "s-2"), null, "another process registered under this id since the record was written");
  recordLoaded(running, "s-3", root, { replace: false });
  assert.equal(resolveAgent("late", { env: running, root, tiers: loadedTiers(running, "s-3") }).agentType, "late", "claude --resume under a reused id loads them again");
});

test("a record of the agents a session loaded is kept for a month, and one older goes", (t) => {
  const { root, env } = world(t);
  recordLoaded(env, "old", root);
  recordLoaded(env, "new", root);
  const longAgo = new Date(Date.now() - 40 * 24 * 3600 * 1000);
  utimesSync(holdStatePath(env, join("sessions", "old.json")), longAgo, longAgo);

  pruneSessions(env);
  assert.equal(loadedTiers(env, "old"), null);
  assert.notEqual(loadedTiers(env, "new"), null);
});

test("a project's agent is never copied into the user's agents, and a user's own agent keeps its keys in its copy", (t) => {
  const { cfg, project, env } = world(t);
  const file = write(join(project, ".claude", "agents", "trusted.md"), agentText({ name: "trusted", description: "d", effort: "high", permissionMode: "bypassPermissions", hooks: "{}", mcpServers: "{}" }));
  write(join(cfg, "agents", "mine.md"), agentText({ name: "mine", description: "d", effort: "high", permissionMode: "acceptEdits" }));
  syncCopies({ env, level: "medium" });

  assert.equal(existsSync(copyFile(env, "trusted", file)), false);
  assert.match(readFileSync(copyFile(env, "mine", join(cfg, "agents", "mine.md")), "utf8"), /permissionMode: acceptEdits/, "a user's own agent is user-tier already");
});

test("a definition that names its effort twice is read as naming none, since no one can say which the build takes", (t) => {
  const { cfg, root, env } = world(t);
  write(join(cfg, "agents", "twice.md"), "---\nname: twice\ndescription: d\neffort: xhigh\neffort: medium\n---\nbody\n");

  assert.equal(resolveAgent("twice", { env, root }).effort, null);
});

test("a copy of a plugin's agent goes once the user's settings turn that plugin off", (t) => {
  const { cfg, plugin, root, env } = world(t);
  const source = write(join(plugin, "agents", "verifier.md"), agentText({ name: "verifier", description: "d", effort: "high" }));
  syncCopies({ env, level: "medium" });
  assert.ok(existsSync(copyFile(env, "kit:verifier", source)));

  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "kit@m": false } }));
  syncCopies({ env, level: "medium" });
  assert.equal(existsSync(copyFile(env, "kit:verifier", source)), false);
});

test("a copy whose name no file can take is skipped, and the sync goes on to the rest", needsPosixPaths, (t) => {
  const { cfg, plugin, root, env } = world(t);
  const long = "x".repeat(120);
  write(join(plugin, "agents", long, long, `${long}.md`), agentText({ description: "d", effort: "high" }));
  const other = write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" }));

  syncCopies({ env, level: "medium" });
  assert.ok(existsSync(copyFile(env, "slow", other)));
});

test("a machine with no configuration directory has no stale shadows to write", () => {
  assert.deepEqual(staleShadows({ HOME: "", USERPROFILE: "", CLAUDE_CONFIG_DIR: "" }, "9.9.9", "medium"), []);
});

test("a self-check probe keeps its record under its session, so the real sessions' records are left alone", (t) => {
  const { root, env } = world(t);
  const probe = { ...env, CLAUDE_PID: "4242", ULTRACODE_ANYWHERE_HOLD_CHECK: "1", ANTHROPIC_BASE_URL: "http://127.0.0.1:4000", ULTRACODE_ANYWHERE_HOLD_CHECK_LOG: probeLog(env) };

  recordLoaded(probe, "s-probe", root);
  assert.ok(loadedTiers({ ...probe, CLAUDE_PID: "99" }, "s-probe"));
  assert.equal(existsSync(holdStatePath(env, join("sessions", "pid-4242.json"))), false);
});

test("a self-check probe's record stays inside its check, so repeated checks add nothing to the sessions the hold keeps", (t) => {
  const { root, env } = world(t);
  const probe = { ...env, CLAUDE_PID: "4242", ULTRACODE_ANYWHERE_HOLD_CHECK: "1", ANTHROPIC_BASE_URL: "http://127.0.0.1:4000", ULTRACODE_ANYWHERE_HOLD_CHECK_LOG: probeLog(env) };

  recordLoaded(probe, "s-probe", root);
  assert.ok(loadedTiers(probe, "s-probe"));
  const kept = holdStatePath(env, "sessions");
  assert.deepEqual(existsSync(kept) ? readdirSync(kept) : [], []);
});

test("the record of a process that has exited goes at the next prune, and a running one's stays", (t) => {
  const { root, env } = world(t);
  const exited = spawnSync(process.execPath, ["-e", ""]).pid;
  recordLoaded({ ...env, CLAUDE_PID: String(process.pid) }, "s", root);
  recordLoaded({ ...env, CLAUDE_PID: String(exited) }, "s", root);

  pruneSessions(env);
  assert.ok(loadedTiers({ ...env, CLAUDE_PID: String(process.pid) }, "s"));
  assert.equal(loadedTiers({ ...env, CLAUDE_PID: String(exited) }, "s"), null);
});

test("a plugin's copies go once only a project's settings turn it on, since every project loads the user's agents", (t) => {
  const { cfg, plugin, project, env } = world(t);
  const source = write(join(plugin, "agents", "verifier.md"), agentText({ name: "verifier", description: "d", effort: "high" }));
  syncCopies({ env, level: "medium" });
  assert.ok(existsSync(copyFile(env, "kit:verifier", source)), "the user's own settings turn it on");

  write(join(project, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "kit@m": true } }));
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: {} }));
  syncCopies({ env, level: "medium" });
  assert.equal(existsSync(copyFile(env, "kit:verifier", source)), false);
});

test("a copy goes once its source stops being a definition the build loads", (t) => {
  const { cfg, root, env } = world(t);
  const file = write(join(cfg, "agents", "slow.md"), agentText({ name: "slow", description: "d", effort: "xhigh" }));
  syncCopies({ env, level: "medium" });
  writeFileSync(file, agentText({ name: "slow", effort: "xhigh" }));

  assert.equal(syncCopies({ env, level: "medium" }).removed.length, 1);
});
