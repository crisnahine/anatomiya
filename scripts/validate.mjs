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

const MANIFESTS = ["plugin.json", "marketplace.json"];

/** The kinds of remote an object source may name, read out of the loader's own schema. */
const REMOTE_KINDS = new Set(["npm", "github", "url", "git-subdir", "archive"]);

/** The hook kinds the loader accepts, each a literal `type` it reads before anything else. */
const HOOK_KINDS = new Set(["command", "prompt", "agent", "http", "mcp_tool"]);

/** Semver as semver.org spells it: no leading zeros, pre-release and build as dotted words. */
const SEMVER =
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
  for (const m of MANIFESTS) {
    if (!entries.includes(m)) problems.push(`.claude-plugin/${m} is missing`);
  }

  let pkg = null;
  if (existsSync(join(root, "package.json"))) pkg = readJson(join(root, "package.json"));
  else problems.push("package.json is missing, so no version can be compared against it");
  const plugin = entries.includes("plugin.json") ? readJson(join(dir, "plugin.json")) : null;
  const marketplace = entries.includes("marketplace.json") ? readJson(join(dir, "marketplace.json")) : null;

  if (plugin) {
    problems.push(...manifestProblems(plugin, ".claude-plugin/plugin.json"));
    problems.push(...declaredPathProblems(plugin, root, ".claude-plugin/plugin.json"));
    if (pkg && plugin.version !== pkg.version) {
      problems.push(`version drift: package.json ${pkg.version}, plugin.json ${plugin.version}`);
    }
    if (pkg && plugin.name !== pkg.name) {
      problems.push(`name drift: package.json ${pkg.name}, plugin.json ${plugin.name}`);
    }
  }

  // The root plugin's hook is what re-delivers the map, so its absence is a
  // problem here rather than something a session discovers by the map quietly
  // going stale. A plugin that declares no hooks at all is a plugin that asked
  // for none.
  problems.push(...hookProblems(root, root, readJson, { required: true }));

  if (marketplace) {
    for (const key of ["name", "owner"]) {
      if (!marketplace[key]) problems.push(`marketplace.json has no "${key}"`);
    }
    const seen = new Set();
    const listed = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
    if (!Array.isArray(marketplace.plugins)) problems.push('marketplace.json "plugins" is not an array');
    if (Array.isArray(marketplace.plugins) && listed.length === 0) problems.push("marketplace.json lists no plugins");
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
      const alreadyRead = pluginRoot === resolve(root);
      if (!alreadyRead && existsSync(ownDir) && outsideByLink(root, ownDir)) {
        problems.push(`${label(root, ownDir)} is a link out of the repository`);
        continue;
      }
      const ownEntries = !alreadyRead && existsSync(ownDir) ? readDir(ownDir, label(root, ownDir)) : [];
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
      const own = pluginRoot === resolve(root) ? plugin : readJson(manifest);
      if (!own) continue;
      if (own.name && own.name !== entry.name) {
        problems.push(`marketplace.json entry ${entry.name} points at a plugin named "${own.name}"`);
      }
      if (pluginRoot === resolve(root)) continue;

      problems.push(...manifestProblems(own, label(root, manifest)));
      problems.push(...declaredPathProblems(own, pluginRoot, label(root, manifest)));
      problems.push(...hookProblems(root, pluginRoot, readJson, { required: false }));
    }
  }

  return problems;
}

/**
 * Every path a manifest names by hand, which is where the typo lands: it has to
 * exist, and it has to stay inside the plugin that names it.
 */
function declaredPathProblems(manifest, pluginRoot, at) {
  const problems = [];
  for (const key of ["commands", "agents", "skills", "hooks", "mcpServers"]) {
    const value = manifest[key];
    const listed = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
    for (const [i, declared] of listed.entries()) {
      if (typeof declared !== "string" || !declared.startsWith(".")) continue;
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
function hookProblems(root, pluginRoot, readJson, { required }) {
  const problems = [];
  const path = join(pluginRoot, "hooks", "hooks.json");
  const at = label(root, path);

  if (!existsSync(path)) {
    if (required) problems.push(`${at} is missing, so the map is never re-delivered`);
    return problems;
  }

  const declared = readJson(path);
  if (!declared) return problems;
  if (!isObject(declared.hooks)) {
    problems.push(`${at} has no top-level hooks block, so it loads nothing`);
    return problems;
  }

  for (const [event, groups] of Object.entries(declared.hooks)) {
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
      // Every file the command names, not only the first, and the path ends
      // where its quote does or where the whitespace does: a command may carry
      // arguments, a quoted path may carry a space, and a command may name the
      // plugin root on its own, which names no file to check.
      for (const [, , quoted, bare] of command.matchAll(/(["'])\$\{CLAUDE_PLUGIN_ROOT\}\/([^"']+)\1|\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'\s]+)/g)) {
        const named = quoted ?? bare;
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

// Compared through the real path on both sides: `import.meta.url` is always
// resolved and `process.argv[1]` is whatever the caller spelled, so a checkout
// reached through a symlink ran nothing and exited 0, which for CI's only
// manifest gate is a pass nobody asked for.
if (process.argv[1] && realOf(fileURLToPath(import.meta.url)) === realOf(resolve(process.argv[1]))) main();

function realOf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
