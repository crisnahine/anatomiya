// lib/tsconfig.mjs
/**
 * The repository's own compiler options, read through a host that cannot leave
 * the repository.
 *
 * The v3 spec claimed the libraries read no repository configuration and its own
 * evidence section falsified it: the checker resolves types against the
 * repository's tsconfig or it resolves almost nothing. So it is read, and the
 * three ways that hurts are closed here rather than hoped about. `extends` is a
 * path a repository writes, `include` and `exclude` decide which files get
 * counted, and half a dozen options make the checker write to disk in a tree
 * somebody is working in.
 */
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, parse, resolve, relative, isAbsolute, posix, win32 } from "node:path";

import { realpathOf, resolveInside } from "./rules.mjs";

export const CONFIG_NAME = "tsconfig.json";

/**
 * Options this tool sets whatever the repository asked for.
 *
 * Nothing here is a preference. Each one either writes a file into a repository
 * the user is working in, or makes the checker reuse a build it did not make.
 */
export const FORCED_OPTIONS = {
  noEmit: true,
  emitDeclarationOnly: false,
  declaration: false,
  declarationMap: false,
  sourceMap: false,
  composite: false,
  incremental: false,
  tsBuildInfoFile: undefined,
  outDir: undefined,
  outFile: undefined,
  declarationDir: undefined,
};

/** Whether an absolute path resolves inside the repository, links followed. */
export function insideRoot(root, abs, { realpath } = {}) {
  const rel = relative(resolve(root), resolve(abs));
  if (rel === "") return true;
  if (climbs(rel) || isAbsolute(rel)) return false;
  // Lexical containment costs nothing and is not containment: resolve()
  // normalises ".." and follows no link, and the checker's own reads do.
  return resolveInside(root, rel.split(/[\\/]/).join("/"), { realpath }) !== null;
}

/**
 * A parse host that reads only inside the repository and lists no directory.
 *
 * `readDirectory` answering nothing is what forces the root file list to the
 * corpus: `include` and `exclude` then select no file, and the program is
 * built from the rootNames the scan passes in. `readFile` is where `extends`
 * arrives, so one containment rule covers the whole chain.
 */
export function confinedParseHost(ts, root, escaped) {
  return {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readDirectory: () => [],
    fileExists: (p) => insideRoot(root, p) && ts.sys.fileExists(p),
    readFile: (p) => {
      if (!insideRoot(root, p)) {
        escaped.push(p);
        return undefined;
      }
      return ts.sys.readFile(p);
    },
  };
}

/**
 * Whether `p` sits inside `base`, on this platform's terms.
 *
 * Case-folded on Windows only: its filesystem is case-insensitive, so the same
 * file reached through two spellings is one file there and two here. Folding on
 * POSIX would make `/repo/Secrets` and `/repo/secrets` the same path, and they
 * are not.
 */
export function contains(base, p, platform = process.platform) {
  // The path grammar comes from the same argument as the folding, or a test
  // naming a platform still resolves through the host's rules and measures
  // neither.
  const on = platform === "win32" ? win32 : posix;
  const fold = (x) => (platform === "win32" ? x.toLowerCase() : x);
  return within(on.relative(fold(on.resolve(base)), fold(on.resolve(p))));
}

/**
 * Whether a `relative()` answer means "contained".
 *
 * Two Windows drives have no relative path between them, so `relative` answers
 * an absolute one, which does not start with ".." and read as inside. That is
 * the guard `insideRoot` already carries and the compiler host's own check did
 * not, on the one platform B18 singles out for special handling.
 */
export const within = (rel) =>
  rel === "" || (!climbs(rel) && !posix.isAbsolute(rel) && !win32.isAbsolute(rel));

/**
 * Whether a `relative()` answer starts by stepping above its base.
 *
 * `..` as a whole first segment, not as a prefix: `startsWith("..")` read a
 * directory named `..base` as outside the root, so an `extends` into it was
 * refused as escaped and the whole tier degraded over a file it could read.
 * Either separator, because `relative` answers in the platform's own.
 */
function climbs(rel) {
  return rel === ".." || rel.startsWith("../") || rel.startsWith("..\\");
}

/**
 * A path in the form TypeScript compares against.
 *
 * It normalises every path it holds to forward slashes and then asserts the two
 * forms are equal, so handing it the backslashes `join` produces on Windows
 * crashes it with a `Debug Failure` the moment a config has an error to report.
 * Replacing the character rather than splitting on `sep`, because `sep` is
 * already "/" on POSIX and a test written there would prove nothing.
 */
export const toTsPath = (p) => String(p).replace(/\\/g, "/");

export function readConfig(ts, root) {
  const configPath = join(root, CONFIG_NAME);

  // No file is not a broken one: the checker runs on its own defaults, which is
  // what `tsc` does in a directory without one, and whether that resolved is
  // the rate's to say. Degraded here, a monorepo keeping its options in
  // `tsconfig.base.json` and one config per package read as counts only at
  // 100% resolution. The reason rides along, so a rate under the floor names
  // the likeliest cause rather than the generic one.
  if (!existsSync(configPath)) {
    return {
      options: { ...ts.getDefaultCompilerOptions(), ...FORCED_OPTIONS },
      fileNames: [],
      status: "ok",
      reason: "no-tsconfig",
      configPath: null,
    };
  }

  // The root config is a path the repository writes like any `extends`, and it
  // was read with the host's own readFile before anything confined it: a
  // committed `tsconfig.json` linking out of the tree was opened and its
  // options handed to the checker. Links followed, as every other read here.
  if (!insideRoot(root, configPath)) return degraded(ts, "config-escaped");

  const { config, references } = readOne(ts, root, configPath);
  if (references.length === 0) return config;

  // A root that builds nothing itself and names the projects that do, which
  // is Vite's react-ts scaffold: `files: []` beside tsconfig.app.json, where
  // the `@/` alias, `jsx` and `lib` live. Read alone it handed the checker the
  // compiler's defaults, every import through the alias resolved to any, and
  // the scaffold measured 77%, under the floor, on every scan. The checker
  // builds one program (B7), so it takes one project's options, and the one
  // the root names first is the application in the scaffold that writes this
  // shape. A reference is a path the repository writes, the same as an
  // `extends`, so one leaving the tree is refused rather than opened.
  const first = ts.resolveProjectReferencePath(references[0]);
  if (!insideRoot(root, first)) return degraded(ts, "reference-escaped");
  return readOne(ts, root, first).config;
}

/** What a config that could not be read as written hands the checker. */
function degraded(ts, reason, options = ts.getDefaultCompilerOptions()) {
  return { options: { ...options, ...FORCED_OPTIONS }, fileNames: [], status: "degraded", reason, configPath: null };
}

/**
 * One config file through the confined host, and the projects it hands its
 * options to: none, unless it builds nothing of its own and names some.
 */
function readOne(ts, root, configPath) {
  const alone = (config) => ({ config, references: [] });
  const tsPath = toTsPath(configPath);

  const text = ts.sys.readFile(configPath);
  if (typeof text !== "string") return alone(degraded(ts, "unparseable"));

  // Not JSON.parse: a tsconfig legally carries comments and trailing commas,
  // and rejecting one for that reads as a broken config to every caller.
  const parsed = ts.parseConfigFileTextToJson(tsPath, text);
  if (parsed.error) return alone(degraded(ts, "unparseable"));

  const escaped = [];
  const host = confinedParseHost(ts, root, escaped);
  // Its own directory is the base its relative paths are written against,
  // which for a referenced project is not the root.
  const result = ts.parseJsonConfigFileContent(parsed.config, host, toTsPath(dirname(configPath)), undefined, tsPath);

  const options = { ...result.options, ...FORCED_OPTIONS };
  if (escaped.length) return alone({ ...degraded(ts, "extends-escaped", options), configPath });
  // B9 forces the root file list to the corpus, so what the config's own
  // include and files globs match is never read. TypeScript reports finding no
  // inputs as an error, and it fires on every well-formed config whose globs
  // this tool is about to override, which is all of them.
  const errors = (result.errors ?? []).filter((e) => e.code !== 18002 && e.code !== 18003);
  if (errors.length) {
    return alone({ ...degraded(ts, "config-errors", options), configPath });
  }

  const config = { options, fileNames: result.fileNames ?? [], status: "ok", reason: null, configPath };
  // Off what the file says rather than off `fileNames`, which the confined
  // host keeps empty for every config it reads.
  const raw = parsed.config ?? {};
  const buildsNothing = isEmptyList(raw.files) && (raw.include === undefined || isEmptyList(raw.include));
  return { config, references: buildsNothing ? (result.projectReferences ?? []) : [] };
}

const isEmptyList = (value) => Array.isArray(value) && value.length === 0;


/**
 * A compiler host whose reads reach two places and no others: the repository,
 * and the lib files that ship beside the plugin's own typescript.
 *
 * The checker needs the second or nothing resolves, and it must come from here
 * rather than from the repository, which can ship its own typescript. The rest
 * of the filesystem is not this tool's to read while it is pointed at somebody
 * else's repository.
 */
export function confinedCompilerHost(ts, root, options) {
  const base = ts.createCompilerHost(options, true);
  const libDir = resolve(dirname(ts.sys.getExecutingFilePath()));
  // Both sides resolved through the link, because the checker asks through it.
  // A repository under a symlinked path, which is every macOS temp directory
  // and plenty of real checkouts, is handed to us as `/var/...` and asked for
  // as `/private/var/...`: comparing those lexically refuses every file the
  // compiler discovered for itself, so every import resolved to `any`, every
  // chain read as one type, and the tier reported 0% resolution everywhere.
  const realRoot = realpathOf(root);
  const realLibDir = realpathOf(libDir);
  const realpath = walkingRealpath();
  const permitted = (asked) => {
    let p;
    try {
      p = opened(asked, realpath);
    } catch {
      return false;
    }
    if (insideRoot(root, p, { realpath }) || contains(libDir, p)) return true;
    return contains(realRoot, realpathOf(p)) || contains(realLibDir, realpathOf(p));
  };
  // Module resolution asks about thousands of paths, each a walk of realpath
  // calls up from the root, and the uncached walk was 45% of building the program.
  const allowed = remembered(permitted);
  const directories = remembered((p) => (allowed(p) ? base.getDirectories(p) : []));

  // Module resolution probes the same candidates from every importing file,
  // measured at 107,928 stats on 24,737 paths in one build.
  return {
    ...base,
    fileExists: remembered((p) => allowed(p) && base.fileExists(p)),
    directoryExists: base.directoryExists && remembered(base.directoryExists),
    readFile: (p) => (allowed(p) ? base.readFile(p) : undefined),
    getSourceFile: (p, ...rest) => (allowed(p) ? base.getSourceFile(p, ...rest) : undefined),
    // Nothing this tier does may leave a file behind in a repository somebody
    // is working in. `noEmit` already says so; this is the second lock.
    writeFile: () => {},
    getDirectories: (p) => directories(p).slice(),
    readDirectory: (p, ...rest) => (allowed(p) ? base.readDirectory(p, ...rest) : []),
    realpath: base.realpath && remembered(base.realpath),
    getCurrentDirectory: () => root,
  };
}

/**
 * `realpathSync` for one build, each directory resolved once.
 *
 * Each `realpathSync` lstats every directory above the path again, and the
 * containment walk asks it of every directory it enters: one lstat per path
 * per build, off the parent's answer, unless the path is itself a link.
 */
export function walkingRealpath() {
  const realpath = remembered((asked) => {
    // `..` as text first, the way `realpathSync` takes it.
    const p = resolve(asked);
    const up = dirname(p);
    if (up === p) return realpathSync(p);
    const at = join(realpath(up), basename(p));
    return lstatSync(at).isSymbolicLink() ? realpathSync(p) : at;
  });
  return realpath;
}

/**
 * The path the OS reaches for `p` as written.
 *
 * The base host opens the raw string, and the OS takes each `..` from where
 * the links before it lead: `src/up/../x` with `up -> ..` is a sibling of the
 * root, while the string reads as `src/x`. A path with no `..` is its own answer.
 */
function opened(p, realpath) {
  const { root } = parse(p);
  const segments = p.slice(root.length).split(/[\\/]/);
  if (!segments.includes("..")) return p;
  let at = root;
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    at = segment === ".." ? dirname(realpath(at)) : join(at, segment);
  }
  return at;
}

/** `fn` answering each argument once, a throw included, for a build that sees a fixed tree. */
function remembered(fn) {
  const seen = new Map();
  return (p) => {
    let r = seen.get(p);
    if (r === undefined) {
      try {
        r = { value: fn(p) };
      } catch (error) {
        r = { error };
      }
      seen.set(p, r);
    }
    if ("error" in r) throw r.error;
    return r.value;
  };
}
