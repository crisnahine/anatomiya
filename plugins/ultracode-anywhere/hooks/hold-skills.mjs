/**
 * Skills and commands, found where Claude Code loads them, so a forked one can
 * be checked before it spawns.
 */
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

import { readFrontmatter } from "./frontmatter.mjs";
import { enabledPluginInstalls } from "./hold-agents.mjs";
import { ancestors, filesIn } from "./hold-files.mjs";
import { configDirFor } from "./hook-io.mjs";

/**
 * Every skill and command under one base, by the name that invokes it. Nested
 * folders join with `:` and a plugin's name leads. A skill also answers to its
 * frontmatter name, and a plugin can keep one SKILL.md at its root.
 */
function skillsUnder(base, prefix) {
  const found = [];
  const skills = join(base, "skills");
  for (const file of filesIn(skills, ".md").filter((path) => /^skill\.md$/i.test(basename(path)))) {
    const fm = readFrontmatter(file);
    found.push({ name: prefix + relative(skills, dirname(file)).split(sep).join(":"), prefix, file, fm });
    if (fm?.fields.name) found.push({ name: prefix + fm.fields.name, prefix, file, fm });
  }
  const rootSkill = join(base, "SKILL.md");
  if (prefix && existsSync(rootSkill)) {
    const fm = readFrontmatter(rootSkill);
    if (fm?.fields.name) found.push({ name: prefix + fm.fields.name, prefix, file: rootSkill, fm });
  }
  const commands = join(base, "commands");
  for (const file of filesIn(commands, ".md")) {
    found.push({ name: prefix + relative(commands, file).replace(/\.md$/, "").split(sep).join(":"), prefix, file, fm: readFrontmatter(file) });
  }
  return found;
}

/**
 * Every personal, project and plugin skill or command that answers to `name`.
 *
 * All of them, a plugin's under its bare name included: which one runs depends
 * on precedence rules that differ between skills, commands and builds, and a
 * caller that checks every candidate is safe under any of them.
 */
export function findSkills(name, { env = process.env, root = "" } = {}) {
  const wanted = String(name ?? "").replace(/^\//, "");
  const config = configDirFor(env);
  const bases = [...(config ? [config] : []), ...(root ? ancestors(root, [".claude"], env) : [])];
  const plugins = enabledPluginInstalls(env, root);
  const seen = new Set();
  const answers = (skill) => skill.name === wanted || (skill.prefix !== "" && skill.name.slice(skill.prefix.length) === wanted);
  return [...bases.map((base) => skillsUnder(base, "")), ...plugins.map((install) => skillsUnder(install.path, `${install.plugin}:`))]
    .flat()
    .filter((skill) => answers(skill) && skill.fm && !seen.has(skill.file) && seen.add(skill.file))
    .map((skill) => ({ name: wanted, file: skill.file, fields: skill.fm.fields, fm: skill.fm }));
}
