/**
 * Agent definitions as Claude Code sees them, and the copies held to a level
 * that a spawn is routed to (A81).
 *
 * An Agent call takes no effort, so which definition a spawn names is the only
 * thing that decides its level. A plugin agent registers as `plugin:name` and
 * cannot replace a built-in or another plugin's agent, so the copies are
 * user-tier files this plugin writes while the hold is on and removes once it
 * is off.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, openSync, readSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { sameLevel } from "./effort.mjs";
import { frontmatter, keyLine, onceNamed, readFrontmatter } from "./frontmatter.mjs";
import { FILE_ID, holdStatePath, probingIn } from "./hold-config.mjs";
import { ancestors, filesIn, processRunning, pruneOlder, readJson, writeWhole } from "./hold-files.mjs";
import { configDirFor, projectSettingsFiles, readIfFile, realOf } from "./hook-io.mjs";

/** The built-in types before a capture has listed them. */
export const DEFAULT_BUILT_IN = ["general-purpose", "Explore", "Plan", "claude", "claude-code-guide", "statusline-setup"];

/** The file a copy was made from. A copy is a file carrying this key or the next. */
const SOURCE_KEY = "ultracode-anywhere-copy-of-file";

/** The type a copy was made of. */
export const COPY_OF_KEY = "ultracode-anywhere-copy-of";

/** The build a built-in's shadow was captured from. A shadow is a file carrying this key. */
export const SHADOW_KEY = "ultracode-anywhere-shadow-of";

/** Keys a plugin agent's loader ignores and a user agent's loader honours, which a copy of a plugin's agent leaves out. */
const UNSHARED_KEYS = ["permissionMode", "hooks", "mcpServers"];

/** Frontmatter a built-in carries that the Agent tool's listing does not show. */
const UNLISTED_FIELDS = { "claude-code-guide": ["permissionMode: dontAsk"], "statusline-setup": ["color: orange"] };

/** A built-in type is a file name here, so it may hold nothing a path could use. */
export const TYPE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** One segment of an agent's name. A copy's file is named after it, so it may hold no path. */
const NAME_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/** How long the record of what a session loaded is kept, which is how long a session may run unrestarted. */
const SESSION_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** How much of a transcript is read at a time, so a long one is read whole without being held whole. */
const TRANSCRIPT_CHUNK = 1024 * 1024;

/** Where the copies live: a folder of their own under the user's agents, which the build reads at any depth. */
export function copiesDir(env = process.env) {
  const config = configDirFor(env);
  return config ? join(config, "agents", "ultracode-anywhere-copies") : null;
}

/**
 * A copy's name: the type, a hash of the real path it was copied from, and the
 * level. Agent names share one space, so the hash keeps two sources from ever
 * claiming one name, and the level retires a copy once the level moves.
 */
export function copyNameFor(def, level) {
  const hash = createHash("sha1").update(realOf(def.file)).digest("hex").slice(0, 8);
  return `${def.agentType.replace(/:/g, "--")}--${hash}--${level}`;
}

/** The built-in types the last capture listed, or the default list before one has. */
export function builtInTypes(env = process.env) {
  const saved = readJson(holdStatePath(env, "builtin-types.json"), null);
  return Array.isArray(saved) && saved.length > 0 && saved.every((type) => typeof type === "string") ? saved : DEFAULT_BUILT_IN;
}

/**
 * The type a file under an agents directory registers as, or "" where the build
 * does not load it. `:` is reserved for plugin scopes, and inside a plugin a
 * nameless file takes its file name and its subfolders join the scoped name.
 */
function agentTypeOf(fields, file, pluginAgentsDir = null) {
  const name = String(fields.name ?? "");
  if (name.includes(":")) return "";
  const segments = pluginAgentsDir ? [...relative(pluginAgentsDir, dirname(file)).split(sep).filter(Boolean), name || basename(file, ".md")] : [name];
  return segments.every((segment) => NAME_SEGMENT.test(segment)) ? segments.join(":") : "";
}

/** Every definition the build would load from one agents directory, with the file each came from. */
function defsIn(dir, source, prefix = "") {
  return filesIn(dir, ".md").flatMap((file) => {
    const fm = readFrontmatter(file);
    if (!fm?.fields.description) return [];
    const type = agentTypeOf(fm.fields, file, source === "plugin" ? dir : null);
    return type ? [{ agentType: prefix + type, effort: onceNamed(fm, "effort"), source, file, dir, fm }] : [];
  });
}

/** Each plugin id with its installs, read as far as the index's shape allows. */
export function installedPlugins(env = process.env) {
  const config = configDirFor(env);
  const plugins = config ? readJson(join(config, "plugins", "installed_plugins.json"), {})?.plugins : null;
  if (!plugins || typeof plugins !== "object") return [];
  return Object.entries(plugins).map(([id, installs]) => [id, [].concat(installs ?? []).filter((install) => typeof install?.installPath === "string")]);
}

/**
 * Every plugin id a session in `root` names in `enabledPlugins`, reading the
 * settings sources it reads, each key taking the last file that names it.
 */
export function enabledPlugins(env = process.env, root = "", sources = ["user", "project", "local"]) {
  const config = configDirFor(env);
  const [project, ...local] = projectSettingsFiles(root, env);
  const files = [sources.includes("user") && config && join(config, "settings.json"), sources.includes("project") && project, ...(sources.includes("local") ? local : [])];
  const enabled = {};
  for (const path of files.filter(Boolean)) {
    const named = readJson(path, null)?.enabledPlugins;
    if (named && typeof named === "object") Object.assign(enabled, named);
  }
  return enabled;
}

/**
 * The installs of every plugin enabled for a session in `root`: the user's
 * settings, then the project's and its local file, each key taking the last
 * file that names it.
 */
export function enabledPluginInstalls(env = process.env, root = "") {
  const enabled = enabledPlugins(env, root);
  return installedPlugins(env)
    .filter(([id]) => enabled[id] === true)
    .flatMap(([id, installs]) => installs.map((install) => ({ plugin: id.split("@")[0], path: install.installPath })));
}

/** The user's own definitions, copies and shadows included. */
export function userDefs(env = process.env) {
  const config = configDirFor(env);
  return config ? defsIn(join(config, "agents"), "user") : [];
}

/** The definitions of every plugin enabled for a session in `root`. */
export function pluginDefs(env = process.env, root = "") {
  return enabledPluginInstalls(env, root).flatMap((install) => defsIn(join(install.path, "agents"), "plugin", `${install.plugin}:`));
}

/** The definitions in `root`'s `.claude/agents` and each one above it, never the user's own folder. */
export function projectDefs(env = process.env, root = "") {
  if (!root) return [];
  const config = configDirFor(env);
  const user = config ? resolve(config, "agents") : null;
  return ancestors(root, [".claude", "agents"], env)
    .filter((dir) => resolve(dir) !== user)
    .flatMap((dir) => defsIn(dir, "project"));
}

/** A definition as a session's record keeps it: what it is called, its level, and where it came from. */
function recordOf(def) {
  return { agentType: def.agentType, effort: def.effort ?? null, source: def.source, file: def.file ?? null, copiedFrom: def.fm?.fields[SOURCE_KEY] ?? null };
}

/** The definitions a session in `root` can reach, in the build's precedence: project, user, plugin, built-in. */
function agentTiers(env = process.env, root = "") {
  return [projectDefs(env, root), userDefs(env), pluginDefs(env, root)].map((tier) => tier.map(recordOf)).concat([builtInTypes(env).map((name) => recordOf({ agentType: name, source: "built-in" }))]);
}

/**
 * Where the record of what a session loaded is kept: under the process that
 * loaded it, since /clear gives the same process a new session id, or under the
 * session where the build names no process. A self-check probe keeps its record
 * inside its own check, which is removed when the check ends.
 */
function recordFile(env, session) {
  const named = FILE_ID.test(String(session ?? "")) ? session : null;
  if (probingIn(env)) return named ? join(dirname(env.ULTRACODE_ANYWHERE_HOLD_CHECK_LOG), "sessions", `${named}.json`) : null;
  const pid = pidOf(env);
  const key = pid ? `pid-${pid}` : named;
  return key ? holdStatePath(env, join("sessions", `${key}.json`)) : null;
}

/** The process id the build names for the session a hook runs in, or null. */
function pidOf(env) {
  const pid = String(env.CLAUDE_PID ?? "");
  return /^\d{1,10}$/.test(pid) ? pid : null;
}

/**
 * Records the definitions a process starting now has, or keeps the record it has
 * unless `replace` asks for a new one. The build reads its agent files at the
 * first prompt and again while it runs, so this is what a session falls back on
 * where its transcript lists no agent types (A81).
 */
export function recordLoaded(env = process.env, session, root = "", { replace = true } = {}) {
  const file = recordFile(env, session);
  if (!file) return false;
  const started = registeredAt(env);
  if (!replace && existsSync(file) && !fromAnother(readJson(file, null), started)) return true;
  writeWhole(file, JSON.stringify({ at: new Date().toISOString(), started, tiers: agentTiers(env, root) }));
  return true;
}

/**
 * The definitions a session can run, or null where it recorded none: the record
 * narrowed to the types its transcript lists, and beside it the copies this
 * plugin wrote under a listed name no other file on disk carries. Nothing says
 * when the build reads a rewritten file again, so nothing else is taken from
 * disk (A81).
 */
export function loadedTiers(env = process.env, session, { root = "", transcriptPath = null } = {}) {
  const record = readJson(recordFile(env, session), null);
  const tiers = fromAnother(record, registeredAt(env)) ? null : record?.tiers;
  if (!(Array.isArray(tiers) && tiers.length === 4 && tiers.every(Array.isArray))) return null;
  const listed = listedTypes(transcriptPath);
  if (!listed) return tiers;
  const merged = tiers.map((tier) => tier.filter((def) => listed.has(def.agentType)));
  const added = agentTiers(env, root).flat().filter((def) => listed.has(def.agentType));
  // A copy is written at the level, so whichever of its texts the build runs is held.
  merged[1].push(...added.filter((def) => added.every((other) => other.agentType !== def.agentType || other.copiedFrom !== null)));
  return merged;
}

/**
 * The agent types a transcript says the build lists for the Agent tool, or null
 * where it says none or cannot be read. Read in pieces, however long it is.
 */
function listedTypes(transcriptPath) {
  let fd;
  try {
    fd = openSync(transcriptPath, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch {
    return null;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    const chunk = Buffer.allocUnsafe(TRANSCRIPT_CHUNK);
    let listed = null;
    let rest = "";
    // A character cut at a chunk's edge garbles only string content, never a name or the JSON around it.
    for (let read; (read = readSync(fd, chunk, 0, chunk.length, null)) > 0; ) {
      const lines = (rest + chunk.toString("utf8", 0, read)).split("\n");
      rest = lines.pop();
      for (const line of lines) listed = foldListing(listed, line);
    }
    // A last line the build is still writing does not parse, and is passed over.
    return foldListing(listed, rest);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * One transcript line folded into the listed types the way the build folds its
 * own: what a delta adds and removes, over from nothing after a compaction.
 */
function foldListing(listed, line) {
  if (!line.includes('"agent_listing_delta"')) return listed;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return listed;
  }
  const delta = entry?.type === "attachment" && entry.isSidechain !== true ? entry.attachment : null;
  if (delta?.type !== "agent_listing_delta") return listed;
  const next = delta.isInitial === true || !listed ? new Set() : listed;
  if (Array.isArray(delta.addedLines) && Array.isArray(delta.addedTypes)) for (const type of delta.addedTypes) next.add(type);
  if (Array.isArray(delta.removedTypes)) for (const type of delta.removedTypes) next.delete(type);
  return next;
}

/**
 * When the build registered the process CLAUDE_PID names, or null. It writes
 * this once per process, so a later process given the same id writes another.
 */
function registeredAt(env) {
  const pid = pidOf(env);
  const config = configDirFor(env);
  if (!pid || !config) return null;
  const at = readJson(join(config, "sessions", `${pid}.json`), null)?.startedAt;
  return Number.isFinite(at) ? at : null;
}

/** Whether a record was written by another process than the one registered now, which only two readable registrations can show. */
function fromAnother(record, started) {
  return Number.isFinite(record?.started) && started !== null && record.started !== started;
}

/** Removes the records of sessions that have not started for a month, and of processes that have exited. */
export function pruneSessions(env = process.env, now = Date.now()) {
  const dir = holdStatePath(env, "sessions");
  if (!dir) return;
  pruneOlder(dir, SESSION_KEEP_MS, now);
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const pid = /^pid-(\d{1,10})\.json$/.exec(name)?.[1];
    if (pid && !processRunning(Number(pid))) rmSync(join(dir, name), { force: true });
  }
}

/**
 * The definition that answers `type` in a session in `root`, or null.
 *
 * The build's own precedence: a project's over the user's over a plugin's over
 * a built-in. A bare name finds the one plugin agent carrying it, and nothing
 * where two do. Which of two files of one name in one tier the build loads is
 * not said anywhere, so given a `level` the one off it answers.
 */
export function resolveAgent(type, { env = process.env, root = "", tiers = agentTiers(env, root), level = null } = {}) {
  for (const tier of tiers) {
    const hits = tier.filter((def) => def.agentType === type);
    if (hits.length > 0) return (level && hits.find((def) => !sameLevel(def.effort, level))) || hits[0];
  }
  const lower = String(type).toLowerCase();
  const types = new Set(
    tiers
      .flat()
      .filter((def) => def.agentType.toLowerCase() === lower || def.agentType.split(":").pop().toLowerCase() === lower)
      .map((def) => def.agentType),
  );
  return types.size === 1 ? resolveAgent([...types][0], { env, root, tiers, level }) : null;
}

/**
 * The copy of a definition held to `level`, only when it was copied from that
 * very file, among the user's definitions a session can run or, without those,
 * the ones on disk.
 */
export function copyOf(def, level, env = process.env, tiers = null) {
  if (!def?.file) return null;
  const name = copyNameFor(def, level);
  const users = tiers ? tiers[1] : userDefs(env).map(recordOf);
  return users.find((d) => d.agentType === name && sameLevel(d.effort, level) && realOf(d.copiedFrom ?? "") === realOf(def.file)) ?? null;
}

/** A frontmatter head without `key`, and without the indented or listed lines under it. */
export function dropKey(head, key) {
  const kept = [];
  let dropping = false;
  for (const line of head.split("\n")) {
    if (line.startsWith(`${key}:`) || keyLine(line)?.key === key) {
      dropping = true;
      continue;
    }
    if (dropping && /^(\s|-\s|-$)/.test(line)) continue;
    dropping = false;
    kept.push(line);
  }
  return kept.join("\n");
}

/** An old value can run over several lines, so the whole key goes before the new line is added. */
function setKey(head, key, value) {
  return `${dropKey(head, key)}\n${key}: ${value}`;
}

function copyText(def, level) {
  let head = def.fm.head.replace(/\r\n?/g, "\n");
  if (def.source !== "user") for (const key of UNSHARED_KEYS) head = dropKey(head, key);
  head = setKey(head, "name", copyNameFor(def, level));
  head = setKey(head, "effort", level);
  head = setKey(head, COPY_OF_KEY, def.agentType);
  // Quoted, so a path holding ` #` or `: ` reads back as the path.
  head = setKey(head, SOURCE_KEY, JSON.stringify(def.file));
  const text = `---\n${head}\n---\n${def.fm.body}`;
  return def.source === "plugin" ? text.replaceAll("${CLAUDE_PLUGIN_ROOT}", () => dirname(def.dir)) : text;
}

/** The files in the copies folder that this plugin wrote, with their frontmatter. */
function copyFiles(env) {
  const dir = copiesDir(env);
  let names = [];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const file = join(dir, name);
    const fields = frontmatter(readIfFile(file))?.fields ?? {};
    return fields[SOURCE_KEY] !== undefined || fields[COPY_OF_KEY] !== undefined ? [{ file, fields }] : [];
  });
}

/** Each path with the separator after it, as itself and as its real path, for a prefix test that cannot match a sibling. */
function prefixesOf(path) {
  return [...new Set([path, realOf(path)])].map((each) => `${each}${sep}`);
}

/**
 * Whether a copy has outlived what it was copied from: the source gone,
 * unreadable, no longer loaded, at the level now, renamed or moved, no longer
 * one of the user's own, or left in the cache of a plugin no longer installed or
 * no longer turned on in the user's settings.
 * Installs can nest and a folder can be a link, so any install that still gives
 * the copy its scoped type keeps it.
 */
function isStale(file, fields, { installs, userAgents, enabled }, level) {
  const source = fields[SOURCE_KEY];
  const src = source ? readFrontmatter(source) : null;
  if (!src?.fields.description || sameLevel(onceNamed(src, "effort"), level)) return true;
  const typeOf = String(fields[COPY_OF_KEY] ?? "");
  if (basename(file, ".md") !== copyNameFor({ agentType: typeOf, file: source }, level)) return true;
  const paths = [...new Set([source, realOf(source)])];
  if (!typeOf.includes(":")) return typeOf !== agentTypeOf(src.fields, source) || !paths.some((path) => userAgents.some((prefix) => path.startsWith(prefix)));
  const plugin = typeOf.slice(0, typeOf.indexOf(":"));
  const scoped = typeOf.slice(typeOf.indexOf(":") + 1);
  return !installs.some(
    ({ id, prefix }) => id.split("@")[0] === plugin && enabled[id] === true && paths.some((path) => path.startsWith(prefix) && scoped === agentTypeOf(src.fields, path, join(prefix, "agents"))),
  );
}

/**
 * Brings the copies in line with the definitions a copy is kept for: one for
 * each user agent, and each agent of a plugin the user's own settings turn on,
 * not already at `level`, and none for anything else.
 *
 * Every project loads the user's agents, so a project's own agents, and those
 * of a plugin only a project turns on, get none. Nothing here depends on the
 * project, so two projects never take turns rewriting one folder.
 */
export function syncCopies({ env = process.env, level }) {
  const done = { written: [], removed: [], total: 0 };
  const dir = copiesDir(env);
  if (!dir || !level) return done;

  const place = {
    installs: installedPlugins(env).flatMap(([id, list]) => list.flatMap((install) => prefixesOf(install.installPath).map((prefix) => ({ id, prefix })))),
    userAgents: prefixesOf(join(configDirFor(env), "agents")),
    enabled: enabledPlugins(env, "", ["user"]),
  };
  for (const { file, fields } of copyFiles(env)) {
    if (!isStale(file, fields, place, level)) continue;
    try {
      rmSync(file);
      done.removed.push(file);
    } catch {
      // Another session's sync removed it first.
    }
  }

  const candidates = [...pluginDefs(env), ...userDefs(env)].filter(
    (def) => !sameLevel(def.effort, level) && def.fm.fields[SOURCE_KEY] === undefined && def.fm.fields[SHADOW_KEY] === undefined,
  );
  done.total = candidates.length;
  for (const def of candidates) {
    const file = join(dir, `${copyNameFor(def, level)}.md`);
    if (dirname(resolve(file)) !== resolve(dir)) continue;
    const text = copyText(def, level);
    if (readIfFile(file) === text) continue;
    try {
      writeWhole(file, text);
      done.written.push(file);
    } catch {
      // A name no file can take, one past the filesystem's length say, leaves that agent refused and the rest copied.
    }
  }
  return done;
}

/** Removes every copy this plugin wrote, and nothing else in the folder. */
export function removeCopies(env = process.env) {
  const removed = [];
  for (const { file } of copyFiles(env)) {
    try {
      rmSync(file);
      removed.push(file);
    } catch {
      // Gone already.
    }
  }
  return removed;
}

function shadowFile(env, type) {
  return join(configDirFor(env), "agents", `${type}.md`);
}

/**
 * The built-in types whose shadow is missing, or was captured from another
 * build or for another level. A file of the user's own under the same name is
 * never stale: it replaces the built-in already.
 */
export function staleShadows(env = process.env, version, level) {
  if (!configDirFor(env)) return [];
  return builtInTypes(env).filter((type) => {
    if (!TYPE_NAME.test(type)) return false;
    if (!existsSync(shadowFile(env, type))) return true;
    const read = readFrontmatter(shadowFile(env, type));
    if (read?.fields[SHADOW_KEY] === undefined) return false;
    return read.fields[SHADOW_KEY] !== version || !sameLevel(read.fields.effort, level);
  });
}

/** Whether a file of the user's own stands where a built-in's shadow would go, which replaces the built-in already. */
export function userFileAt(env = process.env, type) {
  if (!TYPE_NAME.test(type) || !configDirFor(env)) return false;
  const path = shadowFile(env, type);
  return existsSync(path) && readFrontmatter(path)?.fields[SHADOW_KEY] === undefined;
}

/** The tool fields a shadow needs for what the listing said a built-in may use. */
function toolLines(tools) {
  const list = (text) => JSON.stringify(text.split(",").map((tool) => tool.trim()).filter(Boolean));
  if (tools === "*" || tools === "All tools") return [];
  if (tools.startsWith("All tools except ")) return [`disallowedTools: ${list(tools.slice("All tools except ".length))}`];
  return [`tools: ${list(tools)}`];
}

/**
 * Writes a built-in's shadow: the prompt captured off the build, the listing's
 * description and tools, and the level. Answers false, writing nothing, for a
 * type that is no file name or a file the user wrote.
 */
export function writeShadow(env = process.env, entry, prompt, version, level) {
  if (!TYPE_NAME.test(entry.type) || !configDirFor(env) || userFileAt(env, entry.type)) return false;
  const path = shadowFile(env, entry.type);
  const head = [
    `name: ${entry.type}`,
    `description: ${JSON.stringify(entry.description)}`,
    ...toolLines(entry.tools),
    ...(UNLISTED_FIELDS[entry.type] ?? []),
    `effort: ${level}`,
    `${SHADOW_KEY}: ${version}`,
  ];
  writeWhole(path, `---\n${head.join("\n")}\n---\n\n${prompt}\n`);
  return true;
}

/** Removes every shadow this plugin wrote, answering the types it removed. */
export function removeShadows(env = process.env) {
  const config = configDirFor(env);
  if (!config) return [];
  const dir = join(config, "agents");
  let names = [];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }
  const removed = [];
  for (const name of names) {
    if (readFrontmatter(join(dir, name))?.fields[SHADOW_KEY] === undefined) continue;
    try {
      rmSync(join(dir, name));
      removed.push(basename(name, ".md"));
    } catch {
      // Gone already.
    }
  }
  return removed;
}
