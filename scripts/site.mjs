#!/usr/bin/env node
/**
 * The website: the files under `site/`, filled in from this repository and
 * written to the one directory GitHub Pages serves (G24).
 *
 * Nothing the page says that the repository already holds is typed twice. Its
 * examples are fenced blocks of the README and the usage guide, its results
 * chart is the README's own tables, its counts are read off the registry, the
 * build contract and the code index, and its find demo runs the plugin's own
 * `find.mjs`, copied byte for byte, over the index a scan of this checkout wrote.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { fenceAfter } from "./check-docs.mjs";
import { cellsOf, indexRows } from "./decisions.mjs";
import { die, invokedAs, readArgv } from "./entry.mjs";
import { ANATOMIYA, BINARY, ROOT } from "./plugins.mjs";
import { reachableFrom } from "./shipped.mjs";
import { usableIndex } from "../plugins/anatomiya/lib/index-home.mjs";
import { manifestVersion } from "../plugins/anatomiya/lib/version.mjs";
import { REGISTRY } from "../plugins/anatomiya/lib/registry.mjs";

const SITE = join(ROOT, "site");
const LIB = join(ANATOMIYA, "lib");
// Left in a build so a later one knows the directory is its own to replace; Pages leaves dot files out.
const MARK = ".anatomiya-site";
// Every measured task ran 20 sessions per arm, which is what each README cell counts out of.
const SESSIONS_PER_ARM = 20;

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The fenced code blocks under the first heading spelled `heading`, up to the
 * next heading of its level or above, each with the info string it opened with.
 * Fences are read as the docs gate reads them, so a `#` line inside a block is
 * the block's, not a heading.
 */
export function fencedBlocks(text, heading) {
  const blocks = [];
  let level = null;
  let fence = null;
  let open = null;
  for (const line of text.split(/\r?\n/)) {
    const after = fenceAfter(line, fence);
    if (fence === null && after === null) {
      const head = line.match(/^(#{1,6}) (.*)$/);
      if (head && level !== null && head[1].length <= level) break;
      if (head && level === null && head[2] === heading) level = head[1].length;
    } else if (level !== null) {
      if (fence === null) open = { lang: line.trim().slice(after.length).trim(), lines: [] };
      else if (after === null) blocks.push({ lang: open.lang, body: open.lines.join("\n") });
      else open.lines.push(line);
    }
    fence = after;
  }
  return blocks;
}

/**
 * The reuse tasks the README measured, from its tables between "## The whole
 * test, ties included" and the table of habits seen next to the change, which
 * measured something else: each task with both models' counts, and whether the
 * README marks the difference significant by setting it in bold.
 */
export function resultRows(readme) {
  const start = readme.indexOf("\n## The whole test, ties included");
  const end = start === -1 ? -1 : readme.indexOf("\nWhere the habit could be seen", start);
  if (end === -1) throw new Error("README.md has no reuse tables where this reads them");
  let models = null;
  const rows = [];
  for (const line of readme.slice(start, end).split(/\r?\n/)) {
    const cells = cellsOf(line).map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const counts = cells.slice(-2).map((cell) => cell.match(/^(\*\*)?(\d+) \/ (\d+)\1$/));
    if (counts.some((m) => m === null)) {
      models ??= cells.slice(-2).map((cell) => cell.replace(/ with \/ without$/, ""));
      continue;
    }
    const [task, checked] = cells.slice(-4, -2);
    rows.push({
      language: cells.length === 5 ? cells[0] : null,
      task,
      checked,
      counts: counts.map((m) => ({ with: Number(m[2]), without: Number(m[3]), significant: m[1] === "**" })),
    });
  }
  if (rows.length === 0 || models === null) throw new Error("README.md's reuse tables held no row this can read");
  return { models, rows };
}

/**
 * The modules a browser loads to run `entry`, a path under the plugin's root,
 * walked the way the shipped-set check walks the plugin, and the specifiers
 * among their static imports that no file of the plugin answers, which the
 * page's import map has to.
 */
export function moduleClosure(entry) {
  const files = reachableFrom(ANATOMIYA, [entry]).files.map((rel) => join(ANATOMIYA, rel));
  const outside = new Set();
  for (const file of files) {
    for (const [, spec] of readFileSync(file, "utf8").matchAll(/^import\s[^;]*?from\s*["']([^"'.][^"']*)["']/gm)) outside.add(spec);
  }
  return { files, outside: [...outside].sort() };
}

/** One fenced block as markup for the inside of a `<code>`: escaped, and a diff's lines marked added or removed. */
function blockMarkup({ lang, body }) {
  if (lang !== "diff") return escapeHtml(body);
  return body
    .split("\n")
    .map((line) => (/^[+-]/.test(line) ? `<span class="${line[0] === "+" ? "add" : "del"}">${escapeHtml(line)}</span>` : escapeHtml(line)))
    .join("\n");
}

/**
 * The page with every placeholder filled, in one pass over the template so a
 * block that happens to hold braces is left as it is: `{{name}}` from `values`,
 * which is markup already, and `{{block FILE "HEADING" N}}` as the Nth fenced
 * block under that heading in that file. A placeholder nothing fills is refused
 * rather than shipped as braces.
 */
export function fillPage(template, values, read) {
  return template.replace(/\{\{block (\S+) "([^"]+)" (\d+)\}\}|\{\{(\w+)\}\}/g, (_, file, heading, n, name) => {
    if (name === undefined) {
      const block = fencedBlocks(read(file), heading)[Number(n)];
      if (block === undefined) throw new Error(`${file} has no fenced block ${n} under the heading "${heading}"`);
      return blockMarkup(block);
    }
    if (!Object.hasOwn(values, name)) throw new Error(`the page asks for {{${name}}}, which the build does not fill`);
    return values[name];
  });
}

/** The results chart: one row per task, two bars per model, and the counts in words for a screen reader. */
function resultsTable({ models, rows }) {
  const bar = (arm, n) => `<span class="bar ${arm}" style="--v:${n}"><b>${n}</b></span>`;
  const head = `<thead><tr><th scope="col">Task</th>${models.map((m) => `<th scope="col">Claude ${escapeHtml(m)}</th>`).join("")}</tr></thead>`;
  const body = rows.map((row) => {
    const helper = escapeHtml(row.checked.replace(/^calls the existing /, "")).replace(/`([^`]+)`/g, "<code>$1</code>");
    const cells = row.counts.map((c, i) => {
      const words = `${c.with} of ${SESSIONS_PER_ARM} with anatomiya, ${c.without} of ${SESSIONS_PER_ARM} without${c.significant ? ", p below 0.05" : ""}`;
      return `<td data-model="Claude ${escapeHtml(models[i])}"${c.significant ? ' class="sig"' : ""}><span class="bars" aria-hidden="true">${bar("with", c.with)}${bar("without", c.without)}</span><span class="sr">${words}</span></td>`;
    });
    const language = row.language === null ? "" : `${escapeHtml(row.language)} · `;
    return `<tr><th scope="row"><span class="task">${escapeHtml(row.task)}</span><span class="helper">${language}${helper}</span></th>${cells.join("")}</tr>`;
  });
  return `<table class="results">${head}<tbody>\n${body.join("\n")}\n</tbody></table>`;
}

/**
 * Write the site to `out`: the page filled in, the other files of `site/` as
 * they are, the brand assets it names, the find demo's modules byte for byte,
 * and `index`, the code index those modules rank. `commit` is what the page
 * says it was built from. `out` must be new or a directory this wrote before,
 * since it is emptied first.
 */
export function buildSite({ out, index, commit }) {
  if (existsSync(out)) {
    if (!existsSync(join(out, MARK))) throw new Error(`${out} is there and was not written by this script, so it is left alone: give a new directory`);
    rmSync(out, { recursive: true, force: true });
  }
  const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
  const results = resultRows(read("README.md"));
  const cells = results.rows.flatMap((row) => row.counts);
  const sum = (arm) => String(cells.reduce((total, c) => total + c[arm], 0));
  const values = {
    version: escapeHtml(manifestVersion(ANATOMIYA) ?? "unknown"),
    commit: escapeHtml(commit),
    commitShort: escapeHtml(commit.slice(0, 7)),
    definitions: index.count.toLocaleString("en-US"),
    dimensions: String(REGISTRY.length),
    decisions: String(indexRows(read("DECISIONS.md")).length),
    reuseTasks: String(results.rows.length),
    reuseRepositories: String(new Set(results.rows.map((row) => row.task.split(":")[0])).size),
    reuseSessions: String(cells.length * SESSIONS_PER_ARM),
    reuseWith: sum("with"),
    reuseWithout: sum("without"),
    reusePairs: String(cells.length),
    reuseSignificant: String(cells.filter((c) => c.significant).length),
    results: resultsTable(results),
  };
  const page = fillPage(read("site/index.html"), values, read);

  const closure = moduleClosure("lib/find.mjs");
  const strayed = closure.files.filter((file) => dirname(file) !== LIB);
  if (strayed.length > 0) throw new Error(`the find demo reaches modules outside the plugin's lib, which the page cannot load: ${strayed.join(", ")}`);

  mkdirSync(join(out, "lib"), { recursive: true });
  mkdirSync(join(out, "data"));
  writeFileSync(join(out, MARK), "");
  for (const name of readdirSync(SITE)) {
    if (name !== "index.html") copyFileSync(join(SITE, name), join(out, name));
  }
  writeFileSync(join(out, "index.html"), page);
  copyFileSync(join(ROOT, "docs", "assets", "icon.svg"), join(out, "icon.svg"));
  copyFileSync(join(ROOT, "docs", "assets", "social-preview.png"), join(out, "social-preview.png"));
  for (const file of closure.files) copyFileSync(file, join(out, "lib", basename(file)));
  writeFileSync(join(out, "data", "index.json"), JSON.stringify(index));
  return { modules: closure.files.map((file) => basename(file)), outside: closure.outside };
}

if (invokedAs(import.meta.url)) {
  const args = readArgv(process.argv.slice(2), {}, { positionals: true });
  if (args.error !== undefined || args.positionals.length !== 1) die(`${args.error ?? "one output directory is needed"}\nusage: node scripts/site.mjs <out>`);
  // The scan writes the code index the find demo ranks, of the commit the page names.
  const scan = spawnSync(process.execPath, [BINARY, "scan", ROOT], { stdio: "inherit" });
  if (scan.status !== 0) die("the scan of this repository failed, so there is no code index to build the find demo from", 1);
  const index = usableIndex(ROOT)?.index ?? null;
  if (index === null) die("the scan wrote no code index this can read", 1);
  const commit = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const out = resolve(args.positionals[0]);
  try {
    const built = buildSite({ out, index, commit });
    console.log(`wrote the site to ${out}: ${index.count} definitions at ${commit.slice(0, 7)}, find demo modules ${built.modules.join(", ")}`);
  } catch (err) {
    die(err.message, 1);
  }
}
