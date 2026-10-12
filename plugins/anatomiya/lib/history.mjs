/**
 * The two history walks, fed from a store of per-commit records where one can
 * be trusted and from `git log` where none can.
 *
 * Read whole, the authors walk is every commit, 63,000 on discourse, and the
 * co-change walk the newest 20,000, and a commit landing changes what no other
 * commit's diff says. So each commit's fields are kept by sha, git is asked
 * only for the order and for the commits the store lacks, and every commit is
 * replayed in that order through the walk's own reader. Measured after one
 * commit, the two walks with the write: 6.0 s to 2.6 s on discourse, 9.4 s to
 * 3.5 s on vscode. The order is git's on every scan: a merged branch lands its
 * commits among older ones, and a reader that follows renames answers
 * differently for another order.
 *
 * The store is a cache and never an answer of its own. Anything about it that
 * cannot be checked is the full walk.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import { gitBuffered, gitStreamed } from "./git.mjs";
import { buildVersion } from "./readiness.mjs";
import { resolveInside, STORE_DIR } from "./rules.mjs";
import { atomic, recordBytes } from "./store.mjs";

// What opens a commit's header. No status git prints holds it, so a field that
// holds it where a status goes is a header; a path may hold it, and is told
// from one by where it sits.
export const SEP = "\x1e";

/** The store's file per walk, in the store directory. */
export const HISTORY_FILES = { authors: "history-authors.gz", cochange: "history-cochange.gz" };

export const HISTORY = {
  // The most a store inflates to, and so the most one is written with: a file
  // past it is refused before its bytes are held, however small it sits on disk.
  mostBytes: 256 * 1024 * 1024,
};

// What the stamp means by "this layout": the header lines and the record framing below.
const LAYOUT = 1;

// Two lines before the records: the stamp, then the records' own digest, each 64 hex digits.
const HEAD_BYTES = 130;

// Measured on discourse's 32.7 MB of records: level 1 packs in 235 ms to 6.1 MB, level 6 in 792 ms
// to 5.1 MB, and the write is paid on every scan that met a new commit.
const GZIP_LEVEL = 1;

// How many commits are replayed before the event loop is given back.
const REPLAY_SLICE = 2000;

// What one scan's `history` carries between its two walks and its write, kept off the object the caller reads.
const scans = new WeakMap();
const scanOf = (history) => scans.get(history) ?? scans.set(history, { besides: null, pending: [] }).get(history);

const zip = promisify(gzip);
const unzip = promisify(gunzip);

const PLAIN = `${SEP}%aE`;
const NAMED = `${SEP}%H %aE`;
const NAME = /^([0-9a-f]{64}|[0-9a-f]{40}) /;
const FRAME = /^([0-9a-f]{64}|[0-9a-f]{40}) (\d{1,10})$/;

// Nothing follows `--`, which is the rule for every git call here: no argument after it can be read as an option.
const logArgs = (walk, format) => [...walk.config, "log", ...walk.tip, ...walk.walk, ...walk.diff, `--format=${format}`, ...walk.cap, "--"];
const orderArgs = (walk) => ["rev-list", ...(walk.tip.length ? walk.tip : ["HEAD"]), ...walk.walk, ...walk.cap, "--"];
// The listed commits and no other: what selects and bounds the walk is the order's to say.
const onlyArgs = (walk) => [...walk.config, "log", "--no-walk=unsorted", "--stdin", ...walk.diff, `--format=${NAMED}`, "--"];

/**
 * Feed every NUL-delimited field of a walk to the reader `open` answers with.
 *
 * `walk` is the walk's own git arguments in parts: `config` before the
 * subcommand, `tip` the commit it starts from or none for HEAD, `walk` what
 * selects commits, `diff` what each commit prints, `cap` the count it stops
 * at. `renames` says a rename row carries two paths, and `kind` names the file.
 *
 * `open` is called again where a read had to be given up part way, so a reader
 * that was fed half a history is never the one that answers. Without `history`
 * the walk is the plain one. With it, `history[kind]` says how many commits
 * came from the store and how many git was asked for, and `saveHistory` writes
 * what the walk left on it.
 */
export async function historyFields(root, walk, open, { history = null, signal = null } = {}) {
  // `--format` leaves the final record unterminated, so a remainder at exit is
  // the last commit's header or path rather than a truncated one.
  const run = (args, onField, more = {}) => gitStreamed(root, args, onField, { terminated: false, env: walk.env, signal, ...more });
  const plain = () => run(logArgs(walk, PLAIN), open());
  if (history === null) return plain();
  // `walked` stays null where the plain walk answered, which counts no commits.
  const said = (history[walk.kind] = { stored: 0, walked: null, wrote: false });
  const store = await openStore(root, walk, history);
  if (store === null) return plain();
  const leave = (body) => scanOf(history).pending.push({ kind: walk.kind, stamp: store.stamp, body });

  if (store.at !== null) {
    const replay = await replayable(root, walk, store, run).catch(() => null);
    if (replay !== null) {
      const { order, read } = replay;
      const onField = open();
      for (const [i, sha] of order.entries()) {
        // The walk it stands in for arrived a chunk at a time, and the scan's other work ran between the chunks.
        if (i % REPLAY_SLICE === REPLAY_SLICE - 1) await new Promise(setImmediate);
        for (const field of read.get(sha) ?? fieldsAt(store, sha)) onField(field);
      }
      said.stored = order.length - read.size;
      said.walked = read.size;
      // Written only for a commit it did not hold. One it holds and the order
      // no longer names goes at that write, and costs nothing until then.
      if (read.size > 0) {
        const records = order.map((sha) => (read.has(sha) ? Buffer.from(framed(sha, read.get(sha))) : store.body.subarray(store.at.get(sha)[0], store.at.get(sha)[2])));
        if (records.reduce((sum, record) => sum + record.length, HEAD_BYTES) <= HISTORY.mostBytes) leave(() => Buffer.concat(records));
      }
      return;
    }
  }

  const kept = keeper();
  const split = splitter(walk.renames, open(), kept.add);
  try {
    await run(logArgs(walk, NAMED), split.field);
  } catch (err) {
    if (!err.ambiguous) throw err;
    return plain();
  }
  const whole = split.end();
  said.walked = kept.count();
  if (whole && kept.sound()) leave(kept.body);
}

/** Write what each walk of one scan left to be kept. A store that cannot be written is the full walk next time. */
export async function saveHistory(root, history) {
  for (const { kind, stamp, body } of scanOf(history).pending.splice(0)) {
    try {
      // Resolved again: the walk asked before the map was written. The directory is the map's
      // to make, so where a scan made none the write fails and no history is kept either.
      const dir = resolveInside(root, STORE_DIR);
      if (dir === null) continue;
      const records = body();
      atomic(join(dir, HISTORY_FILES[kind]), await zip(Buffer.concat([Buffer.from(`${stamp}\n${digest(records)}\n`), records]), { level: GZIP_LEVEL }));
      history[kind].wrote = true;
    } catch {}
  }
}

/**
 * The store for one walk: its stamp, and where each commit's record sits in
 * what the file held, or `at: null` where no file there can be used. Null
 * where a store may be neither read nor kept: outside the repository's own
 * `.claude`, tracked, or under a stamp that could not be taken.
 */
async function openStore(root, walk, history) {
  const dir = resolveInside(root, STORE_DIR);
  if (dir === null) return null;
  const [stamp, tracked] = await Promise.all([stampOf(root, walk, history), isTracked(root, walk)]);
  if (stamp === null || tracked) return null;
  const none = { stamp, body: null, at: null };
  const packed = recordBytes(join(dir, HISTORY_FILES[walk.kind]));
  if (!packed) return none;
  let text;
  try {
    text = await unzip(packed, { maxOutputLength: HISTORY.mostBytes });
  } catch {
    return none;
  }
  const head = Buffer.from(`${stamp}\n`);
  if (!text.subarray(0, head.length).equals(head)) return none;
  // The records' own digest on the second line, so an edit that keeps every length is still seen.
  const body = text.subarray(HEAD_BYTES);
  if (text.latin1Slice(head.length, HEAD_BYTES) !== `${digest(body)}\n`) return none;
  return { stamp, body, at: indexOf(body) };
}

/**
 * Whether git tracks the store. A tracked one came with the clone, so it is the
 * repository's word for who touched what and not this tool's, and writing one
 * would leave a change in the tree. Asked in any case: a name tracked in
 * another spelling is this file wherever the volume folds case. A git that
 * will not say reads as tracked.
 */
async function isTracked(root, walk) {
  const listed = await gitBuffered(root, ["ls-files", "-z", "--", `:(icase)${STORE_DIR}/${HISTORY_FILES[walk.kind]}`], { env: walk.env });
  return !listed.ok || listed.stdout !== "";
}

/**
 * Everything a commit's record depends on besides the commit, as one digest, or
 * null where part of it could not be read: then nothing is replayed and
 * nothing is kept. Compared whole, so nothing in it is ever close enough.
 *
 * Only the digest is stored. The configuration it covers names paths and can
 * hold a token, and the store sits in a directory a repository may commit.
 */
async function stampOf(root, walk, history) {
  // Read once for the two walks of one scan.
  const besides = await (scanOf(history).besides ??= readBesides(root, walk.env));
  if (besides === null) return null;
  // The walk's arguments less where it starts: the tip is what is asked, and a record does not depend on it.
  return digest(JSON.stringify([LAYOUT, buildVersion(), logArgs({ ...walk, tip: [] }, NAMED), besides]));
}

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * The configuration sections left out of the stamp: none can change what
 * `git log` prints, and each is rewritten often or holds a secret. `branch` is
 * the upstream a new branch tracks. `remote` is where a fetch goes, and the
 * one key of it a walk reads, the promisor flag, is in the walk's own
 * arguments as `-M100%`. `user` is who commits next. `credential`, `url` and
 * `http` are how a remote is reached and where a token is kept. Every other
 * key stays in, so one nobody thought of refuses the store instead of lying.
 */
const NOT_STAMPED = /^(?:branch|remote|user|credential|url|http)\./;

/**
 * The variables that move a commit's parents, the objects that stand in for
 * it, or the files below, as git documents them. `GIT_CONFIG_*` is not here:
 * the configuration is read under the same environment.
 */
const STAMPED_ENV = [
  "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_GRAFT_FILE", "GIT_SHALLOW_FILE", "GIT_NO_REPLACE_OBJECTS", "GIT_REPLACE_REF_BASE",
];

// Past this a mailmap or a list of grafts is not one anybody wrote, and the walk is cheaper than the read.
const STAMPED_FILE_MOST = 8 * 1024 * 1024;

async function readBesides(root, env) {
  const ask = (args) => gitBuffered(root, args, { env });
  const [version, listed, common, replaced] = await Promise.all([
    ask(["version"]),
    ask(["config", "--list", "--null"]),
    ask(["rev-parse", "--git-common-dir"]),
    ask(["for-each-ref", "--format=%(refname) %(objectname)", env.GIT_REPLACE_REF_BASE ?? "refs/replace/"]),
  ]);
  if (![version, listed, common, replaced].every((r) => r.ok)) return null;
  const config = listed.stdout.split("\0").filter(Boolean);
  // The last entry wins for a single-valued key, as git reads them.
  const valueOf = (key) => config.findLast((entry) => entry.startsWith(`${key}\n`))?.slice(key.length + 1);

  const gitDir = resolve(root, common.stdout.replace(/\r?\n$/, ""));
  const mapFile = valueOf("mailmap.file");
  // `~user` and the `:(optional)` spelling are git's to expand, so a file named that way is not one this can watch.
  if (mapFile !== undefined && /^(?:~[^/]|:\()/.test(mapFile)) return null;
  const files = [
    join(root, ".mailmap"),
    mapFile === undefined ? null : resolve(root, mapFile.replace(/^~(?=\/)/, homedir())),
    env.GIT_SHALLOW_FILE ? resolve(root, env.GIT_SHALLOW_FILE) : join(gitDir, "shallow"),
    env.GIT_GRAFT_FILE ? resolve(root, env.GIT_GRAFT_FILE) : join(gitDir, "info", "grafts"),
  ].map((path) => (path === null ? "unset" : fileDigest(path)));
  if (files.includes(null)) return null;

  // Whatever the name resolves to, or nothing where git would find no blob there either.
  const mapBlob = valueOf("mailmap.blob");
  const blob = mapBlob === undefined ? "unset" : (await ask(["rev-parse", "--verify", "--quiet", mapBlob])).stdout;

  return [version.stdout, digest(config.filter((entry) => !NOT_STAMPED.test(entry)).join("\0")), files, blob, replaced.stdout, STAMPED_ENV.map((name) => env[name] ?? null)];
}

// A digest of the file's bytes, "absent" where nothing is there, null where it cannot be read whole.
function fileDigest(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    return stat.isFile() && stat.size <= STAMPED_FILE_MOST ? digest(readFileSync(fd)) : null;
  } catch (err) {
    return err.code === "ENOENT" || err.code === "ENOTDIR" ? "absent" : null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// One record: the commit, the byte length of what follows, and its fields joined on the NUL no field can hold.
function framed(sha, fields) {
  const payload = fields.join("\0");
  return `${sha} ${Buffer.byteLength(payload)}\n${payload}`;
}

/** Where each commit's record starts, where its fields start and where it ends, or null where `body` is not records end to end. */
function indexOf(body) {
  const at = new Map();
  let from = 0;
  while (from < body.length) {
    const nl = body.indexOf(10, from);
    const frame = nl === -1 || nl - from > 80 ? null : FRAME.exec(body.latin1Slice(from, nl));
    if (frame === null) return null;
    const end = nl + 1 + Number(frame[2]);
    // One record a commit, each opening with its header: which of two would answer is not the store's to choose.
    if (end > body.length || at.has(frame[1]) || body[nl + 1] !== SEP.charCodeAt(0)) return null;
    at.set(frame[1], [from, nl + 1, end]);
    from = end;
  }
  return at;
}

const fieldsAt = (store, sha) => store.body.toString("utf8", store.at.get(sha)[1], store.at.get(sha)[2]).split("\0");

/**
 * Git's order for the walk and the records of the commits the store lacks, or
 * null where the two do not account for every commit exactly once.
 */
async function replayable(root, walk, store, run) {
  let listed = "";
  await run(orderArgs(walk), (text) => {
    listed += text;
  });
  const order = listed.split("\n").filter(Boolean);
  const missing = order.filter((sha) => !store.at.has(sha));
  const read = new Map();
  if (missing.length === 0) return { order, read };
  let twice = false;
  const split = splitter(walk.renames, () => {}, (sha, fields) => {
    if (read.has(sha)) twice = true;
    read.set(sha, fields);
  });
  await run(onlyArgs(walk), split.field, { input: `${missing.join("\n")}\n` });
  return split.end() && !twice && read.size === missing.length && missing.every((sha) => read.has(sha)) ? { order, read } : null;
}

/**
 * Split a stream whose headers name their commit into one record per commit,
 * handing `onField` each field as the plain walk would have printed it.
 *
 * A header is told from a path by position, the way both readers consume one:
 * after a status the next field is its path, and after a rename or a copy the
 * next two. A path may hold the separator; a field read for a status may hold
 * it once, followed by the commit. Anything else throws `ambiguous`, since
 * where the commit's name ends can then only be guessed.
 *
 * A record is the header from its separator on and the fields that say
 * something. An empty field, the newlines before a header and a run of them
 * alone are left out: both readers pass over them, and which commit git
 * printed them after depends on where the commit sat in its stream.
 */
function splitter(renames, onField, onRecord) {
  let owed = 0;
  let sha = null;
  let fields = null;
  const close = () => {
    if (fields !== null) onRecord(sha, fields);
    fields = null;
  };
  const field = (given) => {
    if (owed > 0) {
      owed--;
      fields.push(given);
      onField(given);
      return;
    }
    const at = given.indexOf(SEP);
    let fed = given;
    let status = given;
    if (at !== -1) {
      const named = NAME.exec(given.slice(at + 1, at + 66));
      if (named === null || given.indexOf(SEP, at + 1) !== -1) throw ambiguous();
      close();
      sha = named[1];
      fed = given.slice(0, at + 1) + given.slice(at + 2 + sha.length);
      fields = [fed.slice(at)];
      const nl = fed.indexOf("\n", at);
      status = nl === -1 ? "" : fed.slice(nl + 1);
    }
    status = status.replace(/^\n+/, "");
    if (status) {
      if (fields === null) throw ambiguous();
      if (at === -1) fields.push(given);
      owed = renames && /^[RC]\d*$/.test(status) ? 2 : 1;
    }
    onField(fed);
  };
  return {
    field,
    // False where the stream stopped inside a row, so its last record is short.
    end() {
      close();
      return owed === 0;
    },
  };
}

const ambiguous = () => Object.assign(new Error("a field of the log names its commit in no way this reads"), { ambiguous: true });

/**
 * The records of a full walk as the bytes a store holds, in the order they
 * came. Past the bound it holds nothing more and is not `sound`: a history
 * that large is walked every time, in the memory the walk always took.
 */
function keeper() {
  const seen = new Set();
  let chunks = [];
  let parts = [];
  let held = 0;
  let bytes = HEAD_BYTES;
  let twice = false;
  const flush = () => {
    const chunk = Buffer.from(parts.join(""));
    parts = [];
    held = 0;
    if ((bytes += chunk.length) > HISTORY.mostBytes) chunks = null;
    else chunks.push(chunk);
  };
  return {
    add(sha, fields) {
      if (seen.has(sha)) twice = true;
      seen.add(sha);
      if (chunks === null) return;
      const record = framed(sha, fields);
      parts.push(record);
      // Flushed by the megabyte: a million short strings held to the end is heap, and bytes are not.
      if ((held += record.length) > 1024 * 1024) flush();
    },
    count: () => seen.size,
    sound() {
      if (chunks !== null) flush();
      return chunks !== null && !twice;
    },
    body: () => Buffer.concat(chunks),
  };
}
