// test/ab-fixtures.mjs
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { removeTree } from "./platform.mjs";

/**
 * A `claude` earlier on PATH than the real one, running the script given.
 *
 * Running the real one would reach the network and cost a trial per assertion,
 * and what these cases are about is the argv and the environment the harness
 * hands over, and the answer it reads back, all of which a stub settles.
 */
export function stubClaude(t, script) {
  const base = mkdtempSync(join(tmpdir(), "anatomiya-stub-"));
  t.after(() => removeTree(base));
  const bin = join(base, "bin");
  const arm = join(base, "arm");
  mkdirSync(bin);
  mkdirSync(arm);
  const stub = join(bin, "claude");
  writeFileSync(stub, `#!/bin/sh\n${script(base)}\n`);
  chmodSync(stub, 0o755);
  return {
    arm,
    // The system directories come too: the stub is a shell script, and a PATH
    // holding only its own directory cannot resolve the commands it runs.
    path: [bin, "/usr/bin", "/bin"].join(":"),
    argv: () => readFileSync(join(base, "argv.txt"), "utf8").trim().split("\n"),
    env: () => new Map(
      readFileSync(join(base, "env.txt"), "utf8")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
    ),
  };
}

/**
 * A repository the harness can measure: one leaf area holding one stated claim
 * with headroom, written by two hands.
 *
 * The gates size it. The Wilson bound at z=1.96 holds 0.90 from a ratio of 0.94
 * at about 400 sites, the ranking wants headroom above 0.05, the concentration
 * gate wants the sites spread over three files' worth, and the author bar wants
 * a second pair of hands on files carrying conforming sites. `nullish_default`
 * sites are one line each, and the model's default for it is unmeasured, so
 * the map states it as a directive rather than dropping it to a counts line.
 */
export function measurable(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-ab-repo-"));
  t.after(() => removeTree(dir));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe", encoding: "utf8" });
  const write = (rel, body) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  git("init", "-q");
  git("config", "user.email", "one@t.test");
  git("config", "user.name", "one");
  for (let f = 0; f < 20; f++) {
    // 24 of the 400 sites take ||: three each in the first eight files.
    const lines = Array.from({ length: 20 }, (_, s) => `export const v${s} = a.p${s} ${f < 8 && s < 3 ? "||" : "??"} {};`);
    write(`src/x/f${f}.mjs`, `const a = {};\n${lines.join("\n")}\n`);
  }
  git("add", "-A");
  git("commit", "-qm", "init");
  git("config", "user.email", "two@t.test");
  git("config", "user.name", "two");
  for (const f of [10, 11]) write(`src/x/f${f}.mjs`, readFileSync(join(dir, `src/x/f${f}.mjs`), "utf8") + "export const touched = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "second hand");
  return dir;
}

/** The shell lines a stub answers the probe with: the map's own area line where the map is present, NONE where it is not. */
export const PROBE_ANSWER = '    if [ -d .claude/rules ]; then R=$(grep -h "^# " .claude/rules/anatomiya-area-*.md | head -1 | tr -d "#" | sed "s/^ *//"); else R=NONE; fi';
