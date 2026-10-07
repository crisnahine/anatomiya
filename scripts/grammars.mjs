#!/usr/bin/env node
/**
 * The grammars the plugin ships, held to the npm packages they were copied from.
 *
 * A grammar package is 4 to 66 MB of native prebuilds and C source around one
 * `.wasm`, so the plugin carries the `.wasm` alone and the packages stay dev
 * dependencies of the marketplace. The manifest beside the copies records what
 * each one is, and `--check` refuses a copy that is not its package's file.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { invokedAs } from "./entry.mjs";
import { REL, ROOT } from "./plugins.mjs";
import { manifestVersion } from "../plugins/anatomiya/lib/version.mjs";

/** Each language id against its package and the grammar file inside it. */
export const GRAMMARS = {
  python: { package: "tree-sitter-python", source: "tree-sitter-python.wasm" },
  // The package also holds `php_only`, which reads a file with no open tag as code.
  php: { package: "tree-sitter-php", source: "tree-sitter-php.wasm" },
  go: { package: "tree-sitter-go", source: "tree-sitter-go.wasm" },
  java: { package: "tree-sitter-java", source: "tree-sitter-java.wasm" },
  csharp: { package: "tree-sitter-c-sharp", source: "tree-sitter-c_sharp.wasm" },
  rust: { package: "tree-sitter-rust", source: "tree-sitter-rust.wasm" },
  kotlin: { package: "@tree-sitter-grammars/tree-sitter-kotlin", source: "tree-sitter-kotlin.wasm" },
};

const MANIFEST = "grammars.json";

const vendoredIn = (root) => join(root, REL.anatomiya, "grammars");
const installedIn = (root, { package: name, source }) => join(root, "node_modules", name, source);

/** The hash of a file, or null where there is none to read. */
function sha256Of(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

/** The version the root lockfile pins a package to, or null. */
function lockedIn(root) {
  const packages = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")).packages ?? {};
  return (name) => packages[`node_modules/${name}`]?.version ?? null;
}

/** Copy each grammar out of its installed package and write the manifest. */
export async function vendor(root) {
  const { Language, Parser } = await import("web-tree-sitter");
  await Parser.init();
  const dir = vendoredIn(root);
  const locked = lockedIn(root);
  mkdirSync(dir, { recursive: true });
  const entries = [];
  for (const [id, grammar] of Object.entries(GRAMMARS)) {
    const file = `${id}.wasm`;
    copyFileSync(installedIn(root, grammar), join(dir, file));
    // The ABI is the wasm's own answer: a package's source can be newer than the wasm beside it.
    const { abiVersion } = await Language.load(readFileSync(join(dir, file)));
    const version = locked(grammar.package);
    const sha256 = sha256Of(join(dir, file));
    entries.push({ id, package: grammar.package, version, source: grammar.source, file, sha256, abi: abiVersion });
  }
  writeFileSync(join(dir, MANIFEST), `${JSON.stringify(entries, null, 2)}\n`);
  return entries;
}

/** Everything wrong with the vendored set under a marketplace root, as sentences. */
export function check(root) {
  const dir = vendoredIn(root);
  const at = `${REL.anatomiya}/grammars`;
  let entries;
  let locked;
  try {
    entries = JSON.parse(readFileSync(join(dir, MANIFEST), "utf8"));
    if (!Array.isArray(entries)) throw new Error("not a list");
  } catch (err) {
    return [`${at}/${MANIFEST} could not be read: ${err.message}`];
  }
  try {
    locked = lockedIn(root);
  } catch (err) {
    return [`package-lock.json could not be read: ${err.message}`];
  }

  const problems = [];
  const listed = new Set([MANIFEST]);
  for (const entry of entries) {
    const grammar = typeof entry?.id === "string" && Object.hasOwn(GRAMMARS, entry.id) ? GRAMMARS[entry.id] : null;
    if (grammar === null) {
      problems.push(`${at}/${MANIFEST} lists ${entry?.id}, which is not a grammar this vendors`);
      continue;
    }
    const file = `${entry.id}.wasm`;
    if (listed.has(file)) {
      problems.push(`${at}/${MANIFEST} lists ${entry.id} twice`);
      continue;
    }
    listed.add(file);
    if (entry.file !== file || entry.package !== grammar.package || entry.source !== grammar.source) {
      problems.push(`${at}/${MANIFEST} does not name ${entry.id} as ${grammar.package}/${grammar.source} vendored as ${file}`);
      continue;
    }
    const version = locked(grammar.package);
    if (entry.version !== version) problems.push(`${grammar.package} is ${entry.version} in the manifest and ${version} in package-lock.json`);
    const vendored = sha256Of(join(dir, file));
    if (vendored === null) problems.push(`${at}/${file} is in the manifest and not on disk`);
    else if (vendored !== entry.sha256) problems.push(`${at}/${file} does not hash to its manifest entry`);
    const installed = sha256Of(installedIn(root, grammar));
    const named = `node_modules/${grammar.package}/${grammar.source}`;
    if (installed === null) problems.push(`${named} is not installed, so nothing holds ${file} to it; run npm ci`);
    else if (installed !== entry.sha256) problems.push(`${named} does not hash to the manifest entry for ${entry.id}`);
    // A lockfile moved with no install after it leaves the old package's file here under the new version.
    const has = installed === null ? version : manifestVersion(join(root, "node_modules", grammar.package), grammar.package);
    if (has !== version) problems.push(`installed ${grammar.package} is ${has ?? "unreadable"}, the lockfile says ${version}: run npm ci`);
  }
  for (const id of Object.keys(GRAMMARS)) {
    if (!listed.has(`${id}.wasm`)) problems.push(`${id} has no manifest entry in ${at}/${MANIFEST}`);
  }
  // A link hashes as its target here and ships as a link, which an installed plugin cannot follow.
  for (const found of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!found.isFile()) problems.push(`${at}/${found.name} is not a regular file`);
    else if (!listed.has(found.name)) problems.push(`${at}/${found.name} has no manifest entry`);
  }
  return problems;
}

async function main(argv) {
  const prefix = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "";
  const typo = argv.find((arg) => arg.startsWith("-") && arg !== "--check");
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  if (typo !== undefined || positional.length > 1) {
    console.error(`${prefix}${typo !== undefined ? `unknown option: ${typo}` : `only one marketplace root may be given, and ${positional[1]} was the second`}\nusage: node scripts/grammars.mjs [--check] [marketplaceRoot]`);
    process.exit(2);
  }
  const root = positional[0] ? resolve(positional[0]) : ROOT;
  if (!argv.includes("--check")) {
    const entries = await vendor(root);
    console.log(`vendored ${entries.length} grammars into ${vendoredIn(root)}`);
    return;
  }
  const problems = check(root);
  if (problems.length) {
    for (const problem of problems) console.error(`${prefix}${problem}`);
    console.error("if a grammar package was moved on purpose, run npm run grammars");
    process.exit(1);
  }
  console.log(`the ${Object.keys(GRAMMARS).length} vendored grammars are the ones their packages hold`);
}

if (invokedAs(import.meta.url)) await main(process.argv.slice(2));
