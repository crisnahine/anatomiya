import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

import { gitBuffered, gitStreamed } from "./git.mjs";
import { EXT_BY_LANG } from "./langs.mjs";
import { CAPABILITY_WORDS, fileStem, stemWords } from "./dimensions-capability.mjs";

export { EXT_BY_LANG };

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

/**
 * Which extensions belong to which language. One table, because three places
 * used to answer this question: what the corpus takes, what a path's language
 * is, and what an area's delivery glob spells. Adding an extension to one and
 * not the others is silent, and the file is then counted and never delivered.
 *
 * Not the parser's grammar choice, which is a different question with a
 * different answer: `parse-worker.mjs` picks the TypeScript grammar for the
 * `.ts` family and the JSX-capable one for everything else, and a new
 * JavaScript-shaped extension added here needs nothing there.
 */
const extsOf = (lang) => EXT_BY_LANG[lang].join("|");
const SOURCE = new RegExp(`\\.(${Object.keys(EXT_BY_LANG).map(extsOf).join("|")})$`);
const RUBY_EXT = new RegExp(`\\.(${extsOf("ruby")})$`);
const JSX_EXT = new RegExp(`\\.(${extsOf("jsx")})$`);

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
  // Yarn's own vendor directory: 14 files across the 35-repository corpus,
  // every one a machine-generated bundle, and the 2 MB releases sit at the
  // parse timeout boundary, flipping between crashed and rejected across runs,
  // which moves the always-loaded overview (A5).
  /(^|\/)\.yarn(\/|$)/,
  /(^|\/)__fixtures__(\/|$)/,
  /(^|\/)fixtures(\/|$)/,
  /(^|\/)__snapshots__(\/|$)/,
  // The same code under the other names it goes by: 2,218 collected files
  // across a 35-repository corpus, of which angular's 2,010 under `test_cases`
  // were 55 of its 339 areas. `examples` is deliberately absent: 8,967 paths
  // match it and a good share are code someone maintains.
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
 * What remains is per file and guards a parser rather than a repository, and
 * lives in `limits.mjs` because every reader of a file has to agree on it.
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

/**
 * The frameworks this corpus shows evidence of.
 *
 * A framework matters here because some claims are its and cannot be judged
 * without it: `Time.now` is a drifting timestamp under Rails and correct in
 * plain Ruby, and one file carries no marker saying which it is standing in.
 *
 * Read from the corpus, never from `git ls-files`. rubocop's only app/models
 * files are three fixtures under spec/fixtures, which the corpus already drops;
 * the raw list calls rubocop a Rails application. Measured across 19 Ruby
 * repositories, this separates 14 Rails from 5 plain with no error, decidim
 * included, whose engines keep the shape without a config/application.rb.
 */
const RAILS_SHAPE = /(^|\/)(app\/models\/|db\/migrate\/|config\/application\.rb$)/;

/**
 * The languages a file set holds. Beside `language` because a corpus record
 * carries its language and a pinned one may only carry its path, and two
 * readings of that had already drifted apart.
 */
export const langsIn = (files) => [...new Set(files.map((f) => f.lang ?? language(f.rel)))];

export function frameworksIn(files) {
  const out = new Set();
  for (const f of files) {
    if (f.lang === "ruby" && RAILS_SHAPE.test(f.rel)) {
      out.add("rails");
      break;
    }
  }
  return out;
}

/**
 * Which capability wrappers this corpus shows, by filename vocabulary.
 *
 * The same posture as the framework signal: a routing claim asked of a
 * repository with no wrapper can only ever read zero, so the row is offered
 * only where a wrapper-shaped file exists at all (C8).
 */
export function capabilitiesIn(files) {
  const out = new Set();
  const missing = new Set(Object.keys(CAPABILITY_WORDS));
  for (const f of files) {
    for (const cap of missing) {
      if (stemWords(fileStem(f.rel)).some((w) => CAPABILITY_WORDS[cap].has(w))) {
        out.add(cap);
        missing.delete(cap);
      }
    }
    if (!missing.size) break;
  }
  return out;
}

export function language(path) {
  if (RUBY_EXT.test(path) || RUBY_FILENAME.test(path)) return "ruby";
  if (JSX_EXT.test(path)) return "jsx";
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
  // One bounded answer, so it takes the buffered entry point (F5).
  const r = await gitBuffered(cwd, ["rev-parse", "--show-toplevel"], { maxBytes: 1024 * 1024 });
  if (!r.ok) throw new Error(`not a git repository: ${cwd}`, { cause: new Error(r.error) });

  const root = r.stdout.trim();
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
 * enough to matter is also large enough for the collected output to reach V8's
 * string length limit, which `execFile` reports as a `RangeError` from inside
 * Node's own exit handler where no caller can catch it.
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
 *
 * `ls-files -z` terminates every entry, so the runner's default holds: anything
 * left in the buffer at exit is half a path and not a name that happens to lack
 * a delimiter.
 */
function lsFiles(root, onEntry, extra = []) {
  // An empty field is a delimiter run rather than a listed path, and the caller
  // classifies paths.
  return gitStreamed(root, ["ls-files", "-z", ...extra, "--"], (rel) => (rel ? onEntry(rel) : true));
}
