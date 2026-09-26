import { guardedChild, absentInterpreter } from "./child.mjs";
import { collectHits } from "./walk.mjs";
import { rubyFacets } from "./facets.mjs";
import { guardsOver, MAX_FILE_BYTES } from "./limits.mjs";
import { firstLine } from "./encode.mjs";
import { olderThan } from "./version.mjs";
import { ENGINES } from "./langs.mjs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { isAbsolute } from "node:path";

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
// so no gem's code runs and an interpreter whose prism is too old still answers.
const LIST_PRISM = `require "json"
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
 * `USERPROFILE` locate a `--user-install`.
 */
function gemEnv(source) {
  const env = rubyEnv(source);
  for (const k of ["GEM_HOME", "GEM_PATH", "HOME", "USERPROFILE"]) {
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
      ["-e", LIST_PRISM],
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
 * The arguments that put the chosen prism on the load path, for every child
 * that loads prism: the parser and the readiness probe answer about the same
 * library only if they are handed the same one. Empty when the default
 * answers.
 */
export async function prismLoadArgs(options = {}) {
  const chosen = choosePrism(await listPrism(options), ENGINES.prism.floor);
  return chosen ? chosen.paths.flatMap((p) => ["-I", p]) : [];
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
 */
export function rubyEnv(source = process.env) {
  const env = { PATH: source.PATH ?? "", LANG: "C" };
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
require "prism"
require "json"

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
  when String then (v.length > STR_CAP ? v[0, STR_CAP] : v).scrub("")
  when Integer, Float, true, false then v
  end
end

def emit(h)
  $stdout.write(JSON.generate(h))
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

data = $stdin.read.to_s.force_encoding("UTF-8")
data.split("\\0").each_slice(2) do |rel, abs|
  next if rel.nil? || rel.empty? || abs.nil? || abs.empty?
  begin
    if File.size(abs) > MAX_BYTES
      emit({ "rel" => rel, "ok" => false, "error" => "over size cap", "skipped" => true })
      next
    end
    src = File.read(abs, encoding: "UTF-8")
    r = Prism.parse(src)
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

/**
 * Parse Ruby files. Resolves once the child has exited or a guard has fired.
 *
 * The results are the whole record: `parse.mjs` classifies every outcome off
 * them, so no count rides beside them.
 */
export async function parseRuby(
  files,
  { ruby = "ruby", guards: given = null, dimensions = [] } = {},
) {
  const guards = guardsOver(RUBY_GUARDS, given, "prism");
  // Built once, and before any child: a bad override refuses here, loudly,
  // rather than dying inside the spawn where it reads as a broken install.
  const rubyScript = scriptFor(guards.maxBytes);
  const out = {
    results: [],
    truncated: false,
    // Which prism read these files, off the child's own ready line. It was
    // parsed and dropped before anything could read it, so a map could not say
    // which build produced its counts.
    version: null,
    error: null,
    missingParser: null,
  };
  if (files.length === 0) return out;

  const queued = [];
  for (const f of files) {
    // F5 keeps a leading dash out of argv. Paths never reach argv here, but a
    // path that would need that rule is malformed for our purposes either way.
    if (f.rel.startsWith("-") || f.abs.startsWith("-")) {
      deliver(out, { rel: f.rel, ok: false, error: "suspicious path", skipped: true }, 1);
      continue;
    }
    queued.push(f);
  }
  if (queued.length === 0) return out;

  const seen = new Set();
  const unanswered = () => queued.filter((f) => !seen.has(f.rel));
  const load = await prismLoadArgs({ ruby });

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
          if (line) take(out, seen, line, dimensions, attempt);
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
        if (buf) take(out, seen, buf, dimensions, attempt);
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
  if ((await run(queued, 1)) && unanswered().length) {
    attempts = 2;
    // The retry reports its own ending, so it starts clean. The kill is kept
    // because a second child that answers nothing and exits 0 says nothing at
    // all, and what happened to these files is still the first child's timer.
    killed = out.error;
    out.error = null;
    await run(unanswered(), 2);
  }

  // Every file answered, so whatever ended a child on the way out is not a
  // failure of the run: reporting one made a loaded machine turn a clean parse
  // into "ruby went silent" with nothing unexamined behind it.
  if (unanswered().length === 0) out.error = null;

  // Anything the child never answered for is charged rather than dropped: a
  // silent gap between the corpus and the parsed set would read as a smaller
  // repository instead of a failed run.
  for (const f of unanswered()) {
    deliver(
      out,
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

function take(out, seen, line, dimensions, attempt) {
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
  // what keeps the parent from holding the whole corpus in memory.
  if (result.ok && program) {
    // Asked of every tree, including the ones a caller wanted kept: the facets
    // are the same shape the JS worker sends, and a record that carries them on
    // one side and not the other is one the reader has to special-case.
    //
    // Guarded the way each dimension is, and for a sharper reason: this runs
    // inside the stdout handler, so a throw on one odd tree escapes into the
    // stream and takes the whole scan rather than the file it came from.
    try {
      result.facets = rubyFacets(program, result.rel);
    } catch {
      result.facets = { testRunner: null, testCalls: false };
    }
    if (dimensions.length) {
      result.hits = collectHits(program, dimensions, { rel: result.rel });
      // Answered, so the tree is dropped before the result is retained. Holding
      // it made the parent carry every tree in the repository at once, which is
      // the cost the JS side pays a process boundary to avoid.
      result.program = null;
    }
  }
  deliver(out, result, attempt);
}

function deliver(out, result, attempts) {
  result.attempts = attempts;
  out.results.push(result);
}
