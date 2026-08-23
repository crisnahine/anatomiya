/**
 * Where each plugin lives, spelled once.
 *
 * The marketplace is the repository and each plugin is a directory under
 * `plugins/`, so a test that reaches into one is reaching across a seam and
 * ought to name it. Spelled by hand it was in file after file, and the move
 * that put them there had to find every one.
 *
 * `modules.test.mjs` holds that rule: nothing outside this file spells one.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Every path here is repository-relative as well, for a gate that reports one. */
export const REL = {
  anatomiya: "plugins/anatomiya",
  ultracode: "plugins/ultracode-anywhere",
};

/** The marketplace: the repository this file lives in. */
export const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Where the marketplace keeps the plugins it lists. */
const PLUGINS = join(ROOT, "plugins");

/** The scanner. */
export const ANATOMIYA = join(PLUGINS, "anatomiya");

/** The plugin that keeps standing orchestration on. */
export const ULTRACODE = join(PLUGINS, "ultracode-anywhere");

/** The binary a session runs, and the one every end-to-end case drives. */
export const BINARY = join(ANATOMIYA, "bin", "anatomiya.mjs");

/**
 * Where the dependencies actually sit.
 *
 * The marketplace declares the plugins as workspaces, so one install serves
 * them all and npm hoists it to the root. A fixture that copies a plugin's code
 * out to somewhere else has to bring the packages from wherever they landed,
 * which is not beside the plugin.
 */
export function installed() {
  for (const at of [join(ANATOMIYA, "node_modules"), join(ROOT, "node_modules")]) {
    if (existsSync(at)) return at;
  }
  throw new Error("no node_modules: run npm ci at the marketplace root");
}
