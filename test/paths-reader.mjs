import ignore from "ignore";

/**
 * Claude Code's reading of a `paths` list: every entry split on the commas
 * outside a brace, the first brace expanded until none is left, a trailing
 * `/**` stripped, and a list of nothing but `**` dropped. The pieces then go to
 * the `ignore` package built with its defaults, as Claude Code builds it.
 */
export function claudeCodeReaches(patterns, rel) {
  const split = (entry) => {
    const out = [];
    let cur = "";
    let depth = 0;
    for (const ch of entry) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (ch === "," && depth === 0) {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const expand = (p) => {
    const m = p.match(/^([^{]*)\{([^}]+)\}(.*)$/);
    return m ? m[2].split(",").flatMap((x) => expand(m[1] + x.trim() + m[3])) : [p];
  };
  const pieces = patterns.flatMap(split).flatMap(expand).map((p) => (p.endsWith("/**") ? p.slice(0, -3) : p)).filter(Boolean);
  if (pieces.every((p) => p === "**")) return false;
  return ignore().add(pieces).ignores(rel);
}
