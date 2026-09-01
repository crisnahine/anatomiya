// scripts/ab/engine.mjs
/**
 * The model and effort every trial runs at.
 *
 * A trial that names its model and says nothing about effort is two variables,
 * not one: the effort then comes from whatever the machine happens to be set
 * to, and two arms measured hours apart are not comparable. Both halves are
 * stated here so a run carries them rather than inherits them.
 */

export const ENGINE = { model: "claude-opus-5[1m]", effort: "medium" };

/** The levels `--effort` takes, weakest first, as the CLI ranks them. */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];

/**
 * Variables that decide what a trial runs at, whatever the flags say.
 *
 * Read off the installed build by name rather than guessed at by shape. A shape
 * wide enough to catch the thinking variables also catches
 * ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION, and a Bedrock run needs the region
 * that names; one narrow enough to spare it lets MAX_THINKING_TOKENS through,
 * and a trial with thinking off records itself as medium all the same.
 *
 * The context group is here because the pinned model is the 1M one: Claude Code
 * strips the `[1m]` suffix and asks for the long window with a beta header
 * instead, and these four decide whether it gets one.
 */
export const OVERRIDES = new Set([
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "FALLBACK_FOR_ALL_PRIMARY_MODELS",
  "CLAUDE_CODE_EFFORT_LEVEL",
  "CLAUDE_CODE_ALWAYS_ENABLE_EFFORT",
  "MAX_THINKING_TOKENS",
  "CLAUDE_CODE_DISABLE_THINKING",
  "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING",
  "DISABLE_INTERLEAVED_THINKING",
  "CLAUDE_CODE_DISABLE_1M_CONTEXT",
  "ANTHROPIC_BETAS",
  "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
  "CLAUDE_CONTEXT_COLLAPSE_MODEL",
  "CLAUDE_CODE_AUTO_MODE_MODEL",
  "CLAUDE_CODE_BG_CLASSIFIER_MODEL",
  "CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP",
  "CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL",
  "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT",
  "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY",
  "CLAUDE_EFFORT",
  // 2.1.257 forces a child's model with a flag of its own and installs a served
  // catalog in place of the compiled model list, so the switch and the URL that
  // feed it go too: docs/research/claude-code-2-1-257-engine-variables.md.
  "CLAUDE_CODE_SUBAGENT_MODEL_FORCE",
  "CLAUDE_CODE_MODEL_CATALOG",
  "CLAUDE_CODE_MODEL_CATALOG_URL",
]);

/**
 * What a trial is given rather than what it is denied.
 *
 * The build swaps in another model when the chosen one is refused, and says so
 * in its own words: "CLAUDE_CODE_NO_MODEL_FALLBACK is set: model substitution
 * is disabled". A trial that quietly answered from the substitute would record
 * the model it asked for, which is the defect this file exists to close.
 */
const PINS = { CLAUDE_CODE_NO_MODEL_FALLBACK: "1" };

/**
 * Two families arrive with their own suffixes, a name, a description and a
 * capability list each, so they are shapes while the rest are names. Anchored
 * past the `MODEL` segment, which is what keeps
 * `ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION` out of both.
 */
const FAMILIES = [
  /^ANTHROPIC_DEFAULT_[A-Z0-9]+_MODEL(?:_[A-Z0-9_]+)?$/,
  /^ANTHROPIC_CUSTOM_MODEL_OPTION(?:_[A-Z0-9_]+)?$/,
];

export function overridesEngine(name) {
  return OVERRIDES.has(name) || FAMILIES.some((family) => family.test(name));
}

/** The environment a trial runs in: the parent's, minus its say over the engine. */
export function engineEnv(env) {
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    if (!overridesEngine(name)) out[name] = value;
  }
  return { ...out, ...PINS };
}

/**
 * Why the settings in force would decide this run's engine, or null.
 *
 * Only `env` is checked, because only `env` outranks the flags a trial passes.
 * Measured on 2.1.250 and written up in `docs/research/one-model-one-effort.md`:
 * `settings.env` naming `CLAUDE_CODE_EFFORT_LEVEL` sets the effort whatever
 * `--effort` says, while `ultracode: true`, `modelSettings` and `effortLevel`
 * all lose to it. Refusing on those would fail on a machine merely configured
 * for ordinary work, which is a gate nobody could pass, and would refuse a run
 * the flags were already deciding correctly.
 *
 * No environment scrub reaches any of this: Claude Code reads its own settings
 * after it starts, so what `engineEnv` took out comes back.
 */
export function conflictingSettings(settings, engine) {
  const named = Object.keys(settings?.env ?? {}).filter(overridesEngine);
  if (!named.length) return null;
  // No second half naming a clean CLAUDE_CONFIG_DIR: measured on 2.1.250, an
  // empty one takes the credentials with it and every trial answers "Not logged
  // in". Removing the entry is the only advice that works.
  return `settings env entries decide this run's engine ahead of its flags: ${named.join(", ")}. Remove ${named.length === 1 ? "it" : "them"} from the settings file, or measure at the level ${named.length === 1 ? "it sets" : "they set"}`;
}

/**
 * The engine a run uses, or an error naming what was refused.
 *
 * The effort is refused here rather than at the CLI, because the levels are a
 * closed list this can hold: an unrecognised one otherwise costs the whole batch
 * to find out, and one the CLI quietly ignores costs more, since the
 * measurement then records a request nothing honoured. The model is only
 * checked for being a name at all. There is no list of live model ids to hold,
 * so the CLI refuses an unknown one at the first trial, and `test/ab.test.mjs`
 * reads the installed build for the pinned id so `npm test` says it sooner.
 */
export function engineFor({ model, effort } = {}) {
  const pair = { model: model ?? ENGINE.model, effort: effort ?? ENGINE.effort };
  if (typeof pair.model !== "string" || !pair.model.trim()) {
    return { error: "--model takes a model name" };
  }
  if (!EFFORT_LEVELS.includes(pair.effort)) {
    return { error: `--effort takes one of ${EFFORT_LEVELS.join(", ")}, not ${JSON.stringify(pair.effort)}` };
  }
  return pair;
}

/**
 * The engine the trials actually ran on, or the refusal to record one.
 *
 * The flags are a request. Only what comes back says whether it was honoured,
 * and for the 1M window nothing else can: the `[1m]` suffix never reaches the
 * wire, it becomes a beta header, so the window a trial got is knowable only
 * from the answer. Trials that disagree are a batch measured on two engines,
 * which is the thing this file refuses everywhere else. A batch that reported
 * nothing records the request and says the observation was missing, because an
 * answer nobody could read decides neither way.
 */
export function engineRan(asked, trials) {
  const models = new Set();
  const windows = new Set();
  for (const t of trials) {
    if (!t.ran?.model) continue;
    models.add(t.ran.model);
    // A trial whose answer named no window is one this could not read, and an
    // answer nobody could read decides neither way. Keyed together with the
    // model it would have split one engine into two and thrown the batch away.
    if (t.ran.contextWindow) windows.add(t.ran.contextWindow);
  }
  if (models.size > 1) {
    return { error: `the trials ran on more than one engine: ${[...models].sort().join(", ")}` };
  }
  if (windows.size > 1) {
    return { error: `the trials ran in more than one context window: ${[...windows].sort((a, b) => b - a).join(", ")}` };
  }
  if (models.size === 0) {
    return { engine: asked, note: "no trial reported which engine served it, so the table records what was asked for" };
  }
  const [model] = models;
  const [contextWindow] = windows;
  return {
    // The substitute is recorded, and so is what the run asked for, or a reader
    // of the table has only the note in someone's scrollback to go on.
    engine: {
      ...asked,
      model,
      ...(contextWindow ? { contextWindow } : {}),
      ...(model === asked.model ? {} : { asked: asked.model }),
    },
    // Recording the substitute is half the job. A record naming a model the run
    // never asked for, with nothing saying so, leaves the reader to notice.
    note: model === asked.model ? null : `this run asked for ${asked.model} and was served by ${model}`,
  };
}

