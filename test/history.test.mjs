import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import { needsFoldingFilesystem, needsPathControl, needsPosixPaths, needsPosixSpecialFiles, needsShebang, needsSymlinks, removeTree } from "./platform.mjs";

import { authorsByFile } from "../plugins/anatomiya/lib/authors.mjs";
import { walkCochange } from "../plugins/anatomiya/lib/cochange-walk.mjs";
import { runScan } from "../plugins/anatomiya/lib/commands.mjs";
import { HISTORY, HISTORY_FILES, configValue, historyFields, saveHistory } from "../plugins/anatomiya/lib/history.mjs";
import { EXCLUDE_LINES, STORE_DIR } from "../plugins/anatomiya/lib/rules.mjs";
import { READ_MOST } from "../plugins/anatomiya/lib/store.mjs";

/** A repository with the store's directory in place and excluded, as a scan leaves one. */
function repo(t, build) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-history-"));
  t.after(() => removeTree(dir));
  const make = tools(dir);
  make.git("init", "-q", "-b", "main");
  make.author("first@t.test");
  mkdirSync(join(dir, STORE_DIR), { recursive: true });
  appendFileSync(join(dir, ".git", "info", "exclude"), `${EXCLUDE_LINES.join("\n")}\n`);
  build(make);
  return dir;
}

function tools(dir) {
  // Each commit a minute after the last unless a test says when, so git's order is the test's to decide.
  let clock = Date.parse("2020-01-01T00:00:00Z");
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString();
  const write = (rel, body = `${rel}\n`) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  const author = (email) => {
    git("config", "user.email", email);
    git("config", "user.name", email.split("@")[0]);
  };
  const commit = (message, at = (clock += 60_000)) => {
    const when = new Date(at).toISOString();
    git("add", "-A");
    // An empty one is a commit too: a header with no row under it.
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", message], { cwd: dir, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
    return at;
  };
  return { dir, git, write, author, commit };
}

const flat = (map) => [...map].map(([path, emails]) => [path, [...emails]]);
const storeOf = (dir, kind) => join(dir, STORE_DIR, HISTORY_FILES[kind]);

/** One scan's read of the authors: the map, and what the walk said of its store. */
async function authorsWith(dir) {
  const history = {};
  const map = await authorsByFile(dir, { history });
  await saveHistory(dir, history);
  return { map, said: history.authors };
}

/** Renames, a rename back, a deleted path and a mailmap entry, with a branch left to merge. */
function storied({ git, write, author, commit }) {
  write(".mailmap", "One <one@t.test> <uno@t.test>\n");
  write("src/a.ts");
  write("src/gone.ts");
  commit("root");
  author("uno@t.test");
  git("mv", "src/a.ts", "src/b.ts");
  commit("rename");
  author("two@t.test");
  write("src/b.ts", "edited\n");
  git("rm", "-q", "src/gone.ts");
  const forked = commit("edit and delete");
  git("checkout", "-q", "-b", "side");
  author("side@t.test");
  write("src/side.ts");
  // Dated between the commits main makes next, so merged it lands among them in git's order.
  commit("side one", forked + 90_000);
  write("src/b.ts", "side edit\n");
  commit("side two", forked + 150_000);
  git("checkout", "-q", "main");
  author("three@t.test");
  git("mv", "src/b.ts", "src/a.ts");
  commit("rename back");
  write("docs/x.md");
  commit("docs");
}

test("a replay equals the full walk", async (t) => {
  const dir = repo(t, storied);
  const first = await authorsWith(dir);
  assert.deepEqual(flat(first.map), flat(await authorsByFile(dir)), "the walk that fills the store answers as today's");
  assert.deepEqual(first.said, { stored: 0, walked: 5, wrote: true });
  assert.ok(existsSync(storeOf(dir, "authors")));

  const { git, write, author, commit } = tools(dir);
  git("merge", "-q", "--no-ff", "side", "-m", "merge");
  author("four@t.test");
  write("src/a.ts", "after the merge\n");
  commit("after", Date.parse("2020-01-02T00:00:00Z"));

  const expected = await authorsByFile(dir);
  assert.deepEqual([...expected.get("src/a.ts")].sort(), ["first@t.test", "four@t.test", "one@t.test", "three@t.test", "two@t.test"]);
  // The side branch's edit is newer than the rename back, so git prints it first and it keeps the old name:
  // the answer depends on the order, which is why the order is asked of git every time.
  assert.deepEqual([...expected.get("src/b.ts")], ["side@t.test"]);
  // Newest first, each path under the name it holds when git prints it.
  const WHOLE = [
    ["src/a.ts", ["four@t.test", "three@t.test", "two@t.test", "one@t.test", "first@t.test"]],
    ["src/b.ts", ["side@t.test"]],
    ["docs/x.md", ["three@t.test"]],
    ["src/side.ts", ["side@t.test"]],
    ["src/gone.ts", ["two@t.test", "first@t.test"]],
    [".mailmap", ["first@t.test"]],
  ];
  assert.deepEqual(flat(expected), WHOLE);
  const replayed = await authorsWith(dir);
  // Insertion order too: every key and every set, as the full walk builds them.
  assert.deepEqual(flat(replayed.map), WHOLE);
  assert.deepEqual(replayed.said, { stored: 5, walked: 3, wrote: true }, "two side commits and one after, none of them a merge");

  const again = await authorsWith(dir);
  assert.deepEqual(flat(again.map), flat(expected));
  assert.deepEqual(again.said, { stored: 8, walked: 0, wrote: false }, "nothing new is nothing walked and nothing written");
  assert.equal(readFileSync(storeOf(dir, "authors")).length > 0, true);
});

test("a store that lacks more than half the history is passed over for the plain walk, which streams what a replay would hold", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("a.txt");
    commit("one");
    write("b.txt");
    commit("two");
  });
  assert.deepEqual((await authorsWith(dir)).said, { stored: 0, walked: 2, wrote: true });
  const { write, commit } = tools(dir);
  for (const n of [3, 4, 5]) {
    write(`f${n}.txt`);
    commit(`c${n}`);
  }
  const after = await authorsWith(dir);
  assert.deepEqual(flat(after.map), flat(await authorsByFile(dir)));
  assert.deepEqual(after.said, { stored: 0, walked: 5, wrote: true });
  // One commit more on a store that holds five is a replay again.
  write("g.txt");
  commit("c6");
  assert.deepEqual((await authorsWith(dir)).said, { stored: 5, walked: 1, wrote: true });
});

test("a changed .mailmap refuses the store", async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  // Not committed: git reads the working tree's, so no commit says the answer moved.
  writeFileSync(join(dir, ".mailmap"), "One <one@t.test> <uno@t.test>\nOne <one@t.test> <two@t.test>\n");

  const expected = await authorsByFile(dir);
  assert.equal(expected.get("src/a.ts").has("two@t.test"), false);
  const after = await authorsWith(dir);
  assert.deepEqual(flat(after.map), flat(expected));
  assert.deepEqual(after.said, { stored: 0, walked: 5, wrote: true });
  assert.deepEqual((await authorsWith(dir)).said, { stored: 5, walked: 0, wrote: false }, "and the store written under the new one is read");
});

test("a .mailmap that changed while the walk ran writes no store, and the store that was there stays", async (t) => {
  const dir = repo(t, storied);
  const mailmap = join(dir, ".mailmap");
  const committed = readFileSync(mailmap);
  // The walk has answered and the write has not run: where a change during the walk leaves a scan.
  const walkedThen = async (change) => {
    const history = {};
    await authorsByFile(dir, { history });
    change();
    await saveHistory(dir, history);
    return history.authors;
  };

  const first = await walkedThen(() => writeFileSync(mailmap, "One <one@t.test> <two@t.test>\n"));
  assert.deepEqual(first, { stored: 0, walked: 5, wrote: false });
  assert.equal(existsSync(storeOf(dir, "authors")), false);
  // Undone: the stamp is the walk's again, and nothing was sealed under it.
  writeFileSync(mailmap, committed);
  assert.deepEqual((await authorsWith(dir)).said, { stored: 0, walked: 5, wrote: true }, "the next scan walks whole");

  const kept = readFileSync(storeOf(dir, "authors"));
  const { write, commit } = tools(dir);
  write("src/late.ts");
  commit("late");
  const second = await walkedThen(() => writeFileSync(mailmap, "One <one@t.test> <two@t.test>\n"));
  assert.deepEqual(second, { stored: 5, walked: 1, wrote: false });
  assert.deepEqual(readFileSync(storeOf(dir, "authors")), kept);
});

/**
 * Each thing a commit's record depends on besides the commit: `before` sets the
 * repository up, the store is taken, `change` moves the one thing, and the
 * next read must come from git alone and answer as the plain walk does.
 */
const BESIDES = [
  { name: "a configuration key", change: ({ git }) => git("config", "diff.renameLimit", "1") },
  {
    name: "the bytes of the file mailmap.file names",
    before: ({ git }) => git("config", "mailmap.file", "people.map"),
    change: ({ write }) => write("people.map", "One <one@t.test> <two@t.test>\n"),
  },
  {
    name: "the blob mailmap.blob names",
    before: ({ git }) => {
      git("branch", "people");
      git("config", "mailmap.blob", "people:.mailmap");
    },
    change: ({ git, write, commit }) => {
      git("checkout", "-q", "people");
      write(".mailmap", "One <one@t.test> <three@t.test>\n");
      commit("people");
      git("checkout", "-q", "main");
    },
  },
  { name: "a replace ref", change: ({ git }) => git("replace", "--graft", "HEAD~1") },
  { name: "a graft", change: ({ dir, git }) => writeFileSync(join(dir, ".git", "info", "grafts"), git("rev-parse", "HEAD~1")) },
  { name: "the shallow file", change: ({ dir, git }) => writeFileSync(join(dir, ".git", "shallow"), git("rev-parse", "HEAD~1")) },
  {
    name: "a variable that hides the replace refs",
    before: ({ git }) => git("replace", "--graft", "HEAD~1"),
    change: (_, t) => {
      process.env.GIT_NO_REPLACE_OBJECTS = "1";
      t.after(() => delete process.env.GIT_NO_REPLACE_OBJECTS);
    },
  },
  {
    // The promisor flag sits in a section the stamp leaves out, and reaches it through the walk's own arguments.
    name: "the clone turning partial",
    before: ({ git }) => git("remote", "add", "origin", "https://example.invalid/x.git"),
    change: ({ git }) => git("config", "remote.origin.promisor", "true"),
  },
];

for (const { name, before = () => {}, change } of BESIDES) {
  test(`${name} refuses the store`, async (t) => {
    const dir = repo(t, storied);
    before(tools(dir));
    const taken = (await authorsWith(dir)).said;
    assert.equal(taken.wrote && taken.walked > 0, true);
    assert.equal((await authorsWith(dir)).said.stored, taken.walked, "read back before anything moves");

    change(tools(dir), t);
    const expected = await authorsByFile(dir);
    const after = await authorsWith(dir);
    assert.deepEqual(flat(after.map), flat(expected));
    assert.deepEqual(after.map.shallow, expected.shallow);
    assert.equal(after.said.stored, 0);
    assert.equal(after.said.wrote, true, "and the store is taken again under the new stamp");
  });
}

test("an edited diff.orderFile refuses the store: git prints a commit's rows in the order the file gives", async (t) => {
  const dir = repo(t, ({ write, commit }) => {
    write("src/a.ts");
    write("src/b.ts");
    commit("root");
  });
  // In the git directory, so no commit carries it.
  const order = join(dir, ".git", "order");
  writeFileSync(order, "src/b.ts\n");
  tools(dir).git("config", "diff.orderFile", order);
  const taken = await authorsWith(dir);
  assert.deepEqual([...taken.map.keys()], ["src/b.ts", "src/a.ts"]);
  assert.equal((await authorsWith(dir)).said.stored, 1, "read back before the file moves");

  writeFileSync(order, "src/a.ts\n");
  const expected = await authorsByFile(dir);
  assert.deepEqual([...expected.keys()], ["src/a.ts", "src/b.ts"], "the one commit's rows swap");
  const after = await authorsWith(dir);
  assert.deepEqual(flat(after.map), flat(expected));
  assert.deepEqual(after.said, { stored: 0, walked: 1, wrote: true });
});

test("a configuration key is looked up as git lists it: the section and the name in lower case, a subsection as written", () => {
  // As `config --list --null` prints them: a key, a newline, its value.
  const listed = ["diff.orderfile\n/first", "branch.Feature/X.Y.merge\nrefs/heads/x", "diff.orderfile\n/last"];
  assert.equal(configValue(listed, "diff.orderFile"), "/last");
  assert.equal(configValue(listed, "Branch.Feature/X.Y.Merge"), "refs/heads/x");
  assert.equal(configValue(listed, "branch.feature/x.y.merge"), undefined, "a subsection in another case is another key");
  assert.equal(configValue(listed, "diff.renames"), undefined);
});

/**
 * A rename git pairs only where it does not take the file for text: 40 short
 * CRLF lines, 16 of them edited, scores under half as text and 57% as bytes.
 */
function scored({ git, write, author, commit }) {
  git("config", "core.autocrlf", "false");
  const lines = (edited) => Array.from({ length: 40 }, (_, i) => (i < edited ? `x${i + 1}y\r\n` : `l${i + 1}\r\n`)).join("");
  write("a.txt", lines(0));
  commit("root");
  author("mover@t.test");
  git("mv", "a.txt", "b.txt");
  write("b.txt", lines(16));
  commit("rename and edit");
}

const PAIRED = [["b.txt", ["mover@t.test", "first@t.test"]]];
const UNPAIRED = [["a.txt", ["mover@t.test", "first@t.test"]], ["b.txt", ["mover@t.test"]]];

/** Where git reads an attribute from, each named with what `before` and `change` do to it. */
const ATTRIBUTES = [
  {
    // Staged: the entry in the index is what the stamp reads.
    name: "a staged .gitattributes",
    change: ({ git, write }) => {
      write(".gitattributes", "*.txt -diff\n");
      git("add", ".gitattributes");
    },
  },
  {
    // It covers no file of this history, and which files one covers is git's to say.
    name: "one below the root",
    change: ({ git, write }) => {
      write("deep/.gitattributes", "*.txt -diff\n");
      git("add", "deep/.gitattributes");
    },
    answers: UNPAIRED,
  },
  { name: "info/attributes", change: ({ dir }) => writeFileSync(join(dir, ".git", "info", "attributes"), "*.txt -diff\n") },
  {
    name: "the file core.attributesFile names",
    before: ({ git }) => git("config", "core.attributesFile", "mine.attributes"),
    change: ({ dir }) => writeFileSync(join(dir, "mine.attributes"), "*.txt -diff\n"),
  },
  {
    name: "the file git reads where that key is not set",
    before: (_, t) => {
      const was = process.env.XDG_CONFIG_HOME;
      const home = mkdtempSync(join(tmpdir(), "anatomiya-history-xdg-"));
      process.env.XDG_CONFIG_HOME = home;
      t.after(() => {
        if (was === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = was;
        rmSync(home, { recursive: true, force: true });
      });
    },
    change: () => {
      mkdirSync(join(process.env.XDG_CONFIG_HOME, "git"));
      writeFileSync(join(process.env.XDG_CONFIG_HOME, "git", "attributes"), "*.txt -diff\n");
    },
  },
  {
    name: "a variable that leaves the system's attributes out",
    change: (_, t) => {
      process.env.GIT_ATTR_NOSYSTEM = "1";
      t.after(() => delete process.env.GIT_ATTR_NOSYSTEM);
    },
    answers: UNPAIRED,
  },
  {
    name: "a variable that names the tree attributes are read from",
    change: (_, t) => {
      process.env.GIT_ATTR_SOURCE = "HEAD";
      t.after(() => delete process.env.GIT_ATTR_SOURCE);
    },
    answers: UNPAIRED,
  },
  {
    // Edited and not staged: the index entry stays as it was, and git reads the file.
    name: "the bytes on disk of a tracked .gitattributes below the root",
    before: ({ git, write }) => {
      write("deep/.gitattributes", "# none\n");
      git("add", "deep/.gitattributes");
    },
    change: ({ write }) => write("deep/.gitattributes", "*.txt -diff\n"),
    answers: UNPAIRED,
  },
  { name: "a .gitattributes at the root that git does not track", change: ({ write }) => write(".gitattributes", "*.txt -diff\n") },
  {
    // Where the file sits is built into git, so a git in front names another. The real one reads its own, and pairs nothing.
    name: "the system-wide file git names",
    needs: { ...needsShebang, ...needsPathControl },
    before: ({ dir }, t) => gitInFront(t, `case " $* " in *" var GIT_ATTR_SYSTEM "*) echo '${join(dir, ".git", "system.attributes")}'; exit 0;; esac`),
    change: ({ dir }) => writeFileSync(join(dir, ".git", "system.attributes"), "*.txt -diff\n"),
    answers: UNPAIRED,
  },
  ...["GIT_ATTR_SOURCE", "attr.tree"].map((source) => ({
    // The name stays as it is and the commit under it moves. Which git reads the source at all is its version's to say.
    name: `the commit behind the branch ${source} names`,
    before: ({ git }, t) => {
      git("branch", "attributes");
      if (source === "attr.tree") return git("config", source, "attributes");
      process.env[source] = "attributes";
      t.after(() => delete process.env[source]);
    },
    change: ({ git, write, commit }) => {
      git("checkout", "-q", "attributes");
      write(".gitattributes", "*.txt -diff\n");
      commit("attributes");
      git("checkout", "-q", "main");
    },
    answers: null,
  })),
];

for (const { name, needs = {}, before = () => {}, change, answers = PAIRED } of ATTRIBUTES) {
  test(`${name} refuses the authors store: an attribute decides whether a rename is paired`, needs, async (t) => {
    const dir = repo(t, scored);
    before(tools(dir), t);
    const taken = await authorsWith(dir);
    assert.deepEqual(flat(taken.map), UNPAIRED);
    assert.equal((await authorsWith(dir)).said.stored, taken.said.walked, "read back before anything moves");
    await changesWith(dir);

    change(tools(dir), t);
    const expected = await authorsByFile(dir);
    if (answers !== null) assert.deepEqual(flat(expected), answers);
    const after = await authorsWith(dir);
    assert.deepEqual(flat(after.map), flat(expected));
    assert.deepEqual(after.said, { stored: 0, walked: taken.said.walked, wrote: true });
    assert.equal((await authorsWith(dir)).said.stored, taken.said.walked, "and the store taken under that stamp is read");
    // That walk reads no content, so no attribute reaches it.
    assert.equal((await changesWith(dir)).said.stored, taken.said.walked);
  });
}

test("a working-tree .gitattributes that is a link is the plain walk for the authors: git reads no attribute through one", needsSymlinks, async (t) => {
  // The link leads to the bytes the file held, so the name is all that changed.
  const dir = repo(t, scored);
  tools(dir).write(".gitattributes", "*.txt -diff\n");
  assert.deepEqual(flat((await authorsWith(dir)).map), PAIRED);
  const written = readFileSync(storeOf(dir, "authors"));

  renameSync(join(dir, ".gitattributes"), join(dir, "attributes.real"));
  symlinkSync("attributes.real", join(dir, ".gitattributes"));
  assert.deepEqual(flat(await authorsByFile(dir)), UNPAIRED);
  await leftAlone(dir, written, "a link at the root");
});

test("a working-tree .mailmap that is a link is the plain walk: git maps no address through one", needsSymlinks, async (t) => {
  const dir = repo(t, storied);
  const mapped = await authorsWith(dir);
  assert.equal(mapped.map.get("src/a.ts").has("uno@t.test"), false);
  const written = readFileSync(storeOf(dir, "authors"));

  renameSync(join(dir, ".mailmap"), join(dir, "mailmap.real"));
  symlinkSync("mailmap.real", join(dir, ".mailmap"));
  assert.equal((await authorsByFile(dir)).get("src/a.ts").has("uno@t.test"), true);
  await leftAlone(dir, written, "a link at the root");
});

test("another git refuses the store", { ...needsShebang, ...needsPathControl }, async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-history-bin-"));
  t.after(() => removeTree(bin));
  const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$1" = version ]; then echo "git version 0.0.1"; exit 0; fi\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    assert.equal((await authorsWith(dir)).said.stored, 0);
  } finally {
    process.env.PATH = path;
  }
});

/** This build's lib in a directory of its own, as another version or with one line of the store's module changed. */
async function otherBuild(t, { version = "0.0.1", edit = (source) => source } = {}) {
  const lib = fileURLToPath(new URL("../plugins/anatomiya/lib", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "anatomiya-history-build-"));
  t.after(() => removeTree(root));
  cpSync(lib, join(root, "lib"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "anatomiya", version, type: "module" }));
  const source = readFileSync(join(lib, "history.mjs"), "utf8");
  writeFileSync(join(root, "lib", "history.mjs"), edit(source));
  const authors = await import(pathToFileURL(join(root, "lib", "authors.mjs")).href);
  const store = await import(pathToFileURL(join(root, "lib", "history.mjs")).href);
  return async (dir) => {
    const history = {};
    await authors.authorsByFile(dir, { history });
    await store.saveHistory(dir, history);
    return history.authors;
  };
}

test("another build, or another layout of the store, refuses the store", async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  const sameBuild = await otherBuild(t, { version: JSON.parse(readFileSync(new URL("../plugins/anatomiya/package.json", import.meta.url), "utf8")).version });
  assert.equal((await sameBuild(dir)).stored, 5, "a copy of this build reads this build's store");

  const newer = await otherBuild(t);
  assert.equal((await newer(dir)).stored, 0);

  await authorsWith(dir);
  const relaid = await otherBuild(t, {
    version: JSON.parse(readFileSync(new URL("../plugins/anatomiya/package.json", import.meta.url), "utf8")).version,
    edit: (source) => {
      assert.match(source, /^const LAYOUT = 1;$/m);
      return source.replace(/^const LAYOUT = 1;$/m, "const LAYOUT = 2;");
    },
  });
  assert.equal((await relaid(dir)).stored, 0);
});

test("a tracked store is never read", async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  const { git, commit } = tools(dir);
  // What a clone would bring: the repository's own choice of who touched what.
  git("add", "-f", join(STORE_DIR, HISTORY_FILES.authors));
  commit("commit the store");
  const committed = readFileSync(storeOf(dir, "authors"));

  const expected = await authorsByFile(dir);
  const after = await authorsWith(dir);
  assert.deepEqual(flat(after.map), flat(expected));
  assert.deepEqual(after.said, { stored: 0, walked: null, wrote: false }, "the plain walk, and no write into a file the repository commits");
  assert.deepEqual(readFileSync(storeOf(dir, "authors")), committed);
});

/**
 * Rewrite the store as somebody with an editor and gzip would: the stamp line,
 * the line holding the digest of the records, then the records. `sealed`
 * computes the digest again over what `edit` answers, as a careful forger would.
 */
function rewriteStore(dir, edit, { sealed = false } = {}) {
  const text = gunzipSync(readFileSync(storeOf(dir, "authors")));
  const stampEnd = text.indexOf(10);
  const digestEnd = text.indexOf(10, stampEnd + 1);
  const records = Buffer.from(edit(text.subarray(digestEnd + 1)));
  const digest = sealed ? Buffer.from(createHash("sha256").update(records).digest("hex")) : text.subarray(stampEnd + 1, digestEnd);
  writeFileSync(storeOf(dir, "authors"), gzipSync(Buffer.concat([text.subarray(0, stampEnd + 1), digest, Buffer.from("\n"), records])));
}

/** The store is refused: the answer is the plain walk's, every commit came from git, and the store is taken again. */
async function refused(dir) {
  const expected = await authorsByFile(dir);
  const after = await authorsWith(dir);
  assert.deepEqual(flat(after.map), flat(expected));
  assert.deepEqual(after.said, { stored: 0, walked: 5, wrote: true });
}

test("a store edited by hand is refused", async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  rewriteStore(dir, (records) => records);
  assert.equal((await authorsWith(dir)).said.stored, 5, "written back as it was, it is still read");

  // The same length, so every record still frames: one address for another on the commits `two` made.
  rewriteStore(dir, (records) => {
    const edited = records.toString("latin1").replaceAll("two@t.test", "bad@t.test");
    assert.notEqual(edited, records.toString("latin1"));
    return Buffer.from(edited, "latin1");
  });
  await refused(dir);

  const whole = readFileSync(storeOf(dir, "authors"));
  writeFileSync(storeOf(dir, "authors"), whole.subarray(0, whole.length - 9));
  await refused(dir);
  writeFileSync(storeOf(dir, "authors"), "not gzip at all\n");
  await refused(dir);
});

test("a store that ends before its two head lines is refused", async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  const text = gunzipSync(readFileSync(storeOf(dir, "authors")));
  // The stamp line and nothing after it, then part of a digest, then the whole head and no record.
  for (const kept of [text.indexOf(10) + 1, 100, 129, 130]) {
    writeFileSync(storeOf(dir, "authors"), gzipSync(text.subarray(0, kept)));
    await assert.doesNotReject(refused(dir), `${kept} bytes`);
  }
});

test("a store that is not records end to end is refused, however carefully it was sealed", async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  const frame = (sha, payload) => Buffer.from(`${sha} ${Buffer.byteLength(payload)}\n${payload}`);
  const firstOf = (records) => {
    const nl = records.indexOf(10);
    return records.subarray(0, nl + 1 + Number(records.latin1Slice(0, nl).split(" ")[1]));
  };
  const sealed = { sealed: true };
  rewriteStore(dir, (records) => records, sealed);
  assert.equal((await authorsWith(dir)).said.stored, 5, "sealed again as it was, it is still read");

  const SHAPES = {
    "a name that is no commit's": (records) => Buffer.concat([records, frame("Z".repeat(40), "\x1ebad@t.test\0\nA\0src/a.ts")]),
    "a name cut short": (records) => Buffer.concat([records, frame("a".repeat(39), "\x1ebad@t.test\0\nA\0src/a.ts")]),
    "a record running past the end": (records) => Buffer.concat([records, Buffer.from(`${"a".repeat(40)} 99\n\x1ebad@t.test`)]),
    "a commit recorded twice": (records) => Buffer.concat([records, firstOf(records)]),
    "a record that opens with no header": (records) => Buffer.concat([records, frame("a".repeat(40), "A\0src/a.ts")]),
    "bytes after the last record": (records) => Buffer.concat([records, Buffer.from("\n")]),
  };
  for (const [name, edit] of Object.entries(SHAPES)) {
    rewriteStore(dir, edit, sealed);
    await assert.doesNotReject(refused(dir), name);
  }
});

test("a store that is a link is not read, and the next one replaces the link", needsSymlinks, async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  const elsewhere = mkdtempSync(join(tmpdir(), "anatomiya-history-elsewhere-"));
  t.after(() => removeTree(elsewhere));
  const real = join(elsewhere, "store.gz");
  renameSync(storeOf(dir, "authors"), real);
  symlinkSync(real, storeOf(dir, "authors"));
  const before = readFileSync(real);

  await refused(dir);
  assert.equal(lstatSync(storeOf(dir, "authors")).isFile(), true, "the entry is replaced, not written through");
  assert.deepEqual(readFileSync(real), before);
});

test("a store directory that leads out of the repository's own .claude is neither read nor written", needsSymlinks, async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  const elsewhere = mkdtempSync(join(tmpdir(), "anatomiya-history-elsewhere-"));
  t.after(() => removeTree(elsewhere));
  renameSync(join(dir, STORE_DIR), join(elsewhere, "anatomiya"));
  symlinkSync(join(elsewhere, "anatomiya"), join(dir, STORE_DIR));
  const before = readFileSync(join(elsewhere, "anatomiya", HISTORY_FILES.authors));
  tools(dir).commit("one more");

  const after = await authorsWith(dir);
  assert.deepEqual(flat(after.map), flat(await authorsByFile(dir)));
  assert.deepEqual(after.said, { stored: 0, walked: null, wrote: false });
  assert.deepEqual(readFileSync(join(elsewhere, "anatomiya", HISTORY_FILES.authors)), before);

  // And one that started to lead out after the walk had asked: the write asks again.
  rmSync(join(dir, STORE_DIR));
  mkdirSync(join(dir, STORE_DIR));
  const history = {};
  await authorsByFile(dir, { history });
  rmSync(join(dir, STORE_DIR), { recursive: true });
  symlinkSync(join(elsewhere, "anatomiya"), join(dir, STORE_DIR));
  await saveHistory(dir, history);
  assert.deepEqual(history.authors, { stored: 0, walked: 6, wrote: false });
  assert.deepEqual(readFileSync(join(elsewhere, "anatomiya", HISTORY_FILES.authors)), before);
});

test("a directory at the store's name is not read, and the write that cannot replace it is no error", async (t) => {
  const dir = repo(t, storied);
  mkdirSync(join(storeOf(dir, "authors"), "inside"), { recursive: true });
  for (let scans = 0; scans < 2; scans++) {
    const after = await authorsWith(dir);
    assert.deepEqual(flat(after.map), flat(await authorsByFile(dir)));
    assert.equal(after.map.error, undefined);
    assert.deepEqual(after.said, { stored: 0, walked: 5, wrote: false });
  }
  assert.equal(statSync(join(storeOf(dir, "authors"), "inside")).isDirectory(), true);
  assert.deepEqual(readdirSync(join(dir, STORE_DIR)), [HISTORY_FILES.authors], "and no staged file is left beside it");
});

test("a fifo at the store's name is not waited on, and the next store replaces it", needsPosixSpecialFiles, async (t) => {
  const dir = repo(t, storied);
  execFileSync("mkfifo", [storeOf(dir, "authors")]);
  // Nobody writes to it, so an open that waited would never come back.
  await refused(dir);
  assert.equal(lstatSync(storeOf(dir, "authors")).isFile(), true);
});

test("a store packed past what the store directory reads whole is not read", async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  // The real store with one more record after it, sealed: a record of noise, which packs to no less than it is.
  const noise = randomBytes(READ_MOST);
  noise[0] = 0x1e;
  rewriteStore(dir, (records) => Buffer.concat([records, Buffer.from(`${"a".repeat(40)} ${noise.length}\n`), noise]), { sealed: true });
  assert.ok(statSync(storeOf(dir, "authors")).size > READ_MOST);
  await refused(dir);
});

test("a store git tracks under another letter case is this file where the volume folds case, and is never read", needsFoldingFilesystem, async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  const { git, commit } = tools(dir);
  const shouted = join(STORE_DIR, HISTORY_FILES.authors.toUpperCase());
  renameSync(storeOf(dir, "authors"), join(dir, shouted));
  git("add", "-f", shouted);
  commit("commit the store, shouted");
  const committed = readFileSync(storeOf(dir, "authors"));

  const after = await authorsWith(dir);
  assert.deepEqual(flat(after.map), flat(await authorsByFile(dir)));
  assert.deepEqual(after.said, { stored: 0, walked: null, wrote: false });
  assert.deepEqual(readFileSync(storeOf(dir, "authors")), committed);
});

test("a store that cannot be written is no error, and a fault that is not the disk's is not swallowed", async (t) => {
  const dir = repo(t, storied);
  const history = {};
  await authorsByFile(dir, { history });
  rmSync(join(dir, STORE_DIR), { recursive: true });
  await saveHistory(dir, history);
  assert.deepEqual(history.authors, { stored: 0, walked: 5, wrote: false });

  mkdirSync(join(dir, STORE_DIR));
  const broken = {};
  await authorsByFile(dir, { history: broken });
  // What the write reports through: with it gone the write itself works, and what follows is a bug.
  delete broken.authors;
  await assert.rejects(saveHistory(dir, broken), TypeError);

  // No allocation can be made to fail from a test, so each failure is raised where the write reports:
  // what V8 raises when memory runs out, a code Node gives one, and a code of Node's that is a fault here.
  const raised = async (fault) => {
    const history = {};
    // The write before this one landed, and a store that holds every commit leaves nothing to write.
    rmSync(storeOf(dir, "authors"), { force: true });
    await authorsByFile(dir, { history });
    history.authors = {
      set wrote(_) {
        throw fault;
      },
    };
    return saveHistory(dir, history);
  };
  await assert.doesNotReject(raised(new RangeError("Array buffer allocation failed")));
  await assert.doesNotReject(raised(Object.assign(new RangeError("Cannot create a Buffer larger than the maximum"), { code: "ERR_BUFFER_TOO_LARGE" })));
  await assert.rejects(raised(Object.assign(new RangeError("out of range"), { code: "ERR_OUT_OF_RANGE" })), RangeError);
});

const AUTHORS_WALK = { kind: "authors", renames: true, config: ["-c", "log.showRoot=true"], tip: [], walk: ["--no-merges"], diff: ["-M", "--name-status", "-z"], cap: [], env: process.env };

test("a replay its caller has stopped feeds no commit after the stop", async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  const whole = { fed: 0, history: {} };
  await historyFields(dir, AUTHORS_WALK, () => () => whole.fed++, { history: whole.history });
  assert.deepEqual(whole.history.authors, { stored: 5, walked: 0, wrote: false }, "this walk is the one the store was taken for");
  assert.ok(whole.fed > 5);

  const stop = new AbortController();
  let fed = 0;
  // Stopped once the order is in hand and before the first commit is fed.
  const open = () => {
    stop.abort();
    return () => fed++;
  };
  await assert.rejects(historyFields(dir, AUTHORS_WALK, open, { history: {}, signal: stop.signal }), /stopped by its caller/);
  assert.equal(fed, 0);
});

test("a store past the bound is neither inflated nor written", async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  const written = readFileSync(storeOf(dir, "authors"));
  assert.ok(gunzipSync(written).length > 300, "the fixture's store is past the bound this test sets");
  const was = HISTORY.mostBytes;
  HISTORY.mostBytes = 300;
  t.after(() => {
    HISTORY.mostBytes = was;
  });

  const after = await authorsWith(dir);
  assert.deepEqual(flat(after.map), flat(await authorsByFile(dir)));
  assert.deepEqual(after.said, { stored: 0, walked: 5, wrote: false }, "a store nobody would read is not written");
  assert.deepEqual(readFileSync(storeOf(dir, "authors")), written);

  // Exactly what the store holds now: it is read, and one more commit would take it past.
  HISTORY.mostBytes = gunzipSync(written).length;
  tools(dir).commit("one more");
  const grown = await authorsWith(dir);
  assert.deepEqual(flat(grown.map), flat(await authorsByFile(dir)));
  assert.deepEqual(grown.said, { stored: 5, walked: 1, wrote: false });
  assert.deepEqual(readFileSync(storeOf(dir, "authors")), written);

  HISTORY.mostBytes = was;
  assert.deepEqual((await authorsWith(dir)).said, { stored: 5, walked: 1, wrote: true });
});

test("a rewritten history replays the commits it still holds, and one with no commit left walks in full", async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  const { git, write, author, commit } = tools(dir);
  // The newest two commits replaced by one: theirs are in the store and no longer in the history.
  git("reset", "-q", "--hard", "HEAD~2");
  author("rewriter@t.test");
  write("src/b.ts", "rewritten\n");
  commit("rewritten");
  const trimmed = await authorsWith(dir);
  assert.deepEqual(flat(trimmed.map), flat(await authorsByFile(dir)));
  assert.deepEqual(trimmed.said, { stored: 3, walked: 1, wrote: true });
  assert.deepEqual((await authorsWith(dir)).said, { stored: 4, walked: 0, wrote: false }, "the store holds the history as it is now");

  // Every commit replaced: one with no parent, holding the same tree.
  git("checkout", "-q", "--orphan", "fresh");
  commit("squashed");
  const fresh = await authorsWith(dir);
  assert.deepEqual(flat(fresh.map), flat(await authorsByFile(dir)));
  assert.deepEqual(fresh.said, { stored: 0, walked: 1, wrote: true });
  assert.deepEqual((await authorsWith(dir)).said, { stored: 1, walked: 0, wrote: false });
});

/** A `git` ahead of the real one on PATH for this test: `script` runs first, with `$real` the git it stands in front of. */
function gitInFront(t, script) {
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-history-bin-"));
  const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  writeFileSync(join(bin, "git"), `#!/bin/sh\nreal='${real}'\n${script}\nexec "$real" "$@"\n`, { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  const restore = () => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
  };
  t.after(restore);
  return restore;
}

test("unreadable history still says so (F13)", async (t) => {
  const outside = mkdtempSync(join(tmpdir(), "anatomiya-history-nogit-"));
  t.after(() => removeTree(outside));
  const unread = await authorsWith(outside);
  assert.equal(unread.map.size, 0);
  assert.match(unread.map.error, /not a git repository/);
  assert.deepEqual(unread.said, { stored: 0, walked: null, wrote: false });

  const empty = repo(t, () => {});
  const none = await authorsWith(empty);
  assert.equal(none.map.size, 0);
  assert.equal(none.map.error, undefined, "an empty history is an answer, not a failure");
  assert.equal(none.said.wrote, false);
  assert.equal(existsSync(storeOf(empty, "authors")), false);

  // A store taken while the history could be read, and then a commit git can no longer open.
  const dir = repo(t, storied);
  await authorsWith(dir);
  const written = readFileSync(storeOf(dir, "authors"));
  const lost = tools(dir).git("rev-parse", "HEAD~2").trim();
  rmSync(join(dir, ".git", "objects", lost.slice(0, 2), lost.slice(2)));
  const expected = await authorsByFile(dir);
  assert.match(expected.error, /git log exited/);
  const broken = await authorsWith(dir);
  assert.equal(broken.map.error, expected.error, "the store does not stand in for a history git cannot read");
  assert.equal(broken.said.wrote, false);
  assert.deepEqual(readFileSync(storeOf(dir, "authors")), written);
});

test("a walk that fails leaves no store behind", { ...needsShebang, ...needsPathControl }, async (t) => {
  const dir = repo(t, storied);
  // Every field printed, and then an exit that says none of it was the answer.
  gitInFront(t, `case " $* " in *" log "*) "$real" "$@"; exit 3;; esac`);
  const failed = await authorsWith(dir);
  assert.match(failed.map.error, /git log exited 3/);
  assert.deepEqual(failed.said, { stored: 0, walked: null, wrote: false });
  assert.equal(existsSync(storeOf(dir, "authors")), false);
});

const ASKED_COMMITS = `case " $* " in *" --no-walk=unsorted "*)`;

test("a commit neither the store nor git accounts for exactly once is the full walk", { ...needsShebang, ...needsPathControl }, async (t) => {
  const NOT_ANSWERED = {
    "a git that prints nothing for the commits it was asked": `${ASKED_COMMITS} cat > /dev/null; exit 0;; esac`,
    "a git that prints each of them twice": `${ASKED_COMMITS} asked=$(cat); printf '%s\\n' "$asked" | "$real" "$@"; printf '%s\\n' "$asked" | "$real" "$@"; exit 0;; esac`,
    "a git that prints a commit nobody asked for": `${ASKED_COMMITS} { cat; "$real" rev-list --max-parents=0 HEAD; } | "$real" "$@"; exit 0;; esac`,
    "a git too old for the option": `${ASKED_COMMITS} echo "fatal: unrecognized argument: --no-walk=unsorted" >&2; exit 129;; esac`,
  };
  for (const [name, script] of Object.entries(NOT_ANSWERED)) {
    const dir = repo(t, storied);
    await authorsWith(dir);
    tools(dir).commit("one more");
    const expected = await authorsByFile(dir);
    const restore = gitInFront(t, script);
    const after = await authorsWith(dir);
    restore();
    assert.deepEqual(flat(after.map), flat(expected), name);
    assert.equal(after.map.error, undefined, name);
    assert.deepEqual(after.said, { stored: 0, walked: 6, wrote: true }, name);
  }
});

/** Nothing is replayed and nothing is kept: the plain walk answers, and the store on disk is left as it was. */
async function leftAlone(dir, written, name) {
  const expected = await authorsByFile(dir);
  const after = await authorsWith(dir);
  assert.deepEqual(flat(after.map), flat(expected), name);
  assert.deepEqual(after.said, { stored: 0, walked: null, wrote: false }, name);
  assert.deepEqual(readFileSync(storeOf(dir, "authors")), written, name);
}

test("a git that will not say what a record depends on, or whether the store is tracked, is the plain walk", { ...needsShebang, ...needsPathControl }, async (t) => {
  const SILENT = {
    "where its common directory is": `case " $* " in *" --git-common-dir "*) exit 129;; esac`,
    "what its configuration holds": `case " $* " in *" config --list "*) exit 129;; esac`,
    "which replace refs it holds": `case " $* " in *" for-each-ref "*) exit 129;; esac`,
    "whether the store is tracked": `case " $* " in *":(icase)"*) exit 129;; esac`,
    "which attribute files it tracks": `case " $* " in *".gitattributes"*) exit 129;; esac`,
    "what mailmap.blob names": `case " $* " in *" rev-parse --verify --quiet nothing:.mailmap "*) exit 128;; esac`,
    // 128 is git failing. 1 and 129 are its two ways of saying it names no such file.
    "where the system's attributes file is": `case " $* " in *" var GIT_ATTR_SYSTEM "*) exit 128;; esac`,
    "what attr.tree names": `case " $* " in *" rev-parse --verify --quiet main "*) exit 128;; esac`,
  };
  const dir = repo(t, storied);
  // No such object: git says so with exit code 1, and the walk reads no blob.
  tools(dir).git("config", "mailmap.blob", "nothing:.mailmap");
  tools(dir).git("config", "attr.tree", "main");
  await authorsWith(dir);
  const written = readFileSync(storeOf(dir, "authors"));
  for (const [name, script] of Object.entries(SILENT)) {
    const restore = gitInFront(t, script);
    await leftAlone(dir, written, name);
    restore();
  }
  assert.equal((await authorsWith(dir)).said.stored, 5, "and with a git that answers, the store is read again");
});

test("a mailmap this cannot read the way git does is the plain walk", async (t) => {
  const UNREAD = {
    "a home directory only git can expand": ({ git }) => git("config", "mailmap.file", "~nobody/people.map"),
    "a spelling only git reads": ({ git }) => git("config", "mailmap.file", ":(optional)people.map"),
    "a directory where the file should be": ({ git }) => git("config", "mailmap.file", "src"),
    "a file past eight mebibytes": ({ git, write }) => {
      git("config", "mailmap.file", "people.map");
      write("people.map", "#\n".repeat(4 * 1024 * 1024 + 1));
    },
  };
  for (const [name, change] of Object.entries(UNREAD)) {
    const dir = repo(t, storied);
    await authorsWith(dir);
    const written = readFileSync(storeOf(dir, "authors"));
    change(tools(dir));
    await leftAlone(dir, written, name);
  }
});

test("an attribute source this cannot read is the plain walk for the authors, and the co-change store is still kept", async (t) => {
  const tracked = ({ git, write }, rel) => {
    write(rel, "# none\n");
    git("add", rel);
  };
  const UNREAD = {
    "a directory where info/attributes should be": ({ dir }) => mkdirSync(join(dir, ".git", "info", "attributes")),
    // git for Windows dies on every command under this spelling, so there is no plain walk to hold the answer to.
    ...(process.platform === "win32" ? {} : { "a home directory only git can expand": ({ git }) => git("config", "core.attributesFile", "~nobody/attributes") }),
    "a path git expands from where it is installed": ({ git }) => git("config", "core.attributesFile", "%(prefix)/etc/gitattributes"),
    "a directory where the root's .gitattributes should be": ({ dir }) => mkdirSync(join(dir, ".gitattributes")),
    "a directory where a tracked .gitattributes was": (made) => {
      tracked(made, "deep/.gitattributes");
      rmSync(join(made.dir, "deep", ".gitattributes"));
      mkdirSync(join(made.dir, "deep", ".gitattributes"));
    },
    "more tracked .gitattributes than are read": (made) => {
      tracked(made, "one/.gitattributes");
      tracked(made, "two/.gitattributes");
      HISTORY.mostAttributeFiles = 1;
    },
    "an attr.tree that names no object": ({ git }) => git("config", "attr.tree", "nothing"),
    // `rev-parse` takes no `--`, and this one is an option it knows.
    "an attr.tree that reads as an option": ({ dir }) => appendFileSync(join(dir, ".git", "config"), "[attr]\n\ttree = --stdin\n"),
  };
  const most = HISTORY.mostAttributeFiles;
  const restore = () => {
    HISTORY.mostAttributeFiles = most;
  };
  t.after(restore);
  for (const [name, change] of Object.entries(UNREAD)) {
    const dir = repo(t, storied);
    await authorsWith(dir);
    const written = readFileSync(storeOf(dir, "authors"));
    change(tools(dir));
    await leftAlone(dir, written, name);
    assert.deepEqual((await changesWith(dir)).said, { stored: 0, walked: 5, wrote: true }, name);
    restore();
  }
});

test("a git that names no system-wide attributes file keeps a store all the same", { ...needsShebang, ...needsPathControl }, async (t) => {
  // 129 is a git older than the variable, and 1 a git told to read no such file.
  for (const code of [129, 1]) {
    const dir = repo(t, scored);
    const restore = gitInFront(t, `case " $* " in *" var GIT_ATTR_SYSTEM "*) exit ${code};; esac`);
    assert.deepEqual((await authorsWith(dir)).said, { stored: 0, walked: 2, wrote: true }, `exit ${code}`);
    assert.deepEqual((await authorsWith(dir)).said, { stored: 2, walked: 0, wrote: false }, `exit ${code}`);
    restore();
  }
});

test("with HOME empty the user's attributes file is the one git reads, under the filesystem's root", { skip: process.platform === "win32" && "an empty variable is no variable there" }, async (t) => {
  const was = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  t.after(() => {
    for (const [name, value] of Object.entries(was)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.HOME = "";
  delete process.env.XDG_CONFIG_HOME;
  const dir = repo(t, scored);
  await authorsWith(dir);
  // git joins the empty HOME to `/.config/git/attributes`. The same path under the repository is nobody's.
  mkdirSync(join(dir, ".config", "git"), { recursive: true });
  writeFileSync(join(dir, ".config", "git", "attributes"), "*.txt -diff\n");
  const expected = await authorsByFile(dir);
  assert.deepEqual(flat(expected), UNPAIRED, "git reads no attribute from it");
  const after = await authorsWith(dir);
  assert.deepEqual(flat(after.map), flat(expected));
  assert.deepEqual(after.said, { stored: 2, walked: 0, wrote: false });
});

test("a mailmap.blob that reads as an option is never handed to git, and is the plain walk", { ...needsShebang, ...needsPathControl }, async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  const written = readFileSync(storeOf(dir, "authors"));
  // `rev-parse` takes no `--`, and this one is an option it knows.
  appendFileSync(join(dir, ".git", "config"), "[mailmap]\n\tblob = --stdin\n");
  const asked = join(dir, ".git", "asked");
  gitInFront(t, `case " $* " in *" --verify --quiet --stdin "*) touch '${asked}'; exit 1;; esac`);
  await leftAlone(dir, written);
  assert.equal(existsSync(asked), false);
});

test("a line of the order that is no commit's name is the full walk, and nothing of the order reaches git", { ...needsShebang, ...needsPathControl }, async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  tools(dir).commit("one more");
  const expected = await authorsByFile(dir);
  const asked = join(dir, ".git", "asked");
  gitInFront(t, `case " $* " in *" rev-list "*) "$real" "$@"; echo "--all"; exit 0;; *" --no-walk=unsorted "*) cat > '${asked}'; exit 0;; esac`);
  const after = await authorsWith(dir);
  assert.deepEqual(flat(after.map), flat(expected));
  assert.deepEqual(after.said, { stored: 0, walked: 6, wrote: true });
  assert.equal(existsSync(asked), false, "the list was never handed over");
});

test("a mailmap that is a device and no file is the plain walk", needsPosixSpecialFiles, async (t) => {
  const dir = repo(t, storied);
  await authorsWith(dir);
  const written = readFileSync(storeOf(dir, "authors"));
  // It reads as empty, and for ever where it is another device: only a regular file is hashed.
  tools(dir).git("config", "mailmap.file", "/dev/null");
  await leftAlone(dir, written);
});

test("a path holding the separator is still a path, in the walk and in the store", needsPosixPaths, async (t) => {
  // The second one is spelled as a header would be, commit and all.
  const odd = ["src/we\x1eird.ts", `\x1e${"a".repeat(40)} forged@t.test`];
  const dir = repo(t, ({ git, write, commit }) => {
    write("src/a.ts");
    for (const path of odd) write(path);
    commit("root");
    git("mv", odd[0], "src/moved.ts");
    commit("rename one");
  });
  const expected = await authorsByFile(dir);
  assert.deepEqual([...expected.keys()].sort(), [odd[1], "src/a.ts", "src/moved.ts"].sort());
  assert.deepEqual([...expected.get(odd[1])], ["first@t.test"]);

  const first = await authorsWith(dir);
  assert.deepEqual(flat(first.map), flat(expected));
  assert.deepEqual(first.said, { stored: 0, walked: 2, wrote: true });
  const replayed = await authorsWith(dir);
  assert.deepEqual(flat(replayed.map), flat(expected));
  assert.deepEqual(replayed.said, { stored: 2, walked: 0, wrote: false });
});

test("an address holding the separator is the plain walk, since where the commit's name ends is then a guess", async (t) => {
  const dir = repo(t, ({ dir: at, git, write, author, commit }) => {
    write("src/a.ts");
    commit("root");
    write("src/b.ts");
    execFileSync("git", ["add", "-A"], { cwd: at });
    execFileSync("git", ["-c", "user.email=od\x1ed@t.test", "commit", "-qm", "odd"], { cwd: at, stdio: "pipe" });
    // Two newer commits, read before the odd one stops the read: a rename, then the old name made again.
    // A reader that kept what it had learned would follow that rename for the newest commit, which it must not.
    author("mover@t.test");
    git("mv", "src/a.ts", "src/c.ts");
    commit("rename");
    author("maker@t.test");
    write("src/a.ts", "made again\n");
    commit("the old name again");
  });
  const expected = await authorsByFile(dir);
  assert.deepEqual([...expected.get("src/b.ts")], ["od\x1ed@t.test"]);
  assert.deepEqual([...expected.get("src/a.ts")], ["maker@t.test"]);
  assert.deepEqual([...expected.get("src/c.ts")], ["mover@t.test", "first@t.test"]);
  const changes = await walkCochange(dir, tools(dir).git("rev-parse", "HEAD").trim());
  // Four commits. The reader opens a change at every separator, the one inside the address included.
  assert.equal(changes.read, 5);
  for (let scans = 0; scans < 2; scans++) {
    const after = await authorsWith(dir);
    assert.deepEqual(flat(after.map), flat(expected));
    assert.deepEqual(after.said, { stored: 0, walked: null, wrote: false });
    const walked = await changesWith(dir);
    assert.deepEqual(walked.walk, changes, "the changes read before the odd one are not counted twice");
    assert.deepEqual(walked.said, { stored: 0, walked: null, wrote: false });
  }
  assert.deepEqual(Object.keys(HISTORY_FILES).filter((kind) => existsSync(storeOf(dir, kind))), []);
});

/** One scan's read of the first-parent changes up to HEAD, and what the walk said of its store. */
async function changesWith(dir, tip = "HEAD") {
  const history = {};
  const walk = await walkCochange(dir, tools(dir).git("rev-parse", tip).trim(), { history });
  await saveHistory(dir, history);
  return { walk, said: history.cochange };
}

test("the co-change walk replays the same way: a merged branch is one change, read from git once", async (t) => {
  const dir = repo(t, storied);
  const tip = () => tools(dir).git("rev-parse", "HEAD").trim();
  const first = await changesWith(dir);
  assert.deepEqual(first.walk, await walkCochange(dir, tip()));
  assert.deepEqual(first.said, { stored: 0, walked: 5, wrote: true });
  assert.ok(existsSync(storeOf(dir, "cochange")));

  const { git, write, author, commit } = tools(dir);
  git("merge", "-q", "--no-ff", "side", "-m", "merge");
  author("four@t.test");
  write("src/new.ts");
  write("src/a.ts", "after the merge\n");
  commit("after", Date.parse("2020-01-02T00:00:00Z"));

  const expected = await walkCochange(dir, tip());
  assert.equal(expected.error, null);
  assert.equal(expected.read, 7, "five on main, the merge and the one after: the side branch's two are inside the merge");
  assert.deepEqual(expected.changes.slice(0, 2).map((c) => [c.author, c.added, c.touched]), [
    ["four@t.test", ["src/new.ts"], ["src/new.ts", "src/a.ts"]],
    ["three@t.test", ["src/side.ts"], ["src/side.ts", "src/a.ts"]],
  ]);
  // The root commit prints no row, so it is read and is no change.
  const WHOLE = {
    changes: [
      { bulk: false, author: "four@t.test", added: ["src/new.ts"], touched: ["src/new.ts", "src/a.ts"] },
      { bulk: false, author: "three@t.test", added: ["src/side.ts"], touched: ["src/side.ts", "src/a.ts"] },
      { bulk: false, author: "three@t.test", added: ["docs/x.md"], touched: ["docs/x.md"] },
      { bulk: false, author: "three@t.test", added: ["src/a.ts"], touched: ["src/a.ts"] },
      { bulk: false, author: "two@t.test", added: [], touched: ["src/b.ts"] },
      { bulk: false, author: "one@t.test", added: ["src/b.ts"], touched: ["src/b.ts"] },
    ],
    read: 7,
    bulk: 0,
    error: null,
  };
  assert.deepEqual(expected, WHOLE);
  const replayed = await changesWith(dir);
  assert.deepEqual(replayed.walk, WHOLE);
  assert.deepEqual(replayed.said, { stored: 5, walked: 2, wrote: true });
  const again = await changesWith(dir);
  assert.deepEqual(again.walk, expected);
  assert.deepEqual(again.said, { stored: 7, walked: 0, wrote: false });

  // The pin's walk stops at an older commit: the store answers for whichever tip is asked.
  const older = await changesWith(dir, "HEAD~1");
  assert.deepEqual(older.walk, await walkCochange(dir, tools(dir).git("rev-parse", "HEAD~1").trim()));
  assert.deepEqual(older.said, { stored: 6, walked: 0, wrote: false }, "and the newer commit's record is kept for the next walk from HEAD");
  assert.deepEqual((await changesWith(dir)).said, { stored: 7, walked: 0, wrote: false });

  // A commit with no parent, asked for by name: its diff is still every file it starts with, and still says nothing.
  git("checkout", "-q", "--orphan", "fresh");
  commit("squashed");
  const fresh = await changesWith(dir);
  assert.deepEqual(fresh.walk, { changes: [], read: 1, bulk: 0, error: null });
  assert.deepEqual(fresh.said, { stored: 0, walked: 1, wrote: true });
});

test("a scan keeps both stores, a dry run reads them and writes neither", async (t) => {
  const dir = repo(t, storied);
  rmSync(join(dir, ".claude"), { recursive: true });
  const stores = () => Object.keys(HISTORY_FILES).filter((kind) => existsSync(storeOf(dir, kind)));

  const dry = await runScan(dir, { dryRun: true });
  assert.deepEqual(dry.history, { authors: { stored: 0, walked: 5, wrote: false }, cochange: { stored: 0, walked: 5, wrote: false } });
  assert.equal(existsSync(join(dir, ".claude")), false, "a dry run leaves nothing, the stores included");

  const first = await runScan(dir);
  assert.deepEqual(first.history, { authors: { stored: 0, walked: 5, wrote: true }, cochange: { stored: 0, walked: 5, wrote: true } });
  assert.deepEqual(stores(), ["authors", "cochange"]);
  // Neither store is part of what a scan says it wrote: the plan and the summary are the map's.
  for (const name of Object.values(HISTORY_FILES)) assert.equal(JSON.stringify([first.plan, first.summary]).includes(name), false);

  tools(dir).commit("one more");
  const written = Object.keys(HISTORY_FILES).map((kind) => readFileSync(storeOf(dir, kind)));
  const again = await runScan(dir, { dryRun: true });
  assert.deepEqual(again.history, { authors: { stored: 5, walked: 1, wrote: false }, cochange: { stored: 5, walked: 1, wrote: false } });
  // What the dry run read from git is dropped with it: nothing is left for a later write to find.
  await saveHistory(dir, again.history);
  assert.deepEqual(Object.keys(HISTORY_FILES).map((kind) => readFileSync(storeOf(dir, kind))), written);
  const second = await runScan(dir);
  assert.deepEqual(second.history, { authors: { stored: 5, walked: 1, wrote: true }, cochange: { stored: 5, walked: 1, wrote: true } });
  assert.equal(second.result.authors.files, again.result.authors.files);
});
