/**
 * The packages a repository holds of its own, as an import names them: an npm
 * workspace's packages by the name each manifest gives, and Go modules by the
 * path each `go.mod` declares. Read off the manifests' text, which `scan.mjs`
 * hands over, so this is testable from literals.
 *
 * An import of one of these is the repository's own code however its path is
 * spelt, where any other bare name is somebody else's (H59, H58).
 */
import { posix } from "node:path";

import { claim, dirOf, escapeRe, withoutExtension } from "./paths.mjs";
import { parsed } from "./transcript.mjs";

/** The files that name a repository's own packages: npm's and its workspaces', Rush's and Go's. */
export const MANIFESTS = new Set(["package.json", "pnpm-workspace.yaml", "lerna.json", "rush.json", "go.mod"]);

// The fields a manifest names its own entry in, in the order a bundler reading the source would take them.
const ENTRY_FIELDS = ["source", "module", "main"];

const strings = (list) => (Array.isArray(list) ? list.filter((g) => typeof g === "string" && g !== "") : []);

// A JSON string, which a comment's marks or a comma inside belong to, and what is taken out around one.
const STRING = String.raw`("(?:[^"\\]|\\.)*")`;
const COMMENT = new RegExp(String.raw`${STRING}|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)`, "g");
const TRAILING_COMMA = new RegExp(String.raw`${STRING}|,(?=\s*[\]}])`, "g");

/** JSON with comments as JSON: `rush.json` is, and may also leave a comma before a closing bracket. */
const asJson = (text) => text.replace(COMMENT, (_, str) => str ?? "").replace(TRAILING_COMMA, (_, str) => str ?? "");

/** The globs a `pnpm-workspace.yaml` lists under `packages`, as a block list or a flow one. */
function pnpmGlobs(text) {
  const globs = [];
  let listing = false;
  for (const line of text.split(/\r?\n/)) {
    const flow = /^packages\s*:\s*\[(.*)\]/.exec(line);
    if (flow) globs.push(...flow[1].split(",").map((g) => g.trim().replace(/^["']|["']$/g, "")));
    else if (/^packages\s*:/.test(line)) listing = true;
    else if (listing && /^\s*-/.test(line)) globs.push(line.replace(/^\s*-\s*/, "").replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim());
    else if (listing && /^\S/.test(line) && !line.startsWith("#")) listing = false;
  }
  return globs;
}

/**
 * The directories a workspace says hold its packages, as globs: the root manifest's `workspaces`
 * (a list, or Yarn's `{ packages }`), `pnpm-workspace.yaml`'s `packages`, `lerna.json`'s, which
 * defaults to `packages/*`, and each `projectFolder` of `rush.json`. Null where the repository
 * declares no workspace.
 */
export function workspaceGlobs({ root = null, pnpm = null, lerna = null, rush = null }) {
  const globs = [];
  const manifest = root === null ? null : parsed(root);
  globs.push(...strings(Array.isArray(manifest?.workspaces) ? manifest.workspaces : manifest?.workspaces?.packages));
  if (pnpm !== null) globs.push(...pnpmGlobs(pnpm));
  if (lerna !== null) {
    const config = parsed(lerna);
    if (config) globs.push(...(Array.isArray(config.packages) ? strings(config.packages) : ["packages/*"]));
  }
  if (rush !== null) {
    const projects = parsed(asJson(rush))?.projects;
    if (Array.isArray(projects)) globs.push(...strings(projects.map((p) => p?.projectFolder)));
  }
  return globs.length ? [...new Set(globs.filter(Boolean))] : null;
}

/**
 * A workspace glob as a pattern over a directory: `*` is one segment's worth, and `**` any number of
 * segments, none among them. A leading `./` and a trailing `/` say nothing.
 */
function globPattern(glob) {
  const segments = glob.replace(/^(?:\.\/)+/, "").replace(/\/+$/, "").split("/");
  let pattern = "";
  for (const [i, seg] of segments.entries()) {
    const last = i === segments.length - 1;
    if (seg === "**") pattern += last ? (i === 0 ? ".*" : "(?:/.*)?") : i === 0 ? "(?:.*/)?" : "(?:/.*)?/";
    else pattern += (i === 0 || segments[i - 1] === "**" ? "" : "/") + escapeRe(seg).replaceAll("\\*", "[^/]*");
  }
  return new RegExp(`^${pattern}$`);
}

/** Whether a directory falls under a workspace's globs, the last that matches deciding: a `!` glob takes it back out. */
function inWorkspace(dir, globs) {
  let inside = false;
  for (const glob of globs) {
    const negated = glob.startsWith("!");
    if (globPattern(negated ? glob.slice(1) : glob).test(dir)) inside = !negated;
  }
  return inside;
}

/**
 * The packages this repository's own workspace declares, by the name each
 * manifest under its globs gives: `{ rel, text }` per `package.json` in, a map
 * from name to `{ dir, entries }` out, `entries` the paths without an extension
 * its `source`, `module`, `main` and `exports["."]` give. A manifest no glob
 * reaches is a fixture or an example, and a repository with no workspace has no
 * other package. A name two manifests give maps to null, since an import of it
 * could mean either, and a manifest that is no JSON names nothing.
 */
export function workspacePackages(manifests, globs) {
  const packages = new Map();
  if (globs === null) return packages;
  for (const { rel, text } of manifests) {
    if (!inWorkspace(dirOf(rel), globs)) continue;
    const manifest = parsed(text);
    if (typeof manifest?.name !== "string" || manifest.name === "") continue;
    const dot = typeof manifest.exports === "string" ? manifest.exports : manifest.exports?.["."];
    const given = [...ENTRY_FIELDS.map((f) => manifest[f]), typeof dot === "string" ? dot : (dot?.import ?? dot?.default ?? dot?.require)];
    const entries = [...new Set(given.filter((e) => typeof e === "string" && e !== "").map((e) => withoutExtension(posix.normalize(e))))];
    const dir = dirOf(rel);
    const held = packages.get(manifest.name);
    packages.set(manifest.name, held === undefined ? { dir, entries } : held !== null && held.dir === dir ? held : null);
  }
  return packages;
}

/**
 * The module path each `go.mod` declares, to the directory it sits in: `{ rel, text }` per file in.
 * A path two files declare, as examples and test data often reuse one, maps to null.
 */
export function goModules(manifests) {
  const modules = new Map();
  for (const { rel, text } of manifests) {
    const path = /^\s*module\s+"?([^\s"]+)"?/m.exec(text)?.[1];
    if (path) claim(modules, path, dirOf(rel));
  }
  return modules;
}

/**
 * The repository's own packages from every manifest it tracks, `{ rel, text }` each:
 * `{ packages, modules }`, its npm workspace's and its Go modules.
 */
export function ownPackages(manifests) {
  const named = (name) => manifests.filter((m) => posix.basename(m.rel) === name);
  const atRoot = (name) => manifests.find((m) => m.rel === name)?.text ?? null;
  const globs = workspaceGlobs({ root: atRoot("package.json"), pnpm: atRoot("pnpm-workspace.yaml"), lerna: atRoot("lerna.json"), rush: atRoot("rush.json") });
  return { packages: workspacePackages(named("package.json"), globs), modules: goModules(named("go.mod")) };
}
