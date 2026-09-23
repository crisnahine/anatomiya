import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { MIN_BUNDLE, cliPath, settingsFor } from "../scripts/claude-build.mjs";

/** A home of the case's own, so the machine running this decides nothing. */
function elsewhere(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-claude-build-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A settings file under a config directory of the case's own. */
function configured(t, settings) {
  const dir = elsewhere(t);
  const config = join(dir, ".claude");
  mkdirSync(config);
  writeFileSync(join(config, "settings.json"), typeof settings === "string" ? settings : JSON.stringify(settings));
  return { dir, config };
}

test("the settings read are the ones Claude Code would read for this account", (t) => {
  const { config } = configured(t, { env: { CLAUDE_CODE_EFFORT_LEVEL: "high" } });

  assert.deepEqual(settingsFor({ CLAUDE_CONFIG_DIR: config }), { env: { CLAUDE_CODE_EFFORT_LEVEL: "high" } });
});

test("the config directory is the home's own where none is named", (t) => {
  const { dir } = configured(t, { ultracode: true });

  assert.deepEqual(settingsFor({ HOME: dir }), { ultracode: true });
});

test("settings that are not there, or are not a settings file, are no settings rather than a throw", (t) => {
  // A run refuses its own batch on what it finds here, so a file half-written
  // or replaced with a list has to read as nothing to say rather than as a
  // stack in place of the measurement.
  assert.deepEqual(settingsFor({ HOME: elsewhere(t) }), {});
  assert.deepEqual(settingsFor({ CLAUDE_CONFIG_DIR: join(elsewhere(t), "no-such-dir") }), {});
  assert.deepEqual(settingsFor({ HOME: configured(t, "{not json").dir }), {});
  assert.deepEqual(settingsFor({ HOME: configured(t, ["a"]).dir }), {});
  // A home named and empty is no home rather than the machine's own.
  assert.deepEqual(settingsFor({ HOME: "" }), {});
});

test("a launcher on PATH is not the build, whatever it is called", (t) => {
  // The `claude` on PATH is often a kilobyte of shell that runs the real one,
  // and `npm test` puts one first. Read as the build it carries none of the
  // strings a caller looks for, and every machine with one is told the build
  // dropped them.
  const dir = elsewhere(t);
  writeFileSync(join(dir, "claude"), "#!/bin/sh\nexec node /elsewhere/cli.js \"$@\"\n");

  assert.equal(cliPath({ PATH: dir, HOME: dir }), null);
});

test("a file on PATH over the floor is the build, answered behind its links", (t) => {
  // The answer is the real path, which is where a version-managed install keeps
  // the file: `os.tmpdir()` on macOS is reached through one, so a case comparing
  // the path it wrote would fail on the resolution rather than on the rule.
  const dir = elsewhere(t);
  const file = join(dir, "claude");
  writeFileSync(file, Buffer.alloc(MIN_BUNDLE + 1));

  assert.equal(cliPath({ PATH: [join(dir, "empty"), dir].join(delimiter), HOME: dir }), realpathSync(file));
});

/** A file big enough to pass the size floor, at `path`, with its parents made. */
function bundle(path) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, Buffer.alloc(MIN_BUNDLE + 1));
}

test("the build a version-managed install keeps is found when only a shim is on PATH", (t) => {
  // Ordered by version rather than by timestamp: two files written in the same
  // millisecond are a tie, which a fast runner produces and a laptop does not,
  // and a rollback writes an old version with a new timestamp. The older one is
  // backdated forward here, so a reader going by mtime answers it.
  const dir = elsewhere(t);
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "claude"), "#!/bin/sh\nexec claude\n");
  const versions = join(dir, ".local", "share", "claude", "versions");
  bundle(join(versions, "2.1.238"));
  bundle(join(versions, "2.0.0"));
  const later = Date.now() / 1000 + 3600;
  utimesSync(join(versions, "2.0.0"), later, later);

  assert.equal(cliPath({ PATH: bin, HOME: dir }), realpathSync(join(versions, "2.1.238")), "the highest version is the one read");
});

test("a version directory holding names that are not versions still answers, oldest last", (t) => {
  const dir = elsewhere(t);
  const versions = join(dir, ".local", "share", "claude", "versions");
  bundle(join(versions, "nightly"));

  assert.equal(cliPath({ PATH: "", HOME: dir }), realpathSync(join(versions, "nightly")));
});

test("a name that is a version is read before one that is not, whatever the clock says", (t) => {
  // The two halves of the comparator, in one case: a version beats a name that
  // is not one, and where neither is a version the newer file wins.
  const dir = elsewhere(t);
  const versions = join(dir, ".local", "share", "claude", "versions");
  bundle(join(versions, "nightly"));
  bundle(join(versions, "1.0.0"));
  const later = Date.now() / 1000 + 3600;
  utimesSync(join(versions, "nightly"), later, later);

  assert.equal(cliPath({ PATH: "", HOME: dir }), realpathSync(join(versions, "1.0.0")));
});

test("the build the running session names is read before anything on PATH", (t) => {
  const dir = elsewhere(t);
  const named = join(dir, "execpath");
  writeFileSync(named, Buffer.alloc(MIN_BUNDLE + 1));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), Buffer.alloc(MIN_BUNDLE + 1));

  assert.equal(cliPath({ CLAUDE_CODE_EXECPATH: named, PATH: bin, HOME: dir }), realpathSync(named));
});
