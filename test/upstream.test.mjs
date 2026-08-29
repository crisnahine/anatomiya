import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { REL, ROOT } from "../scripts/plugins.mjs";
import { cached } from "../plugins/ultracode-anywhere/hooks/counters.mjs";
import { CALIBRATED_AGAINST, GATE_SHAPE, MARKERS, MIN_BUNDLE, behind, cliPath, conflictIn, drift, driftCached, settingsFor } from "../plugins/ultracode-anywhere/hooks/upstream.mjs";

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

test("the line about the ultracode key names the flag that beats it, since that session gets nothing", () => {
  // Measured on the wire: `"ultracode": true` does resolve effort to xhigh over
  // `effortLevel`, so the built-in fires and a second copy would be noise. A
  // `--effort` or `/effort` below xhigh wins over both, and then the gate does
  // not hold, the built-in stays silent, and this hook has already gone quiet on
  // the key. That session gets no reminder from either side, and the only place
  // it can be told so is the line that says why this one is quiet.
  const said = conflictIn({ ultracode: true }, {});

  assert.match(said, /"ultracode": true/);
  assert.match(said, /effortLevel/, "the key beats the setting");
  assert.match(said, /--effort|\/effort/, "and names what beats the key");
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

test("the installed Claude Code still carries the sentence A42's convention half defers to", (t) => {
  // A42 argues the convention half adds delivery and not wording, because the
  // harness already asks for the wording. A build that stops asking, or one
  // that starts asking for this line's own job, moves that argument. A skip
  // where no build is installed: a missing build is not evidence either way.
  const cli = cliPath();
  if (!cli) return t.skip("no Claude Code build on this machine to read");

  const body = readFileSync(cli, "latin1");
  if (body.length < MIN_BUNDLE) return t.skip("the installed build could not be read");

  assert.ok(
    body.includes("reads like the surrounding code"),
    `no surrounding-code sentence in ${cli}; re-read DECISIONS A42, whose convention half defers to it`
  );
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

/**
 * The files that describe the premise as it stands: what ships, and what a user
 * reads. Not the ones that record what it once was, since a changelog entry or
 * a contract row naming an older build is a fact about that moment. Not this
 * suite either: a case that orders two version directories needs two version
 * names, and neither is a claim about the installed build.
 *
 * A changelog's `[Unreleased]` section is the one part of a record that is not
 * history yet, so a second re-calibration before a release can leave a build
 * standing there with nothing to catch it. The release checklist is what covers
 * that, since a case here cannot tell one section of a file from another.
 */
function describesThePremise() {
  const hooks = join(ROOT, REL.ultracode, "hooks");
  // Every file under `hooks/`, rather than the `.mjs` ones: a hook added under
  // another extension or a directory down is still shipped, and a set that
  // names extensions leaves it uncovered without saying so.
  return [
    ...readdirSync(hooks, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join("hooks", relative(hooks, join(entry.parentPath, entry.name)))),
    "README.md",
    "VERIFYING.md",
  ];
}

/** The plugin's own version, which is not a claim about any Claude Code build. */
function ownVersion() {
  return JSON.parse(readFileSync(join(ROOT, REL.ultracode, ".claude-plugin", "plugin.json"), "utf8")).version;
}

/**
 * Every Claude Code build a file names.
 *
 * Three numbers, outside a link, with a non-zero major, no digit, dot, `^` or
 * `~` in front, and neither a digit nor a dotted digit behind. So a
 * version that ends a sentence still counts, which is how prose writes one and
 * how the rot that prompted this case would have been written next time, while
 * `127.0.0.1`, `^0.90.1`, the `v2.0.0` in a specification's URL and this
 * plugin's own `0.x` are not read as builds.
 *
 * Anything else shaped like a version still counts, a Node floor written
 * `22.12.0` included. That is the trade: the case fails loudly and names the
 * string, and whoever meets it either writes the number some other way or
 * widens this. Narrowing it to the calibrated major and minor was tried and
 * dropped: it would stop catching a build left behind by a minor bump, which is
 * the release where most of this prose gets rewritten.
 */
function buildsNamed(text) {
  return [...text.replace(/https?:\/\/\S+/g, " ").matchAll(/(?<![\d.^~])[1-9]\d*\.\d+\.\d+(?!\.?\d)/g)].map((found) => found[0]);
}

test("every build the code and the current docs name is the one the constant names", () => {
  // The premise is one build's behaviour and the prose says which build, so the
  // two rot apart the moment a person moves one and not the other. Left to a
  // person it happened: `VERIFYING.md` named a build nobody had worked the list
  // against, and no case here could tell.
  const mine = ownVersion();
  const named = describesThePremise().flatMap((rel) =>
    buildsNamed(readFileSync(join(ROOT, REL.ultracode, rel), "utf8"))
      .filter((version) => version !== CALIBRATED_AGAINST && version !== mine)
      .map((version) => `${rel} names ${version}`));

  assert.deepEqual(named, [], `every one of these should be ${CALIBRATED_AGAINST}, the build the list was worked against`);
});

test("the version this plugin was checked against is stated, and a newer one is said out loud", (t) => {
  assert.match(CALIBRATED_AGAINST, /^\d+\.\d+\.\d+$/);

  assert.equal(behind("2.1.238", "2.1.238"), null);
  assert.equal(behind("2.1.240", "2.1.238"), null, "a patch release is not worth a line");
  assert.match(behind("2.2.0", "2.1.238"), /2\.2\.0/);
  assert.match(behind("3.0.0", "2.1.238"), /3\.0\.0/);
  assert.equal(behind(null, "2.1.238"), null, "a version this cannot read is not a warning");
});

test("a run of patch releases eventually says so, since nothing else here can", () => {
  // The rot this exists for happened inside patch bumps: the constant said one
  // build, the machine ran another three patches on, and no session was told.
  // One patch is noise and a run of them is a fact, so the line waits for the
  // run. CI never sees it either, since a runner has no Claude Code to read.
  assert.equal(behind("2.1.247", "2.1.238"), null, "nine patches on is still inside the quiet band");

  const far = behind("2.1.248", "2.1.238");
  assert.match(far, /2\.1\.248/, "and the tenth says which build is running");
  assert.match(far, /2\.1\.238/, "and which one was checked");

  assert.equal(behind("2.1.238", "2.1.248"), null, "a build older than the calibrated one is not a drift");
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
    // Every name in it moved between the build this was first read off and the
    // one it is calibrated against now, and then moved again. The shape did not,
    // which is the whole reason the check reads a shape. Each build's own
    // spelling is kept so the next respelling has something to be compared to.
    `function Ale(e,t,r){return r===!0&&gH()&&kQ(e,t)==="xhigh"}`,
    `function Wv(e,o,t){return t===!0&&Zu()&&yT(e,o)==="xhigh"}`,
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
