/**
 * Facts the prose states that the code also states.
 *
 * Every number here drifted at least once: the README claimed 21 dimensions
 * after 31 shipped, and a gate table listed floors the gates had stopped
 * reading. A reader cannot tell a stale number from a true one, and a wrong
 * number in the file that explains the tool is worse than no file.
 *
 * Only mechanically derivable claims are checked. Prose that describes a
 * measurement is left to a human.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ALL_DIMENSIONS, dimensionsFor } from "../lib/dimensions.mjs";
import { GATES } from "../lib/reduce.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const problems = [];

function claim(where, ok, detail) {
  if (!ok) problems.push(`${where}: ${detail}`);
}

// --- the dimension registry -------------------------------------------------

const total = ALL_DIMENSIONS.length;
const js = dimensionsFor(["js"]).length;
const jsx = dimensionsFor(["jsx"]).length;
const ruby = dimensionsFor(["ruby"]).length;

for (const rel of ["README.md", "docs/how-it-works.md", "CHANGELOG.md"]) {
  const text = read(rel);
  for (const m of text.matchAll(/(\d+)\s+dimensions/g)) {
    claim(`${rel}`, Number(m[1]) === total, `says "${m[1]} dimensions", the registry holds ${total}`);
  }
  for (const m of text.matchAll(/(\d+)\s+for JavaScript(?!\s+and)/g)) {
    claim(rel, Number(m[1]) === js, `says "${m[1]} for JavaScript", dimensionsFor(["js"]) is ${js}`);
  }
  for (const m of text.matchAll(/(\d+)\s+reachable in JSX/g)) {
    claim(rel, Number(m[1]) === jsx, `says "${m[1]} reachable in JSX", dimensionsFor(["jsx"]) is ${jsx}`);
  }
  for (const m of text.matchAll(/(\d+)\s+for Ruby/g)) {
    claim(rel, Number(m[1]) === ruby, `says "${m[1]} for Ruby", dimensionsFor(["ruby"]) is ${ruby}`);
  }
}

// Every key is unique, or a claim is dropped without a word.
const keys = ALL_DIMENSIONS.map((d) => d.key);
claim("lib/dimensions.mjs", new Set(keys).size === keys.length, "two dimensions share a key");

// A dimension either states its inverse or records that it may not. An absent
// field is indistinguishable from one nobody classified.
for (const d of ALL_DIMENSIONS) {
  claim(
    "lib/dimensions.mjs",
    d.counterClaim === null || typeof d.counterClaim === "string",
    `${d.key} has no counterClaim decision, which reads the same as refused`
  );
}

// --- the gate table ---------------------------------------------------------

const gateText = read("README.md") + read("docs/how-it-works.md");
claim(
  "docs",
  /\b0\.90\b/.test(gateText),
  "no document states the 0.90 bar, which is the one number that never moves"
);
claim("lib/reduce.mjs", GATES.minRatio === 0.9, `minRatio is ${GATES.minRatio}, and it is fixed at 0.90 by decision`);

// Anything the gates stopped reading must stop being described.
for (const dead of ["minCandidates", "minAuthors", "maxSingleFileShare"]) {
  claim("lib/reduce.mjs", GATES[dead] === undefined, `${dead} is back in GATES; it was replaced by a repository-relative rule`);
  claim("docs", !gateText.includes(dead), `the docs still name ${dead}, which the gates no longer read`);
}

// --- the command surface ----------------------------------------------------

const usage = execFileSync(process.execPath, [join(root, "bin/anatomiya.mjs"), "--help"], {
  encoding: "utf8",
});
const commands = [...usage.matchAll(/anatomiya\s+(\w+)/g)].map((m) => m[1]);
const unique = [...new Set(commands)];

for (const cmd of unique) {
  let file;
  try {
    file = read(`commands/${cmd}.md`);
  } catch {
    problems.push(`commands/: ${cmd} is in the usage line and has no command file`);
    continue;
  }
  claim(`commands/${cmd}.md`, file.trim().length > 0, "is empty");
}

const readme = read("README.md");
for (const cmd of unique) {
  claim("README.md", readme.includes(`/anatomiya:${cmd}`), `does not mention /anatomiya:${cmd}`);
}

// --- versions ---------------------------------------------------------------

const pkg = JSON.parse(read("package.json"));
const plugin = JSON.parse(read(".claude-plugin/plugin.json"));
claim("package.json", pkg.version === plugin.version, `${pkg.version} against plugin.json ${plugin.version}`);
claim("CHANGELOG.md", read("CHANGELOG.md").includes(`## [${pkg.version}]`), `has no section for ${pkg.version}`);

// ----------------------------------------------------------------------------

if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\n${problems.length} claim(s) in the documentation do not match the code.`);
  process.exit(1);
}
console.log(
  `docs match the code: ${total} dimensions (${js} js, ${jsx} jsx, ${ruby} ruby), ` +
    `${unique.length} commands, version ${pkg.version}`
);
