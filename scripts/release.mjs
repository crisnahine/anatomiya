#!/usr/bin/env node
/**
 * Which plugin a tag releases, and the notes that go with it.
 *
 * The marketplace lists two plugins that answer to different upstreams and move
 * on their own versions. One tag namespace and one changelog served both, and
 * the dangerous shape was not a tag that failed: it was a bare
 * `v0.1.0`, which matched the second plugin's version, found no section of its
 * own, and released anatomiya's `0.1.0` notes instead, silently.
 *
 * A module rather than the shell it grew out of, because a release is the one
 * step that cannot be taken back and the logic was six lines of `awk` inside a
 * workflow, where nothing could run it until a tag was already pushed.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { invokedAs } from "./entry.mjs";
// One rule for what a version is. `validate.mjs` holds it, and its docstring
// says why a second copy is a second answer to the same question: the copy that
// stood here was looser, so a version could pass a tag and fail the branch gate.
import { SEMVER } from "./validate.mjs";
import { REL } from "./plugins.mjs";

/**
 * Every plugin this marketplace can release, the tag that releases it, the
 * files that have to carry that version, and the changelog the notes come from.
 *
 * anatomiya keeps the bare `v` tag it has always had, from when it was the
 * package at the repository root, so no tag already pushed changes meaning.
 * Anything else is prefixed with its own name. `root` is each plugin's
 * directory, read only where a workspace lockfile is one of the manifests,
 * which is the one file that states a version per member rather than its own.
 */
export const RELEASES = [
  {
    plugin: "anatomiya",
    root: REL.anatomiya,
    tag: "v*",
    manifests: [`${REL.anatomiya}/package.json`, `${REL.anatomiya}/.claude-plugin/plugin.json`, "package-lock.json"],
    changelog: "CHANGELOG.md",
  },
  {
    plugin: "ultracode-anywhere",
    root: REL.ultracode,
    tag: "ultracode-anywhere-v*",
    manifests: [`${REL.ultracode}/.claude-plugin/plugin.json`],
    changelog: `${REL.ultracode}/CHANGELOG.md`,
  },
];

/**
 * What the workflow fires on, in the order the entries are declared.
 *
 * Held to the table by a test rather than kept in step by hand: a tag this
 * knows and the workflow ignores is a release that quietly never happens, and
 * that is only visible after the tag is pushed.
 */
export const TAG_GLOBS = RELEASES.map((release) => `${prefixOf(release.tag)}*.*.*`);

/**
 * The part of a tag pattern before its placeholder.
 *
 * A pattern is a prefix and one trailing `*`, which is what `releaseFor` reads
 * when it takes the remainder as the version. Said here rather than assumed:
 * substituting with `replace` takes the first star of however many there are,
 * so a pattern carrying two would be filled in one place and matched from
 * another, and the two would disagree about which tag releases what.
 */
export function prefixOf(tag) {
  if (typeof tag !== "string" || !tag.endsWith("*") || tag.slice(0, -1).includes("*")) {
    throw new TypeError(`a tag pattern is a prefix and one trailing *, not ${JSON.stringify(tag)}`);
  }
  return tag.slice(0, -1);
}

/** The tag a plugin's release carries at this version. */
export const tagFor = (release, version) => `${prefixOf(release.tag)}${version}`;

/**
 * The versions one file has to carry for one plugin.
 *
 * A workspace lockfile carries the marketplace root's version at the top and at
 * `packages[""]`, and each member's under its own path. Only the member's is
 * read: the root's is not what a plugin release moves, so falling back to it
 * released a tag against a lockfile saying nothing about that plugin, and
 * refused a correct tree whenever the two had drifted apart. A member that is
 * not there answers nothing, which the caller reports as the mismatch it is.
 */
function versionsIn(rel, json, release) {
  if (rel !== "package-lock.json") return [json?.version];
  return [json?.packages?.[release.root]?.version];
}

/**
 * The release a tag names, or null where it names none.
 *
 * The prefixed entries are tried first, because `v1.2.3` and
 * `ultracode-anywhere-v1.2.3` differ only in what comes before the `v`, and
 * neither pattern matches the other's tag today. Sorted anyway, because a
 * third plugin named for a prefix of an existing one would be taken by the
 * shorter pattern, and the tag that goes wrong is one already pushed.
 */
export function releaseFor(tag, releases = RELEASES) {
  if (typeof tag !== "string") return null;
  // What decides is the semver test below, not this order: every prefix here
  // ends in `v` and a version never starts with a letter or a dash, so a
  // shorter prefix that also matches leaves a remainder semver refuses, and the
  // walk carries on to the longer one. Measured, not assumed: `va-v1.2.3`
  // starts with `v` and leaves `a-v1.2.3`. The order is kept because it costs
  // one comparison and it is what would hold if that test were ever relaxed,
  // and the table is a parameter so a case can build the overlap it needs.
  const ordered = [...releases].sort((a, b) => b.tag.length - a.tag.length);
  for (const release of ordered) {
    const prefix = prefixOf(release.tag);
    if (!tag.startsWith(prefix)) continue;
    const version = tag.slice(prefix.length);
    if (!SEMVER.test(version)) continue;
    return { ...release, version };
  }
  return null;
}

/**
 * One version's section of a changelog, or null where it has none.
 *
 * The version is matched as a whole token rather than as a substring, or `0.1.0`
 * finds the `10.1.0` heading first and the release ships the wrong notes. The
 * section ends at the next heading of the same level, or at the link
 * definitions the format keeps at the bottom, so the oldest release does not
 * ship a list of compare URLs as its notes.
 */
export function sectionFor(body, version) {
  if (typeof body !== "string" || typeof version !== "string") return null;
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The hyphen and the plus are part of a version rather than boundaries around
  // one, or `0.1.0` matches the `0.1.0-rc.1` heading above it and the release
  // ships the candidate's notes.
  const whole = new RegExp(`(^|[^0-9.\\-+])${escaped}([^0-9.\\-+]|$)`);
  const lines = body.split(/\r?\n/);
  const taken = [];
  let inside = false;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (inside) break;
      inside = whole.test(line);
      continue;
    }
    if (inside && /^\[[^\]]+\]:\s/.test(line)) break;
    if (inside) taken.push(line);
  }

  const notes = taken.join("\n").trim();
  return inside && notes !== "" ? notes : null;
}

/**
 * The notes a tag releases, or the reason it releases nothing.
 *
 * One answer carrying both, rather than a throw, because the caller is a
 * workflow step that has to say which half failed: a tag no plugin claims, a
 * manifest that disagrees with it, or a changelog with nothing under that
 * heading.
 */
export function notesFor(root, tag) {
  const release = releaseFor(tag);
  if (!release) {
    return { plugin: null, version: null, notes: null, problem: `no plugin in this marketplace is released by the tag ${tag}` };
  }

  const answer = { plugin: release.plugin, version: release.version, notes: null, problem: null };
  for (const rel of release.manifests) {
    const path = join(root, rel);
    if (!existsSync(path)) {
      return { ...answer, problem: `${rel} is missing, so nothing says ${release.plugin} is at ${release.version}` };
    }
    let json;
    try {
      json = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      return { ...answer, problem: `${rel} could not be read: ${err.message}` };
    }
    for (const carried of versionsIn(rel, json, release)) {
      if (carried !== release.version) {
        return { ...answer, problem: `version mismatch: the tag says ${release.version}, ${rel} says ${carried ?? "nothing"}` };
      }
    }
  }

  const changelog = join(root, release.changelog);
  if (!existsSync(changelog)) {
    return { ...answer, problem: `${release.changelog} is missing, so there is nothing to release ${release.version} with` };
  }
  let body;
  try {
    body = readFileSync(join(root, release.changelog), "utf8");
  } catch (err) {
    return { ...answer, problem: `${release.changelog} could not be read: ${err.message}` };
  }
  const notes = sectionFor(body, release.version);
  if (notes === null) {
    return { ...answer, problem: `${release.changelog} has no section for ${release.version}. Add one and re-tag.` };
  }

  return { ...answer, notes };
}

const USAGE = "usage: node scripts/release.mjs <tag> [--notes <path>] [--github-output <path>] [--root <path>]";

/** Whether a write happened, saying so rather than throwing when it did not. */
function wrote(path, text, how) {
  try {
    how(path, text);
    return true;
  } catch (err) {
    console.error(`could not write the notes to ${path}: ${err.message}`);
    return false;
  }
}

/**
 * The repository this answers about: the one this file lives in, unless the
 * caller names another.
 *
 * Resolved from here rather than from the working directory, the way the other
 * gates beside it resolve theirs, so where the command was run from cannot
 * decide what it checked.
 */
const rootOf = (named) => (named === null ? resolve(dirname(fileURLToPath(import.meta.url)), "..") : resolve(named));

function main(argv) {
  const flags = ["--notes", "--github-output", "--root"];
  const values = new Map();
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (!flags.includes(argv[i])) {
      // A flag this does not know is a typo, and reading it as the tag is how
      // `--notes-file` released the right version and wrote no notes.
      if (argv[i].startsWith("--")) {
        console.error(`unknown option: ${argv[i]}\n${USAGE}`);
        process.exit(2);
      }
      rest.push(argv[i]);
      continue;
    }
    // A flag whose value never arrived is refused rather than dropped: the
    // caller asked for a file to be written, and exiting 0 without writing it
    // is the failure this whole module exists to stop happening at a tag.
    const value = argv[i + 1];
    // Any dash, not only the three options this knows: a typo taken as a value
    // wrote the notes to a file named `--notes-file` and the step that reads
    // them found the empty one it meant, and `-x` did the same under a shorter
    // name. The sibling gate in `coverage.mjs` refuses one dash for the same
    // reason, and this one refused two.
    if (!value || value.startsWith("-")) {
      console.error(`${argv[i]} needs a path\n${USAGE}`);
      process.exit(2);
    }
    // Given twice, the first path is silently dropped and the step that reads
    // it finds a file that was never written.
    if (values.has(argv[i])) {
      console.error(`${argv[i]} was given twice, and only one path can be written\n${USAGE}`);
      process.exit(2);
    }
    values.set(argv[i], value);
    i++;
  }
  const valueOf = (flag) => values.get(flag) ?? null;
  const tag = rest[0];
  if (!tag) {
    console.error(USAGE);
    process.exit(2);
  }
  // One tag, or the second is a release nobody was told did not happen.
  if (rest.length > 1) {
    console.error(`only one tag may be given, and ${rest[1]} was the second\n${USAGE}`);
    process.exit(2);
  }

  const answered = notesFor(rootOf(valueOf("--root")), tag);
  if (answered.problem !== null) {
    console.error(process.env.GITHUB_ACTIONS === "true" ? `::error::${answered.problem}` : answered.problem);
    process.exit(1);
  }

  const notes = valueOf("--notes");
  // Both writes are guarded, because the tag that started this cannot be taken
  // back and a stack trace says less about which half failed than a sentence.
  if (notes && !wrote(notes, `${answered.notes}\n`, writeFileSync)) process.exit(1);
  // Written here rather than cut out of the line below, because a workflow that
  // parses a human-readable summary breaks the first time the summary is
  // reworded, and it breaks after the tag is already pushed.
  const output = valueOf("--github-output");
  if (output && !wrote(output, `plugin=${answered.plugin}\nversion=${answered.version}\n`, appendFileSync)) process.exit(1);
  console.log(`${answered.plugin} ${answered.version}, ${answered.notes.split("\n").length} lines of notes`);
}

if (invokedAs(import.meta.url)) main(process.argv.slice(2));
