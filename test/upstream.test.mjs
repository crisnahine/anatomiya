import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cached } from "../ultracode-anywhere/hooks/counters.mjs";
import { CALIBRATED_AGAINST, GATE_SHAPE, MARKERS, MIN_BUNDLE, behind, cliPath, conflictIn, drift, driftCached, settingsFor } from "../ultracode-anywhere/hooks/upstream.mjs";

/** What a build carries: the four names, and the gate the reminder is emitted under. */
const whole = () => `function Mae(e,t,r){return r===!0&&ZL()&&zZ(e,t)==="xhigh"}\n${MARKERS.join("\n")}`;

/** A tree standing in for an installed Claude Code and a user's config directory. */
function installed(t, { bundle = whole(), settings = null, project = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-upstream-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  mkdirSync(join(dir, "cli"), { recursive: true });
  const cli = join(dir, "cli", "cli.js");
  if (bundle !== null) {
    writeFileSync(cli, `#!/usr/bin/env node\n${bundle}\n`);
    // Padded to the size of a real build: anything smaller is a launcher, and
    // this check reads launchers as no evidence at all.
    if (bundle !== "") truncateSync(cli, MIN_BUNDLE + 1);
  }

  mkdirSync(join(dir, "config"), { recursive: true });
  if (settings) writeFileSync(join(dir, "config", "settings.json"), JSON.stringify(settings));

  if (project) {
    mkdirSync(join(dir, "repo", ".claude"), { recursive: true });
    writeFileSync(join(dir, "repo", ".claude", "settings.json"), JSON.stringify(project));
  }
  return { dir, cli, config: join(dir, "config"), repo: join(dir, "repo") };
}

// --- the settings this plugin has to agree with ------------------------------

test("the user's settings are read from the config directory Claude Code was told to use", (t) => {
  const tree = installed(t, { settings: { ultracode: true, effortLevel: "medium" } });

  assert.deepEqual(settingsFor({ CLAUDE_CONFIG_DIR: tree.config }), { ultracode: true, effortLevel: "medium" });
});

test("a project's own settings sit on top of the user's", (t) => {
  const tree = installed(t, { settings: { enableWorkflows: true, ultracode: false }, project: { ultracode: true } });

  const merged = settingsFor({ CLAUDE_CONFIG_DIR: tree.config }, tree.repo);

  assert.equal(merged.ultracode, true);
  assert.equal(merged.enableWorkflows, true);
});

test("settings that are missing or unreadable are an empty answer, not a throw", (t) => {
  const tree = installed(t);

  assert.deepEqual(settingsFor({ CLAUDE_CONFIG_DIR: tree.config }), {});
  assert.deepEqual(settingsFor({ CLAUDE_CONFIG_DIR: join(tree.dir, "nowhere") }), {});
  writeFileSync(join(tree.config, "settings.json"), "{not json");
  assert.deepEqual(settingsFor({ CLAUDE_CONFIG_DIR: tree.config }), {});
});

test("workflows switched off by disableWorkflows, or by the environment, leave no tool to point at", () => {
  // The build's own availability check answers false on
  // `CLAUDE_CODE_DISABLE_WORKFLOWS` or `"disableWorkflows": true` before it
  // reads `enableWorkflows` at all.
  assert.match(conflictIn({ disableWorkflows: true }, {}), /disableWorkflows/);
  assert.match(conflictIn({}, { CLAUDE_CODE_DISABLE_WORKFLOWS: "1" }), /CLAUDE_CODE_DISABLE_WORKFLOWS/);
  assert.match(conflictIn({}, { CLAUDE_CODE_DISABLE_WORKFLOWS: "true" }), /CLAUDE_CODE_DISABLE_WORKFLOWS/);
  assert.equal(conflictIn({ disableWorkflows: false }, { CLAUDE_CODE_DISABLE_WORKFLOWS: "" }), null);
});

test("CLAUDE_CODE_WORKFLOWS set to false is the same session with no tool", () => {
  assert.match(conflictIn({}, { CLAUDE_CODE_WORKFLOWS: "false" }), /CLAUDE_CODE_WORKFLOWS/);
  assert.equal(conflictIn({}, { CLAUDE_CODE_WORKFLOWS: "true" }), null);
});

test("the disable switches are named before CLAUDE_CODE_WORKFLOWS, the order the build reads them in", () => {
  assert.match(conflictIn({ disableWorkflows: true }, { CLAUDE_CODE_WORKFLOWS: "false" }), /disableWorkflows/);
});

test("a home that is named and empty is no home, for the settings and for the build alike", (t) => {
  // The counters module already reads `HOME=""` as no home. Read as one here,
  // it fell to the process's own home and read the real settings file.
  assert.deepEqual(settingsFor({ HOME: "", USERPROFILE: "" }), {});
  assert.equal(cliPath({ HOME: "", USERPROFILE: "", PATH: "" }), null);
});

// --- whether the thing this plugin mirrors is still there ---------------------

test("a build carrying every marker this plugin was calibrated against has not drifted", (t) => {
  const tree = installed(t);

  assert.deepEqual(drift({ cli: tree.cli }), { checked: true, missing: [], reason: null });
});

test("a build that dropped a marker says which one, so the plugin is not trusted in silence", (t) => {
  const tree = installed(t, { bundle: `${whole()}`.replace(MARKERS[0], "") });

  const answer = drift({ cli: tree.cli });

  assert.equal(answer.checked, true);
  assert.deepEqual(answer.missing, [MARKERS[0]]);
  assert.match(answer.reason, new RegExp(MARKERS[0]));
});

test("a build this check cannot find is reported as unchecked, not as drifted", (t) => {
  const tree = installed(t, { bundle: null });

  assert.deepEqual(drift({ cli: tree.cli }), { checked: false, missing: [], reason: null });
  assert.deepEqual(drift({ cli: null }), { checked: false, missing: [], reason: null });
});

test("the bundle is found from the command on PATH, and answers null when there is none", (t) => {
  const tree = installed(t);

  assert.equal(cliPath({ CLAUDE_CODE_EXECPATH: tree.cli }), realpathSync(tree.cli));
  assert.equal(cliPath({ CLAUDE_CODE_EXECPATH: join(tree.dir, "gone.js"), PATH: join(tree.dir, "empty"), HOME: tree.dir }), null);
});

// --- the canary, against whatever is installed here ---------------------------

test("the installed Claude Code still carries what this plugin mirrors", (t) => {
  // The one check that can catch upstream moving. It is a skip rather than a
  // failure where no build is installed, since a CI runner has none and a
  // missing build is not evidence either way.
  const cli = cliPath();
  if (!cli) return t.skip("no Claude Code build on this machine to read");

  const answer = drift({ cli });
  if (!answer.checked) return t.skip("the installed build could not be read");

  assert.deepEqual(answer.missing, [], `${answer.reason ?? ""} (read ${cli}, ${statSync(cli).size} bytes)`);
});

// --- the file on PATH is often not the build ---------------------------------

/** A file the size of a real bundle, which is the only thing worth reading markers out of. */
function bundle(path, body) {
  writeFileSync(path, body);
  truncateSync(path, MIN_BUNDLE + 1);
}

test("a launcher script on PATH is not read as the build", (t) => {
  // `npm test` puts node_modules/.bin first, and the `claude` there is a 1275
  // byte shim. Read as the build it carries none of the markers, and the check
  // reports a drift that has not happened, on every machine with a shim.
  const dir = mkdtempSync(join(tmpdir(), "ultracode-shim-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "claude"), "#!/bin/sh\nexec node /elsewhere/cli.js \"$@\"\n");

  assert.equal(cliPath({ PATH: bin, HOME: dir }), null, "a shim is not evidence of anything");
  assert.deepEqual(drift({ cli: cliPath({ PATH: bin, HOME: dir }) }), { checked: false, missing: [], reason: null });
  assert.deepEqual(drift({ cli: join(bin, "claude") }), { checked: false, missing: [], reason: null }, "and read directly it is no evidence either way");
});

test("the build a version-managed install keeps is found when only a shim is on PATH", (t) => {
  // Ordered by version rather than by timestamp: two files written in the same
  // millisecond are a tie, which a fast runner produces and a laptop does not,
  // and a rollback writes an old version with a new timestamp.
  const dir = mkdtempSync(join(tmpdir(), "ultracode-versions-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "claude"), "#!/bin/sh\nexec claude\n");
  const versions = join(dir, ".local", "share", "claude", "versions");
  mkdirSync(versions, { recursive: true });
  bundle(join(versions, "2.1.238"), whole());
  bundle(join(versions, "2.0.0"), `${whole()}`.replace(MARKERS[0], ""));
  const later = Date.now() / 1000 + 3600;
  utimesSync(join(versions, "2.0.0"), later, later);

  const found = cliPath({ PATH: bin, HOME: dir });

  assert.equal(found, realpathSync(join(versions, "2.1.238")), "the highest version is the one read");
  assert.deepEqual(drift({ cli: found }).missing, []);
});

test("a version directory holding names that are not versions still answers, oldest last", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-names-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const versions = join(dir, ".local", "share", "claude", "versions");
  mkdirSync(versions, { recursive: true });
  bundle(join(versions, "nightly"), whole());

  assert.equal(cliPath({ PATH: "", HOME: dir }), realpathSync(join(versions, "nightly")));
});

test("a build too small to be one is treated as no build, never as a drifted one", (t) => {
  // Kept as "checked", the memoiser would remember a launcher as a build that
  // is fine, under a key the launcher does not move.
  const tree = installed(t, { bundle: "" });

  assert.deepEqual(drift({ cli: tree.cli }), { checked: false, missing: [], reason: null });
});

// --- the build this was calibrated against ------------------------------------

test("the version this plugin was checked against is stated, and a newer one is said out loud", (t) => {
  assert.match(CALIBRATED_AGAINST, /^\d+\.\d+\.\d+$/);

  assert.equal(behind("2.1.238", "2.1.238"), null);
  assert.equal(behind("2.1.240", "2.1.238"), null, "a patch release is not worth a line");
  assert.match(behind("2.2.0", "2.1.238"), /2\.2\.0/);
  assert.match(behind("3.0.0", "2.1.238"), /3\.0\.0/);
  assert.equal(behind(null, "2.1.238"), null, "a version this cannot read is not a warning");
});

// --- what counts as evidence about the build ----------------------------------

test("the build is taken from the variable Claude Code actually sets", (t) => {
  // The name this once read, `CLAUDE_CODE_ENTRYPOINT_PATH`, appears nowhere in
  // the shipped build and is never set. `CLAUDE_CODE_EXECPATH` is, and it holds
  // the running build's own path.
  const tree = installed(t);

  assert.equal(cliPath({ CLAUDE_CODE_EXECPATH: tree.cli, PATH: "", HOME: tree.dir }), realpathSync(tree.cli));
});

test("a file called claude that is not a Claude Code build is no evidence, not a drift", (t) => {
  // Any 5 MB file earlier on PATH under that name was read as the build, and a
  // build carrying none of the four names is not a build that dropped them.
  const tree = installed(t, { bundle: "nothing this plugin depends on" });

  assert.deepEqual(drift({ cli: tree.cli }), { checked: false, missing: [], reason: null });
});

test("a build carrying some of the four and not others is the drift this looks for", (t) => {
  const tree = installed(t, { bundle: `${whole()}`.replace(MARKERS[0], "") });

  assert.deepEqual(drift({ cli: tree.cli }).missing, [MARKERS[0]]);
});

test("an answer nobody could read is not kept, so the next session asks again", (t) => {
  // Keeping only the reason collapsed "the build is fine" and "I could not read
  // the build" into the same null, and cached that under a key an unreadable
  // build does not move.
  const tree = installed(t, { bundle: `${whole()}`.replace(MARKERS[0], "") });
  const state = join(tree.dir, "state");

  assert.match(driftCached(tree.cli, state, cached), new RegExp(MARKERS[0]));
  assert.equal(driftCached(null, state, cached), null, "and no build to read is no answer to keep");

  assert.deepEqual(readdirSync(state), [".drift"]);
  assert.match(readFileSync(join(state, ".drift"), "utf8"), new RegExp(MARKERS[0]), "the answer kept is the one that was read");
});

test("a memoiser that knows nothing of this module still gets an answer", (t) => {
  // The refusal to keep an answer is this module's business, not the caller's.
  const tree = installed(t, { bundle: `${whole()}`.replace(MARKERS[0], "") });
  const plain = (dir, name, key, compute) => compute();

  assert.match(driftCached(tree.cli, "unused", plain), new RegExp(MARKERS[0]));
  assert.equal(driftCached(null, "unused", plain), null);
});

// --- the gate itself, now that the build can be read --------------------------

test("the predicate this plugin is built on is still in the build, shape and all", (t) => {
  // Better than a name: the gate is one readable function, and what matters is
  // that the xhigh term is a conjunct rather than something the reminder sets.
  const tree = installed(t, { bundle: whole() });

  assert.deepEqual(drift({ cli: tree.cli }).missing, []);
});

test("a build whose gate stopped requiring xhigh is a build this no longer describes", (t) => {
  const tree = installed(t, { bundle: `function Mae(e,t,r){return r===!0&&ZL()}\n${MARKERS.join("\n")}` });

  assert.deepEqual(drift({ cli: tree.cli }).missing, [GATE_SHAPE]);
});

test("the gate is found however a build spells true, quotes the string, or calls its helper", (t) => {
  // `r===!0`, `"xhigh"` and `ZL()` are one minifier's spelling. A spelling is
  // not a drift, and a drift reported on one nags every session or, under
  // strict, switches the plugin off on a build whose gate still holds.
  for (const gate of [
    `function Mae(e,t,r){return r===true&&ZL()&&zZ(e,t)==='xhigh'}`,
    `function Mae(e,t,r){return r===!0&&ZL(e)&&zZ(e,t)==="xhigh"}`,
    `function Mae(e,t,r){return r===!0&&ZL?.()&&zZ(e,t)==="xhigh"}`,
  ]) {
    const tree = installed(t, { bundle: `${gate}\n${MARKERS.join("\n")}` });
    assert.deepEqual(drift({ cli: tree.cli }).missing, [], gate);
  }
});

test("the installed build still carries that shape", (t) => {
  const cli = cliPath();
  if (!cli) return t.skip("no Claude Code build on this machine to read");

  const answer = drift({ cli });
  if (!answer.checked) return t.skip("the installed build could not be read");

  assert.deepEqual(answer.missing, [], answer.reason ?? "");
});
