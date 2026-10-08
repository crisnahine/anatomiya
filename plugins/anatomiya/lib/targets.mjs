/**
 * The places a map can be written, and how each one spells a glob.
 *
 * The three tools read the same body and disagree on everything around it: the
 * directory, the extension, the frontmatter key and the glob grammar.
 *
 * A leaf that imports nothing, because the hook verbs read it and must not load
 * the scan. The caller hands in its own spelling of one glob, so `areas.mjs`
 * stays the one owner of how a pattern's two halves compose. The filename prefix
 * and the generator key are spelled here and nowhere else: `rules.mjs` exports
 * these two again and carries none of its own.
 */
// The sentences are the ones whose truth depends on the reader. Claude Code's
// say when a file reaches it, which is measured. The others say what each file
// is and nothing about delivery, which nobody measured there, and carry what
// Claude Code's hook says on its own.
const describe = (id, dir, ext, reader, said) =>
  Object.freeze({ id, dir, ext, reader, wrote: null, widens: null, ...said });

const WROTE =
  "Written by anatomiya, a scanner run on this repository; where this and the code disagree, the code is right and this map is stale.";

export const TARGETS = Object.freeze({
  claude: describe("claude", ".claude/rules", ".md", "Claude Code", {
    reads: "Read a file before editing it: these notes load when you read, not when you grep.",
    listed: "loaded when you read one of its files",
  }),
  cursor: describe("cursor", ".cursor/rules", ".mdc", "Cursor", {
    reads: "Each area has its own file under .cursor/rules whose `globs:` names that area's files: before editing a file, read the one that names it.",
    listed: "whose `globs:` names its files",
    wrote: WROTE,
  }),
  copilot: describe("copilot", ".github/instructions", ".instructions.md", "GitHub Copilot", {
    // In VS Code's agent mode nothing attaches for a file the agent opens: the model reads the match itself.
    reads:
      "Each area has its own file under .github/instructions whose `applyTo:` names that area's files: before editing a file, read the one that names it.",
    listed: "whose `applyTo:` names its files",
    wrote: WROTE,
    widens: "VS Code also matches this file's patterns under any parent directory, so they can match a file outside the area.",
  }),
});

export const TARGET_IDS = Object.freeze(Object.keys(TARGETS));

/** Whether this is Claude Code's target: the one every scan writes, in a directory this tool has always written, read by the tool whose `paths` the map was made for. */
export const isClaude = (target) => target.id === TARGETS.claude.id;

/** The key a generated file's frontmatter carries, which is how a file is known as this tool's. */
export const GENERATOR = "anatomiya";

/** What every filename a scan writes starts with. */
export const PREFIX = "anatomiya-";

const HEAD = ["---", `generator: ${GENERATOR}`];

/**
 * Refuse a table keyed by target that lacks one of the three or holds a key that is none.
 *
 * Called where each such table loads: a target one lacks is otherwise a
 * TypeError on the first area written for it, in the middle of a scan.
 */
export function assertPerTarget(name, table) {
  for (const id of TARGET_IDS) if (!Object.hasOwn(table, id)) throw new Error(`${name} has no entry for ${id}`);
  for (const id of Object.keys(table)) if (!TARGET_IDS.includes(id)) throw new Error(`${name} holds ${id}, which is no target`);
}

/** Refuse a list holding a name that is no target's id, naming the first and the ids there are. */
export function assertTargets(names) {
  const unknown = names.find((n) => !TARGET_IDS.includes(n));
  if (unknown !== undefined) throw new Error(`unknown target: ${unknown}; the targets are ${TARGET_IDS.join(", ")}`);
}

/** The target ids a `--targets` value names, in the table's order and Claude Code's with them. An empty list or an unknown name throws. */
export function parseTargets(text) {
  const names = String(text ?? "").split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (names.length === 0) throw new Error("--targets needs at least one name");
  assertTargets(names);
  return TARGET_IDS.filter((id) => isClaude(TARGETS[id]) || names.includes(id));
}

/** The filename a target's overview is written under. */
export const overviewName = (target) => `${PREFIX}overview${target.ext}`;

/** The filename one area's file is written under for a target. */
export const areaName = (target, areaId) => `${PREFIX}area-${areaId}${target.ext}`;

// A comma separates patterns in both tools and a brace left after expansion
// would hide one. The rest is what each reader changes on the way to its matcher.
// Claude Code is handed every pattern as the caller spells it.
const UNSPELLABLE = {
  claude: null,
  // No YAML here: Cursor cuts the line at its first colon and keeps the rest raw.
  // It ends the frontmatter at any `---`, trims each pattern, unwraps a value
  // that opens and closes on one quote, and turns a backslash into a slash.
  // Its matcher reads a leading `!` as every file but these and a leading `#` as a comment.
  cursor: /---|[,{}\\\r\n]|^[\s"'!#]|\s$/,
  copilot: /[,{}"\\\r\n]/,
};
// Cursor reads a `globs` value of exactly `true` or `false` as a boolean.
const MISREAD_ALONE = { claude: null, cursor: /^(true|false)$/, copilot: null };
// What anchors a pattern at the repository root for Claude Code, and whether a
// reader takes it. Run on the matchers cut out of Cursor 3.20.21 and VS Code
// 1.140.0: both read a leading slash as the file system's root, so `/*.go`
// matched no file of a repository. Without it Cursor matched `*.go` at the root
// alone, and VS Code at every depth, so Copilot is given no pattern for the root.
const ANCHOR = "/";
const READS_ANCHOR = { claude: true, cursor: false, copilot: false };
assertPerTarget("UNSPELLABLE", UNSPELLABLE);
assertPerTarget("MISREAD_ALONE", MISREAD_ALONE);
assertPerTarget("READS_ANCHOR", READS_ANCHOR);

/** Whether a target is handed every pattern as the area spells it, so its file's patterns match the area and nothing else. */
export const readsEveryPattern = (target) => UNSPELLABLE[target.id] === null;

const ANCHOR_IN_FRONT = new RegExp(`^${ANCHOR}`);
const EXT_BRACE = /\.\{([^{}]+)\}$/;

const expanded = (g) => {
  const brace = g.tail.match(EXT_BRACE);
  if (!brace) return [g];
  const stem = g.tail.slice(0, brace.index);
  return brace[1].split(",").map((ext) => ({ ...g, tail: `${stem}.${ext}` }));
};

const within = (dir, parent) => parent === "" || dir === parent || dir.startsWith(`${parent}/`);

/**
 * An area's globs as one target can read them, each spelled by the caller's `spell`.
 *
 * `dropped` is the negations the target cannot be told, so its file's patterns
 * match more than the area. `unspellable` is the opposite: patterns that could
 * not be written, so the file matches nothing there, and a negation only they
 * reach is in neither list. `widened` is what the target reads more loosely
 * than written: VS Code puts `**` and a slash in front of a pattern that starts
 * with neither, so `app/*.rb` also matches `vendor/x/app/a.rb`, and a pattern
 * anchored at the repository root also matches below it.
 */
export function spelledGlobs(target, globs, spell) {
  const out = { patterns: [], widened: [], dropped: [], unspellable: [] };
  const unspellable = UNSPELLABLE[target.id];
  if (unspellable === null) return { ...out, patterns: globs.map((g) => spell(g)) };
  // No directory starts with a slash, so one in front is the anchor and nothing
  // else, and no negation is spelled past this line.
  const text = READS_ANCHOR[target.id] ? spell : (g) => spell(g).replace(ANCHOR_IN_FRONT, "");
  // A reader that matches a pattern under every parent directory cannot be given one for the root
  // alone: its file would state the root's claims of every file below, so it gets no pattern there.
  const rootOnly = (g) => !READS_ANCHOR[target.id] && target.widens !== null && ANCHOR_IN_FRONT.test(spell(g));
  // Read off the emitted string: an encoder can fold a comma in that the name did not hold.
  const cannot = (p) => unspellable.test(p);
  const written = [];
  for (const g of globs.filter((g) => !g.negated)) {
    const each = expanded(g).map((e) => text(e));
    if (each.some(cannot) || rootOnly(g)) {
      out.unspellable.push(text(g));
      continue;
    }
    out.patterns.push(...each);
    written.push(g);
  }
  if (out.patterns.length === 1 && MISREAD_ALONE[target.id]?.test(out.patterns[0])) {
    out.unspellable.push(text(written.pop()));
    out.patterns = [];
  }
  // Only a pattern that recurses matches below its own directory.
  const reached = (g) => written.some(({ dir, tail }) => g.dir === dir || (tail.startsWith("**/") && within(g.dir, dir)));
  out.dropped = globs.filter((g) => g.negated && reached(g)).map((g) => text({ ...g, negated: false }));
  if (target.widens !== null) out.widened = out.patterns.filter((p) => !p.startsWith("**/"));
  return out;
}

const SCOPE = {
  claude: (patterns) => ["paths:", ...patterns.map((p) => `  - "${p}"`)],
  cursor: (patterns) => [...(patterns.length > 0 ? [`globs: ${patterns.join(",")}`] : []), "alwaysApply: false"],
  copilot: (patterns) => [`applyTo: "${patterns.join(",")}"`],
};
const EVERYWHERE = { claude: [], cursor: ["alwaysApply: true"], copilot: ['applyTo: "**"'] };
// Why a target cannot be handed an area file with no pattern, or null where it can.
const NEEDS_A_PATTERN = {
  // Measured for Claude Code: a `paths` key with nothing under it loads on every turn.
  claude: () => "an area file with no pattern would load on every turn",
  cursor: null,
  // An `applyTo` cannot match nothing, so the writer leaves this file out.
  copilot: (target) => `no pattern of this area can be written for ${target.reader}`,
};
assertPerTarget("SCOPE", SCOPE);
assertPerTarget("EVERYWHERE", EVERYWHERE);
assertPerTarget("NEEDS_A_PATTERN", NEEDS_A_PATTERN);

/** The lines from one `---` fence to the other, both included. */
export function frontmatter(target, { kind, patterns = [] }) {
  if (kind === "overview") return [...HEAD, ...EVERYWHERE[target.id], "---"];
  const refused = patterns.length === 0 ? NEEDS_A_PATTERN[target.id] : null;
  if (refused) throw new Error(refused(target));
  return [...HEAD, ...SCOPE[target.id](patterns), "---"];
}
