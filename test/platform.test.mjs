import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AVOIDABLE, needsTmpdirVariable } from "./platform.mjs";

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
