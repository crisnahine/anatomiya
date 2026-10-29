/**
 * The end-of-turn reuse check: which source lines a turn added, and the one
 * reason that asks for them to be checked against what the repository already
 * has (A91).
 *
 * Its shape, one subagent handed the diff, is the one that passed 24 of 24 hard
 * cases where every wording the model answered inline passed 9 or 10 of 12
 * (`docs/research/one-line-that-finds-the-existing-function.md`). What it asks
 * of a function that does part of the job or falls short came from the misses of
 * the reuse tasks (A123); the repository's own before a package's, and the
 * search a session with no subagent tool runs itself, were never measured apart.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { addedRanges, pendingPaths } from "./changeset.mjs";
import { corpusDrop, isCorpusPath } from "./corpus.mjs";
import { encodePath } from "./encode.mjs";
import { ask, operationUnfinished, unaskedAs, Unasked } from "./git.mjs";
import { isPathTaken } from "./hook.mjs";
import { findSymbols, formatHit, RANKING } from "./find.mjs";
import { INERT_ENGINES, inertLinesOf, REUSE_PARSE_MS } from "./inert.mjs";
import { assertKeyed, embeddedIn, engineOf, hostedBy, language } from "./langs.mjs";
import { LINE_READ, MAX_FILE_BYTES } from "./limits.mjs";
import { byCode } from "./paths.mjs";
import { readHead, readTail, realpathOf } from "./rules.mjs";
import { blankOutside, scriptBlocks } from "./script-blocks.mjs";
import { markupCodeLines, templateInertLines, templateOf } from "./templates.mjs";
import { sessionStartIn, toolCallsIn, transcriptTail, turnOpenersIn, turnStartIn } from "./transcript.mjs";

/** What an ask or a record carries, so a later stop can tell which files it covered. */
export const REUSE_MARK = "anatomiya reuse check";

/** How long one stop's git reads may take together, inside the timeout the hook declares. */
export const REUSE_GIT_MS = 10_000;

// What is left of the stop's git time; a read is asked only while some is, since a timeout of 0 is none.
const leftOf = (gitBy) => Math.ceil(gitBy - performance.now());

const REASON_OPENING = "Before you finish, give one subagent this change's diff";
// How the transcript records a Stop hook's block reason.
const FEEDBACK = "Stop hook feedback:";

// The reason points at the change and the subagent reads the diff itself, so a
// long list buys nothing but tokens on every block.
const LISTED_MOST = 20;

// Enough for any turn a person would call one change, and a bound on the tag.
const MARKED_MOST = 200;

// This session's own asks sit at the end of its transcript, and its first
// entry at the start.
export const TRANSCRIPT_MOST = 64 * 1024 * 1024;
const TRANSCRIPT_HEAD = 64 * 1024;

// A turn's commits are the last lines of the reflog, and one kept for years
// runs to megabytes.
const REFLOG_TAIL = 256 * 1024;

// `<old> <new> <name> <email> <seconds> <zone>\t<message>`.
const REFLOG_ENTRY = /^([0-9a-f]+) ([0-9a-f]+) .*> (\d+) [+-]\d{4}\t(.*)$/;

// What `git commit` writes, and `--amend`, whose parent is the commit it
// replaced. `commit (initial)` and `commit (merge)` are left out on purpose.
const OWN_COMMIT = /^commit(?: \(amend\))?: /;

const MARKS_READ = new RegExp(`${REUSE_MARK} ((?:[0-9a-f]{12} ?)+)\\)`, "g");

// A migration is a numbered one-off that restates the framework's calls by
// design and that nothing calls, and a schema dump is written by the migrations.
// Only the file right under the directory: measured on the corpus, code nested
// deeper under a `migrations` segment (angular's schematics, prisma's
// `core/migrations`, openproject's `db/migrate/tables`) is ordinary library code.
export const ONE_OFF = /(^|\/)(\w+_)?(migrate|migrations)\/\d+[_-][^/]*$|(^|\/)db\/(\w+_)?schema\.rb$/;

/** Whether a changed path is one the check reads: source the corpus counts, or a view template. */
const asked = (path) => isCorpusPath(path) || templateOf(path) !== null;

/**
 * The code a component file holds: the lines its script blocks cover and the
 * markup lines whose expression computes inline (`markupCodeLines`), and which
 * of all its lines define nothing callable. No lines where a script never ends.
 *
 * Each block is read with the file blanked around it, since markup that opens
 * a comment would carry it into the script below.
 */
async function componentScript(engine, lang, source, kind, deadline) {
  const { blocks, unterminated } = scriptBlocks(source, kind);
  if (unterminated) return { spans: [], inert: [] };
  const lineAt = (offset) => source.slice(0, offset).split("\n").length;
  const spans = blocks.flatMap((b) => {
    const body = source.slice(b.start, b.end);
    if (body.trim() === "") return [];
    return [{ from: lineAt(b.end - body.trimStart().length), to: lineAt(b.start + body.trimEnd().length) }];
  });
  const views = await Promise.all(blocks.map((b) => inertLinesOf({ engine, lang, source: blankOutside(source, b.start, b.end), deadline })));
  const markup = markupCodeLines(kind, source, deadline);
  const inert = markup.map((asks, i) => !asks && views.every((view) => view[i] !== false));
  const computed = markup.flatMap((asks, i) => (asks ? [{ from: i + 1, to: i + 1 }] : []));
  return { spans: [...spans, ...computed], inert };
}

/** The parts of `hunks` that `spans` cover, one hunk per run of lines however many spans meet in it. */
function clipped(hunks, spans) {
  const parts = hunks
    .flatMap((h) => spans.flatMap((s) => (h.from > s.to || h.to < s.from ? [] : [{ ...h, from: Math.max(h.from, s.from), to: Math.min(h.to, s.to) }])))
    .sort((a, b) => a.from - b.from);
  const runs = [];
  for (const part of parts) {
    const last = runs.at(-1);
    if (last !== undefined && part.from <= last.to + 1) last.to = Math.max(last.to, part.to);
    else runs.push({ ...part });
  }
  return runs;
}

// A name a repository chose is shown as it is only where it cannot carry a
// line break or a quote into the reason the model reads.
const PLAIN_PATH = /^[\w./@+-]+$/;

// Repository text inside the reason, held in a quote it cannot close.
const quoted = (text) => `\`${text.replaceAll("`", "")}\``;
const listed = (hit) => quoted(formatHit({ ...hit, rel: PLAIN_PATH.test(hit.rel) ? hit.rel : encodePath(hit.rel) }));

const tag = (files) => `(${REUSE_MARK} ${files.slice(0, MARKED_MOST).map((f) => f.mark).join(" ")})`;

// The bin this hook runs from, which is the copy whose `find` reads the index this scan's build wrote.
const BIN = fileURLToPath(new URL("../bin/anatomiya.mjs", import.meta.url));
// A UNC path's leading `\\` is one backslash to a shell, so it is not.
const QUOTABLE = /^(?!\\\\)[\w ./@+:\\-]+$/;

/** Whether a shell reads a path inside double quotes back as itself. */
export const quotable = (path) => QUOTABLE.test(path);

/**
 * The command that asks this checkout's code index, or null where there is no
 * index `find` can read and answer from (`usable` is `usableIndex`'s answer) or
 * the path to the bin could not be quoted safely.
 */
export function finderFor(usable) {
  // An index of no definitions, a repository in no language it lists, would answer every search with nothing.
  if (!quotable(BIN) || usable === null || usable.count === 0) return null;
  // One single-quoted argument, so a shell globs none of the words: `local_url?` is a pattern to zsh.
  return `node "${BIN}" find '<words>'`;
}

/**
 * The measured wording, with the lines these files added and the tag that covers them.
 * `finder` is the command that asks the code index, which takes the grep's place where there is one,
 * and `closest` what the index already lists nearest the names the change declared (`closestTo`).
 */
export function reuseReason(files, { finder = null, closest = null } = {}) {
  const lines = files.flatMap((f) => {
    const shown = PLAIN_PATH.test(f.path) ? f.path : encodePath(f.path);
    return f.hunks.map((h) => `${shown}:${h.from}-${h.to}${h.created ? " (new file)" : ""}`);
  });
  const more = lines.length - LISTED_MOST;
  const list = `${lines.slice(0, LISTED_MOST).join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
  return (
    `${REASON_OPENING} and these added functions: ${list}. ` +
    // Where the scan indexed the repository, the index is the search and grep is left the calls it cannot name:
    // told to do both, a subagent did both, and the turn cost more for the same hits.
    (finder === null
      ? "Have it grep shared and utility modules, files near the change, and code making the same calls, "
      : `Have it run \`${finder}\` in the repository, two or three words with no quote mark for what each added function does, at most three calls, which lists the closest functions by name, doc and path with how many files import each; have it grep only for code making the same calls, `) +
    "then name every existing function that does the same job or part of it. " +
    (closest === null ? "" : `As of the last scan, the code index lists these closest to the added ${closest.names.map(quoted).join(", ")}: ${closest.hits.map(listed).join("; ")}. `) +
    "For each added function, call the closest one it names, the repository's own before a package's, and delete the copy it replaces. Where one does part of the job, call it for that part. " +
    // A session that named the helper kept a copy where it fell short on one case (A123).
    "Where one falls short on a case this change needs, make the new code fit it, or extend it without changing what it returns to its current callers, and call it. " +
    "If it names none, finish without changing anything. " +
    // Last, so the measured wording above is unchanged where the tool exists.
    "If this session has no subagent tool, run that search yourself.\n" +
    tag(files)
  );
}

// What an added line names when it defines something callable, by engine for the two line rules and by
// language for the tree-sitter ones: the words a search for an existing helper is asked with, never a
// judgement. A line ending in `;` is a statement, and a parenthesis holding another is a call's arguments.
const STATEMENT = /^(?!.*;\s*$)/.source;
// A C# member whose body is one expression, `int Sum(int a, int b) => a + b;`, is a definition though it ends in `;`.
const STATEMENT_OR_ARROW = /^(?!(?!.*=>).*;\s*$)/.source;
// A type as a signature writes it: generic arguments one level deep, `Map<String, List<Integer>>`, and arrays.
const TYPE = String.raw`[\w.?]+(?:<(?:[^<>]|<[^<>]*>)*>)?(?:\[\])*`;
const TYPE_PARAMS = String.raw`(?:<(?:[^<>]|<[^<>]*>)*>\s*)?`;
const ANNOTATED = String.raw`(?:@\w+(?:\([^)]*\))?\s+)*`;
const ATTRIBUTED = String.raw`(?:\[[^\]]*\]\s*)*`;
const KEYWORD = String.raw`(?!(?:if|for|while|switch|catch|with|function|return|new|throw|else|case|await|yield)\b)`;
const LINE_DECLARES = {
  oxc: [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*(?::[^=]*)?=>|[A-Za-z_$][\w$]*\s*=>)/,
    /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    // An accessor is a property, which nobody reuses as a helper, so `get` and `set` head no definition here.
    new RegExp(String.raw`^\s*(?:(?:public|private|protected|static|async|override)\s+)*\*?\s*${KEYWORD}([A-Za-z_$][\w$]*)\s*${TYPE_PARAMS}\([^()]*\)\s*(?::\s*[^{=]+)?\{\s*$`),
    // A class field bound to an arrow: `handleClick = () => {`.
    new RegExp(String.raw`^\s*(?:(?:public|private|protected|static|readonly)\s+)*([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s+)?\([^()]*\)\s*(?::[^=]*)?=>`),
  ],
  prism: [/^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/, /^\s*(?:class|module)\s+([A-Z]\w*(?:::[A-Z]\w*)*)/],
};
const TREE_DECLARES = {
  python: [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, /^\s*class\s+([A-Za-z_]\w*)/],
  php: [
    /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+&?\s*([A-Za-z_]\w*)\s*\(/,
    /^\s*(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)/,
  ],
  go: [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/],
  java: [
    new RegExp(String.raw`${STATEMENT}^\s*${ANNOTATED}(?:(?:public|private|protected|static|final|abstract|synchronized|default)\s+)*${TYPE_PARAMS}${KEYWORD}${TYPE}\s+([A-Za-z_]\w*)\s*\(`),
    new RegExp(String.raw`^\s*${ANNOTATED}(?:(?:public|private|protected|static|final|abstract|sealed|non-sealed)\s+)*(?:class|interface|record|enum)\s+([A-Za-z_]\w*)`),
  ],
  csharp: [
    new RegExp(String.raw`${STATEMENT_OR_ARROW}^\s*${ATTRIBUTED}(?:(?:public|private|protected|internal|static|async|override|virtual|abstract|sealed|partial)\s+)+${KEYWORD}${TYPE}\s+([A-Za-z_]\w*)\s*[<(]`),
    new RegExp(String.raw`^\s*${ATTRIBUTED}(?:(?:public|private|protected|internal|static|abstract|sealed|partial|readonly)\s+)*(?:class|interface|record|struct|enum)\s+([A-Za-z_]\w*)`),
  ],
  rust: [
    /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:(?:const|async|unsafe|extern(?:\s+"[^"]*")?)\s+)*fn\s+([A-Za-z_]\w*)/,
    /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/,
  ],
  kotlin: [
    new RegExp(String.raw`^\s*${ANNOTATED}(?:(?:public|private|protected|internal|override|open|abstract|final|suspend|inline|operator|infix|tailrec|external|actual|expect)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w<>?,. ]+\.)?([A-Za-z_]\w*)\s*\(`),
    new RegExp(String.raw`^\s*${ANNOTATED}(?:(?:public|private|protected|internal|abstract|open|data|sealed|enum|inner|value|annotation)\s+)*(?:class|interface|object)\s+([A-Za-z_]\w*)`),
  ],
};

assertKeyed("TREE_DECLARES", TREE_DECLARES, hostedBy("tree-sitter"));

// Names every class or framework writes, which would search for every other class's copy of themselves.
// Held lower-case, as each language capitalises them its own way: `toString`, `ToString`.
const ANY_CLASS = new Set(["constructor", "initialize", "__init__", "init", "new", "call", "run", "main", "render", "tostring", "to_s", "equals", "hashcode", "gethashcode", "dispose", "__str__", "__repr__", "__eq__", "__hash__", "meta", "setup", "teardown", "up", "down", "change", "perform", "execute", "handle"]);

// A turn that added more than this is asked by its first names, which bounds the searches.
const NAMED_MOST = 8;

/**
 * The names the defining lines of `hunks` declare, in the order they appear: `family` is the engine for
 * JavaScript and Ruby, whose rules read lines, and the language for the tree-sitter ones.
 */
export function declaredIn(family, source, hunks, inert) {
  const rules = LINE_DECLARES[family] ?? TREE_DECLARES[family];
  if (!rules) return [];
  const lines = source.split("\n");
  const names = new Set();
  for (const h of hunks) {
    for (let n = h.from; n <= Math.min(h.to, lines.length) && names.size < NAMED_MOST; n++) {
      if (inert[n - 1] === true || lines[n - 1].length > LINE_READ) continue;
      for (const rule of rules) {
        const m = rule.exec(lines[n - 1]);
        if (m && !ANY_CLASS.has(m[1].toLowerCase())) names.add(m[1]);
      }
    }
  }
  return [...names];
}

/** How long one stop may search the code index, all of a change's names together. */
const REUSE_FIND_MS = 500;
// Per name, and over the whole change: enough to point at a helper, short enough to read in the reason.
const CLOSEST_EACH = 3;
const CLOSEST_MOST = 5;
// django's 39,257 definitions zip to 634 KB and read in about 15 ms; a larger index is left to `find`, which no hook clock bounds.
const REUSE_INDEX_BYTES = 2 * 1024 * 1024;

/**
 * The definitions the code index already lists nearest the names a change
 * declared, and the names that found them, or null where it lists none: the
 * best few for each name among the code the file declaring it can call, its
 * own language or one its runtime shares, the rows of the changed files left out, since they
 * are the last scan's copy of what the turn rewrote. Past `deadline` no further
 * name is asked, and a search it overtakes gives up.
 */
export function closestTo(index, files, { deadline = performance.now() + REUSE_FIND_MS } = {}) {
  const changed = new Set(files.map((f) => f.path));
  const asked = new Set();
  const found = [];
  const hits = new Map();
  for (const file of files) {
    const callable = runtimeOf(file.path);
    const where = (rel) => !changed.has(rel) && runtimeOf(rel) === callable;
    for (const name of file.names ?? []) {
      if (hits.size >= CLOSEST_MOST || performance.now() > deadline) break;
      // A name two runtimes declare is asked of each, since each can call only its own.
      if (asked.has(`${callable}\0${name}`)) continue;
      asked.add(`${callable}\0${name}`);
      const before = hits.size;
      for (const hit of findSymbols(index, [name], { ...RANKING, shown: CLOSEST_EACH }, { deadline, where })) {
        const at = `${hit.rel}:${hit.line}`;
        if (!hits.has(at) && hits.size < CLOSEST_MOST) hits.set(at, hit);
      }
      if (hits.size > before && !found.includes(name)) found.push(name);
    }
  }
  return hits.size ? { names: found, hits: [...hits.values()] } : null;
}

// Code a file can call: JavaScript, TypeScript and the components that embed them are one, Java and Kotlin share a runtime, and each other language is its own.
const SHARED_RUNTIME = { java: "jvm", kotlin: "jvm" };
function runtimeOf(rel) {
  const lang = language(rel);
  const engine = engineOf(lang);
  return engine === "tree-sitter" ? (SHARED_RUNTIME[lang] ?? lang) : engine;
}

/** What the stop after a check says, which is also what keeps those files from being asked about again. */
function reuseRecord(files) {
  return `anatomiya checked ${files.length} changed ${files.length === 1 ? "file" : "files"} for existing functions ${tag(files)}`;
}

/**
 * Each changed source file with the lines the working tree adds over HEAD, or
 * null where there are none or git would not say.
 *
 * A file's mark is taken over its content rather than its line numbers, since
 * two different edits can land on the same lines, and per file, so an edit to
 * one file does not make every other one look new. `since` leaves out a file
 * last written before that moment, and `calls` one last written outside every
 * one of the session's tool calls: either is work the session did not do.
 * Nothing is read while a merge or the like is unfinished, which is another
 * branch's. A migration, a schema dump and a file the corpus refuses
 * (generated, or a link) have no function anybody would reuse, and are left
 * out, and so is a hunk whose every added line provably defines nothing
 * callable.
 *
 * `parsing` holds the deadline every file a rule reads in the stop shares, set
 * at the first one: the hook reads every checkout of a stop against one budget.
 *
 * `turnStart` adds what this turn committed: a turn told to write and commit
 * leaves the tree clean, and read against HEAD alone its work was never asked
 * about. The commits are found in the reflog rather than in state this writes,
 * since a marker file would be one more change `git status` reports (A91).
 */
export async function pendingChange(root, { since = null, turnStart = null, calls = null, parsing = { deadline: null }, gitBy = performance.now() + REUSE_GIT_MS } = {}) {
  // git names every path from the top of the checkout, which is where a scan
  // writes its record. A record further down came with a copy of another
  // project, and joined against it git's paths name files nobody changed.
  if (!isPathTaken(join(root, ".git"))) return null;
  // Asked beside the status read rather than after it, so fewer reads run in a
  // row against the stop's one deadline. The corpus's own refusals past the
  // path are asked the way `check` asks them: a generated file or a link holds
  // nothing anybody wrote here by hand.
  const timeout = leftOf(gitBy);
  if (timeout <= 0) return null;
  const [pending, gitdir, dropOf] = await Promise.all([
    pendingPaths(root, { timeout, keep: asked }),
    gitDir(root, timeout),
    // The hook reads every checkout of a stop together: one whose attributes git could not be asked for
    // asks nothing, as one whose status git would not give does, and the others are still read.
    corpusDrop(root, { timeout, readAlso: (path) => templateOf(path) !== null }).catch((err) => {
      if (err instanceof Unasked) return null;
      throw err;
    }),
  ]);
  if (gitdir === null || operationUnfinished(gitdir) || pending === null || dropOf === null) return null;
  // One diff from before the turn's first commit to the tree reads what it
  // committed and what it left uncommitted together, so the reads in a row
  // stay two however many commits the turn made.
  const base = turnStart === null ? null : await committedSince(root, gitdir, turnStart, calls, gitBy);
  if (pending.present.length === 0 && base === null) return null;
  const edited = base !== null || pending.present.some((p) => p.status === "M");
  const left = leftOf(gitBy);
  if (edited && left <= 0) return null;
  const ranges = edited ? await addedRanges(root, base ?? "HEAD", null, { timeout: left }) : new Map();
  if (ranges === null) return null;

  // A committed file is in the diff and nowhere in the status, and reads as an
  // edit: its hunks are the lines it added over the turn's base.
  const listed = new Set(pending.present.map((p) => p.path));
  const committed = [...ranges.keys()].filter((path) => !listed.has(path) && asked(path));
  const changed = [...pending.present, ...committed.map((path) => ({ path, status: "M" }))];
  const home = realpathOf(root);
  const files = [];
  for (const { path, status } of changed.sort((a, b) => byCode(a.path, b.path))) {
    if (ONE_OFF.test(path) || dropOf(path) !== null) continue;
    const entry = readHead(join(root, path), MAX_FILE_BYTES + 1);
    // Past the size the parser skips, or not a file: nothing this reads either.
    if (entry.kind !== "file" || entry.size > MAX_FILE_BYTES) continue;
    if (since !== null && entry.mtimeMs < since) continue;
    if (calls !== null && !inCall(calls, entry.mtimeMs)) continue;
    const added =
      status === "A"
        ? [{ from: 1, to: lineCount(entry.head), created: true }].filter((h) => h.to > 0)
        : (ranges.get(path) ?? []).map(([from, to]) => ({ from, to, created: false }));
    const asking = await askingHunks(path, entry.head, added, parsing);
    if (asking === null) continue;
    // Over the checkout too: a sibling repository's copy of a file is another file.
    const mark = createHash("sha256").update(`${home}\0${path}\0`).update(entry.head).digest("hex").slice(0, 12);
    files.push({ path, mark, hunks: asking.hunks, ...(asking.names.length ? { names: asking.names } : {}) });
  }
  return files.length > 0 ? files : null;
}

/**
 * What one changed file asks, read off its text alone: the hunks among `added`
 * that define something callable, with the names they declare (A126), or null
 * where every added line provably defines nothing (B68, B73). A view template
 * asks by its kind's rule and declares no name. `parsing` holds the deadline
 * every file of one stop shares, set at the first.
 */
export async function askingHunks(path, source, added, parsing = { deadline: null }) {
  const template = templateOf(path);
  // An engine with no rule cannot tell a function from a comment, so its files ask nothing.
  const lang = template === null ? language(path) : null;
  const engine = lang === null ? null : engineOf(lang);
  if (template === null && !INERT_ENGINES.includes(engine)) return null;
  const kind = lang === null ? null : embeddedIn(lang);
  parsing.deadline ??= performance.now() + REUSE_PARSE_MS;
  const script = kind === null ? null : await componentScript(engine, lang, source, kind, parsing.deadline);
  const hunks = script === null ? added : clipped(added, script.spans);
  const inert =
    template !== null
      ? templateInertLines(template, source, parsing.deadline)
      : script === null
        ? await inertLinesOf({ engine, lang, source, deadline: parsing.deadline, path })
        : script.inert;
  // A line past the end of what was read is one nobody read, so its hunk asks.
  const read = lineCount(source);
  const defining = hunks.filter((h) => h.to > read || !inert.slice(h.from - 1, h.to).every(Boolean));
  if (defining.length === 0) return null;
  const names = template === null ? declaredIn(engine === "tree-sitter" ? lang : engine, source, defining, inert) : [];
  return { hunks: defining, names };
}

/**
 * This checkout's git directory, or null where git will not name one.
 *
 * It says whether a merge, a pick, a revert or a rebase is waiting to be
 * finished, and it holds the reflog. A git directory nobody can name asks
 * nothing: the status read beside this one fails the same way.
 */
async function gitDir(root, timeout) {
  const r = await ask(root, ["rev-parse", "--absolute-git-dir"], "where this checkout's git directory is", { timeout }).catch(unaskedAs(null));
  const dir = r?.code === 0 ? r.stdout.trim() : "";
  return dir === "" ? null : dir;
}

/**
 * The commit this turn's own commits were made on top of, or null where the
 * turn committed nothing it can be charged with.
 *
 * `logs/HEAD` records every move of HEAD with the second it happened. Only the
 * commits made after the turn's last checkout, pull, reset, merge or rebase
 * are its own, since each of those brings in work nobody in this session
 * wrote. A first commit has no parent to diff from and a merge commit holds
 * the other side's work, so either ends the run the way a move does, and so
 * does a commit made outside every tool call of the session's, which the
 * reflog cannot tell from one another session made.
 *
 * Read off the file where there is one, which costs no git read. The reftable
 * backend keeps no `logs/`, and there the same entries are asked of git: read
 * off the file alone, a turn that committed everything it wrote was never
 * asked about on reftable.
 */
async function committedSince(root, gitdir, turnStart, calls, gitBy) {
  const entries = headMoves(gitdir) ?? (await headMovesFromGit(root, gitBy));
  if (entries === null) return null;
  let run = null;
  for (const { from, to, seconds, message } of entries) {
    // A second the reflog recorded is the turn's if any part of it is.
    if ((seconds + 1) * 1000 <= turnStart) continue;
    if (!OWN_COMMIT.test(message) || (calls !== null && !inCall(calls, seconds * 1000))) run = null;
    else if (from === null || run === null || run.to !== from) run = from === null ? null : { from, to };
    else run.to = to;
  }
  return run === null ? null : run.from;
}

/** HEAD's moves, oldest first, off `logs/HEAD`; null where there is no such file. */
function headMoves(gitdir) {
  const log = readTail(join(gitdir, "logs", "HEAD"), REFLOG_TAIL);
  if (log === null) return null;
  const moves = [];
  for (const line of log.split("\n")) {
    const entry = REFLOG_ENTRY.exec(line);
    if (entry !== null) moves.push({ from: entry[1], to: entry[2], seconds: Number(entry[3]), message: entry[4] });
  }
  return moves;
}

// How far back git is asked, where there is no file to read the tail of. A
// turn's commits are the newest entries.
const REFLOG_ASKED = 256;

/**
 * The same moves asked of git, oldest first. Git names each entry's new commit
 * and not the one it moved from, which is the entry before it; the oldest one
 * asked has no such entry and cannot start a run.
 */
async function headMovesFromGit(root, gitBy) {
  // No moves read, so no commit is charged to the turn.
  const timeout = leftOf(gitBy);
  if (timeout <= 0) return null;
  const r = await ask(
    root,
    ["log", "-g", `--max-count=${REFLOG_ASKED}`, "--date=unix", "--format=%H %gd %gs", "HEAD"],
    "how HEAD moved lately",
    { timeout }
  ).catch(unaskedAs(null));
  if (r?.code !== 0) return null;
  const moves = [];
  for (const line of r.stdout.split("\n").reverse()) {
    const entry = /^([0-9a-f]+) [^@]*@\{(\d+)\} (.*)$/.exec(line);
    if (entry === null) continue;
    moves.push({ from: moves.at(-1)?.to ?? null, to: entry[1], seconds: Number(entry[2]), message: entry[3] });
  }
  return moves;
}

const lineCount = (text) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

/**
 * When this session's transcript began, off its head (`sessionStartIn`), or null where it cannot be read.
 *
 * The head grows until it holds a stamp: the first stamped record can be an instructions attachment
 * holding every CLAUDE.md and rules file, measured at 167,656 bytes, with its stamp past the first 64 KiB.
 */
export function sessionStart(transcriptPath) {
  if (typeof transcriptPath !== "string" || transcriptPath === "") return null;
  for (let bytes = TRANSCRIPT_HEAD; ; bytes *= 4) {
    const entry = readHead(transcriptPath, bytes);
    if (entry.kind !== "file") return null;
    const at = sessionStartIn(entry.head);
    if (at !== null || entry.size <= bytes || bytes >= TRANSCRIPT_MOST) return at;
  }
}

/**
 * Whether a moment falls inside one of the session's calls, widened a second
 * each side: some filesystems and the reflog keep whole seconds.
 */
const inCall = (calls, ms) => calls.some((c) => c.from - 1000 <= ms && ms <= c.to + 1000);

/**
 * The marks a transcript's tail already holds, from an ask or a record.
 *
 * Anything but text, which is what an unreadable transcript's tail is, holds
 * none: the worst that costs is one more search, where a mark read that was
 * never there would skip a file nobody checked.
 */
export function askedMarksIn(tail) {
  const marks = new Set();
  if (typeof tail !== "string") return marks;
  for (const [, list] of tail.matchAll(MARKS_READ)) {
    for (const mark of list.trim().split(" ")) marks.add(mark);
  }
  return marks;
}

/**
 * Whether the last block a transcript's tail holds at a stop was this hook's own.
 *
 * `stop_hook_active` says some hook continued the turn, not which one, and
 * recording after another hook's block would mark a file checked that no search
 * read.
 */
export function continuedByReuseIn(tail) {
  if (typeof tail !== "string") return false;
  const last = tail.lastIndexOf(FEEDBACK);
  return last !== -1 && tail.indexOf(REASON_OPENING, last) !== -1;
}

/**
 * Whether the turn a stop ends was opened by the result of a subagent launched
 * after this hook's last ask: a search run in the background returns as a task
 * notification, a turn of its own, and what that turn writes is the check's own
 * fix, which the stop records as the stop right after a block does.
 */
export function resumedByReuseIn(tail) {
  if (typeof tail !== "string") return false;
  // The last ask's line, found from the end, so only what follows it is split: the tail runs to 64 MiB.
  let at = tail.length;
  let start = -1;
  // Past a match at the very start there is nothing before it; a search from -1 finds that one again.
  while (start === -1 && at > 0 && (at = tail.lastIndexOf(FEEDBACK, at - 1)) !== -1) {
    const from = tail.lastIndexOf("\n", at) + 1;
    const to = tail.indexOf("\n", at);
    if (tail.slice(from, to === -1 ? tail.length : to).includes(REASON_OPENING)) start = from;
  }
  if (start === -1) return false;
  const after = tail.indexOf("\n", start);
  const { opened, launched } = turnOpenersIn(after === -1 ? "" : tail.slice(after + 1));
  const last = opened.at(-1) ?? null;
  return last !== null && launched.has(last) && !opened.includes(null);
}

/**
 * What the end of a turn is asked about the source it added, or nothing (A91):
 * one block per change, naming each file as it stands, with what the code index
 * already holds nearest the names it declares (A126).
 *
 * `checkouts` are the mapped checkouts the stop reads, each with the prefix its
 * files are named under, and `own` the one the session sits in, whose index
 * `find` run from the session's directory reads, or null.
 *
 * The transcript is read as a tail, twice: before the git reads, for the
 * session's start and its tool calls, and after them, for what another stop
 * asked or recorded meanwhile (A116). Under `TRANSCRIPT_MOST` the tail is the
 * whole transcript, so the session's start is read off it and the head is not
 * opened again; only a larger transcript reads its head apart.
 */
export async function reuseAnswer(checkouts, payload, { own = null } = {}) {
  // Both halves of "once per change, and only this session's work" are read off
  // the transcript: when the session began and which tool calls it made, and
  // what it already asked. One that cannot be read says neither, so nothing is
  // asked. Asking anyway blocked every turn, a question included, over a tree
  // left dirty before the session, since no ask it made was ever recorded
  // anywhere it could read back.
  let before = transcriptTail(payload.transcript_path, TRANSCRIPT_MOST);
  const since = before?.start === 0 ? sessionStartIn(before.text) : sessionStart(payload.transcript_path);
  if (since === null) return {};
  const turn = turnStartIn(before?.text ?? null);
  const calls = toolCallsIn(before?.text ?? null);
  // Let go before the git reads, so two 64 MiB tails are never held at once.
  before = null;
  // One parse budget and one git deadline for the whole stop, however many checkouts it reads.
  const parsing = { deadline: null };
  const gitBy = performance.now() + REUSE_GIT_MS;
  const changes = await Promise.all(checkouts.map((c) => pendingChange(c.root, { since, turnStart: turn, calls, parsing, gitBy })));
  const change = checkouts.flatMap((c, i) => (changes[i] ?? []).map((file) => ({ ...file, path: c.prefix + file.path })));
  if (change.length === 0) return {};
  // Read again past the git reads, which take seconds: an ask or a record
  // another stop wrote meanwhile covers this change.
  const after = transcriptTail(payload.transcript_path, TRANSCRIPT_MOST)?.text ?? null;
  const asked = askedMarksIn(after);
  const fresh = change.filter((file) => !asked.has(file.mark));
  if (fresh.length === 0) return {};
  if (payload.stop_hook_active === true) {
    return continuedByReuseIn(after) ? { systemMessage: reuseRecord(fresh) } : {};
  }
  if (resumedByReuseIn(after)) return { systemMessage: reuseRecord(fresh) };
  // Only for the one checkout the session sits in, where `find` run from its directory reads that checkout's index.
  const { usableIndex } = await import("./index-home.mjs");
  const usable = own !== null ? usableIndex(own, { readMost: REUSE_INDEX_BYTES }) : null;
  const finder = finderFor(usable);
  // Where the reason cannot name `find`, it is A123's word for word (A124), so it names no candidate either.
  const closest = finder === null || usable.index === null ? null : closestTo(usable.index, fresh);
  return { decision: "block", reason: reuseReason(fresh, { finder, closest }) };
}
