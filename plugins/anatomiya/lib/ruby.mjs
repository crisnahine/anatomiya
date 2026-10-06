import { guardedChild, absentInterpreter } from "./child.mjs";
import { collectHits } from "./walk.mjs";
import { walkRuby } from "./ruby-walk.mjs";
import { rubyFacets } from "./facets.mjs";
import { guardsOver, MAX_FILE_BYTES } from "./limits.mjs";
import { firstLine } from "./encode.mjs";
import { olderThan } from "./version.mjs";
import { ENGINES } from "./langs.mjs";
import { defaultPoolSize } from "./pool.mjs";
import { execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute } from "node:path";
import { Worker } from "node:worker_threads";

/**
 * Ruby files, parsed by prism, in the shape the reducer already consumes.
 *
 * prism is safe in-process, so unlike oxc it needs no pool of one-file-per-
 * process workers: an explicit `rescue SystemStackError` contains the only
 * measured failure. But prism runs in Ruby, so the process boundary is here
 * anyway, and it is a *streaming* one. Buffering a subprocess through execFile
 * throws `RangeError: Invalid string length` from inside Node's own exit
 * handler, with maxBuffer set far above the output size, and no error is
 * attributable to a file. So: spawn, one JSON object per line, parsed as it
 * arrives.
 */

export const RUBY_GUARDS = {
  maxBytes: MAX_FILE_BYTES,
  // What a hung parse looks like is silence, so silence is what is timed first.
  idleMs: 15_000,
  // And a wall clock behind it, because silence is not the only way a child
  // fails to end: one that keeps answering slowly forever never trips the idle
  // timer, and every subprocess here owes a timeout rather than a
  // liveness check. A large repository legitimately runs for minutes, so the
  // ceiling is derived from how much work was handed over rather than fixed.
  // Measured at 6,867 files/sec, so this is roughly two hundred times the
  // budget a real corpus needs.
  wallBaseMs: 60_000,
  wallPerFileMs: 30,
  // No cumulative output cap. The stream is drained a line at a time, so total
  // output is not held anywhere and capping it only truncated large
  // repositories, which suppresses every directive in the map. What V8 actually
  // refuses is one enormous string, and that is per line.
  maxLineBytes: 64 * 1024 * 1024,
  stderrBytes: 8 * 1024,
};

// Every prism this interpreter holds, default or installed, by version and the
// directories that load it. Asked of RubyGems' own records and never of prism,
// so an interpreter whose prism is too old still answers. Started with gems
// disabled and json required before RubyGems is, so json is the interpreter's
// own copy: with gems enabled, the newest installed json gem was activated,
// and one that raised cost every prism choice. RubyGems still evaluates the
// installed `.gemspec` records to answer; no gem's library is loaded.
const LIST_PRISM = `require "json"
require "rubygems"
print JSON.generate(Gem::Specification.find_all_by_name("prism").map { |s|
  { "version" => s.version.to_s, "default" => s.default_gem?, "paths" => s.full_require_paths }
})`;

/**
 * The environment the listing runs under: the parser's scrub, plus the few
 * variables that say where gems are installed.
 *
 * `GEM_HOME` and `GEM_PATH` are where rvm and chruby install every gem,
 * `gem install prism` included, so a listing without them misses the one the
 * remedy just installed. They only name directories to read records from; the
 * parser still runs without them and with gems disabled, and `RUBYOPT` and
 * `RUBYLIB`, which inject code, stay dropped here too. `HOME` and
 * `USERPROFILE` locate a `--user-install`, and so does `XDG_DATA_HOME`:
 * RubyGems puts one under `$XDG_DATA_HOME/gem` when `~/.gem` does not exist,
 * and without it the listing looked under `~/.local/share` and missed the
 * prism the remedy had just installed.
 */
function gemEnv(source) {
  const env = rubyEnv(source);
  for (const k of ["GEM_HOME", "GEM_PATH", "HOME", "USERPROFILE", "XDG_DATA_HOME"]) {
    if (source[k]) env[k] = source[k];
  }
  return env;
}

/**
 * List the prism gems an interpreter holds. `null` when it could not say:
 * absent, too slow, or an answer of any other shape, each of which leaves the
 * interpreter's own default to answer for itself.
 *
 * Buffered and bounded like the readiness probe's version question, outside the
 * repository and with no shell, since it points an interpreter at whatever
 * `PATH` names.
 */
export function listPrism({ ruby = "ruby", env = process.env, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      ruby,
      ["--disable-gems", "-e", LIST_PRISM],
      { cwd: tmpdir(), env: gemEnv(env), encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 64 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      }
    );
  });
}

/**
 * The argv that asks an interpreter which prism the given load path loads: one
 * spelling, for the load check here and the readiness probe, which asked the
 * same question with a copy of its own.
 */
export const prismVersionArgs = (load) => ["--disable-gems", ...load, "-rprism", "-e", "print Prism::VERSION"];

/**
 * The arguments that put the chosen prism on the load path, for every child
 * that loads prism: the parser and the readiness probe answer about the same
 * library only if they are handed the same one. Empty when the default
 * answers.
 */
export async function prismLoadArgs(options = {}) {
  let specs = await listPrism(options);
  for (;;) {
    const chosen = choosePrism(specs, ENGINES.prism.floor);
    if (!chosen) return [];
    const load = chosen.paths.flatMap((p) => ["-I", p]);
    if ((await loadedVersion(load, options)) === chosen.version) return load;
    // Listed is not loadable. A gem whose extension was built for another
    // Ruby, which a shared GEM_HOME keeps after an upgrade, is one RubyGems
    // itself skips, and handed to the parser it failed to load at all: doctor
    // said prism was not installed and hid the default that does load. The
    // next newest is asked instead, and the default answers when none loads.
    specs = specs.filter((s) => s.paths !== chosen.paths);
  }
}

/**
 * The version a prism on these load paths answers when this interpreter
 * requires it, or null when it does not load. The same question the readiness
 * probe asks, bounded the way the listing is.
 */
function loadedVersion(load, { ruby = "ruby", env = process.env, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      ruby,
      prismVersionArgs(load),
      { cwd: tmpdir(), env: rubyEnv(env), encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 64 * 1024 },
      (err, stdout) => resolve(err ? null : stdout.trim())
    );
  });
}

/**
 * Which installed prism the parser loads, off a listing of every one this
 * interpreter holds: `null` to load the interpreter's own default, or the one
 * to put on the load path instead.
 *
 * The default wins whenever it is past the floor, so an interpreter that ships
 * a prism this reads loads exactly what it always did. Under the floor, the
 * newest installed prism past it answers instead: Ruby 3.3 ships prism 0.19,
 * and `gem install prism` puts a 1.x beside it on any Ruby from 2.7, which the
 * parser could not see because it runs with gems disabled.
 *
 * A path that is not absolute, or that argv could read as a flag, is not a
 * path this hands to an interpreter (F5), and a listing of any other shape
 * adds nothing rather than something it made up.
 */
export function choosePrism(specs, floor) {
  if (!Array.isArray(specs)) return null;
  const usable = specs.filter(
    (s) =>
      s && typeof s.version === "string" && Array.isArray(s.paths) && s.paths.length > 0
      && s.paths.every((p) => typeof p === "string" && isAbsolute(p) && !p.startsWith("-"))
      && !olderThan(s.version, floor)
  );
  if (usable.some((s) => s.default === true)) return null;
  const installed = usable.filter((s) => s.default !== true);
  if (installed.length === 0) return null;
  const newest = installed.reduce((a, b) => (olderThan(a.version, b.version) ? b : a));
  return { version: newest.version, paths: newest.paths };
}

/**
 * The parser process loads nothing but the standard library.
 *
 * prism is a default gem, so --disable-gems still finds it while closing the
 * gem-activation path entirely. RUBYOPT, RUBYLIB and GEM_HOME are dropped for
 * the same reason: each one can inject a `-r` into a process we are about to
 * point at repository files.
 *
 * Exported because the readiness probe spawns the same interpreter to ask which
 * prism it would load, and a probe run under a different environment from the
 * parse answers about a different interpreter.
 *
 * `PATH` keeps its absolute entries only. The command is looked up on the
 * child's own `PATH`, and an empty or relative entry is resolved against the
 * child's working directory, which is the temp directory anyone can write:
 * measured with the common trailing colon on a machine with no ruby, the
 * listing, the probe and the parser each ran a `ruby` another local user had
 * left in /tmp, as the person scanning.
 */
export function rubyEnv(source = process.env) {
  const PATH = (source.PATH ?? "").split(delimiter).filter((dir) => isAbsolute(dir)).join(delimiter);
  const env = { PATH, LANG: "C" };
  // Windows refuses to start a side-by-side assembly without a valid
  // %SystemRoot%, which a stripped environment does not carry, so the
  // interpreter never runs at all. Documented in Python's own subprocess
  // notes, and the same rule applies to any spawn with a replaced env.
  if (process.platform === "win32") {
    for (const k of ["SystemRoot", "SYSTEMROOT", "COMSPEC", "windir"]) {
      if (source[k]) env[k] = source[k];
    }
  }
  return env;
}

/**
 * Paths arrive on stdin as NUL-delimited rel/abs pairs, never in argv: git
 * permits newlines in a path, and a path is the one value here the repository
 * controls. Nothing repository-derived reaches the command line, which closes
 * the whole argument-injection class rather than filtering it.
 *
 * The error text is a class name, never a message. A message can quote source.
 *
 * A function of the one guard the script itself enforces, so a caller's
 * override reaches the in-script size check instead of dying at the merge.
 * Refused unless a finite number: interpolated raw, a mistyped override
 * becomes Ruby that dies at load and reads as a broken install.
 */
const scriptFor = (maxBytes) => {
  // `typeof` before finiteness: `Number(null)` is a finite zero, and a zero
  // cap silently marks every file over it.
  if (typeof maxBytes !== "number" || !Number.isFinite(maxBytes)) {
    throw new Error(`maxBytes must be a number, not ${JSON.stringify(maxBytes)}`);
  }
  return script(maxBytes);
};

const script = (maxBytes) => `
require "json"

# A Ruby with no prism at all (2.7 to 3.2 before \`gem install prism\`) raised
# here, before anything could say why, and every file read as crashing the
# parser: check found nothing and scan wrote nothing, with no remedy named.
begin
  require "prism"
rescue LoadError
  $stdout.write(JSON.generate({ "fatal" => "prism is not installed for this ruby" }))
  $stdout.write("\\n")
  exit 1
end

MAX_BYTES = ${maxBytes}
SKIP = [:location, :node_id, :locals, :flags, :depth].freeze
STR_CAP = 40

def conv(v)
  case v
  when Prism::Node
    # A line, never an offset: a hit has to name where it is, and a line number
    # cannot be handed to a slice of the wrong string the way an offset can.
    h = { "t" => v.type.to_s.delete_suffix("_node"), "line" => v.location.start_line }
    v.deconstruct_keys(nil).each do |k, val|
      next if SKIP.include?(k) || k.to_s.end_with?("_loc")
      c = conv(val)
      next if c.nil? || (c.is_a?(Array) && c.empty?)
      h[k.to_s] = c
    end
    h
  when Array then v.map { |x| conv(x) }.compact
  when Symbol then v.to_s
  when String then utf8(v.length > STR_CAP ? v[0, STR_CAP] : v)
  # \`1e400\` is Infinity, which JSON cannot spell: the encoder raised and a file
  # prism read cleanly was reported unread. No dimension reads a float's value.
  when Float then v.finite? ? v : nil
  when Integer, true, false then v
  end
end

# A string as JSON can carry it. \`# encoding: ascii-8bit\` makes "\\xff" a
# binary string, which scrub leaves alone and the encoder refused, dropping the
# whole file; its bytes are read as UTF-8 and whatever is not is removed.
def utf8(v)
  return v.scrub("") if v.encoding == Encoding::UTF_8
  return v.dup.force_encoding("UTF-8").scrub("") if v.encoding == Encoding::BINARY
  v.encode("UTF-8", invalid: :replace, undef: :replace, replace: "")
rescue EncodingError
  v.dup.force_encoding("UTF-8").scrub("")
end

# No nesting cap. A node is one to three JSON levels, and the default of 100
# charged a 98-branch elsif chain as a file that could not be parsed, though
# prism found no error in it. conv runs out of stack near 2,000 levels, well
# before the encoder would, and that is rescued as the file exhausting the
# parser.
def emit(h)
  $stdout.write(JSON.generate(h, max_nesting: false))
  $stdout.write("\\n")
end

$stdout.binmode
$stdin.binmode
emit({ "ready" => true, "prism" => Prism::VERSION })

# prism 0.x spells the fields the dimensions read differently: a rescue chain
# links through consequent rather than subsequent, a constant path through
# child rather than name. Nothing would raise; every count would silently come
# back zero and the repository would read as having no conventions.
if Prism::VERSION.split(".").first.to_i < 1
  emit({ "fatal" => "prism " + Prism::VERSION + " predates the field names this reads" })
  exit 1
end

# prism parses as the newest Ruby it knows unless told otherwise, and this runs
# on the repository's own interpreter: on Ruby 3.3, \`a[0, k: 1] = 2\`, which
# Ruby accepts and 3.4 made an error, counted as a syntax error and the file
# went unread. An interpreter older than the oldest grammar prism carries (3.3)
# is read with that one, the nearest it has; one newer than prism knows, or a
# prism that takes no version, parses as it always did.
PARSE_OPTIONS = begin
  want = (RUBY_VERSION.split(".").map(&:to_i) <=> [3, 3]) < 0 ? "3.3.0" : RUBY_VERSION
  Prism.parse("", version: want)
  { version: want }
rescue ArgumentError, TypeError
  {}
end

data = $stdin.read.to_s.force_encoding("UTF-8")
data.split("\\0").each_slice(2) do |rel, abs|
  next if rel.nil? || rel.empty? || abs.nil? || abs.empty?
  begin
    if File.size(abs) > MAX_BYTES
      emit({ "rel" => rel, "ok" => false, "error" => "over size cap", "skipped" => true })
      next
    end
    src = File.read(abs, encoding: "UTF-8")
    r = Prism.parse(src, **PARSE_OPTIONS)
    # prism recovers past a syntax error and hands back a tree holding nodes
    # nobody wrote. Counting it moves the denominator without moving the code,
    # so the file is reported unread, the way an over-cap file already is.
    if r.errors.any?
      emit({ "rel" => rel, "ok" => false, "errors" => r.errors.length,
             "error" => r.errors.length.to_s + " syntax error(s)" })
      next
    end
    emit({ "rel" => rel, "ok" => true, "ast" => conv(r.value),
           "errors" => 0, "length" => src.length })
  rescue SystemStackError, NoMemoryError
    emit({ "rel" => rel, "ok" => false, "error" => "parser exhausted", "crashed" => true })
  rescue StandardError => e
    emit({ "rel" => rel, "ok" => false, "error" => e.class.to_s })
  end
end
`;

// Each child is handed at least this many files: for fewer, an interpreter's
// startup costs more than it saves.
const MIN_SHARD_FILES = 500;
// Six since each shard walks its own trees: while the parent walked them all,
// a fifth and sixth child only queued more for it (13.5s against 12.8s on
// discourse). Scan medians of three under the bench lock, four against six:
// discourse 10.2s against 8.7s, empire-flippers/api 2.79s against 2.58s for
// 26 MB more peak memory.
const MAX_SHARDS = Math.min(6, defaultPoolSize());

function shardsFor(count) {
  return Math.max(1, Math.min(MAX_SHARDS, Math.floor(count / MIN_SHARD_FILES)));
}

const SHARD = new URL("./ruby-shard.mjs", import.meta.url);

/**
 * Which files each shard reads, as indexes into `sizes`: the largest file goes
 * first into the lightest shard, and an equal load goes to the shard holding
 * fewer files. Contiguous batches put the heavy end of a tree in one child,
 * and the scan waited on that child. Each shard lists its files in input order
 * and the shards follow their first file, so a child reads in the order it was
 * always handed and the merge below meets the batches in the same order.
 */
export function shardsBySize(sizes, count) {
  const shards = Array.from({ length: Math.max(1, count) }, () => ({ load: 0, files: [] }));
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b] - sizes[a]);
  for (const i of order) {
    let lightest = shards[0];
    for (const s of shards) {
      if (s.load < lightest.load || (s.load === lightest.load && s.files.length < lightest.files.length)) lightest = s;
    }
    lightest.load += sizes[i];
    lightest.files.push(i);
  }
  return shards
    .filter((s) => s.files.length)
    .map((s) => s.files.sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0]);
}

// The child reports what it cannot read and skips what is over the cap; for
// balance either weighs nothing.
const bytesOf = (abs, maxBytes) => stat(abs).then((s) => (s.size > maxBytes ? 0 : s.size), () => 0);

/**
 * Parse Ruby files. Resolves once every child has exited or a guard has fired.
 *
 * The results are the whole record: `parse.mjs` classifies every outcome off
 * them, so no count rides beside them.
 *
 * `dimensions` must be rows of `ALL_DIMENSIONS`: they reach the shard threads
 * by key, and a row the registry does not hold charges its batch as crashed.
 */
export async function parseRuby(
  files,
  { ruby = "ruby", guards: given = null, dimensions = [], shards = shardsFor(files.length) } = {},
) {
  const guards = guardsOver(RUBY_GUARDS, given, "prism");
  // Built once, and before any child: a bad override refuses here, loudly,
  // rather than dying inside the spawn where it reads as a broken install.
  const rubyScript = scriptFor(guards.maxBytes);
  if (files.length === 0) return blank();
  const load = await prismLoadArgs({ ruby });

  // One child left the parent idle for most of a large Ruby repository, and
  // with several the parent's own reading of the trees was what the scan
  // waited on: on empire-flippers/api, 2.28s of a 3.45s parse phase. So each
  // shard is a worker thread that runs its child, reads the trees and answers
  // the rows, and a scan gets only counts back, as B10 does for JavaScript. A
  // check asks for no rows, so the trees of the files it touched do cross.
  const keys = dimensions.map((d) => d.key);
  const sizes = await Promise.all(files.map((f) => bytesOf(f.abs, guards.maxBytes)));
  const outs = await Promise.all(
    shardsBySize(sizes, shards).map((ix) =>
      inWorker(ix.map((i) => files[i]), { ruby, guards, rubyScript, load, keys }, ix.reduce((most, i) => Math.max(most, sizes[i]), 0)),
    ),
  );

  const out = blank();
  for (const o of outs) {
    for (const r of o.results) out.results.push(r);
    out.truncated = out.truncated || o.truncated;
    out.version ??= o.version;
    out.error ??= o.error;
    out.missingParser ??= o.missingParser;
    out.stalled ??= o.stalled;
  }
  // Stalled says no child ever started reading, which one that answered disproves.
  if (out.version !== null) out.stalled = null;
  // Back in the order the files were handed over, which the records' insertion
  // order and every tie downstream of it read.
  const at = new Map();
  files.forEach((f, i) => at.has(f.rel) || at.set(f.rel, i));
  out.results.sort((a, b) => (at.get(a.rel) ?? files.length) - (at.get(b.rel) ?? files.length));
  return out;
}

/**
 * A shard's heap is held to what its largest file needs, because V8 grows a
 * heap toward its limit rather than its live set: four threads at the default
 * limit took a scan of empire-flippers/api from 176 MB peak to 318 MB, and
 * held it is 197 MB against 183 MB. Measured, a 588 KB spec needs 20 MB of old
 * generation. A tree that outgrows its hold anyway is read again on a thread
 * with the default heap, with every file not yet answered, so the hold costs
 * time and never a file, and a record already answered is kept rather than
 * read twice.
 */
function heldHeap(largestBytes) {
  return { maxYoungGenerationSizeMb: 1, maxOldGenerationSizeMb: 8 + Math.ceil((32 * largestBytes) / (1024 * 1024)) };
}

async function inWorker(files, job, largestBytes) {
  const held = await onThread(files, job, heldHeap(largestBytes));
  if (!held.ranOut) return held;
  const answered = new Set(held.results.map((r) => r.rel));
  const rest = await onThread(files.filter((f) => !answered.has(f.rel)), job, null);
  return { ...rest, results: [...held.results, ...rest.results] };
}

/**
 * One shard in a worker thread. A worker that ends without answering charges
 * its own batch as crashed, the way a child that dies does, rather than
 * leaving those files out of the record; one that ran out of a held heap
 * answers `ranOut` with the records it did post, for the caller to read the
 * rest again.
 *
 * The `ruby` child is started here, on the parent, at the thread's request,
 * and its bytes are passed through undecoded. A thread that dies takes its
 * clocks with it, and a child it had started itself kept running unguarded and
 * then stayed a zombie: only the thread that spawns a child can reap it. So
 * the parent owns every child, and kills and reaps what a dead thread left.
 */
function onThread(files, job, resourceLimits) {
  return new Promise((resolve) => {
    let failure = null;
    const children = new Map();
    const worker = new Worker(SHARD, {
      workerData: { ...job, files: files.map(({ rel, abs }) => ({ rel, abs })) },
      // Empty for the reason `guardedChild` gives: a flag legal on the parent
      // can be refused on a thread that loads a file.
      execArgv: [],
      ...(resourceLimits ? { resourceLimits } : {}),
    });
    const results = [];
    worker.on("message", (msg) => {
      if (msg.result) results.push(msg.result);
      else if (msg.out) resolve({ ...msg.out, results });
      else if (msg.spawn) children.set(msg.id, startFor(worker, msg));
      else if (msg.read) children.get(msg.id)?.read();
      else if (msg.kill) children.get(msg.id)?.kill("SIGKILL");
      else if (msg.stdin !== undefined) children.get(msg.id)?.stdin.end(msg.stdin);
    });
    worker.once("error", (err) => {
      failure = err;
    });
    // Messages drain before exit, so one that answered has already resolved.
    worker.once("exit", async (code) => {
      await Promise.all([...children.values()].map(killAndReap));
      if (resourceLimits && failure?.code === "ERR_WORKER_OUT_OF_MEMORY") return resolve({ ranOut: true, results });
      const out = blank();
      out.error = failure ? String(failure.message ?? failure) : `ruby shard exited ${code}`;
      for (const f of files) out.results.push({ rel: f.rel, ok: false, error: out.error, crashed: true, attempts: 1 });
      resolve(out);
    });
  });
}

// Chunks in flight to a thread before the child's stdout is paused. Read
// without a bound, the parent queued the whole stream faster than a thread
// could parse it, and held it all.
const IN_FLIGHT = 4;

/** A child started for a thread, every event it raises sent back to that thread in order. */
function startFor(worker, { id, spawn: [command, args, options] }) {
  const send = (msg, moved) => worker.postMessage({ id, ...msg }, moved);
  let child;
  try {
    child = spawn(command, args, options);
  } catch (err) {
    send({ error: { message: String(err?.message ?? err), code: err?.code } });
    return null;
  }
  let unread = 0;
  child.stdout.on("data", (bytes) => {
    // Moved rather than copied where the chunk owns its memory: a copy left
    // the parent holding every chunk it had read until its own next collection.
    const owned = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
    send({ stdout: bytes }, owned ? [bytes.buffer] : undefined);
    if (++unread >= IN_FLIGHT) child.stdout.pause();
  });
  child.read = () => {
    if (--unread < IN_FLIGHT) child.stdout.resume();
  };
  child.stderr.on("data", (bytes) => send({ stderr: bytes }));
  child.stdin.on("error", () => {
    /* the child died first; its exit is what reports the failure */
  });
  child.on("error", (err) => send({ error: { message: String(err?.message ?? err), code: err?.code } }));
  child.on("close", (code, signal) => send({ close: [code, signal] }));
  return child;
}

/** Killed if still running, and resolved once the exit is reaped. */
function killAndReap(child) {
  return new Promise((resolve) => {
    if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill("SIGKILL");
  });
}

function blank() {
  return {
    results: [],
    truncated: false,
    // Which prism read these files, off the child's own ready line. It was
    // parsed and dropped before anything could read it, so a map could not say
    // which build produced its counts.
    version: null,
    error: null,
    missingParser: null,
    // Our own clock stopped the child before its ready line, so the missing
    // version says nothing about the install.
    stalled: null,
  };
}

/**
 * One child over one batch, retried once for what a timer cut off. The body a
 * shard worker runs; `onResult` takes each record as it is decided instead of
 * the batch holding them all, so the batch's own `results` stays empty, and
 * `spawner` starts the child on the parent.
 */
export async function parseBatch(files, { ruby, guards, rubyScript, load, dimensions, onResult, spawner }) {
  const out = blank();
  const seen = new Set();
  const unanswered = () => files.filter((f) => !seen.has(f.rel));

  // Resolves true when one of our own timers did the killing, which is the only
  // ending a second child could answer differently.
  const run = (batch, attempt) =>
    new Promise((resolve) => {
      let sup;
      try {
        sup = guardedChild({
          kind: "spawn",
          command: ruby,
          args: ["--disable-gems", ...load, "-e", rubyScript],
          env: rubyEnv(),
          stdio: ["pipe", "pipe", "pipe"],
          stderrBytes: guards.stderrBytes,
          ...(spawner ? { spawner } : {}),
          // The whole run's ceiling: a child answering one file every fourteen
          // seconds keeps the idle clock happy and never ends.
          wallMs: guards.wallBaseMs + guards.wallPerFileMs * batch.length,
          idleMs: guards.idleMs,
          onTimeout: (reason) => {
            out.error = out.error ?? (reason === "wall" ? "ruby ran past its wall clock" : "ruby went silent");
            done();
          },
        });
      } catch (err) {
        out.error = String(err && err.message ? err.message : err);
        return resolve(false);
      }
      const child = sup.child;

      let settled = false;
      let buf = "";

      const done = () => {
        if (settled) return;
        settled = true;
        sup.settle();
        resolve(sup.killedBy() === "wall" || sup.killedBy() === "idle");
      };

      child.on("error", (err) => {
        out.error = String(err && err.message ? err.message : err);
        // An interpreter that is not there is every Ruby file at once, and an
        // install problem rather than a repository full of files that crash. The
        // JS bridge draws the same line, and both callers read the same flag.
        if (absentInterpreter(err)) out.missingParser = out.error;
        done();
      });

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (settled) return;
        sup.touch();
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line) take(out, onResult, seen, line, dimensions, attempt);
        }
        // A single line this long means one file produced it, and V8 refuses to
        // hold a string much larger. Dropping the run beats an unattributable
        // RangeError from inside the exit handler.
        if (buf.length > guards.maxLineBytes) {
          out.truncated = true;
          out.error = out.error ?? "line cap";
          sup.kill("line cap");
          done();
        }
      });

      child.on("close", (code, signal) => {
        // A guard that already fired has resolved, and the caller has charged
        // whatever never answered. Reading the tail here would hand it a result
        // for a file it has already accounted for, after it stopped listening.
        if (settled) return;
        if (buf) take(out, onResult, seen, buf, dimensions, attempt);
        // The ready line is the proof that the script itself started. Without it
        // the failure is the interpreter, not a file, and stderr is the only
        // thing that says which.
        if (out.version === null && !out.error) {
          out.error = firstLine(sup.stderr()) || `ruby exited ${signal || code}`;
        }
        done();
      });

      child.stdin.on("error", () => {
        /* the child died first; its exit is what reports the failure */
      });

      const payload = [];
      for (const f of batch) payload.push(f.rel, "\0", f.abs, "\0");
      child.stdin.end(payload.join(""));
      sup.touch();
    });

  // A child our own timer killed says how long the machine took, not what the
  // files hold, so the same batch answers on a quieter run and charging it moves
  // the always-loaded overview. One more child for what never answered,
  // the way the pool queues a timed-out parse once. A child that died by itself
  // is a broken install or a fatal from the script, and answers the same twice.
  let attempts = 1;
  let killed = null;
  let timed = await run(files, 1);
  if (timed && unanswered().length) {
    attempts = 2;
    // The retry reports its own ending, so it starts clean. The kill is kept
    // because a second child that answers nothing and exits 0 says nothing at
    // all, and what happened to these files is still the first child's timer.
    killed = out.error;
    out.error = null;
    timed = await run(unanswered(), 2);
  }
  if (timed && out.version === null && unanswered().length) out.stalled = out.error ?? killed;

  // Every file answered, so whatever ended a child on the way out is not a
  // failure of the run: reporting one made a loaded machine turn a clean parse
  // into "ruby went silent" with nothing unexamined behind it.
  if (unanswered().length === 0) out.error = null;

  // Anything the child never answered for is charged rather than dropped: a
  // silent gap between the corpus and the parsed set would read as a smaller
  // repository instead of a failed run.
  for (const f of unanswered()) {
    deliver(
      onResult,
      {
        rel: f.rel,
        ok: false,
        error: out.error ?? killed ?? "no result",
        crashed: true,
        ...(out.missingParser ? { missingParser: true } : {}),
      },
      attempts
    );
  }

  return out;
}

function take(out, onResult, seen, line, dimensions, attempt) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // a partial line from a killed child, not a file's result
  }
  if (msg && msg.ready) {
    out.version = msg.prism ?? null;
    return;
  }
  if (msg && msg.fatal) {
    out.error = String(msg.fatal);
    // The script refuses before it reads a file, and only over the library it
    // loaded: every Ruby file at once, which is an install to fix rather than a
    // repository full of files that crash. The same flag an absent interpreter
    // sets, so the scan and the check name the remedy instead of exiting 0.
    out.missingParser = out.error;
    return;
  }
  if (!msg || typeof msg.rel !== "string") return;
  seen.add(msg.rel);
  const program = msg.ast ?? null;
  const result = {
    rel: msg.rel,
    ok: msg.ok === true,
    program,
    errors: msg.errors ?? 0,
    length: msg.length ?? 0,
    error: msg.error,
    crashed: msg.crashed,
    skipped: msg.skipped,
  };
  // The reducer reads counts, never trees, so a Ruby file answers the same
  // shape a JS worker answers. The walk happens as each tree arrives off the
  // stream rather than in a second pass over every tree at once, which is also
  // what keeps the shard from holding its whole batch in memory.
  if (result.ok && program) {
    // Asked of every tree, including the ones a caller wanted kept: the facets
    // are the same shape the JS worker sends, and a record that carries them on
    // one side and not the other is one the reader has to special-case. On the
    // rows' walk, which runs for the facets alone when a check asks for no rows.
    //
    // Guarded the way each dimension is, and for a sharper reason: this runs
    // inside the stdout handler, so a throw on one odd tree escapes into the
    // stream and takes the whole shard rather than the file it came from.
    const facets = rubyFacets(program, result.rel);
    const hits = collectHits(program, dimensions, { rel: result.rel }, { walker: walkRuby, also: [facets] });
    try {
      result.facets = facets.done();
    } catch {
      result.facets = { testRunner: null, testCalls: false };
    }
    if (dimensions.length) {
      result.hits = hits;
      // Answered, so the tree is dropped before the result is retained. Holding
      // it made the shard carry every tree in its batch at once, and then copy
      // them all to the parent, which is the cost the JS side pays a process
      // boundary to avoid.
      result.program = null;
    }
  }
  deliver(onResult, result, attempt);
}

function deliver(keep, result, attempts) {
  result.attempts = attempts;
  keep(result);
}
