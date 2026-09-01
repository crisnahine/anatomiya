import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

import { gitBuffered, gitStreamed } from "./git.mjs";
import { EXT_BY_LANG, LANGUAGES, language } from "./langs.mjs";
import { CAPABILITY_WORDS, fileStem, stemWords } from "./dimensions-capability.mjs";
import { FRAMEWORKS } from "./frameworks.mjs";

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

// What the corpus takes, derived from the registry so the filter, the
// language of a path and the delivery glob cannot drift apart: adding an
// extension to one and not the others is silent, and the file is then counted
// and never delivered.
const extsOf = (lang) => EXT_BY_LANG[lang].join("|");
const SOURCE = new RegExp(`\\.(${Object.keys(EXT_BY_LANG).map(extsOf).join("|")})$`);

// Source whose filename carries no extension, anchored whole so a Gemfile.lock
// is not a Gemfile and a Rakefile.md is not a Rakefile. Every regex character
// is escaped, not only the dot: the registry holds filenames to no alphabet,
// and a name carrying a bracket would otherwise mis-match silently.
const BARE_FILENAME = new RegExp(
  `(^|/)(${LANGUAGES.flatMap((l) => l.filenames)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})$`
);

// Fixture and vendor code is deliberately unidiomatic. Eighteen of eighty-five
// areas in one measured repository were fixture directories, and a map that
// teaches a parser test's intentional anti-patterns as house style is worse
// than no map.
//
// Four of these match a word boundary rather than a whole segment, because a
// repository often compounds its own fixture word instead of writing it bare:
// webpack's `configCases`, angular's `golden-test`, prisma's `_fixture`,
// diaspora's `jasmine_fixtures`. The boundary is a literal `-` or `_`, or the
// capital letter webpack's own `Cases` compounds join on, never a bare
// substring: `use-cases` and `showcases` are real directory names and neither
// carries one of those boundaries. `spec/data` and `tests/execution` still
// leak, because `data` and `execution` are too common a word to exclude bare.
const EXCLUDE_DIR = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)vendor(\/|$)/,
  // Yarn's own vendor directory: 14 files across the 35-repository corpus,
  // every one a machine-generated bundle, and the 2 MB releases sit at the
  // parse timeout boundary, flipping between crashed and rejected across runs,
  // which moves the always-loaded overview (A5).
  /(^|\/)\.yarn(\/|$)/,
  /(^|\/)__fixtures__(\/|$)/,
  /(^|\/)(\w*_)?fixtures?(\/|$)/,
  /(^|\/)__snapshots__(\/|$)/,
  /(^|\/)snapshots?(\/|$)/,
  // The same code under the other names it goes by: 2,218 collected files
  // across a 35-repository corpus, of which angular's 2,010 under `test_cases`
  // were 55 of its 339 areas. `examples` is deliberately absent: 8,967 paths
  // match it and a good share are code someone maintains.
  /(^|\/)test_cases(\/|$)/,
  /(^|\/)testdata(\/|$)/,
  /(^|\/)test-data(\/|$)/,
  // Only the test compound, never any word after the hyphen: "golden record"
  // is master-data vocabulary, GoldenGate is an Oracle product and the golden
  // ratio is a number, and angular's `golden-test` is the one leak measured.
  /(^|\/)goldens?([-_]tests?)?(\/|$)/,
  /(^|\/)__mocks__(\/|$)/,
  /(^|\/)mocks(\/|$)/,
  // webpack's own compounds: bare `cases`, and a camelCase word ending in a
  // capital `Cases` (`configCases`, `statsCases`...). Lowercase throughout, as
  // `use-cases` and `showcases` are, never matches: 347 of 393 areas and 3 of
  // 14 stated directives, two contradicting each other on one dimension.
  /(^|\/)(cases|[a-zA-Z]*[a-z]Cases)(\/|$)/,
  /(^|\/)dist(\/|$)/,
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

// Bundler output never nests under a directory holding hand-written source: a
// `build` segment reached by descending through `src` is a module named for
// the "build" verb, not compiled output. turbopack-cli's `src/build/mod.rs`
// is real Rust, dropped by the bare-word match with no repository where that
// language is read to notice.
function isBuildOutput(path) {
  const parts = path.split("/");
  const at = parts.indexOf("build");
  return at !== -1 && !parts.slice(0, at).includes("src");
}

export function isExcludedDir(path) {
  return EXCLUDE_DIR.some((re) => re.test(path)) || isBuildOutput(path);
}

export function isSource(path) {
  return SOURCE.test(path) || BARE_FILENAME.test(path);
}

/**
 * Which path-only rule refuses a path, or null where none does. The generated-
 * file head read and the realpath check are not path-only questions and stay
 * with `classify`: a caller asking about a diff path, or asking inside a
 * pre-write hook, has no file to open.
 */
function pathDrop(path) {
  if (isDenied(path)) return "denied";
  if (isExcludedDir(path)) return "excluded";
  if (!isSource(path)) return "notSource";
  return null;
}

/** Whether a path is one the corpus counts: source, not denied and not under an excluded directory. */
export function isCorpusPath(path) {
  return pathDrop(path) === null;
}

// Generated and vendored code is ordinary-looking: it carries real git-blame
// authors and none of the old-syntax or low-author-diversity shape the
// fixture gates above catch. Only its own header tells it apart, so this is a
// second, orthogonal filter rather than another name to add to EXCLUDE_DIR.
// Go's convention pairs the first and third; Meta's tooling writes the second.
const GENERATED_MARKER = /@generated|Code generated by/;

// `DO NOT EDIT` on its own is an ordinary operational warning, and a file
// carrying one was dropped from the corpus with no trace: `collect` drops
// before any accounting, so nothing in the map said the file existed. It
// counts only beside a word about generation, which is how prisma
// (`GENERATED FILE - DO NOT EDIT`) and Go's convention both write it.
const NOT_EDITABLE = /DO NOT EDIT/;
const GENERATION_WORD = /generated|generator/i;

// Bounded rather than whole-file: "the first lines" is what a generator
// stamps, and a fixed byte cap also protects against a single-line minified
// bundle the way the parser's own size cap does.
const MARKER_HEAD_BYTES = 4096;
const ATTR_FILE_BYTES = 65536;

/**
 * The first bytes of a regular file, or "" for anything else: a symlink
 * swapped in between a stat and an open would read the wrong file, so the
 * type is checked on the same handle the bytes come from, and a path that
 * has vanished, is a directory, or refuses to open answers empty rather than
 * throwing.
 */
function readPrefix(path, bytes) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    if (!fstatSync(fd).isFile()) return "";
    const buf = Buffer.alloc(bytes);
    const read = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, read).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// Lines rather than bytes, so a module that documents these markers is safe by
// where a generator stamps rather than by how much comment happens to sit above
// its own constants: this tool's own `corpus.mjs` cleared the byte cap by 1,756
// of them, which is not a property anyone was maintaining. Ten leaves room for
// a licence header above the stamp.
const MARKER_HEAD_LINES = 10;

/** Whether a file's own head carries a generated-file marker. */
export function isGeneratedFile(absPath) {
  const head = readPrefix(absPath, MARKER_HEAD_BYTES).split("\n").slice(0, MARKER_HEAD_LINES).join("\n");
  if (GENERATED_MARKER.test(head)) return true;
  return NOT_EDITABLE.test(head) && GENERATION_WORD.test(head);
}

/**
 * The `linguist-generated` declarations a root `.gitattributes` makes, or an
 * empty list where there is none to read.
 *
 * Read once per corpus rather than once per file: the file deciding this is
 * small and the corpus asking it is not. Three pattern shapes, the ones a
 * `linguist-generated` line actually uses: `dir/**` for a subtree, `*.ext` for
 * an extension, and a bare path for one file. Not gitignore's full grammar,
 * and only the root file: a pattern outside those three, or one declared by a
 * nested `.gitattributes`, is not read rather than guessed at.
 */
function generatedAttrRules(root) {
  const abs = safeResolve(root, ".gitattributes");
  if (!abs) return [];
  const rules = [];
  for (const line of readPrefix(abs, ATTR_FILE_BYTES).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [pattern, ...attrs] = trimmed.split(/\s+/);
    const set = attrs.includes("linguist-generated") || attrs.includes("linguist-generated=true");
    const unset = attrs.includes("-linguist-generated") || attrs.includes("linguist-generated=false");
    if (!set && !unset) continue;
    const re = attrPatternToRegExp(pattern);
    if (re) rules.push({ re, value: set });
  }
  return rules;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function attrPatternToRegExp(pattern) {
  const wild = /[*?[\]]/;
  if (pattern.endsWith("/**") && !wild.test(pattern.slice(0, -3))) {
    return new RegExp(`^${escapeRe(pattern.slice(0, -3))}(/|$)`);
  }
  if (pattern.startsWith("*.") && !wild.test(pattern.slice(2))) {
    return new RegExp(`${escapeRe(pattern.slice(1))}$`);
  }
  if (wild.test(pattern)) return null;
  return new RegExp(`^${escapeRe(pattern)}(/|$)`);
}

// Later lines win, the same resolution git itself applies: a directory rule
// followed by one file's own negation is the shape the tests below exercise.
function isAttrGenerated(rules, rel) {
  let value = false;
  for (const rule of rules) if (rule.re.test(rel)) value = rule.value;
  return value;
}

// The profiles and their measured signals live with the frameworks; what is
// here is the fold over this corpus.

/**
 * The languages a file set holds, through the registry's `language` so a
 * corpus record carrying its language and a pinned one carrying only its path
 * cannot answer differently.
 */
export const langsIn = (files) => [...new Set(files.map((f) => f.lang ?? language(f.rel)))];

/**
 * The frameworks this corpus shows evidence of, one profile at a time.
 *
 * Folded as a set the way capabilities are: every profile is asked until it
 * answers, so a corpus holding two frameworks reports both. `profiles` is a
 * defined-only test override.
 */
export function frameworksIn(files, profiles = FRAMEWORKS) {
  const out = new Set();
  const missing = new Set(profiles);
  for (const f of files) {
    for (const fw of missing) {
      if ((!fw.lang || f.lang === fw.lang) && fw.shape.test(f.rel)) {
        out.add(fw.name);
        missing.delete(fw);
      }
    }
    if (!missing.size) break;
  }
  return out;
}

/**
 * Which capability wrappers this corpus shows, by filename vocabulary.
 *
 * The candidate half of the offering (C14): the vocabulary names which
 * categories a repository could be asked about, and the adoption bar in
 * `adoptedCapabilities` decides whether it is. A routing claim asked of a
 * repository with no wrapper can only ever read zero.
 */
export function capabilitiesIn(files) {
  const out = new Set();
  const missing = new Set(Object.keys(CAPABILITY_WORDS));
  for (const f of files) {
    // Directory names vote too: a wrapper written as src/logging/index.ts is
    // imported by its directory name, which is the only vocabulary it carries.
    const words = f.rel.split("/").slice(0, -1).concat(fileStem(f.rel)).flatMap(stemWords);
    for (const cap of missing) {
      if (words.some((w) => CAPABILITY_WORDS[cap].has(w))) {
        out.add(cap);
        missing.delete(cap);
      }
    }
    if (!missing.size) break;
  }
  return out;
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
  const dropped = { denied: 0, excluded: 0, escaped: 0, notSource: 0, generated: 0 };
  const files = [];
  const others = [];
  const generatedRules = generatedAttrRules(root);

  await lsFiles(root, (rel) => {
    const { drop, abs } = classify(root, rel, generatedRules);
    // Non-source tracked files feed the roster this scan builds over every
    // tracked path, not just the parsed ones.
    if (drop === "notSource") { dropped.notSource++; others.push({ rel }); return true; }
    if (drop) { dropped[drop]++; return true; }
    files.push({ rel, abs, lang: language(rel) });
    return true;
  });

  // Kept in the shape callers already read. No repository size truncates the
  // corpus now; the flag still travels because the Ruby stream can hit its
  // per-line guard, and a partly-answered corpus must not state a convention.
  return { files, others, truncated: false, dropped };
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
  const generatedRules = generatedAttrRules(root);
  await lsFiles(root, (rel) => {
    if (!classify(root, rel, generatedRules).drop) n++;
    return true;
  }, ["--others", "--exclude-standard"]);
  return n;
}

/**
 * Whether a listed path is corpus, and if not, which rule refused it.
 *
 * One classifier for both listings: the corpus and the untracked count are the
 * same question asked of two `ls-files` runs, and a second copy of the rules is
 * a copy that drifts. `generatedRules` is read once by the caller rather than
 * once per path, since it is the same `.gitattributes` for every file asked.
 */
function classify(root, rel, generatedRules) {
  const drop = pathDrop(rel);
  if (drop) return { drop };
  const abs = safeResolve(root, rel);
  if (!abs) return { drop: "escaped" };
  // A file that is generated must not contribute evidence to a stated
  // directive, whichever directory it sits in: the marker is read only once
  // the cheaper string checks above have already let the path through.
  if (isAttrGenerated(generatedRules, rel) || isGeneratedFile(abs)) return { drop: "generated" };
  return { abs };
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
export function lsFiles(root, onEntry, extra = []) {
  // An empty field is a delimiter run rather than a listed path, and the caller
  // classifies paths.
  return gitStreamed(root, ["ls-files", "-z", ...extra, "--"], (rel) => (rel ? onEntry(rel) : true));
}
