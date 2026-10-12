import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { atomic, putBack, replaceAll, stagedPath, writeTemp } from "../plugins/anatomiya/lib/store.mjs";
import { stagedBy } from "../plugins/anatomiya/lib/rules.mjs";
import { TARGETS, areaName, overviewName } from "../plugins/anatomiya/lib/targets.mjs";

/**
 * The store's file mechanics: a file replaced whole or not at all, and the
 * name it is staged under, which a later scan reads back to know whose it is.
 */
function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("the replace never writes through a link planted where its temporary file goes", () => {
  // The directories are resolved (F2), and the temporary name beside the
  // destination was not: it was `<path>.tmp-<pid>`, predictable, and opened
  // with a plain write that follows a link. A repository shipping that name as
  // a tracked symlink had the scan write the map's bytes wherever it pointed.
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-atomic-"));
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-atomic-outside-"));
  try {
    const victim = join(outside, "victim.txt");
    writeFileSync(victim, "untouched\n");
    const target = join(dir, "facts.json");
    symlinkSync(victim, `${target}.tmp-${process.pid}`);

    atomic(target, "{}\n");

    assert.equal(readFileSync(victim, "utf8"), "untouched\n");
    assert.equal(readFileSync(target, "utf8"), "{}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a link planted at the exact temporary name is refused, not written through", async (t) => {
  // The name is unpredictable, which the test above leans on; this one takes
  // the prediction away and leaves `wx` alone to stand between the write and
  // the link.
  const crypto = (await import("node:crypto")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = crypto.randomBytes;
  crypto.randomBytes = (n) => Buffer.alloc(n, 0xab);
  syncBuiltinESMExports();
  t.after(() => {
    crypto.randomBytes = real;
    syncBuiltinESMExports();
  });
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-atomic-"));
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-atomic-outside-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  const victim = join(outside, "victim.txt");
  writeFileSync(victim, "untouched\n");
  const target = join(dir, "facts.json");
  symlinkSync(victim, `${target}.tmp-${process.pid}-${"ab".repeat(8)}`);

  assert.throws(() => atomic(target, "{}\n"), /EEXIST/);
  assert.equal(readFileSync(victim, "utf8"), "untouched\n");
  // And the entry it refused is left where it was: it is not this call's to remove.
  assert.ok(lstatSync(`${target}.tmp-${process.pid}-${"ab".repeat(8)}`).isSymbolicLink());
});

test("a write that fails part way leaves no temporary file behind", async (t) => {
  // ENOSPC arrives after the temporary file exists, and the write sat outside
  // the cleanup, so a full disk left `facts.json.tmp-*` beside the map.
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs.writeFileSync;
  fs.writeFileSync = (file, body, ...rest) => {
    real(file, String(body).slice(0, 1), ...rest);
    throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.writeFileSync = real;
    syncBuiltinESMExports();
  });
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-atomic-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.throws(() => atomic(join(dir, "facts.json"), "{}\n"), /ENOSPC/);
  assert.deepEqual(readdirSync(dir), []);
});

// Sixteen hex digits, as the stager spells them.
const stagedName = (name, pid, hex = "0123456789abcdef") => stagedPath(name, pid, hex);
const EVERY_TARGET = [TARGETS.claude, TARGETS.cursor, TARGETS.copilot];

test("the name a staged file is given is the name a later scan knows as one", (t) => {
  const dir = workspace(t);
  for (const target of EVERY_TARGET) {
    for (const name of [overviewName(target), areaName(target, "0badf00d")]) {
      const tmp = writeTemp(join(dir, name), "x");
      assert.equal(stagedBy(tmp.slice(dir.length + 1), target), process.pid, tmp);
    }
    assert.equal(stagedPath("a", 7, "0123456789abcdef"), "a.tmp-7-0123456789abcdef");
    // Under another target's extension, a name no scan gives a file, no prefix, and a suffix cut short or run long.
    const other = EVERY_TARGET.find((o) => o !== target && !overviewName(o).endsWith(target.ext));
    for (const name of [
      ...(other ? [stagedName(overviewName(other), 1)] : []),
      stagedName(`anatomiya-my-notes${target.ext}`, 1),
      stagedName(`area-0badf00d${target.ext}`, 1),
      stagedName(overviewName(target), 1, "0123456789abcde"),
      stagedName(overviewName(target), 1, "0123456789abcdef0"),
      stagedName(overviewName(target), 1, "0123456789ABCDEF"),
      stagedName(overviewName(target), "x"),
      `${stagedName(overviewName(target), 1)}.bak`,
      overviewName(target),
    ]) {
      assert.equal(stagedBy(name, target), null, `${target.id}: ${name}`);
    }
  }
});

test("putBack removes a file that was not there", (t) => {
  const path = join(workspace(t), "facts.json");
  writeFileSync(path, "new\n");

  putBack(path, null);

  assert.equal(existsSync(path), false);
});

test("putBack leaves a file it could not read", (t) => {
  const path = join(workspace(t), "facts.json");
  writeFileSync(path, "new\n");

  putBack(path, undefined);

  assert.equal(readFileSync(path, "utf8"), "new\n");
});

test("replaceAll undoes every rename when one fails", async (t) => {
  const dir = workspace(t);
  const [a, b] = [join(dir, "a.md"), join(dir, "b.md")];
  writeFileSync(a, "old a\n");
  writeFileSync(b, "old b\n");
  const staged = [[writeTemp(a, "new a\n"), a], [writeTemp(b, "new b\n"), b]];
  const fs = (await import("node:fs")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs.renameSync;
  let calls = 0;
  fs.renameSync = (...args) => {
    if (++calls === 2) throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
    return real(...args);
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.renameSync = real;
    syncBuiltinESMExports();
  });
  const pair = { record: null, records: new Set(), leftover: new Set(), left: [], spared: () => null, settle() {}, restore() {} };

  assert.throws(
    () => replaceAll(staged, [], pair, () => {}, (path) => path.slice(dir.length + 1)),
    /^Error: b\.md could not be replaced \(EPERM\), so the scan stopped and put back what it had replaced/
  );

  assert.equal(calls, 3, "the second rename refused, and the first was put back by one more");
  assert.equal(readFileSync(a, "utf8"), "old a\n");
  assert.equal(readFileSync(b, "utf8"), "old b\n");
});
