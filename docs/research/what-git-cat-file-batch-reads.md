# What git cat-file --batch reads: the delimiters, the reply bytes, and what a reader must not assume

Research notes, October 2026. The tool reads baseline files today with one `git cat-file blob
<sha>:<path>` process per file (`showBlob` in `plugins/anatomiya/lib/git.mjs`). The question is
what one long-lived `git cat-file --batch` child per run would read instead, byte for byte, and
where it would differ from the per-file read. Each claim carries an evidence label:

- **measured**: an empirical result with numbers behind it
- **vendor claim**: a first-party statement by a tool maker about its own product
- **folklore**: widely reported by practitioners, not yet measured

Every **vendor claim** below is git's own text: a release note under `Documentation/RelNotes/`, the
manual page `Documentation/git-cat-file.txt` (renamed `.adoc` by v2.56.0), or the C source at a
named tag, read from a `--filter=blob:none` clone of `https://github.com/git/git` whose `master`
was at `6de20f6092dc` (2026-10-06). Every **measured** result is this machine's git, `git version
2.54.0 (Apple Git-157)` at `/usr/bin/git`, run from Node 22 against throwaway repositories under
`$TMPDIR/catfile-research/`. Apple's build is a vendor patch of upstream 2.54.0, so the source
quoted at `v2.54.0` is upstream's and the bytes are Apple's. They agreed on every case below.

## Summary

`-z` (NUL-terminated input) arrived in git 2.38.0 (October 2022). `-Z` (NUL-terminated input and
output) arrived in git 2.42.0 (August 2023), and the same change marked `-z` deprecated because its
output "can otherwise be ambiguous". Every runner this repository's CI uses, and this machine, has
git 2.54 or newer, so `-Z` is available everywhere the tool is tested. Nothing in this repository
states a minimum git version.

A found object replies `<oid> SP <type> SP <size> LF <contents> LF`. Under `-Z` both LFs become NUL.
The contents are sized, so a reader parses the header up to its first terminator, reads exactly
`<size>` bytes whatever they hold, then consumes one terminator byte. A missing object, a `<rev>`
that does not resolve, and a path absent at that rev all reply `<input> SP missing` and a
terminator. An ambiguous short id replies `<input> SP ambiguous` and also writes hints to stderr. A
path that names a directory replies a tree, not an error, so the reader must check the type is
`blob`, which `git cat-file blob` asserts for it today.

Line input (plain `--batch`) cannot reach a path holding a newline, and silently strips a trailing
CR, so it reads a different file (or none) for a path ending in `\r`. `-Z` reaches both. Tab,
leading `-`, leading space, trailing space, backslash and non-ASCII bytes all read correctly in
every mode, because stdin is not argv and the default format takes the whole line as the name.
A leading `./` is not a literal: git resolves it against the child's working directory.

`--batch` applies no textconv, no filter driver and no `eol` conversion. Its contents equal `git
cat-file blob` byte for byte, proven on a repository with a smudge filter and `eol=crlf`.

`--buffer` must not be used by a reader that writes one request and waits. On this build a blob's
reply arrives except its last terminator byte, and a tree's reply does not arrive at all, until
stdin closes. A child killed mid-reply shows the reader a short body and then end of stream, with
`close` reporting the signal. Closing stdin makes git answer every queued request and exit 0.

## 1. When `-z` and `-Z` arrived, and what each does

**vendor claim**, `Documentation/RelNotes/2.38.0.txt` (tag `v2.38.0`, 2022-10-02):

> Operating modes like "--batch" of "git cat-file" command learned to take NUL-terminated input,
> instead of one-item-per-line.

https://github.com/git/git/blob/v2.38.0/Documentation/RelNotes/2.38.0.txt

The commit is `db9d67f2e` "builtin/cat-file.c: support NUL-delimited input with `-z`", merged as
`tb/cat-file-z` (`git log v2.37.0..v2.38.0 -- builtin/cat-file.c`). The manual page at `v2.38.0`
adds:

> -z:: Only meaningful with `--batch`, `--batch-check`, or `--batch-command`; input is
> NUL-delimited instead of newline-delimited.

https://github.com/git/git/blob/v2.38.0/Documentation/git-cat-file.txt. At `v2.37.0` the page has
no `-z` entry.

**vendor claim**, `Documentation/RelNotes/2.42.0.txt` (tag `v2.42.0`, 2023-08-21):

> "git cat-file --batch" and friends learned "-Z" that uses NUL delimiter for both input and
> output. (merge f79e18849b ps/cat-file-null-output later to maint).

https://github.com/git/git/blob/v2.42.0/Documentation/RelNotes/2.42.0.txt

The manual page at `v2.42.0` adds `-Z` and rewrites `-z`:

> -Z:: Only meaningful with `--batch`, `--batch-check`, or `--batch-command`; input and output is
> NUL-delimited instead of newline-delimited.
>
> -z:: Only meaningful with `--batch`, `--batch-check`, or `--batch-command`; input is
> NUL-delimited instead of newline-delimited. This option is deprecated in favor of `-Z` as the
> output can otherwise be ambiguous.

https://github.com/git/git/blob/v2.42.0/Documentation/git-cat-file.txt. The same two entries read
the same at `v2.56.0` (`Documentation/git-cat-file.adoc`, lines 273 to 282). Its BATCH OUTPUT
section says what `-Z` changes: "when `-Z` is passed, the line feeds in any of the above examples
are replaced with NUL terminators. This ensures that output will be parsable if the output itself
would contain a linefeed and is thus recommended for scripting purposes."

**vendor claim**, the source, `builtin/cat-file.c` at `v2.54.0`, lines 1180 to 1184: both
delimiters start as `'\n'`, `-z` sets only `input_delim` to `'\0'`, and `-Z` sets both. Both
refuse to run without a batch mode (lines 1173 to 1179, "'-z' requires a batch mode").

## 2. The reply bytes, and how a reader must use the size

**vendor claim**, BATCH OUTPUT at `v2.56.0`
(https://github.com/git/git/blob/v2.56.0/Documentation/git-cat-file.adoc): "the whole line is
considered as an object, as if it were fed to linkgit:git-rev-parse[1]". With `--batch` "the
object information is followed by the object contents (consisting of `%(objectsize)` bytes),
followed by a newline", shown as `<oid> SP <type> SP <size> LF` then `<contents> LF`. A name that
"cannot be resolved to an object" prints `<object> SP missing LF`; one that "might refer to more
than one object (an ambiguous short sha)" prints `<object> SP ambiguous LF`. Both ignore any custom
format.

**measured**, one request per child, stdout as a JSON string, in a repository whose `HEAD` holds a
file `plain` with the bytes `plain\n` and a directory `sub/` with one file `f`:

| request | `--batch` reply | `--batch -Z` reply |
|---|---|---|
| found, `HEAD:plain` | `"b9bca019...dde1b3 blob 6\nplain\n\n"` | `"b9bca019...dde1b3 blob 6\u0000plain\n\u0000"` |
| path absent, `HEAD:nope` | `"HEAD:nope missing\n"` | `"HEAD:nope missing\u0000"` |
| rev absent, `nosuchrev:plain` | `"nosuchrev:plain missing\n"` | `"nosuchrev:plain missing\u0000"` |
| ambiguous, `9233` | `"9233 ambiguous\n"` | `"9233 ambiguous\u0000"` |
| directory, `HEAD:sub` | `"c08e37b6...a603f8 tree 29\n<29 binary bytes>\n"` | same, NUL for each LF |

All exit 0. The ambiguous case was made by writing 600 blobs with `git hash-object -w --stdin`
until two shared a prefix (`92331fe` and `923361c`). It also wrote to stderr: `error: short object
ID 9233 is ambiguous`, then `hint: The candidates are:` and one hint line per candidate. `git
cat-file blob 9233` exits 128 with the same text and `fatal: Not a valid object name 9233`. For the
absent path, `git cat-file blob HEAD:nope` exits 128 with `fatal: path 'nope' does not exist in
'HEAD'`, while `--batch` puts nothing on stderr. So a path absent at that rev and a rev that does
not exist give the same `missing` reply, and the reason the per-file read prints is gone.

The tree row matters. `showBlob` uses `cat-file blob` so that "a path that has since become a
directory errors instead of quietly yielding a tree listing". `--batch` yields the tree. A reader
must check that the type field is `blob` and treat anything else as absent.

**Contents can hold the separators.** The contents are written raw and sized
(`print_object_or_die`, `builtin/cat-file.c` at `v2.54.0`, line 383 on), so a blob may contain LF,
NUL, or bytes that look like another header. **measured**: the tree reply above carries a NUL
inside its 29 bytes and still ends on the one LF its size predicts. The safe reader is:

1. Read up to the first output delimiter (LF, or NUL under `-Z`). That is the header.
2. If the header is the request text followed by ` missing`, ` ambiguous`, ` excluded` or
   ` submodule`, the reply ends there. Match against the text the reader sent: under `-Z` the
   echoed name may itself hold spaces or a newline (see section 3), so splitting on spaces is
   wrong.
3. Otherwise split the header from the right into `<oid> <type> <size>`, read exactly `<size>`
   bytes, and then exactly one delimiter byte. Never scan the body for a delimiter.

**`--buffer`.** **vendor claim**, the manual page: "Normally batch output is flushed after each
object is output, so that a process can interactively read and write from `cat-file`. With this
option, the output uses normal stdio buffering". The source shows the uneven result: the header
and the trailing delimiter go through `batch_write`, which under `--buffer` is `fwrite` to stdio,
while a blob's contents first `fflush(stdout)` and then stream straight to fd 1 (`print_object_or_die`
lines 389 to 391 and 419, `batch_object_write` lines 562 to 563). A `missing` reply is `printf`
then `fflush` (`report_object_status`, lines 458 to 464).

**measured**, one request, then 1,000 ms of waiting, then stdin closed:

| mode, request | bytes inside 1,000 ms | bytes after stdin closed |
|---|---|---|
| `--batch`, `HEAD:plain` | 55 | 55 |
| `--batch --buffer`, `HEAD:plain` | 54 | 55, the last byte `"\n"` |
| `--batch --buffer`, `HEAD:sub` (tree) | 0 | 79 |
| `--batch --buffer`, `HEAD:nope` | 18 | 18 |
| `--batch-check --buffer`, `HEAD:plain` | 0 | 48 |

A reader that writes one request and waits for its whole reply hangs under `--buffer`. With a
blob it gets everything but the last delimiter byte, which is the worst case: the read looks
almost done. `--buffer` suits a writer that sends every request first and then closes stdin.

## 3. Awkward paths, line input against `-z` and `-Z`

**measured**, a repository with one file per name below, each committed with `git add -A -- .`.
Every row was also read with `git cat-file blob HEAD:<name>` as the baseline. "found" means the
right oid and the right bytes came back.

| path | `--batch` (line) | `--batch -z` | `--batch -Z` | `cat-file blob` |
|---|---|---|---|---|
| `a<LF>b` | wrong: `"HEAD:a missing\nb missing\n"` | found | found | found |
| `cr<CR>` | wrong: `"HEAD:cr missing\n"` | found | found | not run |
| `a<TAB>b` | found | found | found | found |
| `-dash` | found | found | found | found |
| ` lead` (leading space) | found | found | found | not run |
| `trail ` (trailing space) | found | found | found | found |
| `a\b` (backslash) | found | found | found | found |
| `café.txt` (UTF-8, NFC) | found | found | found | found |
| `café.txt` sent as NFD | `"HEAD:cafe\xcc\x81.txt missing\n"` | not run | not run | not run |
| `./plain`, cwd at the root | found | found | found | found |

What each row shows:

- **Newline.** Line input splits the request in two and replies twice, once per half. Only `-z`
  and `-Z` reach the file. For a missing name holding a newline, `-z` replies `"HEAD:x\ny
  missing\n"`, which a line reader takes as two lines, and `-Z` replies `"HEAD:x\ny
  missing\u0000"`, which parses. That is the ambiguity the deprecation names.
- **Trailing CR.** Line input reads `HEAD:cr` instead. A request `"HEAD:plain\r\n"` likewise
  found `plain`. **vendor claim**, `strbuf_getdelim_strip_crlf` in `strbuf.c` at `v2.54.0`, lines
  725 to 735: with `'\n'` as the delimiter it drops the LF and then one CR before it. With `'\0'`
  it strips nothing.
- **Tab, spaces.** The default format reads the whole line as the name. Only a format holding
  `%(rest)` splits at whitespace (manual page, the `rest` atom), and so does `--filters` or
  `--textconv` in batch mode, whose input "must specify the path, separated by whitespace".
- **Leading `-`.** Harmless on stdin. The request starts with the rev, and stdin is never parsed
  as options. The per-file read is safe for the same reason (`<sha>:` comes first).
- **Backslash and non-ASCII.** Read as raw bytes. Nothing unquotes the input. A name that is not
  the exact bytes in the tree is missing: the NFD spelling of `café.txt` is a different byte
  string and was not found, and a `missing` reply echoes the request bytes as sent.
- **Leading `./`.** **vendor claim**, `Documentation/revisions.adoc` at `v2.56.0`, line 224: "A
  path starting with './' or '../' is relative to the current working directory." **measured**:
  with the child's cwd at `sub/`, `HEAD:./f` found `sub/f`, and `HEAD:f` was missing. So
  `HEAD:./x` means `x` only when the child runs at the repository root, and a path value starting
  `./` or `../` is a request for a different file, not a spelling of the same one.

A last request with no terminator is answered once stdin closes (**measured**, both modes). While
stdin stays open git waits: `"HEAD:plain"` with no LF got no reply in 1,000 ms.

Command: `node cases.mjs <repo>` and `node cases2.mjs <repo> <prefix>`, two scripts that run
`spawnSync("git", ["cat-file", ...mode], { cwd, input })` per case and print stdout and stderr as
JSON strings.

## 4. No textconv, no filters, no eol under plain `--batch`

**vendor claim**, the manual page at `v2.56.0`: `--batch` "May not be combined with any other
options or arguments except `--textconv`, `--filters`, or `--use-mailmap`". `--filters` is what
shows "the content as converted by the filters configured in the current working tree for the
given `<path>` (i.e. smudge filters, end-of-line conversion, etc)". Plain `--batch` has no path to
look attributes up by. In the source, a blob is converted only when `opt->transform_mode` is set,
and otherwise goes to `stream_blob` (`print_object_or_die`, `v2.54.0`, lines 392 to 420).

**measured**, a repository with `a.txt` committed as `line one\nline two\n` (18 bytes), then
`.gitattributes` set to `*.txt text eol=crlf filter=up diff=rev`, `filter.up.smudge` set to `tr
a-z A-Z` and `diff.rev.textconv` set to `rev`:

| command | contents |
|---|---|
| `git cat-file blob HEAD:a.txt` | `line one\nline two\n`, 18 bytes |
| `printf 'HEAD:a.txt\n' \| git cat-file --batch` | header `... blob 18`, then the same 18 bytes |
| `git cat-file --filters HEAD:a.txt` | `LINE ONE\r\nLINE TWO\r\n`, 20 bytes |
| `git cat-file --textconv HEAD:a.txt` | `rev` output, 20 bytes |
| `printf 'HEAD:a.txt a.txt\n' \| git cat-file --batch --filters` | header `... blob 18`, then 20 bytes |

`cmp` on the `cat-file blob` bytes and the 18 body bytes of the `--batch` reply printed nothing,
exit 0. So `--batch` equals today's read.

The last row is a trap for anyone tempted to add `--filters`. The header still says 18, the raw
size, but 20 converted bytes follow, so a size-driven reader would end the reply two bytes early
and misparse everything after it. The source agrees: the header is formatted from the raw size in
`batch_object_write` before `print_object_or_die` converts the contents.

## 5. When the child dies, and when stdin closes

**measured**, Node 22, `spawn("git", ["cat-file", "--batch"])`, script `life.mjs`:

- **Killed mid-reply.** Request a 50,000,000-byte blob and send `SIGKILL` on the first stdout
  chunk. The reader got 131,072 bytes, then stdout `end` at 21 ms, then `close` with `code=null
  signal=SIGKILL`. Nothing marks the reply as cut short except that fewer bytes than the header's
  size arrived before the end of the stream. A reader must fail every request still waiting when
  `close` fires, and treat a body shorter than its size as failed, never as content. A write to
  stdin after that failed in its callback with `ERR_STREAM_DESTROYED`. A write that races the
  death would see `EPIPE` on stdin's `error` event instead, so stdin needs an `error` listener or
  the process throws (**folklore**: the race was not reproduced here).
- **Stdin closed.** Write three requests (`HEAD:plain`, `HEAD:nope`, `HEAD:-dash`), then `end()`.
  All three replies arrived in order, 127 bytes, then `close` with `code=0`. Closing stdin is the
  clean shutdown: git finishes the queue and exits.

Not measured: stderr filling up. Ambiguous names write hint lines to stderr (section 2). A reader
that pipes stderr and never reads it could block git once the pipe buffer fills. Draining stderr,
or passing `"ignore"` for it, avoids the question.

## 6. Which git ships where, and what this repository requires

**measured**, this machine: `git --version` prints `git version 2.54.0 (Apple Git-157)`, and
`which -a git` lists only `/usr/bin/git`.

**vendor claim**, GitHub's runner-images, `main` at `8197087fc536` (2026-10-09). The label table in
https://github.com/actions/runner-images/blob/main/README.md maps `ubuntu-latest` to Ubuntu 24.04,
`windows-latest` to Windows Server 2025 (`windows-2025-vs2026`), and `macos-latest` to macOS 26
Arm64. The image READMEs list:

| label | image README | image version | git |
|---|---|---|---|
| `ubuntu-latest` | https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md | 20261004.327.1 | Git 2.55.0 |
| `windows-latest` | https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-VS2026-Readme.md | 20260925.250.1 | Git 2.55.0.windows.5 |
| `macos-latest` | https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md | 20260907.0351.1 | Git 2.55.0 |

`.github/workflows/ci.yml` runs its `test` job and its later smoke job on exactly these three
labels, with no `container:` and no step that installs another git. The Windows figure matches
`docs/research/what-windows-does-with-a-name-a-lock-and-a-pid.md`, which saw Git 2.55.0.windows.5
on the same image version. Every one of these is past 2.42.0, so `-Z` is there on all of them.

**measured**, grep of `README.md`, `docs/`, `plugins/anatomiya/lib/git.mjs` and
`.github/workflows/` for a git version: nothing states a minimum. What is there:

- `plugins/anatomiya/lib/git.mjs`, line 237: "Measured on git 2.43 and 2.51", about empty filter
  commands. A note on what was tested, not a floor.
- `docs/how-it-works.md`, line 2285: "a git older than 2.31 refuses `--diff-merges`, so the walk
  states nothing there either". A degraded behaviour on older git, not a refusal to run.
- `README.md` names no git version.

So a `-Z` reader would be the first hard dependency on a specific git release (2.42.0). On an
older git `-Z` is an unknown switch and the child exits before reading anything. That outcome was
not measured here, since no git older than 2.54 is installed. Whether to state 2.42 as a floor, or
to fall back to the per-file read when the child dies at once, is a decision this note leaves open.
