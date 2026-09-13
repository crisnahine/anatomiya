/**
 * The level a session asks its workflow stages to run at, and the list it has
 * to be one of (A47).
 *
 * Its own file because both hooks need it and neither may import the other: the
 * prompt hook puts the level in the reminder, and the session hook says so when
 * the setting could not be read. A hook that imported the other's entry point
 * would be one `invokedAs` change away from running it. The list comes along
 * rather than sitting in `upstream.mjs` with the other read-off-a-build facts,
 * since a level name is only ever read through the reader below it.
 *
 * Two switches read the same list. The stage switch reaches the reminder alone:
 * a spawn's effort comes from its agent definition, and the stages of the
 * workflows this plugin ships take theirs from the agent files under `agents/`,
 * so that switch is for the scripts the model writes itself. The hold switch is
 * the other kind: hooks hold every spawn to its level, whatever asked for one.
 */

/**
 * The effort levels the build accepts, lowest first.
 *
 * The order is the one thing here that is not just a set: it is what lets a
 * reader say whether one level sits above another. Read off a build like
 * everything else this plugin stands on, so a name that moved upstream would
 * cost a user their setting in silence. `test/effort.test.mjs` reads all five
 * out of whatever build is installed, and `VERIFYING.md` says what it cannot.
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];

/** How long a setting that named no level may be and still be quoted back. */
const ECHO_MOST = 24;

/**
 * A setting plain enough to quote back, since what a level is not may be
 * anything at all.
 *
 * A project's `settings.json` sets `env`, so this text can arrive with a cloned
 * repository, and it is on its way into a system-reminder the model reads as
 * instructions. A word, a number, a dot or a hyphen is a typo somebody wants
 * named; anything else is counted instead. No space: a level has none, and a
 * short sentence would otherwise be quoted whole.
 */
const QUOTABLE = new RegExp(`^[A-Za-z0-9._-]{1,${ECHO_MOST}}$`);

/**
 * How long a setting may be and still be read: five characters is a level, and
 * this is far past one.
 *
 * A bound rather than a cut, because a cut that then trims is a prefix match
 * wearing a bound: `medium` followed by a kilobyte of anything else read back
 * as `medium`, and the kilobyte went unmentioned. Refused whole, the way a
 * session id that is not a file name is refused rather than stripped.
 */
const READ_MOST = 256;

/**
 * The level this session asked its workflow stages to run at, or null where it
 * asked for none.
 *
 * The answer is one of the five and never the text that was read, so nothing a
 * variable holds reaches the reminder. Case and the spaces a shell leaves
 * behind are forgiven, since `medium` and `Medium ` are the same ask. Anything
 * else is null, and `askedFor` below is what keeps that from being silent.
 */
export function stageEffortIn(env = process.env) {
  return levelIn(env.ULTRACODE_ANYWHERE_STAGE_EFFORT);
}

/**
 * What a session should be told about a setting that named no level, and null
 * where there is nothing to tell it.
 *
 * A cadence nobody could read costs a refresher its place and is worth no
 * words. This one costs a session the whole saving it was turned on for, and
 * costs it silently: the fan-out runs at the session's own level and nothing in
 * the transcript says the switch did not take.
 */
export function askedFor(env = process.env) {
  return unreadable(env.ULTRACODE_ANYWHERE_STAGE_EFFORT, STAGE);
}

/**
 * The level every spawn is held to, or null where the hold is off (A81).
 *
 * A level and nothing else, the way the stage switch reads one, since a value
 * that names none turning the hold on at some guessed level would be a hold
 * nobody chose.
 */
export function heldLevelIn(env = process.env) {
  return levelIn(env.ULTRACODE_ANYWHERE_SPAWN_EFFORT);
}

/** What a session is owed about a hold switch that named no level, and null where it is owed nothing. */
export function heldAskedFor(env = process.env) {
  return unreadable(env.ULTRACODE_ANYWHERE_SPAWN_EFFORT, HOLD);
}

/**
 * Whether an effort a definition names is the held level.
 *
 * The build reads `med` as `medium`, so a definition spelling it that way
 * already runs at the level and needs no copy. Nothing looser than case: a
 * value with anything around the level is one the build refuses, and it runs
 * at its parent's level instead.
 */
export function sameLevel(value, level) {
  if (!level || typeof value !== "string") return false;
  const named = value.toLowerCase();
  return (named === "med" ? "medium" : named) === level;
}

/**
 * What a session is owed about a switch this plugin used to read and does not.
 *
 * Removing a switch in silence is the same failure as a switch that reads a
 * value it cannot use: the setting sits in a user's `settings.json` doing
 * nothing, and the session that relied on it never finds out. Said once, with
 * what replaced it, so the line is worth the room it takes.
 */
export function retired(env = process.env) {
  if (String(env.ULTRACODE_ANYWHERE_SUBAGENT_EFFORT ?? "").trim() === "") return null;
  return (
    "ULTRACODE_ANYWHERE_SUBAGENT_EFFORT is set and no longer does anything: this plugin stopped " +
    "writing agent files for you and ships its own, each carrying its `effort:` in frontmatter. " +
    "Remove it from settings, or set it on an agent file of your own"
  );
}

/**
 * What each switch is called, and what a session loses when its value names no
 * level. The tail is per switch because the cost is: one asks for nothing and
 * the fan-out runs deep, the other says nothing and the files go unchecked.
 *
 * The name is here for the sentence alone. Every read above spells
 * `env.ULTRACODE_ANYWHERE_...` out, because the test that pairs a switch the
 * code reads with a switch the README names finds them by that spelling and by
 * no other: read through this object instead, both switches would go invisible
 * to it and could ship undocumented.
 */
const STAGE = {
  name: "ULTRACODE_ANYWHERE_STAGE_EFFORT",
  costs: "so the stages are asked for none and run at the session's own level",
};

const HOLD = {
  name: "ULTRACODE_ANYWHERE_SPAWN_EFFORT",
  costs: "so spawns are not held to any level",
};

/** The level a value names, or null for anything that is not one of the five. */
function levelIn(value) {
  const asked = normalise(value);
  return EFFORT_LEVELS.find((level) => level === asked) ?? null;
}

/** The line a switch owes a session when its value named no level, or null. */
function unreadable(value, which) {
  const raw = String(value ?? "");
  if (raw.trim() === "" || levelIn(value)) return null;
  return `${which.name} is set to ${shown(raw)}, which is no effort level, ${which.costs}. The levels are ${EFFORT_LEVELS.join(", ")}`;
}

/**
 * A setting as a session may be shown it: quoted when it is plain, and counted
 * when it is not, since the sentence goes into a system-reminder.
 *
 * The trimmed, folded form is what gets quoted. A value whose ends carry a line
 * break passes the class check on its trimmed middle while the raw text opens a
 * line.
 */
export function shown(value) {
  const raw = String(value ?? "");
  const asked = normalise(raw);
  if (QUOTABLE.test(asked)) return `"${asked}"`;
  return `${raw.length === 1 ? "1 character" : `${raw.length} characters`} this will not quote back`;
}

/**
 * A setting read the way this switch reads one: bounded, case-folded, and
 * without the spaces a shell or an editor left on it.
 *
 * The build's own reader folds case and does neither of the other two, so this
 * is deliberately more forgiving at the ends and stricter about length. A
 * variable is typed by a person; `opts.effort` is written by a model.
 */
function normalise(value) {
  const text = String(value ?? "");
  return text.length > READ_MOST ? "" : text.trim().toLowerCase();
}
