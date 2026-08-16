import { mkdtempSync, mkdirSync, rmSync, cpSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * An install of this plugin that has the parser and not the Flow stripper.
 *
 * Not a hypothetical shape: `flow-remove-types` arrived after the plugin
 * shipped, so every node_modules older than it is exactly this. Built as a real
 * directory rather than stubbed, because what is under test is module
 * resolution, and an in-process fake resolves the same either way.
 *
 * Returns the directory to run `bin/anatomiya.mjs` out of.
 */
export function installWithoutStripper(t) {
  const home = mkdtempSync(join(tmpdir(), "anatomiya-nostrip-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const d of ["lib", "bin"]) cpSync(join(root, d), join(home, d), { recursive: true });
  mkdirSync(join(home, "node_modules"), { recursive: true });
  // Everything the parser needs, and deliberately not the stripper. hermes is
  // the stripper's own dependency and goes with it.
  for (const dep of readdirSync(join(root, "node_modules"))) {
    if (dep === "flow-remove-types" || dep.startsWith("hermes")) continue;
    symlinkSync(join(root, "node_modules", dep), join(home, "node_modules", dep));
  }
  return home;
}

/** The file that forces the retry: Flow-only syntax the TypeScript grammar rejects. */
export const FLOW_SOURCE = [
  "// @flow",
  "type Opts = {| name: string |}",
  "export function greet(o: Opts): string { return o.name }",
].join("\n");
