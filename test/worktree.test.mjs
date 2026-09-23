import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { mainCheckoutOf } from "../plugins/anatomiya/lib/worktree.mjs";
import { needsSymlinks } from "./platform.mjs";
import { addWorktree, git, initWithCommit, scratch } from "./git-worktrees.mjs";

/** A repository with one commit, and a directory beside it to put worktrees in. */
function repo(t) {
  const parent = scratch(t);
  const main = join(parent, "main");
  mkdirSync(main);
  initWithCommit(main);
  return { parent, main };
}

test("a registered worktree names the checkout it was added from, wherever it sits", (t) => {
  const { parent, main } = repo(t);

  assert.equal(mainCheckoutOf(addWorktree(main, join(parent, "beside"))), main);
  // Claude Code's own layout puts the worktree inside the checkout it came from.
  assert.equal(mainCheckoutOf(addWorktree(main, join(main, ".claude", "worktrees", "w"))), main);
});

test("a checkout that is not a linked worktree names nothing", (t) => {
  const { parent, main } = repo(t);
  const plain = join(parent, "plain");
  mkdirSync(plain);

  assert.equal(mainCheckoutOf(main), null, "a main checkout");
  assert.equal(mainCheckoutOf(plain), null, "no repository at all");
});

test("git files spelled relative are read against where each one sits", (t) => {
  // `git worktree add --relative-paths`, and `worktree.useRelativePaths`, write
  // both halves of the link relative to the file holding them.
  const { parent, main } = repo(t);
  const wt = addWorktree(main, join(parent, "wt"));
  const own = join(main, ".git", "worktrees", "wt");
  writeFileSync(join(wt, ".git"), `gitdir: ${relative(wt, own)}\n`);
  writeFileSync(join(own, "gitdir"), `${relative(own, join(wt, ".git"))}\n`);

  assert.equal(mainCheckoutOf(wt), main);
});

test("registrations kept behind a link are still the repository's own", needsSymlinks, (t) => {
  // `commondir` holds `../..`, which git reads against the registration as it
  // is spelled; read against its real path it lands outside the repository.
  const { parent, main } = repo(t);
  const wt = addWorktree(main, join(parent, "wt"));
  const registrations = join(main, ".git", "worktrees");
  renameSync(registrations, join(parent, "registrations"));
  symlinkSync(join(parent, "registrations"), registrations, "dir");

  assert.equal(mainCheckoutOf(wt), main);
});

test("git reads the first line of the marker and nothing after it", (t) => {
  const { parent, main } = repo(t);
  const wt = addWorktree(main, join(parent, "wt"));
  writeFileSync(join(wt, ".git"), `not a pointer\n${readFileSync(join(wt, ".git"), "utf8")}`);

  assert.equal(mainCheckoutOf(wt), null);
});

test("a marker is followed only to a registration that points back at it", (t) => {
  const { parent, main } = repo(t);
  const real = addWorktree(main, join(parent, "real"));

  // A copy of a registered worktree's marker: the registration names the other one.
  const copy = join(parent, "copy");
  mkdirSync(copy);
  writeFileSync(join(copy, ".git"), readFileSync(join(real, ".git")));
  assert.equal(mainCheckoutOf(copy), null, "a copied marker");

  // A marker shipped beside a registration of its own that names another
  // repository as its common directory: an archive can carry all three files.
  const forged = join(parent, "forged");
  mkdirSync(join(forged, "reg"), { recursive: true });
  writeFileSync(join(forged, ".git"), "gitdir: ./reg\n");
  writeFileSync(join(forged, "reg", "gitdir"), `${join(forged, ".git")}\n`);
  writeFileSync(join(forged, "reg", "commondir"), `${join(main, ".git")}\n`);
  assert.equal(mainCheckoutOf(forged), null, "a forged registration");
});

test("a git directory that names no checkout lends nothing", (t) => {
  const { parent, main } = repo(t);

  // A submodule's git directory has no `commondir`: it is a repository of its own.
  const sub = join(parent, "sub");
  mkdirSync(sub);
  const modules = join(main, ".git", "modules", "sub");
  mkdirSync(modules, { recursive: true });
  writeFileSync(join(modules, "gitdir"), `${join(sub, ".git")}\n`);
  writeFileSync(join(sub, ".git"), `gitdir: ${modules}\n`);
  assert.equal(mainCheckoutOf(sub), null, "a submodule");

  // A bare repository has no checkout, even with a directory right above it.
  const bare = join(main, "bare.git");
  git(parent, "clone", "-q", "--bare", main, bare);
  assert.equal(mainCheckoutOf(addWorktree(bare, join(parent, "from-bare"))), null, "a bare repository's worktree");

  // `--separate-git-dir` moves the git directory out and names the checkout
  // only in its config, which is not read.
  const separate = join(parent, "separate");
  git(parent, "init", "-q", `--separate-git-dir=${join(parent, "separate-git")}`, separate);
  initWithCommit(separate);
  assert.equal(mainCheckoutOf(addWorktree(separate, join(parent, "from-separate"))), null, "a separated git directory");
});

test("a core.worktree redirect is not read, so the checkout named is the one git worktree list prints", (t) => {
  // Git itself resolves the main tree to the redirect; the directory on disk
  // that holds `.git` is the one a person has, and Claude Code refuses to work
  // in a worktree redirected this way anyway.
  const { parent, main } = repo(t);
  const wt = addWorktree(main, join(parent, "wt"));
  git(main, "config", "core.worktree", join(parent, "elsewhere"));

  assert.equal(mainCheckoutOf(wt), main);
});
