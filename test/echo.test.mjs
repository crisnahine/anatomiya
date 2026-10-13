import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { appendFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { compact, delivered, filler, transcript } from "./transcript.mjs";
import { echoDue, heldIn } from "../plugins/anatomiya/lib/echo.mjs";
import { removeTree } from "./platform.mjs";

const DIGEST = "a1b2c3d4e5f6";

/** A delivery of the map whose digest is `digest`, as the echo stamps it. */
const map = (digest = DIGEST) => `<repository-map delivered="2026-10-12T00:00:00.000Z" digest="${digest}">\nCounted just now.\n\n# Repository map\n</repository-map>`;
const first = map();

/** A transcript as the hook reads its tail: its lines, and the offset it ends at. */
function tailOf(entries) {
  const text = entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
  return { end: Buffer.byteLength(text), lines: () => text.split("\n") };
}

const ours = (text) => text.includes(`digest="${DIGEST}"`);
const held = (entries) => heldIn(tailOf(entries), ours);

/** Whether a call over the transcript at `path` delivers this map, with its batch claims kept under `data`. */
const due = (path, data = null) => echoDue({ digest: DIGEST, transcript: path, data });

test("the echo says nothing when this context window already holds the same map", () => {
  assert.equal(held([{ type: "user", message: { content: "go" } }, delivered(first)]), true);
});

test("the echo delivers again once a compaction follows the last delivery", () => {
  assert.equal(held([delivered(first), compact()]), false);
});

test("the echo delivers a map that differs from the one the window holds", (t) => {
  // The digest is how a delivery names its map, so this one goes through the call that compares them.
  assert.equal(due(transcript(t, [delivered(map("0".repeat(12)))])), true);
  assert.equal(due(transcript(t, [delivered(first)])), false);
});

test("the echo stays silent over a delivery 150 KiB back and delivers again past 192 KiB", () => {
  assert.equal(held([delivered(first), filler(150 * 1024)]), true);
  assert.equal(held([delivered(first), filler(192 * 1024)]), false);
});

test("the echo's window ends at exactly 192 KiB of what the model reads after a delivery", () => {
  // A user line counts its JSON and its newline: 41 bytes past the filler's own.
  const after = (counted) => [delivered(first), filler(counted - 41)];

  assert.equal(held(after(192 * 1024)), true);
  assert.equal(held(after(192 * 1024 + 1)), false);
});

// What 2.1.296 writes for itself between two calls: a snapshot of the system
// prompt, a bookkeeping line, and a hook's own stdout. None carries `rendered`.
const own = (bytes) => [
  { type: "attachment", attachment: { type: "prompt_snapshot", systemPrompt: ["x".repeat(bytes)] } },
  { type: "queue-operation", operation: "enqueue", content: "x".repeat(bytes) },
  { type: "attachment", attachment: { type: "hook_success", stdout: "x".repeat(bytes) } },
];
const shown = (type, bytes) => ({ type: "attachment", attachment: { type }, rendered: [{ content: "x".repeat(bytes) }] });

test("records the build writes for itself do not push a delivery out of the window", () => {
  assert.equal(held([delivered(first), ...own(300 * 1024), filler(100 * 1024)]), true);
  assert.equal(held([delivered(first), shown("skill_listing", 300 * 1024)]), false, "an attachment the model reads counts");
});

test("the CLAUDE.md files the build writes after a delivery do not push it out of the window", () => {
  // The build places them at the head of the context, ahead of the delivery they follow in the transcript.
  assert.equal(held([delivered(first), shown("instructions", 129_512), filler(100 * 1024)]), true);
});

test("heldIn holds a batch claim at an offset inside the window", () => {
  const tail = tailOf([filler(100), filler(100), filler(100)]);
  const line = Buffer.byteLength(`${JSON.stringify(filler(100))}\n`);
  const none = () => false;

  assert.equal(heldIn(tail, none, { batchClaimAt: tail.end - line }), true, "one record back");
  assert.equal(heldIn(tail, none, { batchClaimAt: 0 }), true, "at the head, three records back");
  assert.equal(heldIn(tail, none, { batchClaimAt: 0, window: 2 * line }), false, "past a window of two records");
  assert.equal(heldIn(tail, none), false, "no batch claim and no delivery");
});

/** The plugin's data directory, for one test. */
function dataDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-plugin-data-"));
  t.after(() => removeTree(dir));
  return dir;
}

const append = (path, entries) => writeFileSync(path, `${readFileSync(path, "utf8")}${entries.map((e) => `${JSON.stringify(e)}\n`).join("")}`);

test("the calls of one batch deliver one copy between them, before any of them is in the transcript", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [delivered(first), filler(300 * 1024)]);
  const call = () => due(path, data);

  assert.equal(call(), true, "due by the window");
  assert.equal(call(), false, "a sibling");
  assert.equal(call(), false, "another sibling");
  assert.equal(readdirSync(join(data, "echo")).length, 1, "one batch claim per transcript and map");

  // A sibling whose result alone outruns the window is owed a copy the batch claim must not hold back.
  append(path, [filler(300 * 1024)]);
  assert.equal(call(), true, "due again");
  assert.equal(call(), false);
  assert.equal(readdirSync(join(data, "echo")).length, 1, "the batch claim was replaced, not added to");

  // The same records and a little more, so a batch claim at this window's offset would sit inside it.
  const other = transcript(t, [delivered(first), filler(300 * 1024), filler(300 * 1024), filler(20 * 1024)]);
  assert.equal(due(other, data), true, "another window's batch claim holds nothing here");
});

/** A repository with a map already written, the state a scan leaves behind. */
function mapped(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-echo-"));
  t.after(() => removeTree(dir));
  mkdirSync(join(dir, ".claude", "rules"), { recursive: true });
  writeFileSync(join(dir, ".claude", "rules", "anatomiya-overview.md"), "---\ngenerator: anatomiya\n---\n\n# Repository map\n\n- lib: 3 .mjs\n");
  return dir;
}

const BIN = fileURLToPath(new URL("../plugins/anatomiya/bin/anatomiya.mjs", import.meta.url));

/** How many of `n` echo processes deliver when their payloads arrive together; an undefined `data` leaves the variable unset. */
async function batch(dir, data, path, n, nodeArgs = []) {
  const runs = [];
  for (let i = 0; i < n; i++) {
    // Killed, so delivering nothing, where its lock never comes to an end.
    const child = spawn(process.execPath, [...nodeArgs, BIN, "echo", dir], { env: { ...process.env, CLAUDE_PLUGIN_DATA: data }, timeout: 60_000 });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    runs.push({ child, done: new Promise((done) => child.on("close", () => done(out))) });
  }
  // Every process is up and blocked on stdin before any payload is written.
  const payload = JSON.stringify({ hook_event_name: "PostToolUse", transcript_path: path, cwd: dir });
  for (const { child } of runs) child.stdin.end(payload);
  const outs = await Promise.all(runs.map((run) => run.done));
  return outs.filter((out) => out.includes("<repository-map ")).length;
}

test("echo processes started together deliver one copy per batch, with no batch claim on disk and with a stale one", async (t) => {
  const dir = mapped(t);
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  await batch(dir, data, path, 1);
  const [name] = readdirSync(join(data, "echo"));
  const claim = join(data, "echo", name);

  for (const n of [3, 8]) {
    for (const [what, reset] of [["no batch claim", () => rmSync(claim, { force: true })], ["a stale batch claim", () => writeFileSync(claim, "0\n")]]) {
      for (let round = 0; round < 20; round++) {
        reset();
        assert.equal(await batch(dir, data, path, n), 1, `${what}, ${n} at once, round ${round}`);
      }
    }
  }
});

test("the echo hook prints the map on every call where its data directory is relative or unset", async (t) => {
  const dir = mapped(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const relative = `anatomiya-relative-${process.pid}`;
  t.after(() => removeTree(relative));
  const twice = async (data) => [await batch(dir, data, path, 1), await batch(dir, data, path, 1)];

  assert.deepEqual(await twice(dataDir(t)), [1, 0], "an absolute one keeps the second call silent");
  assert.deepEqual(await twice(relative), [1, 1], "relative");
  assert.equal(existsSync(relative), false, "a relative name is not resolved against the cwd");
  assert.deepEqual(await twice(undefined), [1, 1], "unset");
});

test("a lock held by another call keeps this one silent, and a lock a minute old or a minute ahead is broken", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const echo = () => due(path, data);
  echo();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  // Stamped as the call first reads the lock's age, so a slow runner moves no age across the bound.
  const held = (ms) => {
    writeFileSync(join(data, "echo", name), "0\n");
    writeFileSync(lock, "");
    let stamped = false;
    return lockEnds(() =>
      stubbed("lstatSync", (real, p, ...rest) => {
        if (p === lock && !stamped) {
          stamped = true;
          const at = new Date(Date.now() + ms);
          utimesSync(lock, at, at);
        }
        return real(p, ...rest);
      }, echo)
    );
  };

  assert.equal(held(0), false, "a fresh lock");
  // Past the 5 s hook timeout, inside the 2 s a FAT mtime can be off by.
  assert.equal(held(-6900), false, "a lock 6.9 s old");
  assert.equal(held(6900), false, "a lock 6.9 s ahead");

  assert.equal(held(-60_000), true, "a lock a minute old");
  assert.equal(existsSync(lock), false, "released after the delivery");
  assert.deepEqual(readdirSync(join(data, "echo")), [name], "nothing left of the lock it broke");
  assert.equal(lockEnds(echo), false, "the batch claim it wrote keeps the next call silent");

  assert.equal(held(60_000), true, "a lock a minute ahead");
  assert.equal(held(-7100), true, "a lock 7.1 s old, past the slack");
});

/** Runs `call` and fails where a lock loop goes on past the few exclusive creates one call makes. */
function lockEnds(call) {
  let creates = 0;
  const answer = stubbed("openSync", (real, p, flags, ...rest) => {
    if (flags === "wx" && ++creates > 8) throw new Error("the lock loop did not end");
    return real(p, flags, ...rest);
  }, call);
  assert.ok(creates <= 8, `the lock loop ended, after ${creates} exclusive creates`);
  return answer;
}

/** Runs one echo call with `fs[name]` replaced by `stub`, which is handed the real one. */
function stubbed(name, stub, call) {
  const real = fs[name];
  fs[name] = (...args) => stub(real, ...args);
  syncBuiltinESMExports();
  try {
    return call();
  } finally {
    fs[name] = real;
    syncBuiltinESMExports();
  }
}

// Holds every read of a lock's age, so two calls that find one dead both read it before either breaks it.
const SLOW_LOCK_AGE = `data:text/javascript,${encodeURIComponent(`
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const real = fs.lstatSync;
fs.lstatSync = (path, ...rest) => {
  const stat = real(path, ...rest);
  if (String(path).endsWith(".lock")) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  return stat;
};
syncBuiltinESMExports();
`)}`;

test("two calls that both find a dead lock deliver one copy between them", async (t) => {
  const dir = mapped(t);
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  await batch(dir, data, path, 1);
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  const dead = new Date(Date.now() - 60_000);

  for (let round = 0; round < 20; round++) {
    writeFileSync(join(data, "echo", name), "0\n");
    writeFileSync(lock, "");
    utimesSync(lock, dead, dead);
    assert.equal(await batch(dir, data, path, 2, [`--import=${SLOW_LOCK_AGE}`]), 1, `round ${round}`);
  }
});

test("three and eight calls that find a dead lock deliver one copy per batch and leave no lock or lock token", async (t) => {
  const dir = mapped(t);
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  await batch(dir, data, path, 1);
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);

  for (const n of [3, 8]) {
    for (let round = 0; round < 50; round++) {
      writeFileSync(join(data, "echo", name), "0\n");
      writeFileSync(lock, "");
      const dead = new Date(Date.now() - 60_000);
      utimesSync(lock, dead, dead);
      assert.equal(await batch(dir, data, path, n), 1, `${n} at once, round ${round}`);
      assert.deepEqual(readdirSync(join(data, "echo")), [name], `${n} at once, round ${round}: nothing but the batch claim`);
    }
  }
});

test("a dead lock replaced by a live one before it is broken keeps the call silent, and the live one stays", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => due(path, data));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");
  writeFileSync(lock, "live");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  let replaced = false;
  const answer = stubbed("lstatSync", (real, p, ...rest) => {
    const stat = real(p, ...rest);
    if (p === lock && !replaced) {
      // Another call broke it and took its own in the meantime.
      replaced = true;
      utimesSync(lock, new Date(), new Date());
    }
    return stat;
  }, call);

  assert.equal(replaced, true);
  assert.equal(answer, false);
  assert.equal(readFileSync(lock, "utf8"), "live", "the live lock is where its holder will release it");
  assert.deepEqual(readdirSync(join(data, "echo")).sort(), [name, `${name}.lock`], "and nowhere else");
});

test("a dead lock replaced by another at the same mtime before it is broken is another generation, and stays", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => due(path, data));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");
  writeFileSync(lock, "");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  let replaced = false;
  const answer = stubbed("openSync", (real, p, flags, ...rest) => {
    if (!replaced && flags === "wx" && String(p).startsWith(`${lock}.`)) {
      // Made before the old one goes, so it cannot be handed the old one's inode.
      replaced = true;
      writeFileSync(`${lock}.next`, "another");
      utimesSync(`${lock}.next`, dead, dead);
      renameSync(`${lock}.next`, lock);
    }
    return real(p, flags, ...rest);
  }, call);

  assert.equal(replaced, true);
  assert.equal(answer, false);
  assert.equal(readFileSync(lock, "utf8"), "another", "the other generation's lock is left to the call that made it");
});

test("a dead lock whose file id changed only past 2^53, as an NTFS id can, is another generation", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => due(path, data));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");
  writeFileSync(lock, "live");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  // Each read of the lock names the next id: two files a float rounds to one id.
  let reads = 0;
  const answer = stubbed("lstatSync", (real, p, options) => {
    const stat = real(p, options);
    if (String(p) !== lock) return stat;
    const id = 2n ** 60n + BigInt(reads++);
    stat.ino = options?.bigint ? id : Number(id);
    return stat;
  }, call);

  assert.equal(reads, 2);
  assert.equal(answer, false);
  assert.equal(readFileSync(lock, "utf8"), "live");
});

/** Runs `call` with every removal of a path `refuses` names failing as Windows fails one another process holds. */
function removalRefused(refuses, call) {
  const busy = (real, p, ...rest) => {
    if (refuses(String(p))) throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${p}'`), { code: "EBUSY" });
    return real(p, ...rest);
  };
  return stubbed("rmSync", busy, () => stubbed("unlinkSync", busy, call));
}

test("a lock token that cannot be removed leaves the call to the lock's one create, so it stays silent where another call took the lock", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => due(path, data));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");
  writeFileSync(lock, "");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  const answer = removalRefused((p) => {
    if (!p.startsWith(`${lock}.`)) return false;
    // Another call took the lock the moment the dead one went.
    if (!existsSync(lock)) writeFileSync(lock, "live");
    return true;
  }, call);

  assert.equal(answer, false);
  assert.equal(readFileSync(lock, "utf8"), "live", "the call that took the lock holds it");
});

/** Runs `call` with the first `times` exclusive creates of a path `refused` names answering EPERM, as Windows answers one for a name another process is deleting. */
function createRefused(refused, times, call) {
  let left = times;
  return stubbed("openSync", (real, p, flags, ...rest) => {
    if (flags === "wx" && refused(String(p)) && left > 0) {
      left--;
      throw Object.assign(new Error(`EPERM: operation not permitted, open '${p}'`), { code: "EPERM" });
    }
    return real(p, flags, ...rest);
  }, call);
}

test("a lock create refused while another process deletes the name is tried again, and the batch claim answers", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => due(path, data));
  assert.equal(call(), true);
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);

  assert.equal(createRefused((p) => p === lock, 2, call), false, "kept silent by the batch claim the first call wrote");
  assert.deepEqual(readdirSync(join(data, "echo")), [name]);
});

test("a lock create refused for longer than a deletion takes answers as the transcript alone does", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => due(path, data);
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");

  // Past nine tries the stub stops answering EPERM, so a retry that never ends fails here instead of hanging.
  const tries = [];
  const started = performance.now();
  const answer = stubbed("openSync", (real, p, flags, ...rest) => {
    if (flags === "wx" && String(p) === lock) {
      tries.push(performance.now());
      throw Object.assign(new Error(`open '${p}'`), { code: tries.length > 9 ? "ESTOPPED" : "EPERM" });
    }
    return real(p, flags, ...rest);
  }, call);
  assert.equal(answer, true);
  assert.equal(tries.length, 8, "the first try and seven more");
  // Back to back, all eight would land inside the one deletion they wait out.
  assert.ok(tries[7] - tries[0] >= 100, `the tries spread over ${Math.round(tries[7] - tries[0])}ms`);
  assert.ok(performance.now() - started < 2000, `answered after ${Math.round(performance.now() - started)}ms`);
});

test("a lock token create refused while its name is being deleted is tried again, and the dead lock is broken", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => due(path, data));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const claim = join(data, "echo", name);
  const lock = `${claim}.lock`;
  writeFileSync(claim, "0\n");
  writeFileSync(lock, "");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  assert.equal(createRefused((p) => p.startsWith(`${lock}.`), 1, call), true);
  assert.deepEqual(readdirSync(join(data, "echo")), [name], "the dead lock and its lock token both gone");
  assert.notEqual(readFileSync(claim, "utf8"), "0\n", "and the batch claim written");
});

test("a dead lock the system will not remove answers as the transcript alone does, and the next call breaks it", (t) => {
  // Holding instead would silence the window for good wherever the refusal lasts.
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => due(path, data));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const claim = join(data, "echo", name);
  const lock = `${claim}.lock`;
  writeFileSync(claim, "0\n");
  writeFileSync(lock, "");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  assert.equal(removalRefused((p) => p === lock, call), true);
  assert.deepEqual(readdirSync(join(data, "echo")).sort(), [name, `${name}.lock`], "the dead lock and the batch claim, and no lock token");
  assert.equal(readFileSync(claim, "utf8"), "0\n", "no batch claim written by a call that answered alone");
  assert.equal(call(), true, "once the lock can be removed");
  assert.deepEqual(readdirSync(join(data, "echo")), [name]);
});

test("an empty directory a minute old at the lock's name is removed, and the call takes the lock", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => due(path, data));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const claim = join(data, "echo", name);
  const lock = `${claim}.lock`;
  writeFileSync(claim, "0\n");
  mkdirSync(lock);
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  assert.equal(call(), true);
  assert.deepEqual(readdirSync(join(data, "echo")), [name], "the directory and its lock token both gone");
  assert.notEqual(readFileSync(claim, "utf8"), "0\n", "and the batch claim written under the lock");
});

test("a directory holding a file at the lock's name is left whole, and each call answers as the transcript alone does", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => due(path, data);
  call();
  const [name] = readdirSync(join(data, "echo"));
  const claim = join(data, "echo", name);
  const lock = `${claim}.lock`;
  writeFileSync(claim, "0\n");
  mkdirSync(lock);
  writeFileSync(join(lock, "kept"), "theirs");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  for (let n = 0; n < 2; n++) {
    assert.equal(call(), true, `call ${n}`);
    assert.equal(readFileSync(join(lock, "kept"), "utf8"), "theirs");
    assert.deepEqual(readdirSync(join(data, "echo")).sort(), [name, `${name}.lock`], "and no lock token");
    assert.equal(readFileSync(claim, "utf8"), "0\n", "no batch claim written by a call that answered alone");
  }
});

test("a lock create refused for any reason but a deletion is not tried again", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => due(path, data);
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");

  let tries = 0;
  const answer = stubbed("openSync", (real, p, flags, ...rest) => {
    if (flags === "wx" && String(p) === lock && ++tries === 1) throw Object.assign(new Error(`EACCES: permission denied, open '${p}'`), { code: "EACCES" });
    return real(p, flags, ...rest);
  }, call);
  assert.equal(answer, true, "answered alone");
  assert.equal(tries, 1);
});

test("a call that broke a dead lock and finds a live one in its place stays silent", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => due(path, data));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");
  writeFileSync(lock, "");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  let creates = 0;
  const answer = stubbed("openSync", (real, p, flags, ...rest) => {
    // Another call takes the lock between this one's break and its create.
    if (p === lock && flags === "wx" && ++creates === 2) writeFileSync(lock, "");
    return real(p, flags, ...rest);
  }, call);

  assert.equal(creates, 2);
  assert.equal(answer, false);
});

test("a dead lock whose lock token another call holds is left to that call", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => due(path, data));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");
  writeFileSync(lock, "");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);
  const token = `${name}.lock.${statSync(lock, { bigint: true }).mtimeMs}`;
  writeFileSync(join(data, "echo", token), "");

  assert.equal(call(), false);
  assert.deepEqual(readdirSync(join(data, "echo")).sort(), [name, `${name}.lock`, token].sort(), "both left as they were");
});

test("a dead lock released before the call could break it is taken", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => lockEnds(() => due(path, data));
  call();
  const [name] = readdirSync(join(data, "echo"));
  const lock = join(data, "echo", `${name}.lock`);
  writeFileSync(join(data, "echo", name), "0\n");
  writeFileSync(lock, "");
  const dead = new Date(Date.now() - 60_000);
  utimesSync(lock, dead, dead);

  let tokens = 0;
  const answer = stubbed("openSync", (real, p, flags, ...rest) => {
    // Its holder releases it after this call took the lock token to break it.
    if (p.startsWith(`${lock}.`) && ++tokens === 1) rmSync(lock);
    return real(p, flags, ...rest);
  }, call);

  assert.equal(tokens, 1);
  assert.equal(answer, true);
  assert.deepEqual(readdirSync(join(data, "echo")), [name], "no lock and no lock token left");
});

test("a batch claim write that fails partway leaves the batch claim it replaces whole", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => due(path, data);
  call();
  const [name] = readdirSync(join(data, "echo"));
  const claim = join(data, "echo", name);
  const before = readFileSync(claim, "utf8");
  append(path, [filler(300 * 1024)]);

  let failed = false;
  const answer = stubbed("writeFileSync", (real, p, text, ...rest) => {
    if (!String(p).startsWith(join(data, "echo"))) return real(p, text, ...rest);
    failed = true;
    real(p, String(text).slice(0, 1));
    throw Object.assign(new Error("EIO"), { code: "EIO" });
  }, call);

  assert.equal(failed, true);
  assert.equal(answer, true, "a batch claim that cannot be written answers as the transcript alone");
  assert.equal(readFileSync(claim, "utf8"), before);
});

test("a batch claim from later in the same transcript keeps a sibling silent that read an earlier, shorter snapshot", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(300 * 1024)]);
  const call = () => due(path, data);
  call();
  const [name] = readdirSync(join(data, "echo"));

  for (const [what, after, held] of [["inside the window", 100, true], ["pushed out of the window since", 300 * 1024, false]]) {
    const claimedAt = statSync(path).size + Buffer.byteLength(`${JSON.stringify(filler(100))}\n`);
    writeFileSync(join(data, "echo", name), `${claimedAt}\n`);
    // The transcript grows after this call read it and before it reads the batch claim, as a sibling's record would.
    const mkdir = fs.mkdirSync;
    let grew = false;
    fs.mkdirSync = (...args) => {
      if (!grew) appendFileSync(path, [filler(100), ...(after > 100 ? [filler(after)] : [])].map((e) => `${JSON.stringify(e)}\n`).join(""));
      grew = true;
      return mkdir(...args);
    };
    syncBuiltinESMExports();
    let answer;
    try {
      answer = call();
    } finally {
      fs.mkdirSync = mkdir;
      syncBuiltinESMExports();
    }
    assert.equal(grew, true, `${what}: the transcript grew inside the call`);
    if (held) assert.equal(answer, false, what);
    else assert.equal(answer, true, what);
  }
});

test("a window's first batch delivers once, before anything is in its transcript", (t) => {
  const data = dataDir(t);
  const path = transcript(t, []);
  const call = () => due(path, data);

  assert.equal(call(), true);
  append(path, [filler(100)]);
  assert.equal(call(), false);
});

test("a batch claim after a compaction keeps nothing silent", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(10)]);
  const call = () => due(path, data);

  assert.equal(call(), true);
  append(path, [compact()]);
  assert.equal(call(), true);
});

test("with nowhere to keep a batch claim, every call of a batch answers as it would alone", (t) => {
  const path = transcript(t, [filler(10)]);
  const blocked = join(dataDir(t), "file");
  writeFileSync(blocked, "");

  const relative = `anatomiya-relative-${process.pid}`;
  t.after(() => removeTree(relative));
  for (const [what, data] of [["unset", null], ["relative", relative], ["a file", blocked], ["below a file", join(blocked, "x")]]) {
    for (let i = 0; i < 2; i++) assert.equal(due(path, data), true, what);
  }
  assert.equal(existsSync(relative), false, "a relative name is not resolved against the cwd");
});

test("batch claims older than a day are swept when a new one is made", (t) => {
  const data = dataDir(t);
  mkdirSync(join(data, "echo"));
  const old = join(data, "echo", "0000000000000000-000000000000");
  writeFileSync(old, "0\n");
  const twoDays = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  utimesSync(old, twoDays, twoDays);
  const recent = join(data, "echo", "1111111111111111-000000000000");
  writeFileSync(recent, "0\n");
  const lock = join(data, "echo", "0000000000000000-000000000000.lock");
  writeFileSync(lock, "");
  utimesSync(lock, twoDays, twoDays);
  const token = `${lock}.1700000000000`;
  writeFileSync(token, "");
  utimesSync(token, twoDays, twoDays);
  // A token's own token, left by a call killed breaking a token.
  const tokenOfToken = `${token}.1700000000001`;
  writeFileSync(tokenOfToken, "");
  utimesSync(tokenOfToken, twoDays, twoDays);
  const foreign = join(data, "echo", "notes.txt");
  writeFileSync(foreign, "");
  utimesSync(foreign, twoDays, twoDays);

  due(transcript(t, [filler(10)]), data);

  assert.equal(existsSync(old), false);
  assert.equal(existsSync(lock), false, "a lock left by a call that died");
  assert.equal(existsSync(token), false, "a lock token a call died holding");
  assert.equal(existsSync(tokenOfToken), false, "and a token's token");
  assert.equal(existsSync(recent), true);
  assert.equal(existsSync(foreign), true, "only a name a batch claim has");
  assert.equal(readdirSync(join(data, "echo")).length, 3);
});

test("a batch claim that is not one this hook wrote is replaced rather than believed", (t) => {
  const data = dataDir(t);
  const path = transcript(t, [filler(10)]);
  const call = () => due(path, data);
  assert.equal(call(), true);
  const [name] = readdirSync(join(data, "echo"));
  const claim = join(data, "echo", name);

  for (const content of ["", "12", "nonsense\n", "999999999\n"]) {
    writeFileSync(claim, content);
    assert.equal(call(), true, JSON.stringify(content));
    assert.equal(call(), false, `${JSON.stringify(content)} replaced`);
  }
});
