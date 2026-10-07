/**
 * The places a map can be written, and how each one spells a glob.
 *
 * The three tools read the same body and disagree on everything around it: the
 * directory, the extension, the frontmatter key and the glob grammar. One
 * record per tool, so a fourth is one more record and not a fourth branch in
 * every writer.
 *
 * A leaf over `areas.mjs`, which stays the one owner of how a pattern's two
 * halves compose. The writers and the renderer both read this, so the stems
 * and the generator key are spelled here and `test/targets.test.mjs` holds
 * them equal to the ones `rules.mjs` carries.
 */
import { globText } from "./areas.mjs";

const target = (id, dir, ext, reader) => Object.freeze({ id, dir, ext, always: id === "claude", reader });

export const TARGETS = Object.freeze({
  claude: target("claude", ".claude/rules", ".md", "Claude Code"),
  cursor: target("cursor", ".cursor/rules", ".mdc", "Cursor"),
  copilot: target("copilot", ".github/instructions", ".instructions.md", "GitHub Copilot"),
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
const EXT_BRACE = /\.\{([^{}]+)\}$/;

const expanded = (g) => {
  const brace = g.tail.match(EXT_BRACE);
  if (!brace) return [g];
  const stem = g.tail.slice(0, brace.index);
  return brace[1].split(",").map((ext) => ({ ...g, tail: `${stem}.${ext}` }));
};

/**
 * An area's globs as one target can read them.
 *
 * `dropped` is what the target cannot be told, in the brace form the Claude
 * file shows, and `widened` is what it reads more loosely than written: VS Code
 * puts `**` and a slash in front of a pattern that starts with neither, so
 * `app/*.rb` also matches `vendor/x/app/a.rb`.
 */
export function spelledGlobs(target, globs, encodeDir) {
  if (target.id === "claude") return { patterns: globs.map((g) => globText(g, encodeDir)), widened: [], dropped: [] };
  const patterns = [];
  const dropped = [];
  for (const g of globs) {
    const each = expanded({ ...g, negated: false });
    if (g.negated || each.some((e) => UNSPELLABLE.test(globText(e)))) dropped.push(globText({ ...g, negated: false }));
    else patterns.push(...each.map((e) => globText(e, encodeDir)));
  }
  const widened = target.id === "copilot" ? patterns.filter((p) => !p.startsWith("**/")) : [];
  return { patterns, widened, dropped };
}

const SCOPE = {
  claude: (patterns) => ["paths:", ...patterns.map((p) => `  - "${p}"`)],
  cursor: (patterns) => [`globs: ${patterns.join(",")}`, "alwaysApply: false"],
  copilot: (patterns) => [`applyTo: "${patterns.join(",")}"`],
};
const EVERYWHERE = { claude: [], cursor: ["alwaysApply: true"], copilot: ['applyTo: "**"'] };

/** The lines from one `---` fence to the other, both included. */
export function frontmatter(target, { kind, patterns = [] }) {
  if (kind === "overview") return [...HEAD, ...EVERYWHERE[target.id], "---"];
  // Measured for Claude Code: a scope key with nothing under it loads on every turn.
  if (patterns.length === 0) throw new Error("an area file with no pattern would load on every turn");
  return [...HEAD, ...SCOPE[target.id](patterns), "---"];
}
