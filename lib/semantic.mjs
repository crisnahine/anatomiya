// lib/semantic.mjs
/**
 * The second tier: `typescript@5`'s checker, opt-in and never the default.
 *
 * Measured 26x slower than the syntactic tier and whole-program, so narrowing
 * its file set does not buy the time back: driving the corpus down drove
 * unresolved types from 3.1% to 36.2%. Major 5 is pinned because 7 is the Go
 * port and publishes no JS API at all.
 */

export const SEMANTIC_MIN_MAJOR = 5;

/**
 * The checker, or null.
 *
 * Imported by specifier from this module, so ESM resolves it from the plugin's
 * own node_modules and never from the repository being scanned. A repository
 * can ship its own `typescript`, and importing that one would run
 * repository-controlled code inside this process.
 */
export async function loadTypeScript({ specifier = "typescript" } = {}) {
  try {
    const mod = await import(specifier);
    const ts = mod.default ?? mod;
    if (!ts || typeof ts.createProgram !== "function") return null;
    const version = String(ts.version ?? "");
    if (Number(version.split(".")[0]) !== SEMANTIC_MIN_MAJOR) return null;
    return { ts, version };
  } catch {
    return null;
  }
}

export function notInstalledMessage() {
  return [
    "--deep needs typescript, which is an optional dependency and is not installed",
    "run `npm install --omit=dev` in the plugin directory, or scan again without --deep",
  ].join("\n");
}
