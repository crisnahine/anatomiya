import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";

import { createdAlone, leftLockTokens, mtimeAge, ownerAge, release, removeLeftTokens, takeDeadLock, takeLock } from "../plugins/anatomiya/lib/lock.mjs";
import { COMMIT_LOCK, REFRESH_LOCK } from "../plugins/anatomiya/lib/rules.mjs";
import { stubbed } from "./fs-stub.mjs";
import { removeTree } from "./platform.mjs";

/**
 * The lock both hooks take: one exclusive create, a dead lock broken by the one
 * call holding its lock token, and the two ways of telling a dead one from a live one.
 */
function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-lock-"));
  t.after(() => removeTree(dir));
  return dir;
}

const refused = (code, p) => Object.assign(new Error(`${code}: open '${p}'`), { code });

test("an EPERM create is tried again", (t) => {
  // Windows answers EPERM for a name another process is still deleting.
  for (const content of [null, "held"]) {
    const lock = join(workspace(t), "lock");
    let tries = 0;
    const made = stubbed("openSync", (real, p, flags, ...rest) => {
      if (p === lock && flags === "wx" && ++tries <= 2) throw refused("EPERM", p);
      return real(p, flags, ...rest);
    }, () => stubbed("linkSync", (_real, _from, to) => {
      // No hard links here, so the content goes through the exclusive create too.
      throw refused("EPERM", to);
    }, () => createdAlone(lock, content)));

    assert.equal(made, true, String(content));
    assert.equal(tries, 3, "refused twice, then made");
    assert.equal(readFileSync(lock, "utf8"), content ?? "");
  }
});

test("a create refused with EPERM every time is thrown after eight tries", (t) => {
  for (const content of [null, "held"]) {
    const dir = workspace(t);
    const lock = join(dir, "lock");
    let tries = 0;
    assert.throws(() => stubbed("openSync", (real, p, flags, ...rest) => {
      // Past the bound the refusal changes, so a create that never gives up ends here and not in a hang.
      if (p === lock && flags === "wx") throw refused(++tries > 9 ? "ELOOP" : "EPERM", p);
      return real(p, flags, ...rest);
    }, () => stubbed("linkSync", (_real, _from, to) => {
      throw refused("EPERM", to);
    }, () => createdAlone(lock, content))), { code: "EPERM" }, String(content));

    assert.equal(tries, 8, String(content));
    assert.deepEqual(readdirSync(dir), [], `${content}: nothing made and nothing staged left`);
  }
});

test("a link EPERM falls through to the exclusive create without waiting", (t) => {
  const dir = workspace(t);
  const lock = join(dir, "lock");
  let links = 0;
  const made = stubbed("linkSync", (_real, _from, to) => {
    links++;
    throw refused("EPERM", to);
  }, () => createdAlone(lock, "held"));

  assert.equal(made, true);
  assert.equal(links, 1, "the link is not what a deletion in progress refuses, so it is not tried again");
  assert.equal(readFileSync(lock, "utf8"), "held");
  assert.deepEqual(readdirSync(dir), ["lock"], "and the staged content is gone");
});

test("a create finds a held name taken, and throws on anything else", (t) => {
  const dir = workspace(t);
  const lock = join(dir, "lock");
  writeFileSync(lock, "theirs");
  assert.equal(createdAlone(lock), false);
  assert.equal(createdAlone(lock, "mine"), false);
  assert.equal(readFileSync(lock, "utf8"), "theirs");
  assert.deepEqual(readdirSync(dir), ["lock"]);

  let tries = 0;
  assert.throws(() => stubbed("openSync", (real, p, flags, ...rest) => {
    if (p === join(dir, "other") && flags === "wx" && ++tries) throw refused("EACCES", p);
    return real(p, flags, ...rest);
  }, () => createdAlone(join(dir, "other"))), { code: "EACCES" });
  assert.equal(tries, 1, "a refusal that is not a deletion is not tried again");
});

test("a lock judged dead whose generation changed is left alone", (t) => {
  const dir = workspace(t);
  const lock = join(dir, "lock");
  writeFileSync(lock, "next");
  const verdicts = [{ live: false, generation: "1" }, { live: false, generation: "2" }];
  const judge = () => verdicts.shift();

  assert.equal(takeDeadLock(lock, judge, "mine"), false);
  assert.equal(readFileSync(lock, "utf8"), "next");
  assert.deepEqual(readdirSync(dir), ["lock"], "and its lock token is gone");
});

test("a dead lock is removed by the call holding its lock token, and taken", (t) => {
  const dir = workspace(t);
  const lock = join(dir, "lock");
  writeFileSync(lock, "dead");
  const judge = (p) => (existsSync(p) ? { live: false, generation: "7" } : null);

  assert.equal(takeDeadLock(lock, judge, "mine"), true);
  assert.equal(readFileSync(lock, "utf8"), "mine");
  assert.deepEqual(readdirSync(dir), ["lock"]);

  // Another call holds this generation's lock token, so this one leaves the dead lock to it.
  writeFileSync(lock, "dead");
  writeFileSync(`${lock}.7`, "");
  assert.equal(takeDeadLock(lock, judge, "mine"), false);
  assert.equal(readFileSync(lock, "utf8"), "dead");

  assert.equal(takeDeadLock(lock, () => ({ live: true }), "mine"), false, "a live lock is never broken");
  assert.equal(readFileSync(lock, "utf8"), "dead");
});

test("a lock's mtime says whether a live call can still hold it, either way of the clock", (t) => {
  const lock = join(workspace(t), "lock");
  const now = 1_700_000_000_000;
  const judge = mtimeAge({ heldMostMs: 5000, slackMs: 2000, now: () => now });
  assert.equal(judge(lock), null, "gone");
  writeFileSync(lock, "");
  for (const [ms, live] of [[0, true], [-6900, true], [6900, true], [-7100, false], [7100, false], [-60_000, false]]) {
    const at = new Date(now + ms);
    utimesSync(lock, at, at);
    const verdict = judge(lock);
    assert.equal(verdict.live, live, `${ms} ms`);
    // As the file system keeps it, which can round a millisecond off what was set.
    if (!live) assert.equal(verdict.generation, String(statSync(lock, { bigint: true }).mtimeMs), "the lock token is named by the mtime in ms");
  }
});

test("a lock's owner and age say whether a worker can still hold it", (t) => {
  const lock = join(workspace(t), "lock");
  const now = 1_700_000_000_000;
  const judge = ownerAge({ staleMs: 30 * 60 * 1000, now: () => now, alive: (pid) => pid === 1 });
  const verdict = (content) => {
    writeFileSync(lock, content);
    return judge(lock);
  };
  assert.equal(judge(lock), null, "gone");
  assert.deepEqual(verdict(JSON.stringify({ pid: 1, at: now - 1000, nonce: "0123456789abcdef" })), { live: true, generation: "0123456789abcdef" });
  assert.equal(verdict(JSON.stringify({ pid: 1, at: now - 31 * 60 * 1000 })).live, false, "older than any scan");
  // A clock set back, as NTP steps one past 128 ms, leaves a live worker's stamp ahead of it: its pid decides.
  assert.equal(verdict(JSON.stringify({ pid: 1, at: now + 60_000, nonce: "0123456789abcdef" })).live, true, "ahead of the clock, its process alive");
  assert.equal(verdict(JSON.stringify({ pid: 2, at: now + 1000 })).live, false, "ahead of the clock, its process gone");
  assert.equal(verdict(JSON.stringify({ pid: 1, at: now + 31 * 60 * 1000 })).live, false, "further ahead than any scan runs");
  assert.equal(verdict(JSON.stringify({ pid: 2, at: now })).live, false, "its process is gone");
  assert.equal(verdict(JSON.stringify({ pid: "1", at: now })).live, false, "a pid that is not an integer");
  assert.equal(verdict(JSON.stringify({ pid: 1, at: null })).live, false, "an at that is not a number");
  assert.equal(verdict("{").live, false, "unparseable");

  const dead = verdict(JSON.stringify({ pid: 2, at: now, nonce: "0123456789abcdef" }));
  assert.equal(dead.generation, "0123456789abcdef", "a worker's lock is its nonce's generation");
  for (const content of ["{", JSON.stringify({ pid: 2, at: now, nonce: "../x" })]) {
    assert.match(verdict(content).generation, /^[0-9a-f]{16}$/, `a lock with no nonce of ours still names a lock token: ${content}`);
  }
});

test("a worker's lock outlives the clock being set back under it", (t) => {
  const lock = join(workspace(t), "refresh.lock");
  writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now(), nonce: "0123456789abcdef" }));
  // The wall clock stepped back one second right after a live worker took the lock.
  const judge = ownerAge({ staleMs: 30 * 60 * 1000, now: () => Date.now() - 1000 });

  assert.equal(takeDeadLock(lock, judge, JSON.stringify({ pid: process.pid, at: Date.now(), nonce: "fedcba9876543210" })), false);
  assert.match(readFileSync(lock, "utf8"), /0123456789abcdef/);
});

test("a lock token left by a breaker that died is removed, and the live generation's and other names stay", (t) => {
  const dir = workspace(t);
  const lock = join(dir, "refresh.lock");
  const keep = ["refresh.lock", "refresh.lock.aaaaaaaaaaaaaaaa", "refresh.lock.tmp-1-0123456789abcdef", "refresh.lock.0123", "refresh.json"];
  // And a token's own token, left by a call killed breaking that lock token.
  for (const name of [...keep, "refresh.lock.0123456789abcdef", "refresh.lock.0123456789abcdef.1700000000000"]) writeFileSync(join(dir, name), "");

  removeLeftTokens(lock, "aaaaaaaaaaaaaaaa");

  assert.deepEqual(readdirSync(dir).sort(), keep.sort());
});

// Each judge over an entry it reads as dead: the refresh worker's by what the entry holds, the echo's by its age.
const DEAD_JUDGES = { "the worker's": ownerAge({ staleMs: 30 * 60 * 1000 }), "the echo's": mtimeAge({ heldMostMs: 5000, slackMs: 2000, now: () => Date.now() + 60_000 }) };

test("an empty directory at a lock's name is removed, and the lock is taken on that call", (t) => {
  for (const [whose, judge] of Object.entries(DEAD_JUDGES)) {
    const dir = workspace(t);
    const lock = join(dir, "lock");
    mkdirSync(lock);

    assert.equal(takeDeadLock(lock, judge, "mine"), true, whose);
    assert.equal(readFileSync(lock, "utf8"), "mine", whose);
    assert.deepEqual(readdirSync(dir), ["lock"], `${whose}: and its lock token is gone`);
  }
});

test("a directory holding entries at a lock's name is left whole, and the refusal names it", (t) => {
  for (const [whose, judge] of Object.entries(DEAD_JUDGES)) {
    const dir = workspace(t);
    const lock = join(dir, "lock");
    mkdirSync(join(lock, "kept"), { recursive: true });
    writeFileSync(join(lock, "kept", "file"), "theirs");

    for (let call = 0; call < 2; call++) {
      assert.throws(() => takeDeadLock(lock, judge, "mine"), (err) => err.blocked === lock, `${whose}, call ${call}`);
      assert.equal(readFileSync(join(lock, "kept", "file"), "utf8"), "theirs", whose);
      assert.deepEqual(readdirSync(dir), ["lock"], `${whose}: and no lock token is left`);
    }
  }
});

test("a regular file at a lock's name that the system will not unlink is thrown as refused, and is not named as blocked", (t) => {
  // Windows refuses the unlink of a file a handle still holds open, which passes: the caller tries again.
  for (const [whose, judge] of Object.entries(DEAD_JUDGES)) {
    const dir = workspace(t);
    const lock = join(dir, "lock");
    writeFileSync(lock, "dead");

    const thrown = (() => {
      try {
        stubbed("unlinkSync", (real, p) => {
          if (p === lock) throw refused("EPERM", p);
          return real(p);
        }, () => takeDeadLock(lock, judge, "mine"));
      } catch (err) {
        return err;
      }
      return null;
    })();

    assert.equal(thrown?.code, "EPERM", whose);
    assert.equal("blocked" in thrown, false, whose);
    assert.equal(readFileSync(lock, "utf8"), "dead", whose);
    assert.deepEqual(readdirSync(dir), ["lock"], `${whose}: and no lock token is left`);
  }
});

test("a fifo at a lock's name that the system will not unlink is named as blocked", { skip: process.platform === "win32" ? "no mkfifo" : false }, (t) => {
  const dir = workspace(t);
  const lock = join(dir, "lock");
  execFileSync("mkfifo", [lock]);

  assert.throws(() => stubbed("unlinkSync", (real, p) => {
    if (p === lock) throw refused("EPERM", p);
    return real(p);
  }, () => takeDeadLock(lock, DEAD_JUDGES["the worker's"], "mine")), (err) => err.code === "EPERM" && err.blocked === lock);
  assert.deepEqual(readdirSync(dir), ["lock"], "and no lock token is left");
});

test("the store's two named locks are each judged as their own: a commit lock this process left is dead to the next commit, a refresh lock this process holds is live, and the sweep names a token beside either", (t) => {
  const store = workspace(t);
  assert.ok(takeLock(store, "commit"));
  assert.ok(takeLock(store, "commit"), "a commit lock naming this process is one its release could not remove");
  const refresh = takeLock(store, "refresh");
  assert.ok(refresh);
  assert.equal(takeLock(store, "refresh"), null, "a live worker's lock is not taken from under it");
  release(refresh);
  const tokens = [`${basename(COMMIT_LOCK)}.fedcba9876543210`, `${basename(REFRESH_LOCK)}.0123456789abcdef`];
  for (const name of tokens) writeFileSync(join(store, name), "");
  assert.deepEqual(leftLockTokens(store).sort(), tokens);
});
