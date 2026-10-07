/**
 * The places a map can be written, and how each one spells a glob.
 *
 * The three tools read the same body and disagree on everything around it: the
 * directory, the extension, the frontmatter key and the glob grammar.
 *
 * A leaf that imports nothing, because the hook verbs read it and must not load
 * the scan. The caller hands in its own spelling of one glob, so `areas.mjs`
 * stays the one owner of how a pattern's two halves compose. The stems and the
 * generator key are spelled here, and `test/targets.test.mjs` holds them equal
 * to the ones `rules.mjs` carries.
 */
// `reads` and `listed` are the two sentences that say when a file reaches the
// reader, which is the one thing about the body the three tools do not share.
const describe = (id, dir, ext, reader, reads, listed) =>
  Object.freeze({ id, dir, ext, always: id === "claude", reader, reads, listed });

export const TARGETS = Object.freeze({
  claude: describe(
    "claude", ".claude/rules", ".md", "Claude Code",
    "Read a file before editing it: these notes load when you read, not when you grep.",
    "loaded when you read one of its files"
  ),
  cursor: describe(
    "cursor", ".cursor/rules", ".mdc", "Cursor",
    "Open a file before editing it: an area's notes attach when one of its files is in context.",
    "attached when one of its files is in context"
  ),
  copilot: describe(
    "copilot", ".github/instructions", ".instructions.md", "GitHub Copilot",
    "Open a file before editing it: an area's notes apply to the files its pattern names.",
    "applied to the files its pattern names"
  ),
});

export const TARGET_IDS = Object.freeze(Object.keys(TARGETS));

const STEM = "anatomiya-";
const HEAD = ["---", "generator: anatomiya"];

export function parseTargets(text) {
  const names = String(text ?? "").split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (names.length === 0) throw new Error("--targets needs at least one name");
  const unknown = names.find((n) => !TARGET_IDS.includes(n));
  if (unknown !== undefined) throw new Error(`unknown target: ${unknown}; the targets are ${TARGET_IDS.join(", ")}`);
  return TARGET_IDS.filter((id) => TARGETS[id].always || names.includes(id));
}

export const overviewName = (target) => `${STEM}overview${target.ext}`;
export const areaName = (target, areaId) => `${STEM}area-${areaId}${target.ext}`;

// A comma separates patterns in both tools, a brace left after expansion is one
// neither documents, and the rest would end the frontmatter line or its quotes.
const UNSPELLABLE = /[,{}"\\\r\n]/;
// Cursor's value is unquoted, so YAML reads these as a comment or a mapping.
const UNSPELLABLE_BARE = / #|: |:$/;
const EXT_BRACE = /\.\{([^{}]+)\}$/;

const expanded = (g) => {
  const brace = g.tail.match(EXT_BRACE);
  if (!brace) return [g];
  const stem = g.tail.slice(0, brace.index);
  return brace[1].split(",").map((ext) => ({ ...g, tail: `${stem}.${ext}` }));
};

/**
 * An area's globs as one target can read them, each spelled by the caller's `text`.
 *
 * `dropped` is the negations the target cannot be told, so its file attaches
 * for more than the area. `unspellable` is the opposite: patterns that could
 * not be written, so the file does not attach there. `widened` is what the
 * target reads more loosely than written: VS Code puts `**` and a slash in
 * front of a pattern that starts with neither, so `app/*.rb` also matches
 * `vendor/x/app/a.rb`.
 */
export function spelledGlobs(target, globs, text) {
  const out = { patterns: [], widened: [], dropped: [], unspellable: [] };
  if (target.id === "claude") return { ...out, patterns: globs.map((g) => text(g)) };
  // Read off the emitted string: an encoder can fold a comma in that the name did not hold.
  const cannot = (p) => UNSPELLABLE.test(p) || (target.id === "cursor" && UNSPELLABLE_BARE.test(p));
  for (const g of globs) {
    if (g.negated) {
      out.dropped.push(text({ ...g, negated: false }));
      continue;
    }
    const each = expanded(g).map((e) => text(e));
    if (each.some(cannot)) out.unspellable.push(text(g));
    else out.patterns.push(...each);
  }
  if (target.id === "copilot") out.widened = out.patterns.filter((p) => !p.startsWith("**/"));
  return out;
}

const SCOPE = {
  claude: (patterns) => ["paths:", ...patterns.map((p) => `  - "${p}"`)],
  cursor: (patterns) => [...(patterns.length > 0 ? [`globs: ${patterns.join(",")}`] : []), "alwaysApply: false"],
  copilot: (patterns) => [`applyTo: "${patterns.join(",")}"`],
};
const EVERYWHERE = { claude: [], cursor: ["alwaysApply: true"], copilot: ['applyTo: "**"'] };

/** The lines from one `---` fence to the other, both included. */
export function frontmatter(target, { kind, patterns = [] }) {
  if (kind === "overview") return [...HEAD, ...EVERYWHERE[target.id], "---"];
  if (patterns.length === 0) {
    // Measured for Claude Code: a `paths` key with nothing under it loads on every turn.
    if (target.id === "claude") throw new Error("an area file with no pattern would load on every turn");
    // An `applyTo` cannot match nothing, so the writer leaves this file out.
    if (target.id === "copilot") throw new Error(`no pattern of this area can be written for ${target.reader}`);
  }
  return [...HEAD, ...SCOPE[target.id](patterns), "---"];
}
