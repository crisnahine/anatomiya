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
 * The reminder is the only way to ask. A spawn's effort comes from its agent
 * definition, and neither the Agent tool nor a workflow stage takes one from
 * the caller except through a script's own `opts.effort`, which is the model's
 * to pass and nobody else's.
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

/** Characters of a setting that named no level worth quoting back at whoever set it. */
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
  const asked = normalise(env.ULTRACODE_ANYWHERE_STAGE_EFFORT);
  return EFFORT_LEVELS.find((level) => level === asked) ?? null;
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
  const raw = String(env.ULTRACODE_ANYWHERE_STAGE_EFFORT ?? "");
  if (raw.trim() === "" || stageEffortIn(env)) return null;

  const asked = normalise(raw);
  const quoted = QUOTABLE.test(asked) ? `"${asked}"` : `${raw.length} characters this will not quote back`;
  return `ULTRACODE_ANYWHERE_STAGE_EFFORT is set to ${quoted}, which is no effort level, so the stages are asked for none and run at the session's own. The levels are ${EFFORT_LEVELS.join(", ")}`;
}

/** A setting as the build would read one: bounded, case-folded, and without the shell's spaces. */
function normalise(value) {
  const text = String(value ?? "");
  return text.length > READ_MOST ? "" : text.trim().toLowerCase();
}
