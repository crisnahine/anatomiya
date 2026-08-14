import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

const run = promisify(execFile);

const GIT_TIMEOUT_MS = 120_000;

// Tracked files only. A working tree holds .env, master.key, an .npmrc with a
// token and a .git/config with credentials in the remote URL; a filesystem walk
// picks all of them up and a sample path or a quoted line then leaves the machine.
const DENY = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.env($|\.)/,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)\.claude\/settings\.local\.json$/,
  /(^|\/)(id_rsa|id_ed25519|\.netrc|\.npmrc)$/,
];

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|rb|rake|gemspec|jbuilder)$/;

// Ruby whose filename does not carry the language. Anchored whole, so a
// Gemfile.lock is not a Gemfile and a Rakefile.md is not a Rakefile. `.rbi` is
// deliberately absent: a Sorbet signature describes types rather than anything
// anyone wrote, so a claim counted over one speaks for no code.
const RUBY_FILENAME = /(^|\/)(Rakefile|Gemfile|config\.ru)$/;

// Fixture and vendor code is deliberately unidiomatic. Eighteen of eighty-five
// areas in one measured repository were fixture directories, and a map that
// teaches a parser test's intentional anti-patterns as house style is worse
// than no map.
const EXCLUDE_DIR = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)vendor(\/|$)/,
  /(^|\/)__fixtures__(\/|$)/,
  /(^|\/)fixtures(\/|$)/,
  /(^|\/)__snapshots__(\/|$)/,
  // The same code under the other names it goes by. `examples` is deliberately
  // absent: 8,967 paths in a 35-repository corpus match it and a good share are
  // code someone maintains.
  /(^|\/)test_cases(\/|$)/,
  /(^|\/)testdata(\/|$)/,
  /(^|\/)test-data(\/|$)/,
  /(^|\/)goldens?(\/|$)/,
  /(^|\/)__mocks__(\/|$)/,
  /(^|\/)mocks(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)\.next(\/|$)/,
];

/**
 * The corpus is not capped by file count or by total size.
 *
 * It was, at 50,000 files, and the cap did not merely trim the tail: a corpus
 * that hit it set `truncated`, which suppresses every directive in the whole
 * map. A repository one file over the line got counts and no conventions at
 * all. The cap was there because the scanner held every syntax tree in the
 * parent at once; the trees now stay in the workers that produced them and only
 * per-dimension counts come back, so the reason is gone with it.
 *
 * What remains is per file and guards a parser rather than a repository:
 * `GUARDS.maxBytes` in the pool and `RUBY_GUARDS.maxBytes` in the Ruby script.
 * A source file above that size is generated or minified, and skipping one such
 * file is reported rather than silently folded into the counts.
 */

export function isDenied(path) {
  return DENY.some((re) => re.test(path));
}

export function isExcludedDir(path) {
  return EXCLUDE_DIR.some((re) => re.test(path));
}

export function isSource(path) {
  return SOURCE.test(path) || RUBY_FILENAME.test(path);
}

export function language(path) {
  if (/\.(rb|rake|gemspec|jbuilder)$/.test(path) || RUBY_FILENAME.test(path)) return "ruby";
  if (/\.(tsx|jsx)$/.test(path)) return "jsx";
  return "js";
}

/**
 * Confine a repository-relative path to the repository, following the same
 * shape that survived review elsewhere: lexical containment first because it
 * costs nothing, then realpath on both sides because resolve() normalises ".."
 * but never follows a symlink, and readFile does. Returns the resolved path so
 * the caller reads what was actually checked rather than the unresolved one.
 */
export function safeResolve(root, relPath) {
  const absRoot = resolve(root);
  const full = resolve(absRoot, relPath);
  if (full !== absRoot && !full.startsWith(absRoot + sep)) return null;

  let realRoot, realFull;
  try {
    realRoot = realpathSync(absRoot);
    realFull = realpathSync(full);
  } catch {
    return null;
  }
  if (realFull !== realRoot && !realFull.startsWith(realRoot + sep)) return null;
  return realFull;
}

export async function gitRoot(cwd) {
  let stdout;
  try {
    ({ stdout } = await run("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    }));
  } catch (err) {
    throw new Error(`not a git repository: ${cwd}`, { cause: err });
  }
  const root = stdout.trim();
  // Exit 0 with an empty line is possible; returning "" would resolve every
  // later path against the process cwd instead of against the repository.
  if (!root) throw new Error(`not a git repository: ${cwd}`);
  // git prints forward slashes even on Windows, and may print a short 8.3 form
  // where the filesystem holds a long one. Every path downstream is joined
  // against this and compared with it, so it is made native and real once here
  // rather than in each caller.
  try {
    return realpathSync(root);
  } catch {
    return resolve(root);
  }
}

/**
 * The corpus: tracked source files, deny-listed paths removed, symlinks and
 * paths escaping the repository dropped.
 *
 * `git ls-files -z` is NUL-delimited because git permits newlines in paths, and
 * a newline-split here would turn one hostile filename into two corpus entries.
 *
 * The listing is parsed off the stream rather than buffered: a repository large
 * enough to pass the file cap is also large enough for the collected output to
 * reach V8's string length limit, which `execFile` reports as a `RangeError`
 * from inside Node's own exit handler where no caller can catch it. Streaming
 * also lets the cap breach stop the walk instead of discovering it afterwards.
 */
export async function collect(root) {
  const dropped = { denied: false, excluded: 0, escaped: 0, notSource: 0 };
  const files = [];

  await lsFiles(root, (rel) => {
    const { drop, abs } = classify(root, rel);
    // Denial is a flag rather than a count: one denied path is the whole
    // signal, and the number of them is not something to report.
    if (drop === "denied") { dropped.denied = true; return true; }
    if (drop) { dropped[drop]++; return true; }
    files.push({ rel, abs, lang: language(rel) });
    return true;
  });

  // Kept in the shape callers already read. No repository size truncates the
  // corpus now; the flag still travels because the Ruby stream can hit its
  // per-line guard, and a partly-answered corpus must not state a convention.
  return { files, truncated: false, dropped };
}

/**
 * How many source files the working tree holds that no scan can count, because
 * the corpus is tracked files only.
 *
 * Asked only when the corpus came back empty, which is one more git process in
 * the one state where the answer changes what the output means: a repository
 * whose first commit has not landed otherwise reports an empty map, exit 0 and
 * nothing uncovered, and reads as a tool that found nothing to say.
 *
 * Every filter `collect` applies, since the number is shown beside an
 * instruction to commit these files and scan again. A count including files a
 * later scan would drop is a promise that scan cannot keep.
 */
export async function countUntrackedSource(root) {
  let n = 0;
  await lsFiles(root, (rel) => {
    if (!classify(root, rel).drop) n++;
    return true;
  }, ["--others", "--exclude-standard"]);
  return n;
}

/**
 * Whether a listed path is corpus, and if not, which rule refused it.
 *
 * One classifier for both listings: the corpus and the untracked count are the
 * same question asked of two `ls-files` runs, and a second copy of the rules is
 * a copy that drifts.
 */
function classify(root, rel) {
  if (isDenied(rel)) return { drop: "denied" };
  if (isExcludedDir(rel)) return { drop: "excluded" };
  if (!isSource(rel)) return { drop: "notSource" };
  const abs = safeResolve(root, rel);
  return abs ? { abs } : { drop: "escaped" };
}

/**
 * Feed each NUL-delimited entry to `onEntry`, which returns false to stop.
 *
 * No pathspec follows `--`; it is there because the rule for every git call in
 * this codebase is that nothing after it can be read as an option.
 */
function lsFiles(root, onEntry, extra = []) {
  return new Promise((fulfil, reject) => {
    const child = spawn("git", ["ls-files", "-z", ...extra, "--"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
    });

    let rest = Buffer.alloc(0);
    let stderr = "";
    let stopped = false;
    let settled = false;

    const stop = () => {
      stopped = true;
      if (child.pid && !child.killed) child.kill("SIGKILL");
    };

    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8");
    });

    const fail = (err) => {
      if (settled) return;
      settled = true;
      stop();
      reject(err);
    };

    child.stdout.on("data", (chunk) => {
      if (stopped) return;
      let buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      try {
        let at;
        while ((at = buf.indexOf(0)) !== -1) {
          const rel = buf.subarray(0, at).toString("utf8");
          buf = buf.subarray(at + 1);
          if (rel && onEntry(rel) === false) {
            rest = Buffer.alloc(0);
            return stop();
          }
        }
      } catch (err) {
        // Throwing out of a stream handler would leave the promise pending and
        // the child alive.
        return fail(err);
      }
      rest = buf;
    });

    child.on("error", (err) => fail(new Error(`git ls-files failed: ${err.message}`)));

    child.on("close", (code, signal) => {
      if (settled) return;
      if (stopped) { settled = true; return fulfil(); }
      if (code !== 0) {
        return fail(new Error(`git ls-files exited ${signal || code}: ${stderr.trim()}`));
      }
      // git terminates every entry, so a leftover means the listing was cut off
      // mid-path rather than that the last name lacks a delimiter.
      if (rest.length) return fail(new Error("git ls-files output ended mid-path"));
      settled = true;
      fulfil();
    });
  });
}
