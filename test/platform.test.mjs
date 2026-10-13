import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AVOIDABLE, needsPathControl, needsShebang, needsTmpdirVariable } from "./platform.mjs";

const HERE = fileURLToPath(import.meta.url);

// The nested run below is this case's own fixture. A third level would prove
// nothing the second did not, so it is said rather than returned from silently.
const NESTED = process.env.ANATOMIYA_PLATFORM_NESTED
  ? { skip: "this run is the nested fixture of the case it would spawn" }
  : {};

test("a guard this run could have satisfied left nothing skipped", () => {
  assert.deepEqual(
    Object.fromEntries(AVOIDABLE),
    {},
    "these cases did not run, and the reason is this run's own configuration rather than the platform"
  );
});

// Spawned rather than reasoned about: the point is what a whole run reports, and
// a guard is read once at import, so only a second process can hold a different
// temp directory. The nested run is one level deep, and the marker keeps it so.
test("a temp directory too long for a socket fails the run rather than thinning it", { ...needsTmpdirVariable, ...NESTED }, () => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-platform-"));
  const long = join(dir, "d".repeat(80));
  mkdirSync(long, { recursive: true });
  try {
    const run = spawnSync(process.execPath, ["--test", HERE], {
      encoding: "utf8",
      env: {
        ...process.env,
        TMPDIR: long,
        ANATOMIYA_PLATFORM_NESTED: "1",
        NODE_TEST_CONTEXT: undefined,
      },
    });

    assert.equal(run.status, 1, `the nested run should have failed:\n${run.stdout}${run.stderr}`);
    assert.match(run.stdout, /needsBindableSocketPath/);
    assert.match(run.stdout, /TMPDIR/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The version is asked at import, by every test file that takes a guard from
// the module: a raw spawn error there named neither git nor the case it cost.
test("a run with no git, or one whose version cannot be read, says which guard that cost and why", { ...needsShebang, ...needsPathControl, ...NESTED }, () => {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-platform-git-"));
  const nested = (bin) =>
    spawnSync(process.execPath, ["--test", HERE], {
      encoding: "utf8",
      env: { ...process.env, PATH: bin, ANATOMIYA_PLATFORM_NESTED: "1", NODE_TEST_CONTEXT: undefined },
    });
  try {
    const none = join(dir, "none");
    mkdirSync(none);
    const absent = nested(none);
    assert.equal(absent.status, 1, absent.stdout + absent.stderr);
    assert.match(absent.stdout, /needsBatchZ/);
    assert.match(absent.stdout, /`git --version` could not be run \(ENOENT\)/);

    const odd = join(dir, "odd");
    mkdirSync(odd);
    writeFileSync(join(odd, "git"), "#!/bin/sh\necho 'git version unknown'\n", { mode: 0o755 });
    const unread = nested(`${odd}:/bin:/usr/bin`);
    assert.equal(unread.status, 1, unread.stdout + unread.stderr);
    assert.match(unread.stdout, /needsBatchZ/);
    assert.match(unread.stdout, /`git --version` answered "git version unknown", which names no version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
