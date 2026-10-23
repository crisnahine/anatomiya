/**
 * The node this plugin runs on, held to the floor both manifests declare.
 *
 * Its own module, importing nothing and written in syntax any old node parses,
 * because the entry point asks it before anything else loads: a module the
 * rest of the plugin loads uses a regular expression Node 18 cannot parse, and
 * a failed parse runs no code at all, the floor check included.
 */
export const NODE_FLOOR = "22.0.0";

export const NODE_REMEDY = "install Node 22 or newer and put it first on PATH";

/** Why this node cannot run anything here, with the fix, or null where it can. */
export function unsupportedNode(version = process.versions.node) {
  const have = version.split(".").map((part) => parseInt(part, 10) || 0);
  const want = NODE_FLOOR.split(".").map(Number);
  for (let i = 0; i < want.length; i++) {
    if (have[i] !== want[i]) return have[i] < want[i] ? `node ${version} is older than the ${NODE_FLOOR} this runs on, ${NODE_REMEDY}` : null;
  }
  return null;
}
