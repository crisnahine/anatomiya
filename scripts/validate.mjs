#!/usr/bin/env node
/**
 * Manifest check. The plugin loader reads .claude-plugin/ before anything else
 * runs, so a manifest that does not parse fails at install time with no test to
 * catch it, and a stray file in that directory is loader-visible surface.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, ".claude-plugin");
const MANIFESTS = ["plugin.json", "marketplace.json"];

const problems = [];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    problems.push(`${path}: ${err.message}`);
    return null;
  }
}

if (!existsSync(dir)) {
  problems.push(".claude-plugin/ is missing");
}

const entries = existsSync(dir) ? readdirSync(dir) : [];
for (const name of entries) {
  if (!MANIFESTS.includes(name)) {
    problems.push(`.claude-plugin/${name} is not a manifest; manifests only in that directory`);
  }
}

const pkg = readJson(join(root, "package.json"));
const plugin = entries.includes("plugin.json") ? readJson(join(dir, "plugin.json")) : null;
const marketplace = entries.includes("marketplace.json")
  ? readJson(join(dir, "marketplace.json"))
  : null;

for (const m of MANIFESTS) {
  if (!entries.includes(m)) problems.push(`.claude-plugin/${m} is missing`);
}

if (plugin) {
  if (!plugin.name) problems.push("plugin.json has no name");
  if (!plugin.version) problems.push("plugin.json has no version");
  if (pkg && plugin.version !== pkg.version) {
    problems.push(`version drift: package.json ${pkg.version}, plugin.json ${plugin.version}`);
  }
  if (pkg && plugin.name !== pkg.name) {
    problems.push(`name drift: package.json ${pkg.name}, plugin.json ${plugin.name}`);
  }
}

if (marketplace) {
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  if (plugins.length === 0) problems.push("marketplace.json lists no plugins");
  for (const entry of plugins) {
    if (!entry.name) problems.push("marketplace.json has a plugin entry with no name");
    if (!entry.source) {
      problems.push(`marketplace.json entry ${entry.name} has no source`);
    } else if (entry.source.startsWith(".") && !existsSync(resolve(root, entry.source))) {
      problems.push(`marketplace.json entry ${entry.name} points at a missing path ${entry.source}`);
    }
  }
}

// The loader reads this before anything runs too, and a hook it will not load
// fails silently: the map simply stops being re-delivered and nothing says so.
// The opposite failure already shipped, a hook Claude Code refuses by name on
// every prompt, so both directions are checked here rather than trusted.
const hooksPath = join(root, "hooks", "hooks.json");
if (!existsSync(hooksPath)) {
  problems.push("hooks/hooks.json is missing, so the map is never re-delivered");
} else {
  const declared = readJson(hooksPath);
  if (declared && !isObject(declared.hooks)) {
    problems.push("hooks/hooks.json has no top-level hooks block, so it loads nothing");
  } else if (declared) {
    for (const [event, groups] of Object.entries(declared.hooks)) {
      if (!Array.isArray(groups)) {
        problems.push(`hooks/hooks.json event ${event} is not a list`);
        continue;
      }
      for (const command of groups.flatMap((g) => (Array.isArray(g.hooks) ? g.hooks : [])).map((h) => h.command)) {
        const target = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"']+)/.exec(String(command ?? ""));
        if (!target) problems.push(`hooks/hooks.json ${event} runs ${command}, which names no file in this plugin`);
        else if (!existsSync(join(root, target[1]))) {
          problems.push(`hooks/hooks.json ${event} runs ${target[1]}, which this plugin does not ship`);
        }
      }
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}

console.log(`manifests ok (${MANIFESTS.join(", ")}), hooks ok`);
