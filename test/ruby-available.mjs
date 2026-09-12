import { execFileSync } from "node:child_process";

/**
 * Whether this machine can run the Ruby tier at all.
 *
 * A test that needs `prism` is skipped rather than failed where it is missing:
 * an absent interpreter is a missing tool, not broken code, and a CI runner
 * image bump should not turn every unrelated change red. Asked once, because
 * spawning Ruby per test file costs more than the check is worth.
 */
const RUBY_AVAILABLE = (() => {
  try {
    execFileSync("ruby", ["--disable-gems", "-rprism", "-e", "print Prism::VERSION"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
})();

/** Spread into a test's options: `test("...", needsRuby, () => {})`. */
export const needsRuby = RUBY_AVAILABLE
  ? {}
  : { skip: "ruby -rprism is unavailable on this machine" };
