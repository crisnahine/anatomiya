import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePayload, respond } from "../ultracode-anywhere/hooks/hook-io.mjs";

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
