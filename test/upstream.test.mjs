import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cached } from "../ultracode-anywhere/hooks/counters.mjs";
import { CALIBRATED_AGAINST, MARKERS, MIN_BUNDLE, behind, cliPath, drift, driftCached, settingsFor } from "../ultracode-anywhere/hooks/upstream.mjs";

/** A tree standing in for an installed Claude Code and a user's config directory. */
function installed(t, { bundle = MARKERS.join("\n"), settings = null, project = null } = {}) {
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

// --- whether the thing this plugin mirrors is still there ---------------------

test("a build carrying every marker this plugin was calibrated against has not drifted", (t) => {
  const tree = installed(t);

  assert.deepEqual(drift({ cli: tree.cli }), { checked: true, missing: [], reason: null });
});

test("a build that dropped a marker says which one, so the plugin is not trusted in silence", (t) => {
  const tree = installed(t, { bundle: MARKERS.slice(1).join("\n") });

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
  assert.deepEqual(drift({ cli: join(bin, "claude") }), { checked: true, missing: [], reason: null }, "and read directly it is still not a drift");
});

test("the build a version-managed install keeps is found when only a shim is on PATH", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-versions-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "claude"), "#!/bin/sh\nexec claude\n");
  const versions = join(dir, ".local", "share", "claude", "versions");
  mkdirSync(versions, { recursive: true });
  bundle(join(versions, "2.0.0"), MARKERS.slice(1).join("\n"));
  bundle(join(versions, "2.1.238"), MARKERS.join("\n"));

  const found = cliPath({ PATH: bin, HOME: dir });

  assert.equal(found, realpathSync(join(versions, "2.1.238")), "the newest build is the one running");
  assert.deepEqual(drift({ cli: found }).missing, []);
});

test("a build too small to be one is treated as no build, never as a drifted one", (t) => {
  const tree = installed(t, { bundle: "" });

  assert.deepEqual(drift({ cli: tree.cli }), { checked: true, missing: [], reason: null });
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
  // `CLAUDE_CODE_EXECPATH` appears nowhere in the shipped build and is
  // never set; `CLAUDE_CODE_EXECPATH` is set to the running build's own path.
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
  const tree = installed(t, { bundle: MARKERS.slice(1).join("\n") });

  assert.deepEqual(drift({ cli: tree.cli }).missing, [MARKERS[0]]);
});

test("an answer nobody could read is not kept, so the next session asks again", (t) => {
  // Keeping only the reason collapsed "the build is fine" and "I could not read
  // the build" into the same null, and cached that under a key an unreadable
  // build does not move.
  const tree = installed(t, { bundle: MARKERS.slice(1).join("\n") });
  const state = join(tree.dir, "state");

  assert.match(driftCached(tree.cli, state, cached), new RegExp(MARKERS[0]));
  assert.equal(driftCached(null, state, cached), null, "and no build to read is no answer to keep");

  assert.deepEqual(readdirSync(state), [".drift"]);
  assert.match(readFileSync(join(state, ".drift"), "utf8"), new RegExp(MARKERS[0]), "the answer kept is the one that was read");
});
