/**
 * The process environment with the host's Claude Code and plugin settings
 * taken out.
 *
 * A hook reads `CLAUDE_*` for where the build and its configuration are, so a
 * machine that runs the plugin decided what a case was told. A case sets what
 * it needs after the spread, and the prefix rather than a list keeps a variable
 * a hook starts reading from leaking in unnoticed. A session also names its
 * build in `AI_AGENT`.
 */
export function hostEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith("CLAUDE") && name !== "AI_AGENT")
  );
}
