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
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFESTS = ["plugin.json", "marketplace.json"];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

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

  const readJson = (path) => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      problems.push(`${label(root, path)}: ${err.message}`);
      return null;
    }
  };

  if (!existsSync(dir)) problems.push(".claude-plugin/ is missing");

  const entries = existsSync(dir) ? readdirSync(dir) : [];
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
      if (typeof entry.source !== "string" || !entry.source.startsWith(".")) continue;

      const pluginRoot = resolve(root, entry.source);
      const inside = relative(root, pluginRoot);
      if (inside.startsWith("..")) {
        problems.push(`marketplace.json entry ${entry.name} points outside the repository: ${entry.source}`);
        continue;
      }
      if (!existsSync(pluginRoot)) {
        problems.push(`marketplace.json entry ${entry.name} points at a missing path ${entry.source}`);
        continue;
      }

      const manifest = join(pluginRoot, ".claude-plugin", "plugin.json");
      if (!existsSync(manifest)) {
        problems.push(`${label(root, manifest)} is missing`);
        continue;
      }
      const own = pluginRoot === resolve(root) ? plugin : readJson(manifest);
      if (!own) continue;
      if (own.name !== entry.name) {
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
      if (relative(pluginRoot, abs).startsWith("..")) {
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
  if (manifest.version && !/^\d+\.\d+\.\d+/.test(String(manifest.version))) {
    problems.push(`${at} version is not semver: ${manifest.version}`);
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
    const commands = groups
      .flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks : []))
      .map((h) => h?.command);
    for (const command of commands) {
      const target = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"']+)/.exec(String(command ?? ""));
      if (!target) {
        problems.push(`${at} ${event} runs ${command}, which names no file in this plugin`);
      } else if (relative(pluginRoot, resolve(pluginRoot, target[1])).startsWith("..")) {
        problems.push(`${at} ${event} runs ${target[1]}, which is outside that plugin`);
      } else if (!existsSync(join(pluginRoot, target[1]))) {
        problems.push(`${at} ${event} runs ${target[1]}, which that plugin does not ship`);
      }
    }
  }
  return problems;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const problems = validate(root);
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log(`manifests ok (${MANIFESTS.join(", ")}), hooks ok`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
