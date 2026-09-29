import { execFileSync } from "node:child_process";
import { readiness } from "../plugins/anatomiya/lib/readiness.mjs";

/**
 * Whether this machine can run the Ruby tier at all.
 *
 * A test that needs `prism` is skipped rather than failed where it is missing:
 * an absent interpreter is a missing tool, not broken code, and a CI runner
 * image bump should not turn every unrelated change red. Asked once, because
 * spawning Ruby per test file costs more than the check is worth.
 */
const RUBY_AVAILABLE = await (async () => {
  // The plugin's own probe rather than a bare `ruby -rprism`: that answered
  // yes for prism 0.19, which the parser refuses, so every Ruby test ran and
  // failed on Ruby 3.3 instead of skipping. Ready here means ready to the tool.
  try {
    const [row] = await readiness({ engines: ["prism"], timeoutMs: 10_000 });
    return row.ok;
  } catch {
    return false;
  }
})();

/** Spread into a test's options: `test("...", needsRuby, () => {})`. */
export const needsRuby = RUBY_AVAILABLE
  ? {}
  : { skip: "no ruby with a prism this reads (run anatomiya doctor)" };

// An interpreter at all, whatever prism it holds: what a test of the gem
// listing needs, which asks RubyGems rather than prism.
const INTERPRETER = (() => {
  try {
    execFileSync("ruby", ["-e", "print 1"], { stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
})();

export const needsRubyInterpreter = INTERPRETER ? {} : { skip: "no ruby on PATH" };
