#!/usr/bin/env node
/**
 * The line-ending pass `docs/releasing.md` asks for. A clone of this checkout's HEAD is taken the
 * way a Windows runner checks one out, with `core.autocrlf=true`, and every test file runs in it on
 * its own with `GIT_CONFIG_SYSTEM` set the same way, so a repository a test makes converts too. The
 * clone is removed after, and a failure names its file and its tests.
 *
 * usage: node scripts/line-endings.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { invokedAs } from "./entry.mjs";
import { ROOT } from "./plugins.mjs";

/** The names of the tests a TAP run reports as failed. */
export function failedTests(tap) {
  return [...tap.matchAll(/^\s*not ok \d+ - (.+?)(?: # .*)?$/gm)].map((m) => m[1]);
}

/** How many tracked files the working tree holds each way, from `git ls-files --eol`. */
export function endings(listing) {
  const counts = {};
  for (const line of listing.split("\n")) {
    const held = line.split(/\s+/)[1];
    if (held) counts[held] = (counts[held] ?? 0) + 1;
  }
  return counts;
}

if (invokedAs(import.meta.url)) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-eol-"));
  const clone = join(dir, "clone");
  const config = join(dir, "gitconfig");
  try {
    execFileSync("git", ["-c", "core.autocrlf=true", "clone", "-q", ROOT, clone], { stdio: "inherit" });
    cpSync(join(ROOT, "node_modules"), join(clone, "node_modules"), { recursive: true });
    writeFileSync(config, "[core]\n\tautocrlf = true\n");
    console.log(JSON.stringify(endings(execFileSync("git", ["-c", "core.autocrlf=true", "ls-files", "--eol"], { cwd: clone, encoding: "utf8" }))));
    const files = execFileSync("git", ["ls-files", "test/*.test.mjs"], { cwd: clone, encoding: "utf8" }).split("\n").filter(Boolean);
    let failed = 0;
    for (const file of files) {
      const run = spawnSync(process.execPath, ["--test", file], {
        cwd: clone,
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_SYSTEM: config },
        maxBuffer: 64 * 1024 * 1024,
      });
      if (run.status === 0) continue;
      failed++;
      console.log(`${file}: ${failedTests(run.stdout ?? "").join("; ") || `exit ${run.status}`}`);
    }
    console.log(`${files.length - failed} of ${files.length} test files pass`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
