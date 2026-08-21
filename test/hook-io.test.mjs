import { test } from "node:test";
import assert from "node:assert/strict";

import { closeSync, mkdtempSync, openSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { needsPosixSpecialFiles, needsSymlinks } from "./platform.mjs";
import { parsePayload, readIfFile, readOwnFile, readStdin, respond } from "../ultracode-anywhere/hooks/hook-io.mjs";

/** What `respond` wrote, with stdout captured for the length of one call. */
function said(event, context) {
  const written = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  try {
    respond(event, context);
  } finally {
    process.stdout.write = write;
  }
  return written.join("");
}

test("a payload that will not parse reads as an empty one rather than throwing", () => {
  assert.deepEqual(parsePayload("{not json"), {});
  assert.deepEqual(parsePayload(""), {});
  assert.deepEqual(parsePayload("null"), {}, "a payload that parses to nothing is nothing");
  assert.deepEqual(parsePayload("[1,2]"), [1, 2], "an array is an object, and reads no fields");
  assert.deepEqual(parsePayload('{"cwd":"/repo"}'), { cwd: "/repo" });
});

test("one object on stdout, named for its event, with the text escaped as JSON", () => {
  const out = said("SessionStart", 'a "quoted" line\nand another');

  assert.equal(out.endsWith("\n"), true);
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
  assert.equal(parsed.hookSpecificOutput.additionalContext, 'a "quoted" line\nand another');
});

test("nothing to say is nothing written, not an empty object", () => {
  assert.equal(said("UserPromptSubmit", null), "");
  assert.equal(said("UserPromptSubmit", undefined), "");
  assert.notEqual(said("UserPromptSubmit", ""), "", "an empty string is still an answer");
});

// --- reads that have to end ---------------------------------------------------

test("a payload longer than a megabyte is cut rather than held in memory whole", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-io-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "big");
  writeFileSync(path, "x".repeat(3 * 1024 * 1024));
  const fd = openSync(path, "r");
  t.after(() => closeSync(fd));

  assert.equal(readStdin(fd).length, 1024 * 1024);
});

test("stdin that never ends is not waited on for longer than a turn", needsPosixSpecialFiles, (t) => {
  // A device on stdin returns for as long as it is willing to talk, and a
  // hook that reads it whole is a prompt held to its timeout.
  const dir = mkdtempSync(join(tmpdir(), "ultracode-io-dev-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fd = openSync("/dev/zero", "r");
  t.after(() => closeSync(fd));

  const started = Date.now();
  const said = readStdin(fd);

  assert.equal(said.length <= 1024 * 1024, true);
  assert.equal(Date.now() - started < 3000, true, "and it stops rather than reading on");
});

test("a file this cannot read is an empty answer, whatever the reason", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-io-read-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.equal(readIfFile(join(dir, "absent")), "");
  assert.equal(readIfFile(dir), "", "a directory is not a file to read");
  writeFileSync(join(dir, "big"), "x".repeat(200));
  assert.equal(readIfFile(join(dir, "big"), 100), "", "and one larger than the caller allows is not read at all");
  assert.equal(readIfFile(join(dir, "big"), 4096).length, 200);
});

test("a path swapped for something that blocks between the check and the read is still not read", needsPosixSpecialFiles, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ultracode-io-fifo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("mkfifo", [join(dir, "pipe")]);

  const started = Date.now();
  assert.equal(readIfFile(join(dir, "pipe")), "");
  assert.equal(Date.now() - started < 3000, true);
});

test("a settings file a user symlinked into place is still read", needsSymlinks, (t) => {
  // Dotfiles repositories put `~/.claude/settings.json` behind a link, so the
  // read this plugin does of somebody else's file follows one. The read of its
  // own state does not.
  const dir = mkdtempSync(join(tmpdir(), "ultracode-io-link-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "real.json"), '{"ultracode":true}');
  symlinkSync(join(dir, "real.json"), join(dir, "settings.json"));

  assert.equal(readIfFile(join(dir, "settings.json")), '{"ultracode":true}');
  assert.equal(readOwnFile(join(dir, "settings.json")), "", "a file this plugin owns may not be a link");
});
