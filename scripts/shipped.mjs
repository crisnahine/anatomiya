#!/usr/bin/env node
/**
 * What the plugin ships, against what it loads.
 *
 * A plugin's directory holds what the marketplace copies, and its `package.json`
 * `files` is what says which of those the plugin loads and which are how it is
 * built. That list went unread: the package
 * is private, so no pack or publish ever happened, and the list was wrong in
 * both directions without a word. It omitted `hooks/`, which is where the
 * loader looks for the hooks this plugin installs, and its `.claude-plugin/`
 * entry carried `marketplace.json` with the manifest, which describes the
 * marketplace rather than the plugin.
 *
 * npm answers what the list covers rather than this re-implementing it: a
 * directory entry is recursive, a negation subtracts, a nested `.npmignore`
 * subtracts, a few names are added whatever the list says, and an entry naming
 * a path that does not exist is passed over in silence. `--dry-run` writes no
 * tarball, though it still runs whatever `prepack` a package declares, and
 * `--offline` reaches nothing.
 *
 * What is checked is the direction that breaks a plugin: a file it loads and
 * does not ship. Shipping more than it loads is only checked for the
 * marketplace manifest, which is the one file that belongs to something else.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { invokedAs } from "./entry.mjs";
import { LOADABLE } from "./validate.mjs";

/** Read rather than trusted: this gate must not reach a registry. */
export const PACK_ARGV = ["pack", "--dry-run", "--json", "--offline"];

/**
 * Whether the pack this reads can be run here at all.
 *
 * npm ships on Windows as `npm.cmd` with no `npm.exe`, a spawn resolves an
 * extension-less name against `.com` and `.exe` only, so it answers ENOENT on a
 * machine that has npm installed, and running the batch file needs the shell
 * `runSetup` already refuses to spawn for the same reason. The gate runs on the
 * Linux job either way, so a Windows checkout is told why rather than handed a
 * failure it cannot fix.
 */
export const PACKABLE = process.platform !== "win32";

/** Where the loader looks for hooks when the manifest names nowhere else. */
const DECLARATION = "hooks/hooks.json";

/** The first file the loader opens, and the one that says where the rest is. */
const MANIFEST = ".claude-plugin/plugin.json";

/** The marketplace's own manifest, which describes the marketplace and not this plugin. */
const MARKETPLACE = ".claude-plugin/marketplace.json";

/**
 * Where the loader starts, for one manifest: what it names for a kind, and the
 * conventional path for every kind it leaves unnamed.
 *
 * A file under any of them may name a path the way the loader substitutes one,
 * and a first pass read two of the five, so a skill naming a file the plugin
 * did not ship passed the gate without a word. The manifest is read because a
 * kind it points somewhere else is loaded from there and not from the
 * convention, and it is a starting point itself: an mcp block written inline
 * names a file, and nothing had ever opened the manifest to see it.
 *
 * A value that names no path leaves the convention standing, which is the
 * answer `validate.mjs` gives the same key: reading `[]` as a list of no paths
 * dropped the conventional path with it and the whole kind went unwalked. A
 * value that names somewhere outside the plugin, or the plugin root itself, is
 * returned as a problem rather than followed: everything the walk reaches is
 * held to the root, and the starting points were not.
 */
function entryPointsFor(root, manifest) {
  const at = [MANIFEST];
  const problems = [];
  for (const [key, conventional] of LOADABLE) {
    const named = manifest?.[key];
    const spelled = (Array.isArray(named) ? named : [named]).filter((one) => typeof one === "string" && one.trim() !== "");
    if (spelled.length === 0) {
      at.push(conventional);
      continue;
    }
    for (const one of spelled) {
      const held = inside(root, resolve(root, one));
      if (held === null) problems.push(`${MANIFEST} ${key} names ${one}, which is not inside this plugin`);
      else at.push(held);
    }
  }
  return { at: [...new Set(at)], problems };
}

/** The file the loader opens first for hooks, which a manifest may move. */
function declarationIn(root, manifest) {
  const named = manifest?.hooks;
  const one = (Array.isArray(named) ? named : [named]).find((v) => typeof v === "string" && v.trim() !== "");
  return one === undefined ? DECLARATION : inside(root, resolve(root, one)) ?? DECLARATION;
}

/**
 * A specifier the plugin owns, as it is spelled in source: named after `from`
 * or a bare `import`, or handed to a call.
 *
 * The call form is deliberately any call rather than `require` and `import`
 * alone, because this repository loads its one JSON table through
 * `createRequire(import.meta.url)("./model-defaults.json")`, where the callee
 * is a value and not a name a pattern can look for. A call that is neither
 * resolves to a path that is not a file, and the walk drops it.
 */
const SPECIFIERS = [
  /(?:from|import)\s*(["'])(\.[^"']*)\1/g,
  /\(\s*(["'])(\.[^"']*)\1\s*\)/g,
  // A sibling resolved rather than imported. Both of this tool's workers are
  // started this way, `new URL("./parse-worker.mjs", import.meta.url)` handed
  // to a child process, so nothing imports the two files it cannot run without.
  /new\s+URL\s*\(\s*(["'])(\.[^"']*)\1/g,
];

/**
 * A path into the plugin, as a hook command or a command file spells it.
 *
 * The quoted form is tried first because a hook command is parsed out of JSON
 * before it is read here, so the quotes left in it are the shell's and they are
 * what delimit the path: read to the first space instead, a file with a space
 * in its name was reported as one the plugin does not have.
 */
const PLUGIN_PATHS = [
  /(["'])\$\{CLAUDE_PLUGIN_ROOT\}\/([^"']+)\1/g,
  /()\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'\s`)]+)/g,
];

/**
 * What ends a sentence rather than a filename.
 *
 * Command and skill files are prose, and a path written into one runs to the
 * full stop. Read as part of the name, it reports a file the plugin has as one
 * it does not: a gate that fails on a correct tree gets turned off.
 */
const SENTENCE_END = /[.,;:!?]+$/;

/**
 * A named path as the tree spells it: as written if that is there, and without
 * the sentence stop if that is.
 *
 * Stripping first renames a file that honestly ends in one of those characters.
 * Asked of the tree, each answer is about a path that is really there, and a
 * name that is neither keeps the spelling the author wrote, which is the one
 * they have to go and look for.
 */
function spelledInTree(root, named) {
  if (existsSync(join(root, named))) return named;
  const trimmed = named.replace(SENTENCE_END, "");
  return existsSync(join(root, trimmed)) ? trimmed : named;
}

/** A path as this repository spells one, so a message reads the same on either platform. */
const asPosix = (path) => path.split(sep).join("/");

/**
 * Every file under `root` that the given entry points can reach, themselves
 * included, as repository-relative paths.
 *
 * Walked rather than listed, because the list is what goes wrong: `bin/` and
 * `lib/` are two entries in `files` today and one import away from being three.
 * Textual, and deliberately so: resolving through the loader would mean running
 * the code, and a specifier that is not a literal is one this cannot follow
 * either way.
 */
export function reachableFrom(root, entries) {
  const files = new Set();
  const missing = new Map();
  const queue = entries.map((rel) => ({ rel, from: null }));

  while (queue.length > 0) {
    const { rel, from } = queue.shift();
    if (files.has(rel)) continue;
    const path = join(root, rel);
    if (!isFile(path)) {
      // A path named the way the loader substitutes one is an explicit
      // reference, so a name with no file behind it is a typo worth reporting.
      // A specifier is not: the patterns above deliberately over-match, and a
      // call with a relative string that resolves to nothing is ordinary code.
      // A directory that is there is neither: prose names one to say where
      // something lives, and there is no file to read at it.
      if (from !== null && !missing.has(rel) && !existsSync(path)) missing.set(rel, from);
      continue;
    }
    files.add(rel);

    const body = readFileSync(path, "utf8");
    for (const pattern of SPECIFIERS) {
      for (const [, , specifier] of body.matchAll(pattern)) {
        const reached = inside(root, resolve(dirname(path), specifier));
        if (reached !== null) queue.push({ rel: reached, from: null });
      }
    }
    // Read in every file rather than in the entry points alone. The loader
    // substitutes the variable for what it loads, and it also sets it in the
    // environment of every hook process, so a script under `bin/` naming a
    // sibling that way is naming one for real.
    for (const named of pluginPathsIn(root, rel, body)) {
      const reached = inside(root, resolve(root, named));
      if (reached !== null) queue.push({ rel: reached, from: rel });
    }
  }

  return { files: [...files], missing };
}

/**
 * The plugin paths a file names, read the way its own format spells them.
 *
 * A hook declaration is JSON, so its command arrives with the quotes around the
 * path escaped, and a pattern run over the raw bytes took the backslash before
 * the closing quote as part of the filename. Parsed first, the string is the
 * one the loader will substitute into. Anything else is prose, where the raw
 * text is what a reader sees.
 */
function pluginPathsIn(root, rel, body) {
  const named = [];
  const collect = (text) => {
    // The quoted form first, and what it matched is then taken out of the text:
    // the unquoted pattern matches inside a quoted reference too, and would
    // report the part before the space as a second, shorter path.
    const [quoted, bare] = PLUGIN_PATHS;
    const rest = text.replace(quoted, (whole, _q, path) => {
      named.push(spelledInTree(root, path));
      return " ".repeat(whole.length);
    });
    for (const [, , path] of rest.matchAll(bare)) named.push(spelledInTree(root, path));
  };

  if (!rel.endsWith(".json")) {
    collect(body);
    return named;
  }
  const walk = (value) => {
    if (typeof value === "string") collect(value);
    else if (Array.isArray(value)) for (const item of value) walk(item);
    else if (value !== null && typeof value === "object") for (const item of Object.values(value)) walk(item);
  };
  try {
    walk(JSON.parse(body));
  } catch {
    // A declaration that does not parse loads nothing, which the manifest gate
    // already says in its own words.
  }
  return named;
}

/**
 * The path relative to the root, or null when it steps outside it.
 *
 * The step is `..` alone or `..` followed by the separator: a prefix test read
 * a file honestly named `..rc` as one, and `relative` never returns a `..`
 * anywhere but at the front.
 */
function inside(root, path) {
  const rel = relative(root, path);
  // The absolute case is what `escapes` in `scripts/validate.mjs` guards and
  // this did not: two Windows drives have no relative path between them, so
  // `relative` answers an absolute one, which holds no `..` and read as inside.
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return asPosix(rel);
}

/**
 * Every plugin directory the marketplace lists, inside the marketplace.
 *
 * A package of its own was the filter here once, which left the plugin that
 * has none checked by nothing at all: it ships its directory whole, so what it
 * loads still has to be there. A source pointing out of the marketplace names
 * no plugin of this repository's, and `validate.mjs` says so in its own words;
 * walking it here would report on a tree that is nobody's plugin.
 */
export function pluginRootsIn(marketplace) {
  let listed;
  try {
    listed = JSON.parse(readFileSync(join(marketplace, MARKETPLACE), "utf8")).plugins;
  } catch {
    return [];
  }
  if (!Array.isArray(listed)) return [];
  const roots = [];
  for (const entry of listed) {
    if (typeof entry?.source !== "string") continue;
    const root = resolve(marketplace, entry.source);
    if (inside(marketplace, root) === null || !existsSync(root)) continue;
    roots.push(root);
  }
  return roots;
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Every file under a directory the plugin ships by convention, at any depth.
 *
 * Commands nest: `commands/ops/deploy.md` is `/plugin:ops:deploy`, so a walk one
 * level deep leaves every namespaced command unread and whatever it names
 * unchecked.
 */
function filesIn(root, rel) {
  let entries;
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    // A name npm never carries is not a thing the plugin loads: a Finder visit
    // leaves a `.DS_Store` in a command directory, and reading one as an entry
    // point turned every macOS checkout red.
    if (entry.name.startsWith(".")) continue;
    const at = `${rel}/${entry.name}`;
    // A `Dirent` for a link is neither a file nor a directory, so a link was
    // passed over by both branches. npm drops one from the tarball as well, so
    // a command behind a link went unwalked and unshipped in one silence.
    const kind = entry.isSymbolicLink() ? statOf(join(root, at)) : entry;
    if (kind?.isDirectory()) found.push(...filesIn(root, at));
    else if (kind?.isFile()) found.push(at);
  }
  return found;
}

/** What a path resolves to, or null for a link with nothing behind it. */
function statOf(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Everything wrong with what this package would ship, as sentences.
 *
 * Returned rather than printed, for the same reason `validate` returns its own:
 * the cases only exist as trees on disk, and that is what puts them under test.
 */
export function shipped(root) {
  const problems = [];

  // A plugin with no package of its own has no list to hold against what it
  // loads, and the marketplace copies its directory whole. What it still has is
  // files that name paths, so the walk below runs either way and only the
  // comparison with `files` is skipped. Filtered out for want of a list, the
  // second plugin here was read by nothing at all.
  const lists = existsSync(join(root, "package.json"));
  let carried = null;
  if (lists) {
    const pack = spawnSync("npm", PACK_ARGV, { cwd: root, encoding: "utf8", timeout: 120000 });
    if (pack.error || pack.status !== 0) {
      problems.push(`npm ${PACK_ARGV.join(" ")} could not read what this package ships: ${(pack.stderr || pack.error?.message || "").trim().split("\n")[0]}`);
      return problems;
    }
    try {
      carried = new Set(JSON.parse(pack.stdout)[0].files.map((file) => file.path));
    } catch (err) {
      problems.push(`npm ${PACK_ARGV.join(" ")} answered something this cannot read: ${err.message}`);
      return problems;
    }
  }

  // Read before the walk, because it says where the walk starts. Falling back
  // to the conventional paths when it will not parse is silence about every
  // kind it moved, and one trailing comma is all it takes.
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, MANIFEST), "utf8"));
  } catch {
    problems.push(`${MANIFEST} could not be read, so nothing says where this plugin keeps what it loads`);
    return problems;
  }

  // Both are read before anything the plugin does, and `files` names the
  // manifest by its exact path, so a typo there ships a plugin with no manifest
  // at all and npm passes the entry over without a word. The declaration is the
  // one the manifest names, since a manifest that moved it left the file at the
  // conventional path a leftover the loader never opens.
  const declaration = declarationIn(root, manifest);
  for (const read of carried === null ? [] : [...new Set([MANIFEST, declaration])]) {
    if (!carried.has(read) && existsSync(join(root, read))) {
      problems.push(`package.json files does not ship ${read}, which the loader reads`);
    }
  }

  const starting = entryPointsFor(root, manifest);
  problems.push(...starting.problems);
  const entries = starting.at
    .filter((rel) => existsSync(join(root, rel)))
    .flatMap((at) => (isFile(join(root, at)) ? [at] : filesIn(root, at)));
  const named = new Map();
  const absent = new Map();
  for (const entry of entries) {
    const walked = reachableFrom(root, [entry]);
    for (const reached of walked.files) {
      if (!named.has(reached)) named.set(reached, entry);
    }
    for (const [reached, from] of walked.missing) {
      if (!absent.has(reached)) absent.set(reached, from);
    }
  }
  for (const [reached, through] of named) {
    // The two the loop above already reported on, and not the other entry
    // points: a command or a skill that is not shipped is a command or a skill
    // the plugin does not have, and this is the only loop that would say so.
    if (carried === null || reached === MANIFEST || reached === declaration || carried.has(reached)) continue;
    problems.push(`package.json files does not ship ${reached}, which ${through} reaches`);
  }
  for (const [reached, through] of absent) {
    problems.push(`${through} names ${reached}, which this plugin does not have`);
  }

  // Asked of the list where there is one and of the directory where there is
  // not: a plugin with no `files` ships whatever sits in it, so the file that
  // belongs to the marketplace is carried by the plugin that nothing stops.
  if (carried === null) {
    if (existsSync(join(root, MARKETPLACE))) {
      problems.push(`${MARKETPLACE} belongs to the marketplace rather than to the plugin, and this plugin ships its whole directory`);
    }
  } else if (carried.has(MARKETPLACE)) {
    problems.push(`package.json files ships ${MARKETPLACE}, which belongs to the marketplace rather than to the plugin`);
  }

  return problems;
}

function main(argv) {
  if (!PACKABLE) {
    console.log("not checked here: npm on Windows is a batch file, and running one needs a shell no command here may spawn");
    return;
  }
  // An option this does not know is a typo, and taking one as the directory to
  // scan made the npm spawn fail for a missing cwd with a message about npm not
  // being installed.
  const typo = argv.find((arg) => arg.startsWith("-"));
  if (typo !== undefined) {
    console.error(`unknown option: ${typo}\nusage: node scripts/shipped.mjs [pluginRoot]`);
    process.exit(2);
  }
  if (argv.length > 1) {
    console.error(`only one plugin root may be given, and ${argv[1]} was the second`);
    process.exit(2);
  }
  // Every plugin the marketplace lists, unless the caller names one: each has
  // its own root, its own `files` and its own set to check, and checking one of
  // two is how the other's went unread.
  const marketplace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const roots = argv[0] ? [resolve(argv[0])] : pluginRootsIn(marketplace);
  if (roots.length === 0) {
    console.error(`${MARKETPLACE} lists no plugin inside this marketplace whose directory is there`);
    process.exit(1);
  }
  const problems = roots.flatMap((root) => shipped(root).map((problem) => `${relative(marketplace, root) || "."}: ${problem}`));
  if (problems.length) {
    const prefix = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "";
    for (const problem of problems) console.error(`${prefix}${problem}`);
    process.exit(1);
  }
  // Named rather than counted, and each said with what was asked of it: a
  // plugin with a `files` list is held to it, and one without ships its
  // directory whole, so what was checked there is that everything it loads is
  // in that directory. The count alone reads as one check over both.
  const said = roots.map((root) => {
    const rel = relative(marketplace, root) || ".";
    return existsSync(join(root, "package.json")) ? rel : `${rel} (no files list: what it loads is there)`;
  });
  console.log(`the shipped set holds what each of these loads: ${said.join(", ")}`);
}

if (invokedAs(import.meta.url)) main(process.argv.slice(2));
