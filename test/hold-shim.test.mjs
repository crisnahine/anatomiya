import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { holdStatePath } from "../plugins/ultracode-anywhere/hooks/hold-config.mjs";
import { SHIM_HEAD_BYTES, SHIM_MARKER, realClaudeOn, runShim, shimPlan } from "../plugins/ultracode-anywhere/hooks/hold-shim.mjs";
import { hostEnv } from "./host-env.mjs";
import { world, write } from "./hold-fixtures.mjs";
import { needsGitRootLocalSettings, needsPosixPaths, needsShebang, needsUnreadableFiles } from "./platform.mjs";

const SHIM = fileURLToPath(new URL("../plugins/ultracode-anywhere/shim/claude", import.meta.url));
const NAME = process.platform === "win32" ? "claude.exe" : "claude";

/** A directory holding a stand-in for the real claude, which prints what it was started with. */
function fakeClaude(root, name = "real") {
  const dir = join(root, name);
  const file = write(join(dir, NAME), '#!/bin/sh\nprintf "%s\\n" "effort=$CLAUDE_CODE_EFFORT_LEVEL" "model=$ANTHROPIC_MODEL" "child=$ULTRACODE_ANYWHERE_HELD_CHILD" "$@"\n');
  chmodSync(file, 0o755);
  return dir;
}

/** A world with the shim's own directory and a real claude on PATH, in that order. */
function shimWorld(t) {
  const w = world(t);
  w.real = fakeClaude(w.root);
  w.env = { ...w.env, PATH: [join(SHIM, ".."), w.real].join(delimiter) };
  w.plan = (args, extra = {}) => shimPlan(args, { ...w.env, ...extra }, w.root);
  return w;
}

// --- finding the real claude -----------------------------------------------------

test("the real claude is the first on PATH that is a file and no copy of this shim", (t) => {
  const { root, real, env } = shimWorld(t);
  const decoy = join(root, "decoy");
  mkdirSync(join(decoy, NAME), { recursive: true });
  const copy = join(root, "copy");
  chmodSync(write(join(copy, NAME), `#!/usr/bin/env node\n// ${SHIM_MARKER}\n`), 0o755);

  assert.equal(realClaudeOn({ ...env, PATH: [decoy, copy, join(SHIM, ".."), real].join(delimiter) }), join(real, NAME));
  assert.equal(realClaudeOn({ ...env, PATH: [decoy, copy].join(delimiter) }), null);
  assert.equal(realClaudeOn({ ...env, PATH: "" }), null);
});

test("the shim carries its marker inside the bytes a lookup reads", () => {
  assert.ok(readFileSync(SHIM).subarray(0, SHIM_HEAD_BYTES).includes(SHIM_MARKER));
});

// --- the plan --------------------------------------------------------------------

test("a session is started on the held model at the held level, whatever it was given", (t) => {
  const { real, plan } = shimWorld(t);

  const { exec } = plan(["-p", "hi there", "--model", "haiku", "--effort=xhigh", "-m", "sonnet", "--fallback-model", "x", "--model=opus", "--verbose"]);
  assert.equal(exec.file, join(real, NAME));
  const held = JSON.stringify({ env: { ULTRACODE_ANYWHERE_HELD_CHILD: "1", CLAUDE_CODE_EFFORT_LEVEL: "medium", ANTHROPIC_MODEL: "claude-opus-5[1m]" } });
  assert.deepEqual(exec.args, ["--model", "claude-opus-5[1m]", "--effort", "medium", "--settings", held, "-p", "hi there", "-m", "sonnet", "--verbose"]);
  assert.equal(exec.env.CLAUDE_CODE_EFFORT_LEVEL, "medium");
  assert.equal(exec.env.ANTHROPIC_MODEL, "claude-opus-5[1m]");
  assert.equal(exec.env.ULTRACODE_ANYWHERE_HELD_CHILD, "1");
});

test("a subcommand that starts no session is passed through with its own arguments", (t) => {
  const { plan } = shimWorld(t);

  for (const sub of ["mcp", "plugin", "auth", "doctor", "update", "--version", "-v", "--help"]) {
    assert.deepEqual(plan([sub, "list", "--model", "x"]).exec.args, [sub, "list", "--model", "x"], sub);
  }
});

test("what would start a session nothing can hold, lift its effort, or drop its hooks is refused wherever it sits", (t) => {
  const { root, plan } = shimWorld(t);
  const loose = write(join(root, "loose.json"), '{"disableAllHooks": true}');
  const escaped = write(join(root, "escaped.json"), '{"\\u0065nv": {}}');
  const braced = write(join(root, "{braced}.json"), '{"disableAllHooks": true}');
  const refused = [
    ["--bare", "-p", "x"], ["--safe-mode"], ["--restricted"], ["--setting-sources", "project,local"], ["--setting-sources=local"],
    ["--settings", '{"env":{"CLAUDE_CODE_EFFORT_LEVEL":"high"}}'], ["--settings", '{"\\u0065nv":{}}'], ["--settings", loose], [`--settings=${loose}`], ["--settings", escaped],
    ["--settings", join(root, "not-a-file")], ["--settings"], ["--settings", braced], ["--settings", "{not json"],
    ["--settings", '{"enabledPlugins":{"ultracode-anywhere@m":false}}'], ["--settings", '{"agent":"heavy"}'], ["--settings", '{"allowManagedHooksOnly":true}'],
    ["--agents", '{"general-purpose":{"description":"d","prompt":"p","effort":"max"}}'],
    ["--settings", '{"hooks":{}}'], ["--settings", '{"modelSettings":{}}'], ["--settings", '{"model":"sonnet"}'], ["--settings", '{"effortLevel":"high"}'], ["--settings", '{"maxEffortLevel":"low"}'], ["--settings", '{"availableModels":["claude-haiku-4-5"]}'], ['--agents={}'], ["--agent", "heavy"], ["--agent=heavy"],
    ["--bg", "-p", "x"], ["--background"], ["agents"], ["respawn", "--all"], ["ultrareview"], ["--verbose", "ultrareview"], ["--debug-file", "/dev/null", "agents"],
    ["--cloud", "fix it"], ["--cloud=fix"], ["--remote", "fix it"], ["--remote=fix"], ["--environment", "ccpool_1"], ["--environment=ccpool_1"], ["self-hosted-runner"],
  ];
  for (const args of refused) {
    const decided = plan(args);
    assert.equal(decided.exec, undefined, args.join(" "));
    assert.match(decided.refuse, /^claude: /, args.join(" "));
    assert.equal(decided.status, 2, args.join(" "));
  }
  assert.ok(plan(["--setting-sources", "user,project", "--settings", '{"skipDangerousModePermissionPrompt":true}', "--remote-control", "-p", "x"]).exec);
});

test("a claude whose configuration does not enable this plugin is refused, since its spawns would run with no hold", (t) => {
  const { root, cfg, plan } = shimWorld(t);

  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "ultracode-anywhere@m": false } }));
  assert.match(plan(["-p", "x"]).refuse, /does not enable ultracode-anywhere/);
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: { "ultracode-anywhere@m": true } }));
  write(join(root, ".claude", "settings.local.json"), JSON.stringify({ enabledPlugins: { "ultracode-anywhere@m": false } }));
  assert.match(plan(["-p", "x"]).refuse, /does not enable ultracode-anywhere/, "a project's own settings can turn it off too");
  const other = join(root, "other-config");
  write(join(other, "settings.json"), "{}");
  assert.match(plan(["mcp", "list"], { CLAUDE_CONFIG_DIR: other }).exec.args[0], /mcp/, "a subcommand that starts no session is not asked");
});

test("a --settings file that exists and cannot be read is refused", needsUnreadableFiles, (t) => {
  const { root, plan } = shimWorld(t);
  const locked = write(join(root, "locked.json"), "{}");
  chmodSync(locked, 0o000);

  assert.match(plan(["--settings", locked]).refuse, /could not be read/);
});

test("nothing starts while the self-check holds a leak on this build, or while a required setting is missing", (t) => {
  const { env, plan } = shimWorld(t);
  write(holdStatePath(env, "verified.json"), JSON.stringify({ version: "9.9.9", leaks: ["built-in agent: a spawn ran at claude-opus-5/xhigh"] }));

  assert.match(plan(["-p", "x"], { AI_AGENT: "claude-code_9-9-9_agent" }).refuse, /xhigh/);
  assert.ok(plan(["-p", "x"], { AI_AGENT: "claude-code_9-9-10_agent" }).exec, "a leak on another build gates nothing here");
  assert.match(plan(["-p", "x"], { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "0" }).refuse, /CLAUDE_CODE_SUBAGENT_MODEL_FORCE/);
});

test("with the hold off in this environment the shim steps aside and starts claude as asked", (t) => {
  const { plan } = shimWorld(t);

  const { exec } = plan(["--model", "haiku", "--bare", "-p", "x"], { ULTRACODE_ANYWHERE_SPAWN_EFFORT: "" });
  assert.deepEqual(exec.args, ["--model", "haiku", "--bare", "-p", "x"]);
  assert.equal(exec.env.ULTRACODE_ANYWHERE_HELD_CHILD, undefined);
});

test("with no real claude on PATH the shim says so and starts nothing", (t) => {
  const { plan } = shimWorld(t);

  const decided = plan(["-p", "x"], { PATH: join(SHIM, "..") });
  assert.match(decided.refuse, /not found on PATH/);
  assert.equal(decided.status, 127);
});

// --- run end to end ----------------------------------------------------------------

test("run from a shell, the shim starts the real claude with the held model and level and passes its exit on", needsShebang, (t) => {
  const { env, root } = shimWorld(t);
  const run = (args, extra = {}) => spawnSync(process.execPath, [SHIM, ...args], { encoding: "utf8", env: { ...hostEnv(), ...env, ...extra }, cwd: root });

  const started = run(["-p", "hi", "--effort", "max"]);
  assert.equal(started.status, 0, started.stderr);
  const held = JSON.stringify({ env: { ULTRACODE_ANYWHERE_HELD_CHILD: "1", CLAUDE_CODE_EFFORT_LEVEL: "medium", ANTHROPIC_MODEL: "claude-opus-5[1m]" } });
  assert.deepEqual(started.stdout.trim().split("\n"), ["effort=medium", "model=claude-opus-5[1m]", "child=1", "--model", "claude-opus-5[1m]", "--effort", "medium", "--settings", held, "-p", "hi"]);

  const refused = run(["--bare"]);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /--bare turns off the hooks/);
  assert.equal(refused.stdout, "");

  const failing = fakeClaude(root, "failing");
  write(join(failing, NAME), "#!/bin/sh\nexit 7\n");
  assert.equal(run(["-p", "x"], { PATH: [join(SHIM, ".."), failing].join(delimiter) }).status, 7);
});

test("the shim's own run answers the status a refusal owes, and passes on the one the real claude exits with", needsShebang, (t) => {
  const w = shimWorld(t);
  const said = [];
  t.mock.method(process.stderr, "write", (text) => {
    said.push(String(text));
    return true;
  });

  assert.equal(runShim(["--bare"], w.env, w.root), 2);
  assert.match(said.join(""), /--bare turns off the hooks/);
  assert.equal(runShim(["-v"], { ...w.env, PATH: "" }, w.root), 127);
  chmodSync(write(join(w.real, NAME), "#!/bin/sh\nexit 3\n"), 0o755);
  assert.equal(runShim(["-p", "x"], w.env, w.root), 3);
});

test("a shim whose plugin files cannot load starts nothing and says so", () => {
  // A resolve hook that fails the one import stands in for a half-removed install, and runs the shim file itself.
  const hook = 'export async function resolve(specifier, context, next) { if (specifier.endsWith("hold-shim.mjs")) throw new Error("hold-shim.mjs is gone"); return next(specifier, context); }';
  const register = `import { register } from "node:module"; register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(hook)}`)});`;
  const run = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(register)}`, SHIM, "-p", "x"], { encoding: "utf8", env: hostEnv() });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /the ultracode-anywhere shim could not load, so nothing was started: .*hold-shim\.mjs is gone/);
});

test("a variable that turns the hooks off is refused like the flag it stands for", (t) => {
  const { plan } = shimWorld(t);

  assert.match(plan(["-p", "x"], { CLAUDE_CODE_SIMPLE: "1" }).refuse, /CLAUDE_CODE_SIMPLE turns off the hooks/);
  assert.match(plan(["-p", "x"], { CLAUDE_CODE_SAFE_MODE: "true" }).refuse, /CLAUDE_CODE_SAFE_MODE turns off the hooks/);
  assert.ok(plan(["-p", "x"], { CLAUDE_CODE_SIMPLE: "0", CLAUDE_CODE_SAFE_MODE: "" }).exec);
});

test("the plugin must be enabled in the settings sources the claude will read", (t) => {
  const { root, cfg, plan } = shimWorld(t);
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: {} }));
  write(join(root, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "ultracode-anywhere@m": true } }));

  assert.ok(plan(["-p", "x"]).exec, "enabled for this project");
  assert.match(plan(["--setting-sources", "user", "-p", "x"]).refuse, /does not enable ultracode-anywhere/);
  assert.ok(plan(["--setting-sources=user,project", "-p", "x"]).exec);
});

test("a --setting-sources list is quoted back with the blanks around its sources trimmed, and one carrying anything else is not", (t) => {
  const { plan } = shimWorld(t);

  assert.match(plan(["--setting-sources", "project,local", "-p", "x"]).refuse, /--setting-sources "project,local" leaves out the user settings/);
  assert.match(plan(["--setting-sources=project, local", "-p", "x"]).refuse, /--setting-sources "project,local" leaves out/);
  assert.match(plan(["--setting-sources", "project,$(id)", "-p", "x"]).refuse, /--setting-sources 13 characters this will not quote back/);
});

test("a --settings value is checked once and handed on as the text that was checked, with the child's own level held in it", (t) => {
  const { root, plan } = shimWorld(t);
  const file = write(join(root, "worker.json"), '{"skipDangerousModePermissionPrompt": true}');

  const { exec } = plan(["--settings", file, "-p", "x"]);
  const handed = exec.args.filter((_, at) => exec.args[at - 1] === "--settings").map((text) => JSON.parse(text));
  assert.deepEqual(handed, [{ skipDangerousModePermissionPrompt: true, env: { ULTRACODE_ANYWHERE_HELD_CHILD: "1", CLAUDE_CODE_EFFORT_LEVEL: "medium", ANTHROPIC_MODEL: "claude-opus-5[1m]" } }]);
  assert.equal(exec.args.includes(file), false, "the child never reads the path a second time");
});

test("everything after -- is the prompt's, passed on as it is", (t) => {
  const { plan } = shimWorld(t);

  assert.deepEqual(plan(["-p", "--", "--bare", "--model", "x"]).exec.args.slice(-4), ["--", "--bare", "--model", "x"]);
});

test("on Windows a launcher script is named where no claude.exe is on PATH, since a script needs a shell the shim will not hand a prompt to", (t) => {
  const { root, env } = shimWorld(t);
  const npm = join(root, "npm");
  write(join(npm, "claude.cmd"), "@echo off\n");

  const decided = shimPlan(["-p", "x"], { ...env, PATH: [join(SHIM, ".."), npm].join(delimiter) }, root, "win32");
  assert.match(decided.refuse, /claude\.cmd is a launcher script/);
  assert.equal(decided.status, 126);
  assert.equal(shimPlan(["-p", "x"], { ...env, PATH: join(SHIM, "..") }, root, "win32").status, 127, "with nothing at all it is still not found");
});

test("a claude started in a subdirectory is checked against the session's project, which the exports name", (t) => {
  const { project, env } = shimWorld(t);
  write(join(project, ".claude", "settings.json"), JSON.stringify({ env: { ULTRACODE_ANYWHERE_STATE: join(project, "st") } }));
  const sub = join(project, "src");
  mkdirSync(sub, { recursive: true });

  assert.match(shimPlan(["-p", "x"], { ...env, ULTRACODE_ANYWHERE_PROJECT_DIR: project }, sub).refuse ?? "", /a project's settings set ULTRACODE_ANYWHERE_STATE/);
});

test("a claude is checked against the plugins its own directory's settings enable, with a git repository's local settings read at its root", needsGitRootLocalSettings, (t) => {
  // Measured: a claude started below a project reads .claude/settings.json in its own directory, and settings.local.json at the git root.
  const { cfg, project, env } = shimWorld(t);
  const sub = join(project, "src");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(sub, { recursive: true });
  const at = { ...env, ULTRACODE_ANYWHERE_PROJECT_DIR: project };

  write(join(project, ".claude", "settings.local.json"), JSON.stringify({ enabledPlugins: { "ultracode-anywhere@m": false } }));
  assert.match(shimPlan(["-p", "x"], at, sub).refuse ?? "", /does not enable ultracode-anywhere/, "the git root's local settings reach a claude started below it");
  write(join(project, ".claude", "settings.local.json"), "{}");
  write(join(cfg, "settings.json"), JSON.stringify({ enabledPlugins: {} }));
  write(join(project, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "ultracode-anywhere@m": true } }));
  assert.match(shimPlan(["-p", "x"], at, sub).refuse ?? "", /does not enable ultracode-anywhere/, "the project settings above it do not");
  write(join(sub, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "ultracode-anywhere@m": true } }));
  assert.ok(shimPlan(["-p", "x"], at, sub).exec);
});

test("a CLAUDE_PROJECT_DIR that a project's settings put in the shell does not move the project the shim checks", (t) => {
  const { root, project, env } = shimWorld(t);
  const elsewhere = join(root, "elsewhere");
  mkdirSync(elsewhere, { recursive: true });
  write(join(project, ".claude", "settings.json"), JSON.stringify({ env: { CLAUDE_PROJECT_DIR: elsewhere } }));
  const sub = join(project, "src");
  mkdirSync(sub, { recursive: true });

  const decided = shimPlan(["-p", "x"], { ...env, ULTRACODE_ANYWHERE_PROJECT_DIR: project, CLAUDE_PROJECT_DIR: elsewhere }, sub);
  assert.match(decided.refuse ?? "", /a project's settings set CLAUDE_PROJECT_DIR/);
});
