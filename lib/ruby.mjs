import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

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
  maxBytes: 4 * 1024 * 1024,
  // Not a whole-run timeout: a large repository legitimately runs for minutes.
  // What a hung parse looks like is silence, so silence is what is timed.
  idleMs: 15_000,
  // No cumulative output cap. The stream is drained a line at a time, so total
  // output is not held anywhere and capping it only truncated large
  // repositories, which suppresses every directive in the map. What V8 actually
  // refuses is one enormous string, and that is per line.
  maxLineBytes: 64 * 1024 * 1024,
  stderrBytes: 8 * 1024,
};

/**
 * The parser process loads nothing but the standard library.
 *
 * prism is a default gem, so --disable-gems still finds it while closing the
 * gem-activation path entirely. RUBYOPT, RUBYLIB and GEM_HOME are dropped for
 * the same reason: each one can inject a `-r` into a process we are about to
 * point at repository files.
 */
function rubyEnv() {
  const env = { PATH: process.env.PATH ?? "", LANG: "C" };
  // Windows refuses to start a side-by-side assembly without a valid
  // %SystemRoot%, which a stripped environment does not carry, so the
  // interpreter never runs at all. Documented in Python's own subprocess
  // notes, and the same rule applies to any spawn with a replaced env.
  if (process.platform === "win32") {
    for (const k of ["SystemRoot", "SYSTEMROOT", "COMSPEC", "windir"]) {
      if (process.env[k]) env[k] = process.env[k];
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
 */
const SCRIPT = `
require "prism"
require "json"

MAX_BYTES = ${RUBY_GUARDS.maxBytes}
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
 * With `onFile` the results are handed over one at a time and not retained: a
 * Rails-sized corpus is 5,500 syntax trees, and holding them all costs more
 * than the reduction that consumes them.
 */
export async function parseRuby(
  files,
  { onFile = null, ruby = "ruby", guards = RUBY_GUARDS, dimensions = [] } = {},
) {
  const out = {
    results: [],
    parsed: 0,
    crashed: 0,
    skipped: 0,
    truncated: false,
    engine: null,
    error: null,
    missingParser: null,
  };
  if (files.length === 0) return out;

  const queued = [];
  for (const f of files) {
    // F5 keeps a leading dash out of argv. Paths never reach argv here, but a
    // path that would need that rule is malformed for our purposes either way.
    if (f.rel.startsWith("-") || f.abs.startsWith("-")) {
      deliver(out, onFile, { rel: f.rel, ok: false, error: "suspicious path", skipped: true });
      continue;
    }
    queued.push(f);
  }
  if (queued.length === 0) return out;

  const seen = new Set();

  await new Promise((resolve) => {
    let child;
    try {
      child = spawn(ruby, ["--disable-gems", "-e", SCRIPT], {
        // Outside the repository, so a relative read inside the child cannot
        // reach a tracked file we did not hand it.
        cwd: tmpdir(),
        env: rubyEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      out.error = String(err && err.message ? err.message : err);
      return resolve();
    }

    let settled = false;
    let idle = null;
    let buf = "";
    let stderr = "";

    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      resolve();
    };

    const stop = (reason) => {
      if (reason) out.error = out.error ?? reason;
      child.kill("SIGKILL");
      done();
    };

    // Re-arming after the run has settled would leave a timer holding the event
    // loop open for the length of the idle window, long after the answer left.
    const touch = () => {
      if (settled) return;
      clearTimeout(idle);
      idle = setTimeout(() => stop("ruby went silent"), guards.idleMs);
    };

    child.on("error", (err) => {
      out.error = String(err && err.message ? err.message : err);
      // An interpreter that is not there is every Ruby file at once, and an
      // install problem rather than a repository full of files that crash. The
      // JS bridge draws the same line, and both callers read the same flag.
      if (err && err.code === "ENOENT") out.missingParser = out.error;
      done();
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < guards.stderrBytes) stderr += chunk;
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      touch();
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line) take(out, onFile, seen, line, dimensions);
      }
      // A single line this long means one file produced it, and V8 refuses to
      // hold a string much larger. Dropping the run beats an unattributable
      // RangeError from inside the exit handler.
      if (buf.length > guards.maxLineBytes) {
        out.truncated = true;
        stop("line cap");
      }
    });

    child.on("close", (code, signal) => {
      // A guard that already fired has resolved, and the caller has charged
      // whatever never answered. Reading the tail here would hand it a result
      // for a file it has already accounted for, after it stopped listening.
      if (settled) return;
      if (buf) take(out, onFile, seen, buf, dimensions);
      // The ready line is the proof that the script itself started. Without it
      // the failure is the interpreter, not a file, and stderr is the only
      // thing that says which.
      if (out.engine === null && !out.error) {
        out.error = firstLine(stderr) || `ruby exited ${signal || code}`;
      }
      done();
    });

    child.stdin.on("error", () => {
      /* the child died first; its exit is what reports the failure */
    });

    const payload = [];
    for (const f of queued) payload.push(f.rel, "\0", f.abs, "\0");
    child.stdin.end(payload.join(""));
    touch();
  });

  // Anything the child never answered for is charged rather than dropped: a
  // silent gap between the corpus and the parsed set would read as a smaller
  // repository instead of a failed run.
  for (const f of queued) {
    if (seen.has(f.rel)) continue;
    deliver(out, onFile, {
      rel: f.rel,
      ok: false,
      error: out.error ?? "no result",
      crashed: true,
      ...(out.missingParser ? { missingParser: true } : {}),
    });
  }

  return out;
}

function take(out, onFile, seen, line, dimensions) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // a partial line from a killed child, not a file's result
  }
  if (msg && msg.ready) {
    out.engine = msg.prism ?? null;
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
  if (result.ok && program && dimensions.length) {
    result.hits = rubyHits(program, dimensions);
    // Answered, so the tree is dropped before the result is retained. Holding
    // it made the parent carry every tree in the repository at once, which is
    // the cost the JS side pays a process boundary to avoid.
    result.program = null;
  }
  deliver(out, onFile, result);
}

/**
 * Every Ruby dimension's sites for one tree, keyed for the reducer.
 *
 * The dimensions are passed in rather than imported: the dimension module
 * imports this one for its walker, so importing it back would close a cycle.
 */
function rubyHits(program, dimensions) {
  const hits = {};
  for (const dim of dimensions) {
    const sites = [];
    try {
      dim.run(program, (hit) => sites.push({ conforming: !!hit.conforming, where: hit.where ?? null }));
    } catch {
      continue;
    }
    if (sites.length) hits[dim.key] = sites;
  }
  return hits;
}

function firstLine(text) {
  const line = String(text || "").split("\n").find((l) => l.trim());
  return line ? line.trim().slice(0, 200) : "";
}

function deliver(out, onFile, result) {
  if (result.ok) out.parsed++;
  if (result.crashed) out.crashed++;
  if (result.skipped) out.skipped++;
  if (onFile) onFile(result);
  else out.results.push(result);
}

const DECL = new Set(["def", "class", "module", "singleton_class"]);

/**
 * One walk over a prism tree, carrying the chain of declarations enclosing
 * every node, exactly as the oxc walk does.
 *
 * Scope attribution comes from the traversal rather than from a second pass: a
 * match holding a byte offset and no enclosing declaration needs an interval
 * join to answer "which method", and prism counts UTF-8 bytes where oxc counts
 * UTF-16 code units, so that join is the one place the two engines' conventions
 * could silently mix. There are no offsets in this tree to mix.
 *
 * A block is not a declaration: `items.each do |i| ... end` inside a method
 * still reports that method, which is what a human reading the map wants.
 *
 * `visit(node, ctx)` receives:
 *   ctx.stack     enclosing declarations, outermost first
 *   ctx.enclosing innermost enclosing declaration, or null at file level
 *   ctx.def       innermost enclosing method definition, or null
 *   ctx.cls       innermost enclosing class or module, or null
 *   ctx.ancestors every node above this one, blocks included
 */
export function walkRuby(ast, visit) {
  const stack = [];
  const ancestors = [];

  const step = (node) => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (const child of node) step(child);
      return;
    }
    if (typeof node.t !== "string") return;

    const isDecl = DECL.has(node.t);
    visit(node, {
      stack,
      ancestors,
      enclosing: stack.length ? stack[stack.length - 1] : null,
      def: last(stack, (n) => n.t === "def"),
      cls: last(stack, (n) => n.t === "class" || n.t === "module"),
    });

    if (isDecl) stack.push(node);
    ancestors.push(node);
    for (const key of Object.keys(node)) step(node[key]);
    ancestors.pop();
    if (isDecl) stack.pop();
  };

  step(ast);
}

function last(stack, pred) {
  for (let i = stack.length - 1; i >= 0; i--) if (pred(stack[i])) return stack[i];
  return null;
}

/** Statements written directly in a body, skipping the statements wrapper. */
export function bodyOf(node) {
  const b = node && node.body;
  if (!b) return [];
  if (Array.isArray(b)) return b;
  if (b.t === "statements") return Array.isArray(b.body) ? b.body : [];
  return [b];
}

/** The dotted name of a constant reference: Foo, or ActiveRecord::Base. */
export function constName(node) {
  if (!node) return null;
  if (node.t === "constant_read") return node.name ?? null;
  if (node.t === "constant_path") {
    const parent = constName(node.parent);
    return parent ? `${parent}::${node.name}` : (node.name ?? null);
  }
  return null;
}
