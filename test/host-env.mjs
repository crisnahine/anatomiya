/**
 * The process environment with the host's Claude Code and plugin settings
 * taken out.
 *
 * A hook reads `CLAUDE_*` for where the build and its configuration are and
 * `ULTRACODE_ANYWHERE*` for its own switches, so a machine that runs the
 * plugin decided what a case was told: one exported level made the session
 * hook speak where a case expected silence. A case sets what it needs after
 * the spread, and the prefixes rather than a list keep a variable the plugin
 * starts reading from leaking in unnoticed.
 */
export function hostEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith("CLAUDE_") && !name.startsWith("ULTRACODE_ANYWHERE"))
  );
}
