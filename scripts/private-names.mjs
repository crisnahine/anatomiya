/**
 * The names this repository shares with a private repository of the corpus
 * and with none of its public ones.
 *
 * The corpus holds real repositories, and some of them are private. Every
 * fixture, comment and document here is public, so a class, a table or a path
 * lifted from a private one reads as that repository to anyone who knows it, and
 * renaming by eye misses some. The private repositories are named on the command
 * line, so this file never lists them.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

import { invokedAs, readArgv, realOf } from "./entry.mjs";
import { ROOT } from "./plugins.mjs";
import { byCode } from "../plugins/anatomiya/lib/paths.mjs";
import { contains } from "../plugins/anatomiya/lib/tsconfig.mjs";

// Two passes, because one alternation would take `read` out of `read-only`.
// shortcut: names compare in their own case from four characters (G16); fold case if a renamed one gets through.
const SNAKE = /[A-Za-z][A-Za-z0-9_]{3,}/g;
const KEBAB = /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+/g;
const PATH = /[A-Za-z0-9_.@[\]-]+(?:\/[A-Za-z0-9_.@[\]-]+)+/g;
// A lockfile lists every package a repository installs, which is every repository's vocabulary.
const LOCKFILE = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Gemfile\.lock|composer\.lock|Cargo\.lock|poetry\.lock)$/;
// Shorter lines are framework boilerplate everywhere.
const LINE_FLOOR = 24;

const listed = (dir, ...flags) =>
  execFileSync("git", ["-C", dir, "ls-files", "-z", ...flags], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] }).toString().split("\0").filter(Boolean);
const tracked = (dir) => listed(dir);
// The checked repository's own list holds what is written and not yet added too, which the next commit publishes.
const ownFiles = (dir) => listed(dir, "--cached", "--others", "--exclude-standard");

/** A regular file's text, or null for a link, a FIFO, one too big to be a source file or one holding a NUL. */
function textOf(path) {
  try {
    const seen = lstatSync(path);
    if (!seen.isFile() || seen.size > 2_000_000) return null;
    const buf = readFileSync(path);
    return buf.subarray(0, 8192).includes(0) ? null : buf.toString("utf8");
  } catch {
    return null;
  }
}

/** Every text file of `dir` the list names but its lockfiles, one at a time, so a large repository is never held whole. */
function* textsOf(dir, files = tracked(dir)) {
  for (const rel of files) {
    if (LOCKFILE.test(rel)) continue;
    const text = textOf(join(dir, rel));
    if (text !== null) yield { rel, text };
  }
}

function namesIn(text) {
  const names = new Set();
  for (const re of [SNAKE, KEBAB]) for (const m of text.matchAll(re)) names.add(m[0]);
  return names;
}

const bare = (s) => s.trim().replace(/^[`'"+,(]+|[`'"+,);]+$/g, "").trim();

/** Every line long enough to be someone's own, split again at a `\n` a string literal holds, so a fixture's copy reads as written. */
function linesIn(text) {
  const lines = new Set();
  for (const line of text.split("\n")) {
    for (const part of line.split("\\n")) {
      const t = bare(part);
      if (t.length >= LINE_FLOOR) lines.add(t);
    }
  }
  return lines;
}

/** Every run of two or more consecutive segments of a path. */
function subPaths(path) {
  const segs = path.split("/");
  const out = [];
  for (let i = 0; i < segs.length; i++) for (let j = i + 2; j <= segs.length; j++) out.push(segs.slice(i, j).join("/"));
  return out;
}

const add = (map, key, rel) => (map.get(key) ?? map.set(key, new Set()).get(key)).add(rel);

/**
 * Takes out of each candidate set what a public repository also holds.
 *
 * Read in this process rather than asked of `git grep -F -f`: the candidates
 * hold ordinary words, so git listed 25,172 of one repository's 27,672 files
 * and spent 72 seconds matching thousands of patterns before a file was read.
 */
function prune(dir, names, lines, paths) {
  for (const rel of tracked(dir)) {
    for (const p of subPaths(rel)) paths.delete(p);
    for (const n of namesIn(rel)) names.delete(n);
  }
  if (names.size === 0 && lines.size === 0) return;
  for (const { text } of textsOf(dir)) {
    if (names.size) for (const n of namesIn(text)) names.delete(n);
    if (lines.size) for (const l of linesIn(text)) lines.delete(l);
    if (names.size === 0 && lines.size === 0) return;
  }
}

const gitOut = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

/** The commits a repository's history starts from, which a clone or a fork of it shares; empty where it has none. */
function rootsOf(dir) {
  try {
    return new Set(gitOut(dir, "rev-list", "--max-parents=0", "HEAD").split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Whether `child` is a copy of `repo`: a shared first commit, or a tip `repo` holds, which is what a shallow clone keeps. */
function copyOf(child, repo, repoRoots) {
  if ([...rootsOf(child)].some((r) => repoRoots.has(r))) return true;
  try {
    gitOut(repo, "cat-file", "-e", `${gitOut(child, "rev-parse", "HEAD")}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * What this repository shares only with the private repositories of the
 * corpus, less what `accepted` names, and the children passed over as copies
 * of it; or `{ error }` for a corpus that cannot be read, a repository git
 * cannot list, or a private name the corpus does not hold.
 */
export function privateNames({ repo, corpus, privates, accepted = new Set() }) {
  let children;
  try {
    children = readdirSync(corpus, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(corpus, e.name, ".git")))
      .map((e) => e.name);
  } catch (err) {
    return { error: `the corpus directory ${corpus} cannot be listed: ${err.code ?? err.message}` };
  }
  const absent = privates.filter((name) => !children.includes(name));
  if (absent.length) return { error: `the corpus holds no repository named ${absent.join(", ")}` };
  for (const dir of [repo, ...children.map((name) => join(corpus, name))]) {
    try {
      tracked(dir);
    } catch (err) {
      return { error: `git cannot list the files of ${dir}: ${String(err.stderr ?? err.message).trim().split("\n")[0]}` };
    }
  }
  // A copy of this repository read as public holds every name it spells, and the check would pass on nothing.
  const repoRoots = rootsOf(repo);
  if (repoRoots.size === 0) return { error: `git cannot read the first commit of ${repo}, so no copy of it in the corpus could be told apart` };
  // A shallow clone's first commit is where it was cut, which no full copy shares.
  if (gitOut(repo, "rev-parse", "--is-shallow-repository") === "true") {
    return { error: `${repo} is a shallow clone, so no copy of it in the corpus could be told apart; run git fetch --unshallow there first` };
  }
  const others = children.filter((c) => !privates.includes(c));
  const skipped = others.filter((c) => copyOf(join(corpus, c), repo, repoRoots));
  const publics = others.filter((c) => !skipped.includes(c)).map((c) => join(corpus, c));
  const files = ownFiles(repo);
  const mine = textsOf(repo, files);

  const names = new Map();
  const lines = new Map();
  const spelled = new Map();
  for (const { rel, text } of mine) {
    for (const name of namesIn(text)) add(names, name, rel);
    for (const line of linesIn(text)) add(lines, line, rel);
    for (const path of text.match(PATH) ?? []) add(spelled, path, rel);
  }
  // A file's own path spells names too, a binary file's included.
  for (const rel of files) {
    for (const name of namesIn(rel)) add(names, name, rel);
    add(spelled, rel, rel);
  }

  const secretNames = new Set();
  const secretLines = new Set();
  const secretPaths = new Set();
  for (const name of privates) {
    const dir = join(corpus, name);
    for (const { text } of textsOf(dir)) {
      for (const n of namesIn(text)) secretNames.add(n);
      for (const l of linesIn(text)) secretLines.add(l);
    }
    for (const rel of tracked(dir)) {
      for (const p of subPaths(rel)) secretPaths.add(p);
      for (const n of namesIn(rel)) secretNames.add(n);
    }
  }

  const nameCandidates = new Set([...names.keys()].filter((n) => secretNames.has(n)));
  const lineCandidates = new Set([...lines.keys()].filter((l) => secretLines.has(l)));
  const pathCandidates = new Set([...spelled.keys()].flatMap(subPaths).filter((p) => secretPaths.has(p)));

  for (const dir of publics) prune(dir, nameCandidates, lineCandidates, pathCandidates);

  // A path is reported once, as the longest private run of the path it was spelled in.
  const paths = new Map();
  for (const [path, files] of spelled) {
    const longest = subPaths(path).filter((p) => pathCandidates.has(p)).sort((a, b) => b.length - a.length)[0];
    if (longest) for (const rel of files) add(paths, longest, rel);
  }

  const found = [
    ...[...lineCandidates].map((text) => ({ kind: "line", text, files: [...lines.get(text)].sort() })),
    ...[...nameCandidates].map((text) => ({ kind: "name", text, files: [...names.get(text)].sort() })),
    ...[...paths].map(([text, files]) => ({ kind: "path", text, files: [...files].sort() })),
  ]
    .filter((f) => !accepted.has(f.text))
    .sort((a, b) => byCode(a.kind, b.kind) || byCode(a.text, b.text));
  return { found, skipped };
}

const USAGE = `usage: node scripts/private-names.mjs <corpusDir> <private>... [--repo <dir>] [--accept <file>]
  <corpusDir>        a directory whose children are the corpus repositories
  <private>          each child of it that is a private repository
  --repo <dir>       the repository to check, this one when left out
  --accept <file>    names, lines and paths judged ordinary, one per line, kept outside the repository`;

function main(argv) {
  const read = readArgv(argv, { repo: { type: "string" }, accept: { type: "string" } }, { positionals: true });
  const refuse = (why) => {
    console.error(`${why}\n\n${USAGE}`);
    process.exit(2);
  };
  if (read.error) refuse(read.error);
  const [corpus, ...privates] = read.positionals;
  if (corpus === undefined || privates.length === 0) refuse("the corpus directory and at least one private repository are required");
  const repo = realOf(resolve(read.values.repo ?? ROOT));
  let accepted = new Set();
  if (read.values.accept !== undefined) {
    // In the filesystem's own spelling, or a path written in another case reads as one outside.
    if (contains(realOf(repo, realpathSync.native), realOf(resolve(read.values.accept), realpathSync.native))) {
      refuse(`${read.values.accept} sits inside the repository it checks, so it would name what it hides`);
    }
    try {
      accepted = new Set(readFileSync(read.values.accept, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    } catch (err) {
      refuse(`the accepted list ${read.values.accept} cannot be read: ${err.code ?? err.message}`);
    }
  }
  const result = privateNames({ repo, corpus, privates, accepted });
  if (result.error) refuse(result.error);
  for (const name of result.skipped) console.error(`passed over ${name}: it is a copy of the repository it checks`);
  for (const { kind, text, files } of result.found) console.log(`${kind} ${text}: ${files.join(", ")}`);
  if (result.found.length) process.exit(1);
  console.error(`no name, line or path here is held only by ${privates.join(", ")}`);
}

if (invokedAs(import.meta.url)) main(process.argv.slice(2));
