/**
 * Every git call this tool makes, and every reading of the NUL record grammars
 * it answers in.
 *
 * All of it existed four times over, and the copies had drifted: one runner
 * carried a 30s timeout, two carried 120s and one carried none at all, so a git
 * that never returned took the scan with it. The `--name-status -z` grammar was
 * three hand-rolled state machines, each with its own note that a rename is
 * three fields, and the porcelain grammar a fourth.
 *
 * Two entry points, because the split is real rather than incidental (F6).
 * `gitBuffered` is for callers that ask for one bounded thing at a time: a blob,
 * a ref, one diff. Every read that grows with the repository goes through
 * `gitStreamed`, because `execFile` throws `RangeError: Invalid string length`
 * from inside Node's own exit handler and `maxBuffer` does not protect against
 * it. Both carry the same battery: a timeout, a byte bound, and an exit code no
 * caller may read output without.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { devNull } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { MAX_FILE_BYTES } from "./limits.mjs";

const run = promisify(execFile);

export const GIT = {
  timeoutMs: 120_000,
  maxBytes: 64 * 1024 * 1024,
  // The check runs at review time, where a git that has stopped answering is
  // worth giving up on sooner than a scan would.
  checkTimeoutMs: 30_000,
  checkMaxBytes: 32 * 1024 * 1024,
};

// Enough to name the failure. Everything past it is the same message again.
const STDERR_CAP = 4096;

/**
 * Every option this tool passes to git, spelled out.
 *
 * `--` neutralises the whole argument-injection class where git accepts it, and
 * five of the plumbing commands here do not: `rev-parse`, `cat-file`,
 * `merge-base`, `config` and `status` take no separator, so a repository-
 * controlled value reaching one of those argument positions has nothing
 * standing between it and being read as an option. A tracked file named
 * `--instruction-file-path=.git/config` exfiltrated a secret through exactly
 * that shape.
 *
 * So the rule is stated from the other side: an argument that looks like an
 * option must be one this tool wrote. Every ref, sha and path is validated by
 * its own predicate before it gets here, and this is what makes a predicate
 * that was forgotten fail loudly rather than reach git.
 */
const FLAGS = new Set([
  "--",
  "-c",
  "-e",
  "-r",
  "-z",
  "-M",
  "-M100%",
  // `status` defaults to collapsing an untracked directory to one entry ending
  // in `/`, which names no file and is dropped by every path predicate here.
  "-uall",
  "--count",
  "--depth=1",
  "--exclude-standard",
  "--find-renames",
  // A submodule is a commit, not a file: the check listed one at a source-like
  // path and reported it as a file it could not read at HEAD.
  "--ignore-submodules=all",
  "--format",
  "--get",
  "--is-shallow-repository",
  "--max-parents=0",
  "--name-only",
  "--name-status",
  "--no-color",
  "--no-ext-diff",
  "--no-merges",
  "--no-textconv",
  "--others",
  "--porcelain",
  "--quiet",
  "--show-toplevel",
  "--unified=0",
  // The prefixes a diff is read with, fixed so a repository's config cannot move them.
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--verify",
  // What the refresh worker asks (`refresh.mjs`): the index with its modes and
  // blob ids for the stamp, where this checkout's git directory is, and whether
  // a pin is newer than HEAD; and what `pin` asks (`commands.mjs`): whether
  // tracked files carry edits.
  "-s",
  "--absolute-git-dir",
  "--untracked-files=no",
  "--is-ancestor",
  // A remote-tracking ref's full name and its newest reflog entry, so the
  // refresh can tell a tip this clone pushed from one a fetch brought.
  "--symbolic-full-name",
  "-n1",
  // Every reflog, and the first-parent line a pin would move along, so a
  // commit this clone made is never pinned because a fetch brought it back.
  "-g",
  "--all",
  "--first-parent",
  // HEAD's recent moves with the second each happened, for the end-of-turn
  // check on a repository whose reflog is not a file (`reuse.mjs`).
  "--max-count=256",
  "--date=unix",
  // Whether a merge has left the index with a path per stage, which `pin`
  // refuses to record (`commands.mjs`).
  "--unmerged",
  // Each path tagged with its index state, so `pin` sees the skip-worktree
  // paths a sparse checkout leaves out of the tree.
  "-t",
  // The same with assume-unchanged in lowercase, so the corpus reads a root
  // `.gitattributes` git treats as unchanged from the index (`corpus.mjs`).
  "-v",
  // The one read of a repository's own config that says which file each value
  // came from, so the commands it names can be replaced (`repositoryCommands`).
  "--show-scope",
  "--null",
  "--get-regexp",
  // Whether core.ignorecase folds case, as git itself parses the value.
  "--type=bool",
]);

// `--format=<pattern>` carries a pattern this tool composes; the value is not
// repository-controlled and does not belong in the set above one string at a
// time.
const FLAG_VALUES = ["--format="];

/**
 * The one argument this tool will not hand to git, and why.
 *
 * `null` when the call is safe to make.
 */
function refuse(args) {
  if (!Array.isArray(args) || args.length === 0) return "no git subcommand";
  for (const arg of args) {
    if (typeof arg !== "string") return `git argument is not a string: ${typeof arg}`;
    if (!arg.startsWith("-")) continue;
    if (FLAGS.has(arg) || FLAG_VALUES.some((p) => arg.startsWith(p))) continue;
    // A value that reached an argument position starting with a dash is either
    // a ref, a sha or a path that its own predicate should have refused.
    return `git argument reads as an option: ${arg.slice(0, 60)}`;
  }
  return null;
}

/**
 * The environment every git call runs in.
 *
 * A repository can name a promisor remote that makes git reach for credentials,
 * and a prompt on a terminal nobody is watching is a scan that never returns.
 * Refused rather than answered, which turns a hang into an exit code every
 * caller here already knows how to report.
 *
 * One variable and no more. `GIT_OPTIONAL_LOCKS=0` was the obvious neighbour and
 * is the wrong trade: it stops `status` refreshing the index, so a file whose
 * mtime moved without its content reads as dirty, and the check would report
 * uncommitted edits nobody made.
 */
function gitEnv(env, { lazyFetch = false, repository = NO_REPOSITORY_COMMANDS } = {}) {
  // Each of these rewrites what every pathspec means, and the pathspecs here spell their own magic.
  const { GIT_LITERAL_PATHSPECS, GIT_GLOB_PATHSPECS, GIT_NOGLOB_PATHSPECS, GIT_ICASE_PATHSPECS, ...rest } = env;
  return {
    ...rest,
    GIT_TERMINAL_PROMPT: "0",
    // A partial clone fetches a missing object from its promisor on demand, so
    // a read of a pinned blob reached the network and, with the remote gone,
    // came back unread (F14). Missing is the answer here, except where the
    // caller asks otherwise: the check's read of the merge base, whose blobs a
    // blobless clone never held, and without which every changed file was
    // skipped (F5). The other fetch this tool makes on purpose, the check's
    // shallow base, is an explicit `fetch` this does not touch.
    ...(lazyFetch ? {} : { GIT_NO_LAZY_FETCH: "1" }),
    // The transports git may use, which closes `ext::`. A repository shipped as
    // a tarball rather than cloned carries its own `.git/config`, and an
    // `ext::` remote URL is a shell command git runs to reach it: the check's
    // shallow path is the one place this tool talks to a remote at all, and it
    // reads that config to do it.
    //
    // Without `git` for a repository that names its own `core.gitProxy`: that
    // key is first-match-wins, so no entry after the repository's replaces it,
    // and the transport is the only thing it is ever run for.
    GIT_ALLOW_PROTOCOL: repository.noGitProtocol ? "file:http:https:ssh" : "file:git:http:https:ssh",
    // The same tarball's config can name commands git runs on a read. Measured:
    // `core.fsmonitor` set to a script in `.git/config` ran on every `status`
    // this tool made. Environment config is the one kind every subcommand
    // honours and a repository cannot override, since it sits above every
    // config file. The hooks go with it, because `fetch` runs
    // `reference-transaction`, and nothing this tool runs is owed a hook.
    // After them, the replacements for the commands this repository's own
    // config names (`repositoryCommands`).
    ...withConfig(env, [...NEUTRAL_CONFIG, ...repository.config]),
  };
}

const NEUTRAL_CONFIG = [
  ["core.fsmonitor", "false"],
  ["core.hooksPath", devNull],
  // Every `log` verifies each signed commit when this is on, whatever its
  // format, with the `gpg.program` the same config names. Measured: a
  // repository's program ran on a `log --format=%H`.
  ["log.showSignature", "false"],
  // A fetch that brings a commit moving a submodule fetches the submodule too,
  // from inside it and under its own config, which this process never read.
  // The check's fetch wants one commit of the superproject and nothing else.
  ["fetch.recurseSubmodules", "false"],
];

/**
 * The commands a repository's own config names, and what each is replaced with.
 *
 * A tarball carries its `.git/config`, and some keys there are commands git
 * runs on a read: a filter driver on any `status` or `diff` that hashes a file
 * its `.gitattributes` routes through it, and on the check's one fetch an ssh
 * command, credential helpers, an askpass, a `git://` proxy and an
 * alternate-refs command. The names under `filter.` are the repository's own
 * choice, so no fixed entry closes them; they are read instead, once per
 * repository per process, and only a value whose scope is `local` or
 * `worktree` is replaced. What the user set globally or on a command line is
 * what the replacement is, where there is one: their ssh wrapper, their
 * credential helpers and their filter drivers keep working.
 *
 * Measured on git 2.43 and 2.51: an empty filter command is no filter, and git
 * then reads the file as its bytes, provided the driver is not also marked
 * `required`; an empty `core.askPass` is none; an empty `credential.helper`
 * empties the list before it, so the helpers that are not the repository's
 * are listed again after it. The config read itself runs none of them.
 */
const REPOSITORY_COMMANDS =
  "^(filter\\..+\\.(clean|smudge|process)" +
  "|core\\.(sshcommand|askpass|gitproxy|alternaterefscommand)" +
  "|remote\\..+\\.uploadpack" +
  "|lfs\\.(extension\\..+\\.(clean|smudge)|customtransfer\\..+\\.path|standalonetransferagent)" +
  "|credential\\.(.+\\.)?helper)$";

const NO_REPOSITORY_COMMANDS = Object.freeze({ config: [], uploadPack: null, noGitProtocol: false });

const REPOSITORY_SCOPES = new Set(["local", "worktree"]);

/** `scope\0key\nvalue\0` per entry, from `config --show-scope --null`. */
function parseScopedConfig(out) {
  const fields = String(out ?? "").split("\0");
  const entries = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [scope, pair] = [fields[i], fields[i + 1]];
    const nl = pair.indexOf("\n");
    // A key with no `=` has no value, which none of these keys can use.
    if (nl === -1) continue;
    entries.push({ scope, key: pair.slice(0, nl), value: pair.slice(nl + 1) });
  }
  return entries;
}

// The exact commands `git lfs install --local` writes. They run the user's own
// installed `git-lfs`, found on their PATH, and not a script the repository
// ships; replaced, every LFS file whose stat moved read as changed and `pin`
// refused a clean tree. Anything else under the `lfs` name is the repository's.
const STANDARD_LFS = new Map([
  ["filter.lfs.clean", new Set(["git-lfs clean -- %f"])],
  ["filter.lfs.smudge", new Set(["git-lfs smudge -- %f", "git-lfs smudge --skip -- %f"])],
  ["filter.lfs.process", new Set(["git-lfs filter-process", "git-lfs filter-process --skip"])],
]);
const isStandardLfs = (e) => STANDARD_LFS.get(e.key)?.has(String(e.value ?? "").trim()) === true;

/**
 * The environment entries that replace what `entries` names from the
 * repository, the upload-pack to name on the command line, and whether the
 * `git://` transport is closed for this repository.
 */
function replacementsFor(entries, env) {
  // git-lfs reads this config as well, and runs an extension or transfer
  // command it names, so a repository naming one gets no git-lfs at all,
  // whoever's filter would have started it.
  const lfsCommand = entries.some((e) => REPOSITORY_SCOPES.has(e.scope) && e.key.startsWith("lfs."));
  const ours = entries.filter((e) => REPOSITORY_SCOPES.has(e.scope) && (lfsCommand || !isStandardLfs(e)));
  if (ours.length === 0) return NO_REPOSITORY_COMMANDS;
  const theirs = entries.filter((e) => !REPOSITORY_SCOPES.has(e.scope));
  // Last one wins for every single-valued key here, as git reads them.
  const userValue = (key) => theirs.findLast((e) => e.key === key)?.value;
  const config = [];
  const done = new Set();
  const replace = (key, value) => {
    if (done.has(key)) return;
    done.add(key);
    config.push([key, value]);
  };
  let credentials = false;
  let uploadPack = null;
  let noGitProtocol = false;
  if (lfsCommand) {
    for (const kind of ["clean", "smudge", "process"]) replace(`filter.lfs.${kind}`, "");
    replace("filter.lfs.required", "false");
  }

  for (const { key } of ours) {
    const filter = /^filter\.(.+)\.(clean|smudge|process)$/.exec(key);
    if (filter) {
      const value = userValue(key);
      replace(key, value ?? "");
      // Required and empty is a failed filter, and git refuses the read.
      if (value === undefined) replace(`filter.${filter[1]}.required`, "false");
    } else if (key === "core.sshcommand") {
      // With no value of the user's, what git would run without one: their
      // `GIT_SSH`, which git runs without a shell, or `ssh`.
      replace(key, userValue(key) ?? (env.GIT_SSH ? shellQuote(env.GIT_SSH) : "ssh"));
    } else if (key === "core.askpass") {
      replace(key, userValue(key) ?? "");
    } else if (key === "core.alternaterefscommand") {
      // No refs from the alternate, which only makes a fetch negotiate with
      // fewer of the commits it already holds.
      replace(key, userValue(key) ?? "true");
    } else if (key === "core.gitproxy") {
      noGitProtocol = env.GIT_PROXY_COMMAND === undefined;
    } else if (/^remote\..+\.uploadpack$/.test(key)) {
      // The first one configured wins, so an entry after the repository's is
      // refused with "more than one uploadpack given" and the repository's
      // runs. Only the command line outranks it.
      uploadPack = "git-upload-pack";
    } else if (/^credential\.(.+\.)?helper$/.test(key)) {
      credentials = true;
    }
  }
  if (credentials) {
    config.push(["credential.helper", ""]);
    for (const e of theirs) if (/^credential\.(.+\.)?helper$/.test(e.key)) config.push([e.key, e.value]);
  }
  return { config, uploadPack, noGitProtocol, theirs };
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

// Bounded, because a long-lived process can be handed any number of roots.
const REPOSITORY_CACHE_MOST = 64;
const repositoryCache = new Map();

/**
 * What decides which config a git sees besides the repository: where the
 * global and system files are, the command-line entries, and which git.
 */
function configSources(env) {
  return JSON.stringify(
    Object.entries(env ?? {})
      .filter(([k]) => k.startsWith("GIT_") || k === "HOME" || k === "XDG_CONFIG_HOME" || k === "PATH")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
}

/**
 * The replacements for `root`, read once per repository and environment per
 * process. `{ unread }` when git would not say, which the runners refuse the call
 * over: a read that cannot tell which commands the repository names cannot
 * promise none of them runs.
 */
function repositoryCommands(root, env, timeout) {
  const key = `${resolve(root)}\0${configSources(env)}`;
  const known = repositoryCache.get(key);
  if (known) return known;
  const asked = run("git", ["config", "--show-scope", "--null", "--get-regexp", REPOSITORY_COMMANDS], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout,
    env: gitEnv(env),
  }).then(
    ({ stdout }) => replacementsFor(parseScopedConfig(stdout), env),
    // Exit 1 is no key matched. Anything else is kept as what went wrong, so
    // the call it stopped can say so.
    (err) => {
      if (err && err.code === 1 && !err.killed) return NO_REPOSITORY_COMMANDS;
      const how = err && (err.signal || err.code);
      const said = String(err?.stderr || err?.message || "").trim().slice(0, STDERR_CAP);
      return { unread: `git config exited ${how ?? "abnormally"}: ${said}` };
    }
  ).then((answer) => {
    if (answer.unread) repositoryCache.delete(key);
    return answer;
  });
  repositoryCache.set(key, asked);
  if (repositoryCache.size > REPOSITORY_CACHE_MOST) repositoryCache.delete(repositoryCache.keys().next().value);
  return asked;
}

/**
 * The call as it is made: the caller's arguments with what this repository
 * needs said on the command line, and the environment with its replacements.
 *
 * Two things only the command line can say. A `remote.<name>.uploadpack` is
 * first-match-wins in config, so `fetch` and `ls-remote` name git's own. And a
 * `status` or a `diff` of the working tree runs git inside every populated
 * submodule to ask whether it is dirty, under the submodule's own config,
 * whose filter drivers this process never read; `--ignore-submodules=dirty`
 * still reports a submodule whose commit moved, and a caller's own
 * `--ignore-submodules` comes after it and wins. It is also the only spelling
 * that outranks a `submodule.<name>.ignore` in the repository's config.
 * Inserted after the arguments `refuse` has passed, since they are this
 * tool's own.
 */
async function prepared(root, args, env, { lazyFetch, timeout }) {
  const repository = await repositoryCommands(root, env, timeout);
  if (repository.unread) return { unread: repository.unread };
  let at = 0;
  while (args[at] === "-c") at += 2;
  const sub = args[at];
  const extra = [];
  if (sub === "status" || sub === "diff") extra.push("--ignore-submodules=dirty");
  if (repository.uploadPack && (sub === "fetch" || sub === "ls-remote")) {
    const remote = args.slice(at + 1).find((a) => !a.startsWith("-"));
    // The user's own, where they configured one: git would have used it,
    // since theirs is read before the repository's.
    const mine = repository.theirs?.find((e) => e.key === `remote.${remote}.uploadpack`)?.value;
    extra.push(`--upload-pack=${mine ?? repository.uploadPack}`);
  }
  return {
    args: extra.length ? [...args.slice(0, at + 1), ...extra, ...args.slice(at + 1)] : args,
    // A lazy fetch is git's own child, reading the upload-pack from config with
    // no command line of ours, so where the repository names one the object
    // stays missing instead.
    env: gitEnv(env, { lazyFetch: lazyFetch && !repository.uploadPack, repository }),
  };
}

function unreadConfig(call) {
  return `could not read which commands this repository's config names (${call.unread})`;
}

/**
 * The `GIT_CONFIG_COUNT` entries a caller already carries, with these after
 * them so that they win. Replacing the count instead dropped the caller's own,
 * which is somebody else's `-c` for every git this process starts. A count git
 * would refuse as bogus is read as none, since git would then refuse every call.
 */
function withConfig(env, entries) {
  const given = String(env?.GIT_CONFIG_COUNT ?? "").trim();
  const count = /^\d+$/.test(given) && Number.isSafeInteger(Number(given)) ? Number(given) : 0;
  const out = { GIT_CONFIG_COUNT: String(count + entries.length) };
  entries.forEach(([key, value], i) => {
    out[`GIT_CONFIG_KEY_${count + i}`] = key;
    out[`GIT_CONFIG_VALUE_${count + i}`] = value;
  });
  return out;
}

/**
 * Every call reports its exit code beside its output, and no caller may read
 * stdout without looking at `ok`.
 *
 * `git merge-base` exits 1 with empty stdout and no stderr when the two commits
 * have no common ancestor. Code that captures stdout alone cannot tell that from
 * a successful answer, and passes "" downstream as if it were a sha.
 */
export async function gitBuffered(
  root,
  args,
  { encoding = "utf8", maxBytes = GIT.maxBytes, timeout = GIT.timeoutMs, env = process.env, lazyFetch = false } = {}
) {
  const refused = refuse(args);
  if (refused) {
    return {
      ok: false,
      code: null,
      oversize: false,
      stdout: encoding === "buffer" ? Buffer.alloc(0) : "",
      error: refused,
    };
  }
  const call = await prepared(root, args, env, { lazyFetch, timeout });
  if (call.unread) {
    return { ok: false, code: null, oversize: false, stdout: encoding === "buffer" ? Buffer.alloc(0) : "", error: unreadConfig(call) };
  }
  try {
    const { stdout } = await run("git", call.args, {
      cwd: root,
      encoding,
      maxBuffer: maxBytes,
      timeout,
      env: call.env,
    });
    return { ok: true, code: 0, oversize: false, stdout, error: null };
  } catch (err) {
    const message = String((err && err.message) || err);
    return {
      ok: false,
      code: err && typeof err.code === "number" ? err.code : null,
      oversize: /maxBuffer/.test(message),
      // A call that failed answered part of a question at best, and the whole
      // point of reporting `ok` is that the part is never read as the answer.
      stdout: encoding === "buffer" ? Buffer.alloc(0) : "",
      error: message,
    };
  }
}

/**
 * The magic a pathspec needs to match as this repository folds case: git keeps
 * the index spelling and matches pathspecs case-sensitively even under core.ignorecase.
 */
export async function caseMagic(root) {
  const r = await gitBuffered(root, ["config", "--type=bool", "--get", "core.ignorecase"]);
  return r.ok && r.stdout.trim() === "true" ? "icase" : "";
}

/**
 * The other entry point: output read off the stream, one NUL-delimited field at
 * a time (F6).
 */
export function gitStreamed(
  root,
  args,
  onField,
  { terminated = true, timeout = GIT.timeoutMs, env = process.env, maxFieldBytes = GIT.maxBytes, lazyFetch = false } = {}
) {
  const refused = refuse(args);
  if (refused) return Promise.reject(new Error(refused));
  return prepared(root, args, env, { lazyFetch, timeout }).then((call) => new Promise((fulfil, reject) => {
    if (call.unread) return reject(new Error(`git ${args[0]}: ${unreadConfig(call)}`));

    const child = spawn("git", call.args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      env: call.env,
    });
    let rest = Buffer.alloc(0);
    let stderr = "";
    let stopped = false;
    let settled = false;

    // A caller that has seen enough gets the child killed rather than the rest
    // of the listing read and thrown away, on the repositories where the
    // listing is largest.
    const stop = () => {
      stopped = true;
      rest = Buffer.alloc(0);
      if (child.pid && !child.killed) child.kill("SIGKILL");
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      stop();
      reject(err);
    };

    // Capped, because stderr grows with the repository the same way stdout
    // does and the message only has to name the failure.
    child.stderr.on("data", (chunk) => {
      if (stderr.length < STDERR_CAP) stderr += chunk.toString("utf8");
    });

    child.stdout.on("data", (chunk) => {
      if (stopped) return;
      let buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      try {
        let at;
        while ((at = buf.indexOf(0)) !== -1) {
          const field = buf.subarray(0, at).toString("utf8");
          buf = buf.subarray(at + 1);
          if (onField(field) === false) return stop();
        }
      } catch (err) {
        // Throwing out of a stream handler would leave the promise pending and
        // the child alive.
        return fail(err);
      }
      // What is left is one record still arriving. Unbounded, it grows to V8's
      // string limit and throws from a place no caller can catch, which is the
      // failure streaming exists to avoid.
      if (buf.length > maxFieldBytes) {
        return fail(new Error(`git ${args[0]} sent one record past ${maxFieldBytes} bytes`));
      }
      rest = buf;
    });

    child.on("error", (err) => fail(new Error(`git ${args[0]} failed: ${err.message}`)));

    child.on("close", (code, signal) => {
      if (settled) return;
      // A walk this caller ended is not a walk that failed, however the killed
      // child exits.
      if (stopped) {
        settled = true;
        return fulfil();
      }
      // A caller of a stream has already been handed part of the output, so
      // the only way to say "that was not the answer" is to refuse the whole
      // read (F13, F15).
      if (code !== 0) return fail(new Error(`git ${args[0]} exited ${signal || code}: ${stderr.trim()}`));
      // Whether a leftover is the final record or a cut-off one is a fact about
      // the command, not about the caller: `ls-files -z` terminates every entry
      // and `log --format=` terminates none of them.
      if (rest.length) {
        if (terminated) return fail(new Error(`git ${args[0]} output ended mid-record`));
        // Guarded for the same reason the record loop is, and in the one branch
        // that runs after the child has gone: an escaping throw is an uncaught
        // exception beside a promise that never settles.
        try {
          onField(rest.toString("utf8"));
        } catch (err) {
          return fail(err);
        }
      }
      settled = true;
      fulfil();
    });
  }));
}

/**
 * The `--name-status` grammar, read one field at a time.
 *
 * `-z` because git permits newlines in a path, and a newline split would turn
 * one hostile filename into two entries. A rename or a copy record is three
 * NUL-separated fields, everything else is two.
 *
 * A reader rather than a parse over a whole string, because every caller
 * streams: a diff listing grows with the repository exactly as `ls-files` does,
 * two distant commits differ in every path, and `execFile` answers a listing
 * that large with `RangeError: Invalid string length` from inside Node's own
 * exit handler, where no caller can catch it. So the state an index would have
 * carried lives in a closure, and there is one reading of what the fields mean.
 *
 * A record left half-arrived when the stream ends is dropped rather than
 * completed: emitting the field that came would name a file the diff never
 * reported.
 */
export function nameStatusReader(onRow) {
  let status = null;
  let from = null;
  return (field) => {
    if (status === null) {
      // A delimiter run rather than a record. `-z` terminates every field, so
      // the split yields a trailing empty one.
      if (field) status = field;
      return true;
    }
    const renamed = status[0] === "R" || status[0] === "C";
    if (renamed && from === null) {
      from = field;
      return true;
    }
    const row = { status, from: renamed ? from || null : null, to: field };
    status = null;
    from = null;
    // A record whose path never arrived names no file, and naming an empty one
    // is worse than losing the record the cap already cost.
    if (!row.to) return true;
    return onRow(row) !== false;
  };
}

/**
 * The paths `git status --porcelain -z` reports as dirty.
 *
 * The other NUL grammar, and the second place a rename is an extra field: a
 * record is `XY <path>`, and a rename or a copy is followed by its origin as a
 * bare field. Read as another record it counts the rename twice and takes the
 * three status characters off the old name.
 *
 * Beside `nameStatusReader` rather than in the check, so the note that a rename
 * carries two paths lives once for both of git's spellings of it.
 */
export function parsePorcelainRows(out) {
  const fields = String(out ?? "").split("\0");
  const rows = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    // Git's own XY: X is the index against HEAD, Y is the tree against the
    // index. A caller that has to know whether the path is still on disk reads
    // both, because either letter alone answers about one half of the move.
    const row = { x: field[0], y: field[1], path: field.slice(3), orig: null };
    // A rename writes the new path with its letters and then the old path
    // bare. Dropping that second field loses where the file's committed
    // version lives, and a caller comparing against it then has nothing.
    if (/[RC]/.test(field.slice(0, 2))) row.orig = fields[++i] ?? null;
    rows.push(row);
  }
  return rows;
}


/* --- the plumbing every phase reads a repository through --- */

/**
 * Reading a repository, separated from deciding what the reading means. A base
 * ref has nothing to do with a baseline, and both phases resolve one.
 */

// A sha reaches a git argument, so it is validated as a sha rather than trusted
// as a string: a pin file is a repository-controlled input like any other.
export function isSha(sha) {
  // Up to 64 digits: a repository made with `--object-format=sha256` names
  // every object that way, and a 40-digit ceiling read its HEAD as none.
  return typeof sha === "string" && /^[0-9a-f]{7,64}$/.test(sha);
}

// A ref name cannot begin with a dash. `rev-parse` takes revisions before any
// `--`, so a ref of `--upload-pack=...` would be read as an option; a tracked
// file with that name already exfiltrated a secret through the same class of
// argument elsewhere.
function safeRef(ref) {
  return typeof ref === "string" && ref.length > 0 && !ref.startsWith("-");
}

/**
 * Is the baseline commit still in this repository at all?
 *
 * Squash-merge-to-main is the common workflow, not the edge: the branch's
 * commits never land, and after the branch is deleted the pinned sha names an
 * object that no longer exists. Every caller checks this before reading a blob,
 * and drops to counts-only when it fails (E3).
 */
export async function shaReachable(root, sha) {
  if (!isSha(sha)) return false;
  const r = await gitBuffered(root, ["cat-file", "-e", `${sha}^{commit}`]);
  return r.ok;
}

/**
 * The commit a pin would record. Never a ref name: a pin holds a sha because a
 * branch moves and the population it named would move with it.
 */
export async function headSha(root) {
  return commitAt(root, "HEAD");
}

/** The commit `ref` names, or null where it names none. */
export async function commitAt(root, ref) {
  const r = await gitBuffered(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  const sha = r.ok ? r.stdout.trim() : "";
  return isSha(sha) ? sha : null;
}

/**
 * The contents of one path as of the baseline commit (E2).
 *
 * Never the working tree. Reading the working tree makes the baseline and the
 * current population the same numbers, so an agent that edits three of fourteen
 * baseline files moves the baseline it is being measured against.
 *
 * `git cat-file blob` is `git show <sha>:<path>` with the object type asserted,
 * so a path that has since become a directory errors instead of quietly
 * yielding a tree listing that would then be parsed as source.
 *
 * An empty file returns ok with empty content; an absent path returns not-ok.
 * The two must never collapse into the same value.
 *
 * The read gives up at exactly the size the parser skips at, which is what makes
 * a blob this refuses one the parse would have refused anyway.
 *
 * The clock is the caller's. The scan and the check do not agree about how long
 * to wait on a stalled git, and this is the check's most frequent call.
 */
export async function showBlob(root, sha, path, { timeout, env, lazyFetch = false } = {}) {
  if (!isSha(sha)) return { ok: false, reason: "bad sha" };
  const r = await gitBuffered(root, ["cat-file", "blob", `${sha}:${path}`], {
    encoding: "buffer",
    maxBytes: MAX_FILE_BYTES,
    lazyFetch,
    ...(timeout === undefined ? {} : { timeout }),
    ...(env === undefined ? {} : { env }),
  });
  if (r.ok) return { ok: true, content: r.stdout };
  return { ok: false, reason: r.oversize ? "over size cap" : "absent" };
}

/**
 * The merge base of two commits, with the three outcomes kept apart: found,
 * genuinely no common ancestor (exit 1, empty stdout, no stderr), and the
 * command failing for some other reason.
 */
export async function mergeBase(root, a, b) {
  if (!safeRef(a) || !safeRef(b)) return { found: false, failed: true, sha: null };
  const r = await gitBuffered(root, ["merge-base", a, b]);
  if (r.ok) {
    const sha = r.stdout.trim();
    return { found: sha.length > 0, failed: false, sha: sha || null };
  }
  return { found: false, failed: r.code !== 1, sha: null };
}

const UNFINISHED_OPERATIONS = Object.freeze([
  "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG", "rebase-merge", "rebase-apply", "index.lock",
]);

/**
 * Whether git has left an operation unfinished in `gitdir`. The tree then holds
 * a state that exists only until the operation completes: the other side's work
 * mid-merge, a commit a bisect is visiting, an index being written. One test,
 * because the refresh and the end-of-turn check each kept their own and the two
 * had already drifted apart.
 */
export function operationUnfinished(gitdir) {
  return UNFINISHED_OPERATIONS.some((name) => existsSync(join(gitdir, name)));
}

/**
 * The refs a base is looked for in, in order. `origin/HEAD` names the remote's
 * default branch, which is what a change is actually reviewed against.
 *
 * `@{upstream}` is deliberately absent: a pushed feature branch tracks itself,
 * and the merge base of HEAD with itself is HEAD.
 */
export const BASE_REFS = ["origin/HEAD", "origin/main", "origin/master", "main", "master"];

/**
 * The commit the change under review is built on.
 *
 * Never HEAD (E6). Over `<baseline>..HEAD` the branch's own edits count as map
 * drift, so a claim's reported staleness rises with the size of the change
 * being reviewed and bundling more files into a branch walks it past the
 * threshold. The literal ref is refused rather than quietly accepted.
 *
 * This is the only base resolver: scan and check measuring drift against
 * different refs is two different answers to one question.
 */
export async function resolveBaseRef(root, ref = null) {
  if (ref === "HEAD" || ref === "@") {
    return { ok: false, reason: "base ref must not be HEAD" };
  }
  if (ref !== null && !safeRef(ref)) {
    return { ok: false, reason: `not a ref name: ${ref}` };
  }

  const tried = ref ? [ref] : BASE_REFS;
  for (const candidate of tried) {
    const sha = await commitAt(root, candidate);
    if (!sha) continue;

    // The fork point, where one exists, so the branch's own commits sit outside
    // the range. Unrelated histories fall back to the ref tip rather than to "".
    const base = await mergeBase(root, "HEAD", sha);
    return { ok: true, ref: candidate, sha: base.found ? base.sha : sha, forkPoint: base.found };
  }
  return { ok: false, reason: ref ? `cannot resolve ${ref}` : "no base branch found" };
}

/**
 * Paths whose working-tree content differs from `sha`.
 *
 * Everything tracked and absent from this set is byte-identical to the commit,
 * so its baseline parse and its corpus parse are the same parse. Without this
 * the baseline stage re-reads and re-parses the whole population through one
 * `git cat-file` process per file, which measured 6.9s against 1.4s to parse
 * the entire corpus, on a repository where nothing had changed at all.
 *
 * `null` rather than an empty set when git will not answer: an empty set claims
 * every file is unchanged, which is the unsafe direction.
 */
export async function changedSinceWorktree(root, sha) {
  if (!safeRef(sha)) return null;
  // No `--find-renames`: a rename lands here as both paths, and both are then
  // materialised rather than reused. Cheap, and it keeps the reuse rule simple.
  //
  // Streamed, because the listing grows with the repository: a pin far enough
  // behind the working tree differs in every path.
  return pathSet(root, ["diff", "--name-only", "-z", sha, "--"]);
}

/**
 * Every path a NUL-terminated listing names, or `null` if git would not answer.
 *
 * `null` rather than an empty set: an empty set is a real answer meaning "no
 * paths", and every caller here reads that as a population it can trust.
 */
async function pathSet(root, args, opts = {}) {
  const paths = new Set();
  // Undefined keys fall back to the runner's own defaults, so a caller that
  // does not care never has to name a budget.
  const bounded = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
  try {
    await gitStreamed(root, args, (rel) => {
      if (rel) paths.add(rel);
      return true;
    }, bounded);
  } catch {
    return null;
  }
  return paths;
}

/**
 * Every tracked path at one commit, or `null` when git would not answer.
 *
 * A file-to-file obligation is answered by which files exist, so measuring it
 * against the baseline needs the baseline's file list and not the working
 * tree's.
 *
 * `null` rather than an empty set, for the reason the diff answers null: an
 * empty set is a real answer meaning "no files", and the obligation reads it as
 * "no companion exists anywhere", so every changed producer on the branch owes
 * a file that is sitting right there. A map stating the obligation puts those
 * at MUST-FIX against an author who wrote the companion.
 */
export async function filesAt(root, sha, { timeout, maxFieldBytes } = {}) {
  if (!safeRef(sha)) return null;
  // Streamed: this listing grows with the repository exactly as `ls-files`
  // does, and that is the read `execFile` answers with a `RangeError` thrown
  // from inside Node's own exit handler.
  //
  // The rev goes before the separator: git reads anything past `--` as a path.
  return pathSet(root, ["ls-tree", "-r", "--name-only", "-z", sha, "--"], { timeout, maxFieldBytes });
}

/**
 * Renames and changed paths between two commits, in one pass.
 *
 * NUL-delimited because git permits newlines in paths, the same reason the
 * corpus is collected with `ls-files -z`. Rename records arrive as three
 * fields, everything else as two.
 */
export async function diffRange(root, from, to) {
  // `${from}..` puts a leading dash at the head of the argument, where git
  // reads it as an option.
  if (!safeRef(from) || !safeRef(to)) return null;

  const renames = new Map();
  const changed = new Set();

  // Streamed for the same reason the two listings above are: the range between
  // a pin and a distant base names every path in the repository.
  try {
    await gitStreamed(
      root,
      ["diff", "--find-renames", "--name-status", "-z", `${from}..${to}`, "--"],
      nameStatusReader((row) => {
        changed.add(row.to);
        // Both names count as changed: at the pinned commit only the old one
        // exists, and the map is what lets a renamed file find its own baseline
        // instead of reading as greenfield.
        if (row.from) {
          renames.set(row.to, row.from);
          changed.add(row.from);
        }
        return true;
      })
    );
  } catch {
    return null;
  }

  return { renames, changed };
}
