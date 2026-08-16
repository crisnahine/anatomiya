import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A throwaway repository built from a map of relative paths to bodies.
 *
 * Shared because the config tests and the tier tests both need one, and two
 * copies of a fixture builder drift the moment one of them learns something.
 * The caller removes it; every test here already has a `finally`.
 */
export function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-ts-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}
