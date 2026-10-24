# What a queue, a rename limit and a transcript head rest on

Research notes, October 2026. Seven facts outside this repository that anatomiya's code leans on:
how fast `Array.prototype.shift` drains a long queue, what git does past its rename limit and with
`--name-only`, what sits at the head of a Claude Code transcript, how Claude Code wraps rules and
hook context, whether a rename and an exclusive create are safe on each system, and how fine a
file's mtime is. Each claim below names where it comes from:

- **doc**: a first-party page, quoted, with its URL
- **read**: a first-party source file, with what to search for in it
- **ran**: a command run on this machine, with its version and output

Every page and file was read on 2026-10-24. Source files are from the branch or tag named. Line
numbers drift; the quoted text is what to search for. This machine: macOS 27.0.1 on arm64 (APFS),
Node v22.22.3 (V8 12.4.254.21-node.56), git 2.54.0 (Apple Git-157), Claude Code 2.1.310. Probes
sit outside the repository, under `/private/tmp/claude-502/research-0-17-1/`.

## 1. `Array.prototype.shift` on a long array

`shift` moves every remaining element down one slot unless V8 can move the start of the backing
store instead ("left-trim"). Left-trim is O(1). The copy is O(n), so draining a queue of n items
by `shift` is O(n^2) whenever left-trim is refused.

- **read** `src/builtins/array-shift.tq` (v8 tag 12.4.254.21): the fast path ends with
  `if (newLength > kMaxCopyElements) goto Runtime;`, and `src/objects/js-array.h` has
  `static const int kMaxCopyElements = 100;`. Up to 100 elements are copied inline; past that the
  runtime decides.
- **read** `src/objects/elements.cc` (same tag), search `kMaxCopyElements &&`: the runtime
  left-trims only where `len > JSArray::kMaxCopyElements && dst_index == 0 &&
  isolate->heap()->CanMoveObjectStart(dst_elms)`; otherwise it calls `MoveElements`, a copy of
  every remaining element. v8 main has the same branch in `RemoveElement`.
- **read** `src/heap/heap.cc` (same tag), `Heap::CanMoveObjectStart`: it returns false when
  `IsLargeObject(object)` (main spells it `HeapLayout::InAnyLargeSpace`), while the sampling heap
  profiler runs, while concurrent recompilation has jobs queued, during incremental marking, and
  while the page is still being swept.
- **read** `src/common/globals.h`: `kMaxRegularHeapObjectSize = (1 << (kPageSizeBits - 1))`, "half
  of the page size"; `src/base/build_config.h`: `kPageSizeBits = 18` on x64 and arm64 without huge
  pages, so any object above 128 KiB lives in large-object space.
- **ran** `node -p "process.config.variables.v8_enable_pointer_compression"` prints `0`: Node 22
  stores 8 bytes per element slot, so a backing store above about 16,380 slots is a large object
  and is never left-trimmed. A store grows past its length when it is filled by `push`, so the
  cliff can come below 16,380 elements.

**ran** `probes/shift.mjs`: fill an array with `{ i }` objects by `push`, then drain it by `shift`
or by walking a head index. Median of 5 runs:

```
node v22.22.3 v8 12.4.254.21-node.56 darwin-arm64
n        shift_ms  head_ms  (median of 5)
10000        1.06    0.105
16000       12.89    0.012
20000       22.19    0.015
50000      167.88    0.035
100000     687.19    0.089
```

Doubling n from 50k to 100k makes the drain about 4 times slower, the O(n^2) shape. At 10k the
store is a regular object and is left-trimmed. At 16k a push-grown store is already large.

**ran** anatomiya's own parse pool, `createPool({ size: 4 })` over a stub worker that answers at
once, every file queued before any worker is ready, on the same machine:

```
files    queue.shift  head index
10000         116 ms      113 ms
40000         761 ms      298 ms
80000       2,432 ms      572 ms
```

## 2. `diff.renameLimit` and `status.renameLimit`

- **doc** `Documentation/config/diff.adoc` (git master): "`diff.renameLimit`: The number of files
  to consider in the exhaustive portion of copy/rename detection; equivalent to the `git diff`
  option `-l`. If not set, the default value is currently 1000."
- **read** `diff.c` (git master): `static int diff_rename_limit_default = 1000;`, overwritten from
  `diff.renamelimit` in config, and applied where `options->rename_limit < 0`, so `-l` beats config.
- **read** `diffcore-rename.c`, `too_many_rename_candidates`: the test is
  `num_destinations * num_sources > rename_limit * rename_limit`, a square, not a count; `if
  (rename_limit <= 0) return 0; /* treat as unlimited */`; and `needed_rename_limit` is set to the
  larger of the two counts.
- **read** `diff.c`: the warning is `"exhaustive rename detection was skipped due to too many
  files."` followed by `"you may want to set your %s variable to at least %d and retry the
  command."`. The text is "exhaustive", not "inexact". `diff_warn_rename_limit` is called from
  `diff_result_code`, which only sets exit bits for `--exit-code` and `--check`. A skip changes
  neither.
- **doc** `Documentation/git.adoc`: `-c <name>=<value>` "The value given will override values
  from configuration files."
- **doc** `Documentation/config/status.adoc`: `status.renameLimit` "Defaults to the value of
  diff.renameLimit"; `status.renames` "Defaults to the value of diff.renames".

**ran** in a throwaway repository, three files each moved and given one extra line (`R099`):

```
$ git -c diff.renameLimit=1 diff --name-status HEAD~1 HEAD; echo "exit $?"
D	f1.txt
...
A	g3.txt
warning: exhaustive rename detection was skipped due to too many files.
warning: you may want to set your diff.renameLimit variable to at least 3 and retry the command.
exit 0
```

- The warnings go to stderr; stdout holds plain `D` and `A` rows.
- With `diff.renameLimit 1` in the repository's own config, `git -c diff.renameLimit=7000 diff`
  and `git diff -l7000` both print `R099` rows again. The command line wins.
- `-c diff.renameLimit=0` prints `R099` rows: zero means no limit.
- Three moves with no edit print `R100` even at limit 1. Exact renames are found before the limit
  is checked, so only edited moves fall back to `D` and `A`.
- `git -c status.renameLimit=1 status --porcelain` lists staged edited moves as `D` and `A` and
  prints no warning at all, in porcelain or long format. A skipped rename in `status` can only be
  seen from its rows.

## 3. `--name-only` and renames

- **doc** `Documentation/RelNotes/2.9.0.adoc`: "The end-user facing Porcelain level commands in the
  "git diff" and "git log" family by default enable the rename detection". Since git 2.9.0.
- **doc** `Documentation/config/diff.adoc`: `diff.renames` "Defaults to `true`. Note that this
  affects only `git diff` Porcelain like git-diff(1) and git-log(1), and not lower level commands
  such as git-diff-files(1)."
- **doc** `Documentation/diff-options.adoc`: `--name-only` "Show only the name of each changed file
  in the post-image tree"; `--no-renames` "Turn off rename detection, even when the configuration
  file gives the default to do so."
- **read** `diff.c`, search `DIFF_FORMAT_NAME) {`: the printer writes `p->two->path` only, the new
  side of the pair.

**ran**, same repository:

```
$ git diff --name-only HEAD~1 HEAD
g1.txt
g2.txt
g3.txt
$ git diff --name-only --no-renames HEAD~1 HEAD
f1.txt
f2.txt
f3.txt
g1.txt
g2.txt
g3.txt
```

So `--name-only` drops a rename's old path, and `--no-renames` (or `-c diff.renames=false`) brings
it back as a separate line. Past the rename limit, an edited move prints both names even without
`--no-renames`.

## 4. The head of a Claude Code transcript

The docs say nearly nothing about the file's shape.

- **doc** https://code.claude.com/docs/en/hooks, Common input fields: `transcript_path` is the "Path
  to conversation JSON. The transcript file is written asynchronously and may lag the in-memory
  conversation".

The rest is **ran**: scripts under `probes/` that print record types, key order, byte offsets and
sizes, never content. Over 14 days: 418 main-session transcripts and 2,739 subagent transcripts.

- Two head shapes, set by how the session started. A main transcript whose records name
  `entrypoint: "cli"` (interactive) starts `last-prompt`, `mode`, `permission-mode`, usually
  `atis-latch`, none of them stamped, and its first stamped record is a SessionStart
  `hook_success` attachment within the first 650 bytes. One with `entrypoint: "sdk-cli"` (`claude -p`)
  starts with a stamped `queue-operation` (`enqueue`) at byte 0. On the last 3 days every `cli`
  transcript (47) had the first shape and every `sdk-cli` one (105) the second.
- A subagent transcript starts with its prompt, a `user` record, at byte 0: 2,670 of 2,670 that had
  a stamped record.
- `timestamp` is not the last key. In a message record it follows `uuid` and comes before
  `rendered` and `renderedRole` (attachments), `toolUseResult` (tool results) or `advisorModel`
  (assistant turns). Records ending in `timestamp`: 71 of 25,348 over 3 days.
- `"timestamp":"` can also be a nested key: in 4 of 418 main transcripts the first match was inside
  a `file-history-snapshot`, not a record's own stamp.
- The first stamped record is small in most transcripts and very large in a few. Its size: median
  1,159 bytes, p99 6,712. The largest main-session one was a 167,657-byte `instructions`
  attachment on 2.1.296. The largest subagent one was a 127,278-byte prompt.
- Where the first record's own `"timestamp":"..."` ends, counted from byte 0: main median 86 bytes,
  max 84,036; subagent median 1,705, max 127,037. 1 main and 3 subagent transcripts end it past 64
  KiB. The `instructions` record's stamp sits mid-record, before `rendered` repeats its text.
- `instructions` records over 14 days: 319, median 93,699 bytes, max 189,549 (189,526 in a
  subagent), first seen at record index 4 or later.

Against `what-a-2-1-296-transcript-holds.md`, on 2.1.310: the two record families, the `rendered`
and `renderedRole` pair, and the text stored twice all still hold. `renderedRole` is `system` for
`hook_additional_context` and `user` for `instructions` and `nested_memory`.

## 5. How rules and hook context reach the model

- **doc** https://code.claude.com/docs/en/memory: "CLAUDE.md content is delivered as a user message
  after the system prompt, not as part of the system prompt itself." Path-scoped rules "only load
  into context when Claude works with matching files". The page says nothing about tags or
  escaping.
- **doc** https://code.claude.com/docs/en/hooks, Add context for Claude: "Claude Code wraps the
  string in a system reminder and inserts it into the conversation at the point where the hook
  fired." And: "If your string contains a `<system-reminder>` or `</system-reminder>` tag, Claude
  receives the string with that tag's `<` replaced by `&lt;`." Each string is "capped at 10,000
  characters"; past that the model gets "the file path and a preview of up to the first 2,000
  characters".

**ran** on this session's transcript: the `rendered` copy of `hook_additional_context`,
`instructions` and `nested_memory` is each one message whose content starts `<system-reminder>`
and ends `</system-reminder>`.

**ran** with a throwaway project and `claude -p --model haiku` on 2.1.310. A rule with no `paths`,
a `CLAUDE.md` and a path-scoped rule each held `</system-reminder>` and a forged
`<system-reminder>...</system-reminder>`; a UserPromptSubmit hook returned the same tags plus
`</my-tag>`. What `rendered` held:

| Source | Attachment | What the tag became |
|---|---|---|
| Hook `additionalContext` | `hook_additional_context` | `&lt;/system-reminder>`, `&lt;system-reminder>`; `</my-tag>` untouched |
| `CLAUDE.md` | `instructions` | unchanged: the block holds 2 opening and 4 closing tags |
| `.claude/rules/*.md` without `paths` | `instructions` | unchanged |
| `.claude/rules/*.md` with `paths`, on a matching Read | `nested_memory` | `<\/system-reminder>`, `<\system-reminder>` |

So hook context and path-scoped rules cannot close Claude Code's wrapper, while `CLAUDE.md` and a
rule loaded at launch can. No source escapes any other tag. A `</repository-map>` inside the text
anatomiya's hook wraps in `<repository-map>` reaches the model as written. These are the stored
`rendered` copies; that the request body matches them is the 2.1.296 note's reading, not traced
here.

## 6. A rename over a file, and an exclusive create

`what-windows-does-with-a-name-a-lock-and-a-pid.md` covers a rename over a file another process
holds open on Windows, sharing modes and pid checks. Not repeated here.

- **doc** POSIX `rename()`, https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html:
  "a directory entry named new shall remain visible to other threads throughout the renaming
  operation and refer either to the file referred to by new or old before the operation began";
  "If the rename() function fails for any reason other than [EIO], any file named by new shall be
  unaffected."
- **doc** Linux `rename(2)`, https://man7.org/linux/man-pages/man2/rename.2.html: "If newpath
  already exists, it will be atomically replaced, so that there is no point at which another
  process attempting to access newpath will find it missing." BUGS: "On NFS filesystems, you can
  not assume that if the operation failed, the file was not renamed."
- **ran** `man 2 rename` on macOS 27.0.1: "The rename() system call guarantees that an instance of
  new will always exist, even if the system should crash in the middle of the operation."
- **read** `src/win/fs.c` (libuv v1.x), `fs__rename`: `MoveFileExW(req->file.pathw,
  req->fs.info.new_pathw, MOVEFILE_REPLACE_EXISTING)`, nothing else. Not
  `SetFileInformationByHandle`.
- **doc** https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw:
  `MOVEFILE_REPLACE_EXISTING` "replaces its contents with the contents of the lpExistingFileName
  file"; to another volume the move needs `MOVEFILE_COPY_ALLOWED`, which libuv does not pass, and
  then "simulates the move by using the CopyFile and DeleteFile functions". The page never says
  "atomic".

`openSync(path, "wx")`:

- **doc** Node `doc/api/fs.md` (v22.x): `'wx'` is "Like `'w'` but fails if the path exists", and on
  Windows `O_EXCL|O_CREAT` maps "to `CREATE_NEW`, as accepted by `CreateFileW`". Also: "The
  exclusive flag might not work with network file systems."
- **read** libuv `src/win/fs.c`, `fs__open`: `case UV_FS_O_CREAT | UV_FS_O_EXCL: ... disposition =
  CREATE_NEW;`.
- **doc** POSIX `open()`, https://pubs.opengroup.org/onlinepubs/9799919799/functions/open.html:
  "The check for the existence of the file and the creation of the file if it does not exist shall
  be atomic with respect to other threads executing open() naming the same filename in the same
  directory with O_EXCL and O_CREAT set."
- **doc** Linux `open(2)`, https://man7.org/linux/man-pages/man2/open.2.html: "On NFS, O_EXCL is
  supported only when using NFSv3 or later on kernel 2.6 or later. In NFS environments where O_EXCL
  support is not provided, programs that rely on it for performing locking tasks will contain a
  race condition." The portable fallback it gives: create a unique file and `link(2)` it to the
  lock name, then trust a link count of 2.
- **ran** `man 2 open` on macOS: O_EXCL with O_CREAT "may be used to implement a simple
  exclusive-access locking mechanism", and fails on a symbolic link "even if the symbolic link
  points to a non-existent name". **ran** `probes/ino.mjs`: a second `openSync(path, "wx")` throws
  `EEXIST`.

On a local disk, on all three systems, a rename replaces in one step and `"wx"` is an exclusive
create. Over NFS neither promise is complete: a failed rename may have happened, and `"wx"` is
only exclusive from NFSv3 on.

## 7. How fine an mtime is, and whether a rename changes the inode

| File system | mtime unit | Source |
|---|---|---|
| HFS+ | 1 s | **doc** TN1150, https://developer.apple.com/library/archive/technotes/tn/tn1150.html: dates "are stored in unsigned 32-bit integers (UInt32) containing the number of seconds since midnight, January 1, 1904, GMT" |
| APFS | 1 ns | **doc** Apple File System Reference (2020-06-22), https://developer.apple.com/support/downloads/Apple-File-System-Reference.pdf, `j_drec_val_t`: "This timestamp is represented as the number of nanoseconds since January 1, 1970 at 0:00 UTC". **ran** below |
| ext4 | 1 ns with inodes over 128 bytes | **doc** https://docs.kernel.org/filesystems/ext4/inodes.html: "the upper 30 bits are used to provide nanosecond timestamp accuracy", where "`sb->s_inode_size` is larger than 128 bytes"; "By default, ext4 inode records are 256 bytes." |
| FAT | 2 s write, 10 ms create, 1 day access | **doc** https://learn.microsoft.com/en-us/windows/win32/sysinfo/file-times: "the resolution of create time on FAT is 10 milliseconds, while write time has a resolution of 2 seconds and access time has a resolution of 1 day" |
| NTFS | 100 ns unit | same page: "A file time is a 64-bit value that represents the number of 100-nanosecond intervals". Also: "the last write time is not fully updated until all handles that are used for writing are closed." |

A unit is not a tick. The page gives NTFS's unit, not how often the clock behind it moves.

The inode:

- **doc** POSIX `rename()` (above): after the call, new refers to "the file referred to by ...
  old". The name now points at the temporary file's inode.
- **read** libuv `src/win/fs.c`: `stat_info.FileId.QuadPart =
  file_info.InternalInformation.IndexNumber.QuadPart;` then `statbuf->st_ino =
  stat_info.FileId.QuadPart;`. On Windows `ino` is the file's index number, which belongs to the
  file, not the name.
- **ran** `probes/ino.mjs` on APFS:

```
ino before 1222180668n tmp 1222180669n after 1222180669n changed true after===tmp true
mtimeNs before 1792819788175299657n after 1792819788175423033n ns digits nonzero true
in-place write keeps ino true
```

A file replaced by rename takes the temporary file's inode. A write in place keeps the old one. A
check on `ino` therefore tells the two apart even where two writes share one mtime tick.

## What this changes for anatomiya

1. Any queue drained by `shift` that can pass about 16k items (`lib/pool.mjs`, `lib/revision.mjs`,
   `scripts/shipped.mjs`) is quadratic; a head index costs nothing.
2. `changeset.mjs` is right to pass `-c diff.renameLimit=` on the command line. The limit is a
   square (7000 allows 49M pairs). Exact moves survive any limit. Its skip warning names
   "exhaustive", and it never changes the exit code.
3. `status` never warns past `status.renameLimit`, so a skip there is only visible as `D` plus `A`
   rows. `--name-only` loses a rename's old path unless `--no-renames` is passed.
4. A 64 KiB head (`reuse.mjs` `TRANSCRIPT_HEAD`) finds the first stamp in 3,084 of the 3,088
   transcripts that had one. The rest are a huge first
   `instructions` record or subagent prompt with its stamp past 64 KiB. Interactive and `-p`
   sessions start differently, and a regex can match a nested `timestamp`.
5. The hook's echo and the path-scoped area files cannot close `<system-reminder>`, but
   `anatomiya-overview.md` (no `paths`) loads raw, and no tag but `system-reminder` is escaped
   anywhere, `</repository-map>` included.
6. On local disks, write-then-rename and `"wx"` locks are sound on all three systems. On NFS they
   are not guaranteed, and Node's own docs say so.
7. An mtime equality check can miss a change on HFS+ (1 s) and FAT (2 s). An `ino` change shows a
   rename-replace whatever the clock.

## Not settled

- How often Linux and Windows actually advance an mtime. ext4 stores nanoseconds and NTFS 100 ns
  units, but the kernel's file clock ticks more coarsely; no page read here gives the tick.
- Whether a ReFS file's 64-bit `IndexNumber` is unique. ReFS file IDs are 128-bit, and libuv reads
  the 64-bit field.
- Whether the API request carries the `rendered` text byte for byte. Only the transcript's copy was
  read.
