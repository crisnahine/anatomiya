#!/usr/bin/env node
/**
 * Manifest check. The plugin loader reads .claude-plugin/ before anything else
 * runs, so a manifest that does not parse fails at install time with no test to
 * catch it, and a stray file in that directory is loader-visible surface.
 *
 * Every plugin the marketplace lists is read as a plugin, not as a path that
 * exists: a directory with no manifest in it installs as nothing, and a hook
 * naming a file its plugin does not ship loads nothing.
 */
import { readFileSync, readdirSync, existsSync, realpathSync, statSync } from "node:fs";
import { join, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { invokedAs } from "./entry.mjs";

const MANIFESTS = ["plugin.json", "marketplace.json"];

/** The kinds of remote an object source may name, read out of the loader's own schema. */
const REMOTE_KINDS = new Set(["npm", "github", "url", "git-subdir", "archive"]);

/** The hook kinds the loader accepts, each a literal `type` it reads before anything else. */
const HOOK_KINDS = new Set(["command", "prompt", "agent", "http", "mcp_tool"]);

/**
 * Semver as semver.org spells it: no leading zeros, pre-release and build as
 * dotted words.
 *
 * Exported because `check-docs.mjs` holds every plugin's version to the same
 * rule before it builds a tag out of one, and a second copy of this pattern is
 * a second answer to one question.
 */
export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** A value as a sentence can carry it: a string as it is, anything else as JSON. */
const shown = (v) => (typeof v === "string" ? v.replace(/\r?\n/g, "\\n") : JSON.stringify(v));

/**
 * Whether a path relative to its root steps out of it. `..cmds` is a name and
 * `../x` is a step, and a prefix test read both as the step; on Windows a
 * path on another drive comes back absolute rather than dotted.
 */
const escapes = (rel) => rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

/**
 * Whether a path inside the repository is a link to somewhere outside it. The
 * containment check on the spelled path normalises `..` and knows nothing
 * about links.
 */
function outsideByLink(root, path) {
  try {
    return escapes(relative(realpathSync(root), realpathSync(path)));
  } catch {
    return false;
  }
}

/** A path as a manifest spells it, so a message reads the same on either platform. */
const label = (root, path) => relative(root, path).split(sep).join("/");

/**
 * Everything wrong with the manifests under `root`, as sentences.
 *
 * Returned rather than printed: the failure cases are what a test needs, and
 * they only exist as trees on disk.
 */
export function validate(root) {
  const problems = [];
  const dir = join(root, ".claude-plugin");

  // A document that parses to null, false or an array is not a manifest, and
  // reading it as an absent one reported nothing at all.
  const readJson = (path) => {
    let value;
    try {
      value = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      problems.push(`${label(root, path)}: ${err.message}`);
      return null;
    }
    if (!isObject(value)) {
      problems.push(`${label(root, path)} is not an object`);
      return null;
    }
    return value;
  };

  // A manifest directory that is a file installs as nothing, and reading it
  // threw past every sentence collected so far.
  const readDir = (path, at) => {
    try {
      return readdirSync(path);
    } catch (err) {
      problems.push(err?.code === "ENOTDIR" ? `${at} is not a directory` : `${at}: ${err?.code ?? err?.message}`);
      return null;
    }
  };

  if (!existsSync(dir)) problems.push(".claude-plugin/ is missing");
  else if (outsideByLink(root, dir)) problems.push(".claude-plugin is a link out of the repository");

  const entries = existsSync(dir) ? (readDir(dir, ".claude-plugin") ?? []) : [];
  for (const name of entries) {
    if (!MANIFESTS.includes(name)) {
      problems.push(`.claude-plugin/${name} is not a manifest; manifests only in that directory`);
    }
  }
  // Only the marketplace manifest is required here. The repository root is the
  // marketplace and nothing else: each plugin has its own root and its own
  // manifest, which the loop below reads where the marketplace says it is.
  if (!entries.includes("marketplace.json")) problems.push(".claude-plugin/marketplace.json is missing");

  // Read once, and only for its own sake: `readJson` reports what is wrong with
  // it, a value that is not an object included. Nothing compares a version
  // against it any more, since no plugin sits here.
  if (!existsSync(join(root, "package.json"))) {
    problems.push("package.json is missing, and it is what declares the plugins as workspaces");
  } else {
    readJson(join(root, "package.json"));
  }
  const marketplace = entries.includes("marketplace.json") ? readJson(join(dir, "marketplace.json")) : null;

  if (marketplace) {
    for (const key of ["name", "owner"]) {
      if (!marketplace[key]) problems.push(`marketplace.json has no "${key}"`);
    }
    const seen = new Set();
    const listed = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
    if (!Array.isArray(marketplace.plugins)) problems.push('marketplace.json "plugins" is not an array');
    if (Array.isArray(marketplace.plugins) && listed.length === 0) problems.push("marketplace.json lists no plugins");
    // Which of the plugins whose hooks are required actually had them read.
    // Asked as "is the name listed", this passed for four shapes that give up
    // on the entry before the hook check runs, so the missing declaration went
    // unmentioned and was still there once the sentence that did print was
    // fixed. Asked as "were they read", every one of them is caught.
    const read = new Set();
    for (const [i, entry] of listed.entries()) {
      const at = entry?.name ? `entry ${entry.name}` : `plugins[${i}]`;
      if (!entry?.name) problems.push("marketplace.json has a plugin entry with no name");
      if (!entry?.source) {
        problems.push(`marketplace.json ${at} has no source`);
        continue;
      }
      if (!entry.name) continue;
      if (seen.has(entry.name)) {
        problems.push(`marketplace.json lists ${entry.name} twice`);
        continue;
      }
      seen.add(entry.name);

      // An object source names a remote by kind, which is somebody else's
      // repository to validate, as long as the kind is one the loader knows.
      if (isObject(entry.source)) {
        const kind = entry.source.source;
        if (typeof kind !== "string") problems.push(`marketplace.json ${at} names a source with no kind`);
        else if (!REMOTE_KINDS.has(kind)) problems.push(`marketplace.json ${at} names a source of kind ${JSON.stringify(kind)}, which the loader does not know`);
        continue;
      }

      // The loader reads a bare "." as "./" before anything else does, and
      // refuses any other source that does not start with "./", a "../"
      // spelling included, even one that re-enters the repository. What starts
      // with "./" may wander as long as it resolves inside: the install path
      // is a traversal guard, not a ban on "..".
      const spelled = entry.source === "." ? "./" : entry.source;
      if (typeof spelled !== "string" || !spelled.startsWith("./")) {
        // A remote source is somebody else's repository to validate. A drive
        // letter is not a scheme, whatever it looks like, and an absolute path
        // resolves on the machine it was written on and nowhere else.
        const source = typeof spelled === "string" ? spelled : "";
        if (/^[a-z][a-z0-9+.-]+:/i.test(source) && !/^[a-z]:[\\/]/i.test(source)) continue;
        if (/^([\\/]|[a-z]:[\\/])/i.test(source) || source === "") {
          problems.push(`marketplace.json ${at} names a source that is not a path in this repository: ${shown(entry.source)}`);
        } else {
          problems.push(`marketplace.json ${at} has a source that does not start with "./": ${entry.source}`);
        }
        continue;
      }

      const pluginRoot = resolve(root, spelled);
      const inside = relative(root, pluginRoot);
      if (escapes(inside) || outsideByLink(root, pluginRoot)) {
        problems.push(`marketplace.json entry ${entry.name} points outside the repository: ${entry.source}`);
        continue;
      }
      if (!existsSync(pluginRoot)) {
        problems.push(`marketplace.json entry ${entry.name} points at a missing path ${entry.source}`);
        continue;
      }

      const ownDir = join(pluginRoot, ".claude-plugin");
      if (existsSync(ownDir) && outsideByLink(root, ownDir)) {
        problems.push(`${label(root, ownDir)} is a link out of the repository`);
        continue;
      }
      const ownEntries = existsSync(ownDir) ? readDir(ownDir, label(root, ownDir)) : [];
      if (ownEntries === null) continue;
      for (const name of ownEntries) {
        if (!MANIFESTS.includes(name)) {
          problems.push(`${label(root, join(ownDir, name))} is not a manifest; manifests only in that directory`);
        }
      }

      const manifest = join(pluginRoot, ".claude-plugin", "plugin.json");
      if (!existsSync(manifest)) {
        problems.push(`${label(root, manifest)} is missing`);
        continue;
      }
      const own = readJson(manifest);
      if (!own) continue;
      if (own.name && own.name !== entry.name) {
        problems.push(`marketplace.json entry ${entry.name} points at a plugin named "${own.name}"`);
      }

      problems.push(...manifestProblems(own, label(root, manifest)));
      problems.push(...declaredPathProblems(own, pluginRoot, label(root, manifest)));
      // A plugin whose own package manifest sits beside its plugin manifest has
      // to agree with it: they are the same release, and a tag reads both.
      problems.push(...packageDrift(pluginRoot, own, label(root, manifest), readJson));
      problems.push(...dependencyInstall(pluginRoot, label(root, pluginRoot), readJson));
      problems.push(...lockfileDrift(root, pluginRoot, `${label(root, pluginRoot)}/package-lock.json`, readJson));
      // The hook that re-delivers the map is required of the plugin that owns
      // it, and of no other: a commands-only plugin asked for no hooks. Which
      // one that is comes off the marketplace rather than off a position in the
      // tree, since no plugin sits at the root any more.
      if (HOOKS_REQUIRED.has(entry.name)) read.add(entry.name);
      const hooks = hookProblems(root, pluginRoot, readJson, { required: HOOKS_REQUIRED.has(entry.name), at: hooksPathsIn(own, pluginRoot) });
      problems.push(...hooks);
      // Hooks are one of the five, so what can be asked of every plugin is that
      // something is there to load. Not asked of a plugin whose declaration was
      // just reported missing: that is the same absence said a second way.
      if (hooks.length === 0 && installsNothing(pluginRoot, own)) {
        problems.push(`marketplace.json entry ${entry.name} installs as nothing: no hooks, commands, agents, skills or mcpServers`);
      }
    }

    for (const wanted of HOOKS_REQUIRED) {
      if (!read.has(wanted)) {
        problems.push(`marketplace.json lists no usable plugin called ${wanted}, whose hooks were never read as a result`);
      }
    }
  }

  return problems;
}

/**
 * The plugins whose hooks are the reason they exist.
 *
 * anatomiya's hook is what re-delivers the map, so its absence is a problem
 * here rather than something a session discovers by the map going stale. Named
 * rather than inferred from where the plugin sits, because nothing sits at the
 * repository root now and a position was never the reason anyway.
 */
const HOOKS_REQUIRED = new Set(["anatomiya"]);

/**
 * A plugin's `package.json` against its `plugin.json`, where it has both.
 *
 * One release moves both and a tag reads both, so the version and the name
 * drift in silence otherwise. This is what was checked at the repository root
 * before the plugins moved out of it.
 */
function packageDrift(pluginRoot, manifest, at, readJson) {
  const path = join(pluginRoot, "package.json");
  if (!existsSync(path)) return [];
  const pkg = readJson(path);
  if (!pkg) return [];
  const problems = [];
  if (manifest.version && pkg.version !== manifest.version) {
    problems.push(`version drift: package.json ${pkg.version}, ${at} ${manifest.version}`);
  }
  if (manifest.name && pkg.name !== manifest.name) {
    problems.push(`name drift: package.json ${pkg.name}, ${at} ${manifest.name}`);
  }
  return problems;
}

/**
 * The lockfiles Claude Code will install a plugin's dependencies from.
 *
 * Read off the build rather than assumed: 2.1.251 lists these four, in this
 * order, and runs the first one it finds beside a `package.json` in the plugin
 * root. `yarn.lock` and `pnpm-lock.yaml` are refused there by name, because
 * their resolution-time hooks run around the `--ignore-scripts` the install is
 * given, so neither counts as covering a plugin.
 */
const INSTALLED_FROM = ["bun.lock", "bun.lockb", "npm-shrinkwrap.json", "package-lock.json"];

/**
 * The lockfiles the loader looks at and will not run, by name.
 *
 * A plugin root holding one of these has a lockfile and still installs nothing,
 * so "no lockfile sits beside it" would send a maintainer looking straight at
 * one to check the only thing that is not wrong.
 */
const REFUSED_LOCKFILES = ["yarn.lock", "pnpm-lock.yaml"];

/**
 * Whether a plugin's dependencies would actually be installed for whoever
 * installs it.
 *
 * The loader reads the plugin root with a non-recursive `readdir` and installs
 * only where a manifest and one of those lockfiles sit together; a root holding
 * the manifest alone is passed over with nothing logged. anatomiya was that
 * root from 0.3.0, when the plugin moved out of the repository root and left
 * the lockfile behind: every version after it installed with no parser, and the
 * first command needing one refused with a sentence about running `setup` that
 * nobody sees on a repository holding no JavaScript.
 *
 * Asked of the declared dependencies rather than of the directory, since a
 * plugin that runs on what node ships has nothing to install and needs no file
 * kept in step with nothing.
 */
function dependencyInstall(pluginRoot, at, readJson) {
  const path = join(pluginRoot, "package.json");
  if (!existsSync(path)) return [];
  const pkg = readJson(path);
  // What the plugin needs at run time, which is not everything `npm ci` would
  // fetch: dev dependencies are left out on purpose, since a plugin that has
  // only those loads fine with none of them installed. Peers are in, because
  // the loader would install them and a plugin can need one to run.
  // `bundleDependencies` is not, because npm requires each of its entries to be
  // a dependency as well, so it can add nothing.
  //
  // A block that is not a block counts as declaring. `dependencies: "oops"` is
  // a manifest npm refuses, and filtering it out left an empty list, which
  // reads as a plugin with nothing to install: the gate passed a manifest
  // nobody can install at all.
  const declared = [pkg?.dependencies, pkg?.optionalDependencies, pkg?.peerDependencies].filter((set) => set !== undefined);
  if (declared.every((set) => isObject(set) && Object.keys(set).length === 0)) return [];
  if (INSTALLED_FROM.some((name) => existsSync(join(pluginRoot, name)))) return [];
  const refused = REFUSED_LOCKFILES.find((name) => existsSync(join(pluginRoot, name)));
  if (refused) return [`${at}: ${refused} is not a lockfile an install reads, so it runs nothing; use npm or bun`];
  return [`${at}: package.json declares dependencies and no lockfile sits beside it, so an install runs nothing`];
}

/**
 * The plugin's lockfile against the marketplace's own, where both are npm's.
 *
 * One dependency set, resolved twice: the root's lockfile is what CI installs
 * and every test here runs against, and the plugin's is what Claude Code
 * installs for whoever adds the plugin. Left to drift they answer different
 * versions for one range, so the suite is green against a parser nobody
 * running the plugin has. Compared by resolved version rather than by file,
 * since the two trees are shaped differently: the root hoists two plugins'
 * packages into one, and a package only the root names belongs to the other
 * plugin rather than being a disagreement about this one.
 *
 * The version compared against is the one this plugin would get rather than the
 * one at the top. npm writes a package it could not hoist under the workspace
 * that needed it, and the copy at the top then belongs to the other consumer:
 * held to that one, a plugin shipping the version it is meant to have reads as
 * drifted, and the fix would be to break it.
 */
function lockfileDrift(root, pluginRoot, at, readJson) {
  const mine = join(pluginRoot, "package-lock.json");
  const theirs = join(root, "package-lock.json");
  if (!existsSync(mine) || !existsSync(theirs)) return [];
  const ours = readJson(mine)?.packages;
  const marketplace = readJson(theirs)?.packages;
  if (!isObject(ours) || !isObject(marketplace)) return [];
  // Where this plugin's own nested resolutions sit in the marketplace's tree.
  // Empty where the two are the same directory, which `validate` never reaches
  // but a caller could: the prefix is then the path itself, and every lookup
  // falls to the hoisted entry, which is the right answer there.
  const within = relative(root, pluginRoot).split(sep).join("/");
  const nestedUnder = within === "" ? "" : `${within}/`;
  const problems = [];
  for (const [path, entry] of Object.entries(ours)) {
    if (path === "" || !isObject(entry) || typeof entry.version !== "string") continue;
    const other = marketplace[`${nestedUnder}${path}`] ?? marketplace[path];
    if (!isObject(other) || typeof other.version !== "string" || other.version === entry.version) continue;
    problems.push(`${at}: ${path} resolves to ${entry.version}, and package-lock.json resolves it to ${other.version}`);
  }
  return problems;
}

const PLUGIN_PATH = /(["'])\$\{CLAUDE_PLUGIN_ROOT\}\/([^"']+)\1|\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'\s`)]+)/g;

/**
 * The paths into a plugin that a text names as `${CLAUDE_PLUGIN_ROOT}/...`, in
 * the order it names them.
 *
 * A quoted path runs to its closing quote, so a name may carry a space. A bare
 * one ends at whitespace, a quote, a backtick or a closing parenthesis: prose
 * wraps a path in backticks and a shell wraps one in a subshell, and a file
 * honestly named with either is quoted in every hook this repository ships.
 * One alternation, so a bare match never starts inside a quoted one.
 *
 * One grammar, because `scripts/shipped.mjs` read the same variable with a
 * copy that ended a bare path at whitespace alone, and on
 * `sh -c "(node ${CLAUDE_PLUGIN_ROOT}/x.mjs)"` the two gates named two files.
 */
export function pluginPaths(text) {
  const named = [];
  for (const [, , quoted, bare] of text.matchAll(PLUGIN_PATH)) named.push(quoted ?? bare);
  return named;
}

/**
 * The five kinds of thing a plugin can install: the manifest key that names
 * one, and where the loader looks when the manifest does not.
 *
 * One list, because `declaredPathProblems` walked its own copy of the same five
 * keys and `scripts/shipped.mjs` reads this one for the same reason: three
 * hand-kept copies of one fact is the shape this repository keeps writing tests
 * against.
 */
export const LOADABLE = [
  ["hooks", "hooks/hooks.json"],
  ["commands", "commands"],
  ["agents", "agents"],
  ["skills", "skills"],
  ["mcpServers", ".mcp.json"],
];

/** The manifest keys alone, in the order the kinds are declared. */
const LOADABLE_KEYS = LOADABLE.map(([key]) => key);

/**
 * Whether a plugin would install with a name, a version and no behaviour.
 *
 * Hooks cannot be required of every plugin, since a commands-only one is a
 * perfectly good plugin, so the question is whether any of the five is there at
 * all. It is asked because the hook check answers nothing when the declaration
 * is simply absent: the second plugin here is its two hooks, and deleting the
 * file that declares them left every gate green.
 */
function installsNothing(pluginRoot, manifest) {
  for (const [key, conventional] of LOADABLE) {
    // A manifest that names one has already had that path checked for real by
    // `declaredPathProblems`, so naming it is enough here: what that one
    // passes over is a path carrying the loader's variable, which is a
    // declaration either way. Naming it as an empty list or an empty object is
    // not naming it.
    if (declares(manifest[key])) return false;
    const at = join(pluginRoot, conventional);
    // A hook declaration is asked what it declares rather than whether it has
    // bytes: `{"hooks":{}}` is a file, and it loads nothing.
    if (key === "hooks" ? declaresAHook(at) : holdsSomething(at)) return false;
  }
  return true;
}

/**
 * Whether a hook declaration names at least one hook the loader would run.
 *
 * A file that is there and will not parse counts as one: `hookProblems` reports
 * what is wrong with it in its own words, and saying "installs as nothing"
 * beside that adds a second sentence about one broken file. What this is asked
 * for is the file that parses and declares none, which reads as behaviour to
 * every other check.
 */
function declaresAHook(path) {
  let declared;
  try {
    declared = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return err?.code !== "ENOENT";
  }
  if (!isObject(declared?.hooks)) return true;
  return holdsAHook(declared);
}

/**
 * Whether a parsed declaration puts a hook entry anywhere under its events.
 *
 * Three spellings of the same nothing: no event, an event with no group, and a
 * group whose own list is empty. A shape `hookProblems` refuses is one it will
 * name, so this answers yes there rather than adding a second message about the
 * same file.
 */
function holdsAHook(declared) {
  const events = Object.values(declared.hooks);
  if (events.some((groups) => !Array.isArray(groups))) return true;
  return events.some((groups) => groups.some((group) => (Array.isArray(group?.hooks) ? group.hooks : []).length > 0));
}

/**
 * The hook declarations a manifest names, or none for the convention.
 *
 * Every one it names, because the loader merges them: reading only the first
 * left a second file's hooks unchecked. A path that leaves the plugin is not
 * among them, since `declaredPathProblems` has already said so and reading it
 * would be reporting on a file that is not this plugin's; nor is one carrying
 * the plugin-root variable, which is the loader's to substitute.
 */
function hooksPathsIn(manifest, pluginRoot) {
  const named = manifest?.hooks;
  const paths = [];
  for (const one of Array.isArray(named) ? named : [named]) {
    if (typeof one !== "string" || one.trim() === "" || one.includes("${")) continue;
    const rel = one.replace(/^\.\//, "");
    const abs = resolve(pluginRoot, rel);
    if (escapes(relative(pluginRoot, abs)) || outsideByLink(pluginRoot, abs)) continue;
    paths.push(rel);
  }
  return paths;
}

/** Whether a manifest value names anything, rather than being present and empty. */
function declares(value) {
  if (typeof value === "string") return value !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return Boolean(value);
}

/**
 * A file with bytes in it, or a directory with a file somewhere under it.
 *
 * Somewhere under it rather than directly in it, because commands nest:
 * `commands/ops/deploy.md` is a command, and a directory holding one empty
 * subdirectory installs nothing.
 */
function holdsSomething(path) {
  let seen;
  try {
    seen = statSync(path);
  } catch {
    return false;
  }
  if (seen.isFile()) return seen.size > 0;
  if (!seen.isDirectory()) return false;
  try {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (holdsSomething(join(path, entry.name))) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Every path a manifest names by hand, which is where the typo lands: it has to
 * exist, and it has to stay inside the plugin that names it.
 */
function declaredPathProblems(manifest, pluginRoot, at) {
  const problems = [];
  for (const key of LOADABLE_KEYS) {
    const value = manifest[key];
    const listed = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
    for (const [i, declared] of listed.entries()) {
      // `./hooks/hooks.json` and `hooks/hooks.json` are one path to the
      // loader, and only the first was ever checked. A path carrying the
      // plugin-root variable is the loader's to substitute, so resolving it
      // here would report on a path nothing opens.
      if (typeof declared !== "string" || declared.trim() === "" || declared.includes("${")) continue;
      const where = Array.isArray(value) ? `${key}[${i}]` : key;
      const abs = resolve(pluginRoot, declared);
      if (escapes(relative(pluginRoot, abs)) || outsideByLink(pluginRoot, abs)) {
        problems.push(`${at} ${where} points outside the plugin: ${declared}`);
      } else if (!existsSync(abs)) {
        problems.push(`${at} ${where} points at a missing path: ${declared}`);
      }
    }
  }
  return problems;
}

/** What every plugin manifest has to say, wherever in the repository it lives. */
function manifestProblems(manifest, at) {
  const problems = [];
  for (const key of ["name", "version", "description"]) {
    if (!manifest[key]) problems.push(`${at} has no ${key}`);
  }
  if (manifest.version && !SEMVER.test(String(manifest.version))) {
    problems.push(`${at} version is not semver: ${shown(String(manifest.version))}`);
  }
  return problems;
}

/**
 * The hooks a plugin declares, and whether it ships what they run.
 *
 * The loader reads this before anything runs too, and a hook it will not load
 * fails silently. The opposite failure already shipped, a hook Claude Code
 * refuses by name on every prompt, so both directions are checked here rather
 * than trusted.
 */
function hookProblems(root, pluginRoot, readJson, { required, at: named = [] }) {
  const problems = [];
  // Where the manifest puts them, and the convention only when it names
  // nothing. `LOADABLE`'s own docstring says that is the rule and
  // `installsNothing` follows it; this read the convention whatever the
  // manifest said, so a plugin that moved its declaration was refused for a
  // file it does not need and the hooks it does declare went unchecked.
  const paths = (named.length ? named : [join("hooks", "hooks.json")]).map((rel) => join(pluginRoot, rel));

  // What each declaration turned out to be, so the question below is answered
  // over the set rather than per file: the loader merges them, and one of them
  // carrying the hook is enough for the map to be re-delivered.
  const present = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const at = label(root, path);
    const declared = readJson(path);
    // A file that will not parse has been reported by `readJson` in its own
    // words, and it is not evidence either way about what is declared.
    if (!declared) {
      present.push({ path, at, declared: null, loads: true });
      continue;
    }
    if (!isObject(declared.hooks)) {
      problems.push(`${at} has no top-level hooks block, so it loads nothing`);
      present.push({ path, at, declared, loads: false, said: true });
      continue;
    }
    present.push({ path, at, declared, loads: holdsAHook(declared) });
  }

  // A file was what this checked for, and a file is not a hook. The one plugin
  // whose hooks are required is also the one skipped by the check that asks
  // whether a plugin installs anything at all, so an emptied declaration here
  // passed every gate.
  if (required && !present.some((one) => one.loads)) {
    if (present.length === 0) problems.push(`${label(root, paths[0])} is missing, so the map is never re-delivered`);
    // Where every declaration has already been called one that loads nothing,
    // saying it a second way adds a sentence and no fact.
    else if (!present.every((one) => one.said)) problems.push(`${present[0].at} declares no hook, so the map is never re-delivered`);
    return problems;
  }

  for (const { at, declared } of present) {
    if (!declared || !isObject(declared.hooks)) continue;
    problems.push(...eventProblems(pluginRoot, at, declared.hooks));
  }
  return problems;
}

/** What one declaration's events run, and whether this plugin ships it. */
function eventProblems(pluginRoot, at, block) {
  const problems = [];
  for (const [event, groups] of Object.entries(block)) {
    if (!Array.isArray(groups)) {
      problems.push(`${at} event ${event} is not a list`);
      continue;
    }
    const hooks = groups.flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks : []));
    for (const hook of hooks) {
      // Every kind the loader accepts is a literal `type`, and an entry without
      // one, or with one it does not know, fails the whole event's load in
      // silence. Only a command hook runs a file of the plugin's.
      if (!isObject(hook) || typeof hook.type !== "string" || hook.type === "") {
        problems.push(`${at} ${event} has a hook with no type, so the loader drops the event`);
        continue;
      }
      if (!HOOK_KINDS.has(hook.type)) {
        problems.push(`${at} ${event} has a hook of type ${JSON.stringify(hook.type)}, which the loader does not know`);
        continue;
      }
      if (hook.type !== "command") continue;
      if (typeof hook.command !== "string" || hook.command.trim() === "") {
        problems.push(`${at} ${event} has a hook with no command`);
        continue;
      }
      // The exec form names its files in `args`, one per element, and the
      // shell form in `command`; both read as one line here.
      const args = Array.isArray(hook.args) ? hook.args.filter((a) => typeof a === "string") : [];
      const command = [hook.command, ...args.map((a) => (a.includes(" ") ? `"${a}"` : a))].join(" ");
      if (!command.includes("${CLAUDE_PLUGIN_ROOT}")) {
        problems.push(`${at} ${event} runs ${command}, which names nothing in this plugin`);
        continue;
      }
      // Every file the command names, not only the first: a command may carry
      // arguments, and one may name the plugin root on its own, which names no
      // file to check.
      for (const named of pluginPaths(command)) {
        const file = join(pluginRoot, named);
        if (escapes(relative(pluginRoot, resolve(pluginRoot, named))) || outsideByLink(pluginRoot, file)) {
          problems.push(`${at} ${event} runs ${named}, which is outside that plugin`);
        } else if (!isFile(file)) {
          problems.push(`${at} ${event} runs ${named}, which that plugin does not ship`);
        }
      }
    }
  }
  return problems;
}

/** A directory exists and runs nothing, so existence is not the question. */
function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function main() {
  const root = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const problems = validate(root);
  if (problems.length) {
    // A workflow reads these as annotations, and a line it cannot see is a
    // failure someone has to open the log to understand.
    const prefix = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "";
    for (const p of problems) console.error(`${prefix}${p}`);
    process.exit(1);
  }
  console.log(`manifests ok (${MANIFESTS.join(", ")}), hooks ok`);
}

if (invokedAs(import.meta.url)) main();
