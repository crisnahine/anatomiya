/**
 * What the spawn hold decides about one tool call or one typed prompt (A81).
 *
 * An Agent call is routed to a definition at the level, a Workflow script gets
 * the prelude, a forked skill off the level is refused, the bundled code review
 * is rewritten to the level, and a call that would start a session nothing here
 * can hold is refused. A spawn that cannot be routed is refused too, since the
 * hold is a promise about every spawn.
 */
import { isAbsolute, resolve } from "node:path";

import { appendLine, ownState, stateDirFor } from "./counters.mjs";
import { sameLevel, shown } from "./effort.mjs";
import { onceNamed } from "./frontmatter.mjs";
import { copyOf, enabledPlugins, loadedTiers, resolveAgent } from "./hold-agents.mjs";
import { RECHECK, globalConfigFile, holdGaps, holdTarget, pluginEnabled, probingIn, runningVersion, verifiedRecord } from "./hold-config.mjs";
import { inGitRepo, readJson } from "./hold-files.mjs";
import { findSkills } from "./hold-skills.mjs";
import { projectRedirects, projectRoot } from "./hold-switch.mjs";
import { logLine, verdict } from "./hold-tripwire.mjs";
import { copiesBeside, injectLevel, knownWorkflows, resolveWorkflow, workflowCopies } from "./hold-workflows.mjs";
import { here, readIfFile } from "./hook-io.mjs";

/** The words the bundled review reads as an effort, `ultra` among them, which sends it to the cloud. */
const EFFORT_WORDS = new Set(["low", "med", "medium", "high", "xhigh", "max", "ultra"]);

/**
 * The bundled review and its alias. A skill of your own may take either name and
 * still leave the bundled review to run, so both names are always held the way
 * the bundled review is.
 */
const CODE_REVIEW = new Set(["code-review", "review"]);

/** The bundled review drops these anywhere in its arguments before it reads the effort word. */
const REVIEW_FLAGS = new Set(["--comment", "--fix", "--post", "--no-post"]);

/** What a session that never recorded the agents it loaded is told, since nothing can be checked against them. */
const UNRECORDED = "This session's loaded agents were not recorded when it started, so what a spawn would run cannot be checked against them. Start a new session.";

/** Claude Code's own state file keeps every project's history, so it grows well past what the other reads allow. */
const GLOBAL_CONFIG_MOST = 64 * 1024 * 1024;

/** The routine actions that only read, which start and change nothing in the cloud. */
const ROUTINE_READS = new Set(["list", "get", "list_runs", "get_run_log"]);

/** Why every spawn is refused on this build, or null: the self-check saw one off the level here. */
export function gateReason(env = process.env) {
  if (probingIn(env)) return null;
  // A record another account can write may say anything, and this reason goes to the model.
  const dir = stateDirFor(env);
  if (dir && !ownState(dir)) {
    return "The spawn hold keeps its record in a state directory that is not this account's alone, so whether this build leaks cannot be told and spawns are refused. Make that directory this account's alone, mode 0700, or point ULTRACODE_ANYWHERE_STATE at one that is.";
  }
  const version = runningVersion(env);
  const state = verifiedRecord(env);
  const leaks = state?.version === version && Array.isArray(state.leaks) ? state.leaks.filter((leak) => typeof leak === "string") : [];
  if (leaks.length === 0) return null;
  return `The spawn hold's self-check found spawns off the level on Claude Code ${version}: ${leaks.join("; ")}. Spawns are refused until it passes. Run ${RECHECK} once it is fixed, in the background, since it takes a few minutes.`;
}

/** Why every spawn is refused here, or null: a missing setting, or a leak the self-check found on this build. */
function refusedFor(ctx) {
  return gapsReason(ctx) ?? gateReason(ctx.env);
}

/** Why every spawn is refused in this configuration, or null: a setting the hold cannot do without is missing. */
function gapsReason({ env, root, level }) {
  const { required } = holdGaps(env, { root });
  if (required.length === 0) return null;
  return `Spawns are held to ${level} and this configuration cannot hold them: ${required.join("; ")}. Fix these in settings.json, or unset ULTRACODE_ANYWHERE_SPAWN_EFFORT.`;
}

/** An effort a definition names, plain enough to repeat to the model. */
function effortNamed(effort) {
  if (effort === undefined || effort === null) return "the session's";
  return /^[a-z]{1,16}$/i.test(String(effort)) ? String(effort) : "an unknown";
}

function cloudReview(level) {
  return `/ultrareview runs in the cloud, where nothing here holds its agents to ${level}. Use /code-review ${level} for a local review.`;
}

/**
 * An Agent call routed to a definition at the level, a refusal, or null where
 * it is already at the level with nothing to drop.
 */
export function decideAgent(input, { env = process.env, root = "", level, tiers = null }) {
  if (typeof input.name === "string" && input.name !== "") {
    return { deny: "An Agent call with a name starts a teammate, a separate session whose effort nothing here can hold. Leave out name." };
  }
  const type = input.subagent_type || "general-purpose";
  if (type === "fork") {
    return { deny: `A fork runs at this session's own effort and cannot be held to ${level}. Name a subagent_type (general-purpose if nothing fits) and give it a self-contained prompt.` };
  }
  const def = resolveAgent(type, { env, root, level, ...(tiers && { tiers }) });
  if (def === null) {
    return { deny: `No agent definition named ${type} was found, so its effort cannot be checked. Use a subagent_type from the list exactly, or general-purpose.` };
  }
  let target = def.agentType;
  if (!sameLevel(def.effort, level)) {
    // Every project loads the user's agents, so a copy of one project's agent there would reach all of them.
    if (def.source === "project") {
      return { deny: `The project's agent ${def.agentType} runs at ${effortNamed(def.effort)} effort, and every spawn must run at ${level}. Set \`effort: ${level}\` in its file under .claude/agents and start a new session.` };
    }
    if (def.source === "plugin" && !pluginEnabled(enabledPlugins(env, "", ["user"]), def.agentType.split(":")[0])) {
      return { deny: `${def.agentType} comes from a plugin only this project's settings turn on, and a copy held to ${level} would reach every project. Turn the plugin on in your own settings to have it copied, and start a new session.` };
    }
    const copy = copyOf(def, level, env, tiers);
    if (!copy) {
      return { deny: `${def.agentType} would not run at ${level} and has no copy held to ${level} yet. Copies are written when a session starts, so start a new session.` };
    }
    if (resolveAgent(copy.agentType, { env, root, level, ...(tiers && { tiers }) })?.file !== copy.file) {
      return { deny: `${copy.agentType} answers to another definition in this session, which is not the copy of ${def.agentType} held to ${level}. Remove the other file of that name.` };
    }
    target = copy.agentType;
  }
  // The type is always written, so a build that forks on an omitted one cannot, and the forced
  // subagent model is the only model a spawn gets.
  const { model, ...next } = { ...input, subagent_type: target };
  if (input.isolation === "remote") {
    // A remote agent runs on the cloud's settings, where nothing here reaches its effort.
    if (inGitRepo(root, env)) next.isolation = "worktree";
    else delete next.isolation;
  }
  const unchanged = target === input.subagent_type && model === undefined && next.isolation === input.isolation;
  return unchanged ? null : { updatedInput: next };
}

/** A Workflow call whose script carries the prelude, a refusal, or null where it carries it already. */
export function decideWorkflow(input, { env = process.env, root = "", cwd = root, transcriptPath = null, level }) {
  const rest = { ...input };
  let script = input.script;
  if (typeof script !== "string") {
    if (typeof input.scriptPath === "string") {
      script = readIfFile(isAbsolute(input.scriptPath) ? input.scriptPath : resolve(cwd || here(), input.scriptPath));
      if (script === "") {
        return { deny: `The workflow script ${input.scriptPath} could not be read, so its stages cannot be held to ${level}. Pass the script inline instead.` };
      }
      delete rest.scriptPath;
    } else if (typeof input.name === "string") {
      script = resolveWorkflow(knownWorkflows(env, root), input.name)?.src ?? null;
      if (script === null) {
        return { deny: `Could not find the script for workflow ${input.name}, so its stages cannot be held to ${level}. Pass the script inline instead.` };
      }
      delete rest.name;
    } else {
      return { deny: `This Workflow call names no script, scriptPath or name, so there is nothing this hook can hold to ${level}.` };
    }
  }
  // The script is what was held, so nothing is left for the build to pick over it.
  delete rest.scriptPath;
  delete rest.name;
  const dir = copiesBeside(transcriptPath, env);
  const injected = injectLevel(script, level, dir ? workflowCopies(env, root, dir, level) : {}, { worktree: inGitRepo(root, env) });
  if (injected === null) {
    return { deny: `This workflow script does not open with an \`export const meta = {...}\` literal this hook can read, so its stages cannot be held to ${level}. Start the script with the meta literal, and keep \`\${}\` substitutions out of it.` };
  }
  const unchanged = injected === input.script && !Object.hasOwn(input, "scriptPath") && !Object.hasOwn(input, "name");
  return unchanged ? null : { updatedInput: { ...rest, script: injected } };
}

/** A RemoteTrigger call refused unless it only reads routines, since a routine runs on the cloud's settings. */
export function decideRoutine(input) {
  if (ROUTINE_READS.has(input.action)) return null;
  return {
    deny: `RemoteTrigger ${input.action} would start or change a cloud session, where nothing here holds its agents to a level. Only list, get, list_runs and get_run_log go through.`,
  };
}

function splitWords(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean);
}

/** Where the bundled review's effort word sits: the first word that is not one of its flags, or -1. */
function effortWordAt(parts) {
  const first = parts.findIndex((word) => !REVIEW_FLAGS.has(word));
  return first >= 0 && EFFORT_WORDS.has(parts[first].toLowerCase()) ? first : -1;
}

/** The bundled review's arguments with the level in place of whatever effort word they held. */
function reviewArgs(args, level) {
  const parts = splitWords(args);
  const effortAt = effortWordAt(parts);
  if (effortAt >= 0) parts.splice(effortAt, 1);
  return [level, ...parts].join(" ");
}

/** Why a forked skill may not spawn, or null where it runs at the level. Its own effort wins over its agent's. */
function forkRefusal(skill, { env, root, level, tiers = null }) {
  if (/^inherit$/i.test(String(skill.fields.model ?? ""))) {
    return `The skill ${skill.name} forks onto this session's own model, and a spawn may not inherit it. Follow its steps inline instead.`;
  }
  const effort = onceNamed(skill.fm, "effort");
  if (effort !== undefined) {
    if (sameLevel(effort, level)) return null;
    const at = effort === null ? "an effort it names twice" : `${effortNamed(effort)} effort`;
    return `The skill ${skill.name} runs as a forked subagent at ${at}, and every spawn must run at ${level}. Follow its steps inline instead.`;
  }
  const agentType = skill.fields.agent || "general-purpose";
  const def = resolveAgent(agentType, { env, root, level, ...(tiers && { tiers }) });
  if (def && sameLevel(def.effort, level)) return null;
  return `The skill ${skill.name} forks into ${agentType}, which would not run at ${level}. Follow its steps inline instead.`;
}

/** A Skill call refused, rewritten to the level for the bundled review, or null where it spawns nothing off the level. */
export function decideSkill(input, ctx) {
  const name = String(input.skill ?? "").replace(/^\//, "");
  if (name === "ultrareview") return { deny: cloudReview(ctx.level) };
  const forked = findSkills(name, ctx).filter((skill) => skill.fields.context === "fork");
  const bundled = CODE_REVIEW.has(name);
  if (!bundled && forked.length === 0) return null;
  const refused = refusedFor(ctx);
  if (refused) return { deny: refused };
  if (forked.length > 0) {
    const tiers = loadedTiers(ctx.env, ctx.session);
    if (!tiers) return { deny: UNRECORDED };
    for (const skill of forked) {
      const reason = forkRefusal(skill, { ...ctx, tiers });
      if (reason) return { deny: reason };
    }
  }
  if (!bundled) return null;
  const args = reviewArgs(input.args, ctx.level);
  return args === input.args ? null : { updatedInput: { ...input, args } };
}

/** A typed review with no effort word reuses the last review's effort, or the session's when none is stored. */
function decideReviewPrompt(name, rest, ctx) {
  const refused = refusedFor(ctx);
  if (refused) return { block: refused };
  const parts = splitWords(rest);
  const effortAt = effortWordAt(parts);
  const word = effortAt >= 0 ? parts[effortAt].toLowerCase() : "";
  if (word === "ultra") {
    return { block: `/${name} ultra runs in the cloud, where nothing here holds its agents to ${ctx.level}. Type /${name} ${reviewArgs(rest, ctx.level)} for a local review.` };
  }
  const stored = readJson(globalConfigFile(ctx.env), null, GLOBAL_CONFIG_MOST)?.codeReviewLastEffort;
  const asked = word || (typeof stored === "string" ? stored : "");
  if (sameLevel(asked, ctx.level)) return null;
  const forksAt = word ? `${word} effort` : asked ? `${shown(asked).replace(/^"|"$/g, "")} effort, the last one used` : "the session's effort";
  return { block: `/${name} would fork at ${forksAt}, and every spawn must run at ${ctx.level}. Type /${name} ${reviewArgs(rest, ctx.level)} instead.` };
}

/** A typed prompt blocked, or null. A command typed by the user runs without a tool call, so the prompt itself is read. */
export function decidePrompt(prompt, ctx) {
  const found = /^\/(\S+)\s*(.*)$/s.exec(String(prompt ?? "").trimStart());
  if (!found) return null;
  const [, name, rest] = found;
  if (name === "ultrareview") return { block: cloudReview(ctx.level) };
  if (ctx.env.ULTRACODE_ANYWHERE_HELD_CHILD === "1" && (name === "model" || name === "effort")) {
    return { block: `/${name} is off in a claude started from a held session's shell, which runs at ${ctx.level} effort on the subagent model.` };
  }
  if (CODE_REVIEW.has(name)) {
    const review = decideReviewPrompt(name, rest, ctx);
    if (review) return review;
  }
  const out = decideSkill({ skill: name }, ctx);
  return out?.deny ? { block: out.deny } : null;
}

/** What one call runs against: the session, its project, its directory, its transcript, and the level. */
function callContext(event, env) {
  const cwd = typeof event.cwd === "string" && event.cwd ? event.cwd : here();
  const transcriptPath = typeof event.transcript_path === "string" ? event.transcript_path : null;
  return { env, session: event.session_id, root: projectRoot(env, cwd), cwd, transcriptPath, level: null };
}

function deny(reason) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}

function decideTool(tool, input, ctx) {
  switch (tool) {
    case "Skill":
      return decideSkill(input, ctx);
    case "RemoteTrigger":
      return decideRoutine(input);
    case "Agent":
    case "Task":
    case "Workflow": {
      const refused = refusedFor(ctx);
      if (refused) return { deny: refused };
      if (probingIn(ctx.env) && ctx.env.ULTRACODE_ANYWHERE_HOLD_CHECK_UNROUTED === "1") return null;
      if (tool === "Workflow") return decideWorkflow(input, ctx);
      const tiers = loadedTiers(ctx.env, ctx.session);
      return tiers ? decideAgent(input, { ...ctx, tiers }) : { deny: UNRECORDED };
    }
    default:
      return null;
  }
}

/** The PreToolUse answer for one payload: a routed input, a refusal, or an empty object. */
export function toolAnswer(event, env = process.env) {
  const ctx = callContext(event, env);
  const target = holdTarget(env, { root: ctx.root });
  if (!target) return {};
  ctx.level = target.level;
  // A project that moves what the hold reads may have pointed its state into itself, so nothing is written there.
  const moved = projectRedirects(ctx.root).length > 0;
  if (!moved && probingIn(env)) appendLine(env.ULTRACODE_ANYWHERE_HOLD_CHECK_LOG, logLine(event, env));
  const tripped = verdict(event, { env: moved ? { ...env, ULTRACODE_ANYWHERE_STATE: "", CLAUDE_CONFIG_DIR: "", HOME: "", USERPROFILE: "" } : env, target });
  if (tripped !== "allow") return deny(tripped);
  const input = event.tool_input && typeof event.tool_input === "object" ? event.tool_input : {};
  const decided = decideTool(event.tool_name, input, ctx);
  if (!decided) return {};
  return decided.deny ? deny(decided.deny) : { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: decided.updatedInput } };
}

/** The UserPromptSubmit answer for one payload: a block, or an empty object. */
export function promptAnswer(event, env = process.env) {
  const ctx = callContext(event, env);
  const target = holdTarget(env, { root: ctx.root });
  if (!target) return {};
  ctx.level = target.level;
  const decided = decidePrompt(event.prompt, ctx);
  return decided?.block ? { decision: "block", reason: decided.block } : {};
}
