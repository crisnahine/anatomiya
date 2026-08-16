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
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, sep, posix, win32 } from "node:path";

import { resolveInside } from "./rules.mjs";

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
export function insideRoot(root, abs) {
  const rel = relative(resolve(root), resolve(abs));
  if (rel === "") return true;
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  // Lexical containment costs nothing and is not containment: resolve()
  // normalises ".." and follows no link, and the checker's own reads do.
  return resolveInside(root, rel.split(/[\\/]/).join("/")) !== null;
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
 * A path in the form TypeScript compares against.
 *
 * It normalises every path it holds to forward slashes and then asserts the two
 * forms are equal, so handing it the backslashes `join` produces on Windows
 * crashes it with a `Debug Failure` the moment a config has an error to report.
 * Replacing the character rather than splitting on `sep`, because `sep` is
 * already "/" on POSIX and a test written there would prove nothing.
 */
/**
 * Whether a `relative()` answer means "contained".
 *
 * Two Windows drives have no relative path between them, so `relative` answers
 * an absolute one, which does not start with ".." and read as inside. That is
 * the guard `insideRoot` already carries and the compiler host's own check did
 * not, on the one platform B18 singles out for special handling.
 */
/**
 * A path resolved through every link and alias the OS keeps.
 *
 * `realpathSync.native` where it exists, because on Windows it is the one that
 * expands an 8.3 short name: `tmpdir()` there answers `C:\Users\RUNNER~1\...`
 * while the compiler resolves the same file to the long form, and comparing
 * those two refused every file it discovered for itself.
 */
export function realpathOf(p) {
  try {
    return (realpathSync.native ?? realpathSync)(p);
  } catch {
    // A path that does not exist cannot be resolved and is not a read.
    return resolve(p);
  }
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
  const fold = (x) => (platform === "win32" ? x.toLowerCase() : x);
  return within(relative(fold(resolve(base)), fold(resolve(p))));
}

export const within = (rel) =>
  rel === "" || (!rel.startsWith("..") && !posix.isAbsolute(rel) && !win32.isAbsolute(rel));

export const toTsPath = (p) => String(p).replace(/\\/g, "/");

export function readConfig(ts, root) {
  const configPath = join(root, CONFIG_NAME);
  const degraded = (reason, options = ts.getDefaultCompilerOptions()) => ({
    options: { ...options, ...FORCED_OPTIONS },
    fileNames: [],
    status: "degraded",
    reason,
    configPath: null,
  });

  if (!existsSync(configPath)) return degraded("no-tsconfig");

  const tsPath = toTsPath(configPath);

  const text = ts.sys.readFile(configPath);
  if (typeof text !== "string") return degraded("unparseable");

  // Not JSON.parse: a tsconfig legally carries comments and trailing commas,
  // and rejecting one for that reads as a broken config to every caller.
  const parsed = ts.parseConfigFileTextToJson(tsPath, text);
  if (parsed.error) return degraded("unparseable");

  const escaped = [];
  const host = confinedParseHost(ts, root, escaped);
  const result = ts.parseJsonConfigFileContent(parsed.config, host, toTsPath(root), undefined, tsPath);

  const options = { ...result.options, ...FORCED_OPTIONS };
  if (escaped.length) return { ...degraded("extends-escaped", options), configPath };
  // B9 forces the root file list to the corpus, so what the config's own
  // include and files globs match is never read. TypeScript reports finding no
  // inputs as an error, and it fires on every well-formed config whose globs
  // this tool is about to override, which is all of them.
  const errors = (result.errors ?? []).filter((e) => e.code !== 18002 && e.code !== 18003);
  if (errors.length) {
    return { ...degraded("config-errors", options), configPath };
  }

  return { options, fileNames: result.fileNames ?? [], status: "ok", reason: null, configPath };
}


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
  const allowed = (p) => {
    if (insideRoot(root, p) || contains(libDir, p)) return true;
    return contains(realRoot, realpathOf(p)) || contains(realLibDir, realpathOf(p));
  };

  return {
    ...base,
    fileExists: (p) => allowed(p) && base.fileExists(p),
    readFile: (p) => (allowed(p) ? base.readFile(p) : undefined),
    getSourceFile: (p, ...rest) => (allowed(p) ? base.getSourceFile(p, ...rest) : undefined),
    // Nothing this tier does may leave a file behind in a repository somebody
    // is working in. `noEmit` already says so; this is the second lock.
    writeFile: () => {},
    getDirectories: (p) => (allowed(p) ? base.getDirectories(p) : []),
    readDirectory: (p, ...rest) => (allowed(p) ? base.readDirectory(p, ...rest) : []),
    realpath: base.realpath,
    getCurrentDirectory: () => root,
  };
}
