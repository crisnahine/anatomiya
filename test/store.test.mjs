import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, fstatSync, lstatSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { atomic, putBack, replaceAll, stagedPath, writeTemp } from "../plugins/anatomiya/lib/store.mjs";
import { stagedBy } from "../plugins/anatomiya/lib/rules.mjs";
import { TARGETS, areaName, overviewName } from "../plugins/anatomiya/lib/targets.mjs";
import { stubbed } from "./fs-stub.mjs";
import { needsPosixPermissions, needsSymlinks, removeTree } from "./platform.mjs";

/**
 * The store's file mechanics: a file replaced whole or not at all, and the
 * name it is staged under, which a later scan reads back to know whose it is.
 */
function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-store-"));
  t.after(() => removeTree(dir));
  return dir;
}

test("the replace never writes through a link planted where its temporary file goes", (t) => {
  // The directories are resolved (F2), and the temporary name beside the
  // destination was not: it was `<path>.tmp-<pid>`, predictable, and opened
  // with a plain write that follows a link. A repository shipping that name as
  // a tracked symlink had the scan write the map's bytes wherever it pointed.
  const victim = join(workspace(t), "victim.txt");
  writeFileSync(victim, "untouched\n");
  const target = join(workspace(t), "facts.json");
  symlinkSync(victim, `${target}.tmp-${process.pid}`);

  atomic(target, "{}\n");

  assert.equal(readFileSync(victim, "utf8"), "untouched\n");
  assert.equal(readFileSync(target, "utf8"), "{}\n");
});

// What mode the file a write lands in had when its bytes went in.
const writtenModes = (written) => (real, file, ...rest) => {
  if (typeof file === "number") written.push(fstatSync(file).mode & 0o777);
  return real(file, ...rest);
};

test("a file replaced whole keeps its mode, read-only included, and its bytes are never in a file more open than that", needsPosixPermissions, (t) => {
  // Renamed over it, a 0600 file came back 0644; set after the write, the mode left its bytes readable between the two.
  const dir = workspace(t);

  // 0664 is wider than a new file under the usual umask of 022 makes, so it is set on the open file before the write.
  for (const mode of [0o600, 0o664, 0o444]) {
    const path = join(dir, `settings-${mode.toString(8)}.json`);
    writeFileSync(path, "{}\n");
    chmodSync(path, mode);
    const written = [];

    stubbed("writeFileSync", writtenModes(written), () => atomic(path, '{"a":1}\n'));

    assert.equal(lstatSync(path).mode & 0o777, mode, mode.toString(8));
    assert.deepEqual(written, [mode], `${mode.toString(8)}: the bytes were written into a file of that mode and no wider`);
  }
});

test("a filesystem that refuses a mode change leaves a replaced file narrower, never wider, and still replaces it", needsPosixPermissions, (t) => {
  const dir = workspace(t);
  const refuse = () => {
    throw Object.assign(new Error("EPERM: operation not permitted, fchmod"), { code: "EPERM" });
  };

  for (const mode of [0o600, 0o664]) {
    const path = join(dir, `settings-${mode.toString(8)}.json`);
    writeFileSync(path, "{}\n");
    chmodSync(path, mode);
    const written = [];

    stubbed("fchmodSync", refuse, () => stubbed("writeFileSync", writtenModes(written), () => atomic(path, '{"a":1}\n')));

    assert.equal(readFileSync(path, "utf8"), '{"a":1}\n', mode.toString(8));
    assert.equal(written.length, 1);
    for (const seen of [written[0], lstatSync(path).mode & 0o777]) assert.equal(seen & ~mode, 0, `${mode.toString(8)}: ${seen.toString(8)} opens no bit the file did not`);
  }
});

test("a file put where a link stood takes a new file's own mode, never the link's", needsSymlinks, (t) => {
  // A replaced file keeps its mode, and a link's is not its target's: read through the link, a 0600 target's would be.
  const dir = workspace(t);
  const fresh = join(dir, "fresh.json");
  atomic(fresh, "{}\n");
  const elsewhere = join(dir, "elsewhere.json");
  writeFileSync(elsewhere, "{}\n");
  chmodSync(elsewhere, 0o600);
  const target = join(dir, "facts.json");
  symlinkSync(elsewhere, target);

  atomic(target, "{}\n");

  assert.equal(lstatSync(target).isFile(), true, "the control: the link itself was replaced");
  assert.equal(lstatSync(target).mode & 0o777, lstatSync(fresh).mode & 0o777);
  assert.equal(readFileSync(elsewhere, "utf8"), "{}\n", "and what it named is left alone");
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
  const victim = join(workspace(t), "victim.txt");
  writeFileSync(victim, "untouched\n");
  const target = join(workspace(t), "facts.json");
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
  const dir = workspace(t);

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

test("a file that was not there before the write is removed when it is put back", (t) => {
  const path = join(workspace(t), "facts.json");
  writeFileSync(path, "new\n");

  putBack(path, null);

  assert.equal(existsSync(path), false);
});

test("a file whose earlier bytes could not be read is left as it is when it is put back", (t) => {
  const path = join(workspace(t), "facts.json");
  writeFileSync(path, "new\n");

  putBack(path, undefined);

  assert.equal(readFileSync(path, "utf8"), "new\n");
});

test("a rename that fails puts back every file already replaced", async (t) => {
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
