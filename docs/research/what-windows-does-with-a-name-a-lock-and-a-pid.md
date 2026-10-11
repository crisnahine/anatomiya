# What Windows does with a name, a lock and a pid

Research notes, 2026-10-08. The branch `more-languages` (read at `6f2a116`) has never run on Windows,
and `main` requires the suite green on `windows-latest` for Node 22 and Node 24. Six beliefs about
Windows hold up code or tests on that branch. Each one is settled here against the source that owns it,
and two more found while reading are added at the end. No code is proposed.

Every claim carries its source, in three kinds:

- **doc**: a first-party page, quoted, with its URL
- **read**: source code at a tag or commit, with the repository, the file and the lines
- **run**: a command and its output on the machine this was written on, on 2026-10-08. That machine is
  macOS 27.0.1 on APFS. Nothing here was run on Windows.

The versions read. `actions/setup-node` resolves `22` and `24` through `actions/node-versions`, whose
manifest lists 22.23.3 and 24.21.0 first. `https://nodejs.org/dist/index.json` gives 22.23.3 libuv
1.51.0 and 24.21.0 libuv 1.52.1, and `deps/uv/include/uv/version.h` at each Node tag agrees. libuv is
read as Node ships it, under `deps/uv` in `nodejs/node` at tags `v22.23.3` and `v24.21.0`. `windows-latest`
is Windows Server 2025, image 20260925.250.1, with Git 2.55.0.windows.5 and Node 22.23.3 preinstalled
(`actions/runner-images` at `e7c7cb8`, `README.md` and `images/windows/Windows2025-VS2026-Readme.md`).

## Summary

| # | The belief | Answer | Agrees with the branch |
|---|---|---|---|
| 1 | NTFS does not fold `ſ` onto `s`, APFS does | APFS settled. NTFS not decided by any owner page; the two upper case tables Microsoft publishes leave U+017F unmapped. The test measures the pair and passes either way | yes, as a test; the comment's NTFS half is unproven |
| 2 | `access(dir, W_OK)` reads no ACL on Windows | Settled. It reads the read-only attribute only, and passes every directory | yes |
| 3 | `kill(pid, 0)` gives `ESRCH` for a gone pid and `EPERM` for one the user may not open | Settled by libuv's code. A freed id may be reused at once. Microsoft gives no range, so "a pid no system gives" is unproven for Windows | yes for the code; the test's comment is unproven |
| 4 | A rename over a file held open fails with a code in `EPERM`, `EACCES`, `EBUSY` | Settled. `EPERM` for an open or read-only target, `EBUSY` for a sharing violation, no retry in libuv or Node | yes |
| 5 | The runner checks out with `core.autocrlf=true` | Settled in two steps: the image installs Git with no line-ending option, and the installer's default writes `true` to the system config. `actions/checkout` does not touch it | yes |
| 6 | A child that sends itself `SIGKILL` exits non-zero | Settled. Exit code 1, `signal` null | yes |
| 7 | A read-only file refuses a removal | Settled the other way on Windows: libuv removes it | no test depends on it |
| 8 | `realpathSync.native` expands an 8.3 short name | libuv's call is settled; Microsoft's page does not define the word that decides it | no test depends on it |

Nothing read here predicts a failing test on the Windows runner. Two things stay open because no owner
decides them, and both are listed under "What the sources leave open".

## 1. Does NTFS treat `ſ` and `s` as one name

**The belief.** `test/write.test.mjs:2567` says APFS folds the long s (U+017F) onto `s` "and neither
NTFS nor a plain lower-casing does". `plugins/anatomiya/lib/rules.mjs:190-191` folds a name with
`name.toUpperCase().toLowerCase()`, "Upper first: APFS also folds the long s onto `s`".

**Unicode.** doc, `UnicodeData.txt` 18.0.0, <https://www.unicode.org/Public/UCD/latest/ucd/UnicodeData.txt>:

```
017F;LATIN SMALL LETTER LONG S;Ll;0;L;<compat> 0073;;;;N;;;0053;;0053
```

Field 12 is the simple uppercase mapping and it is U+0053, `S`. Field 14, the titlecase mapping, is
also U+0053, and there is no lowercase mapping. `CaseFolding.txt` 18.0.0 in the same directory has
`017F; C; 0073; # LATIN SMALL LETTER LONG S`, a common fold onto `s`. So a volume that upcases or
folds by the Unicode data treats the two as one name.

**Apple.** doc, the APFS FAQ, updated 2018-06-04,
<https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html>:

> APFS implements normalization and case insensitivity according to the Unicode 9.0 standard

doc, Apple File System Reference, 2020-06-22,
<https://developer.apple.com/support/downloads/Apple-File-System-Reference.pdf>, on
`APFS_INCOMPAT_CASE_INSENSITIVE`: "Filenames on this volume are case insensitive." The reference does
not say how the comparison is made. The word "fold" is nowhere in it, and its name hash is described
as NFD normalization only.

run, on an APFS volume, macOS 27.0.1, Node 22.22.3: a file written as `a.inſtructions.md` is found as
`a.instructions.md`, a file written as `ſ` is found as `S`, and `probe` is found as `PROBE`.

Apple's FAQ plus the Unicode data decide the APFS half, and the run agrees.

**Microsoft, on NTFS.** doc, "How NTFS Works" (Windows Server 2003),
<https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2003/cc781134(v=ws.10)>,
in the table of metadata files:

> Upcase table | $Upcase | 10 | Converts lowercase characters to matching Unicode uppercase characters.

doc, `FsRtlAreNamesEqual`,
<https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-_fsrtl_advanced_fcb_header-fsrtlarenamesequal>:

> Case-insensitive matching is performed by converting both strings to uppercase before they are
> compared.

and of its `UpcaseTable` parameter: "If this value is not supplied, the default system uppercase
character table is used."

Those two say NTFS compares by upcasing through a table. Neither says which Unicode version the table
follows or lists its rows, and no Microsoft page found states either for NTFS.

**Microsoft, on the tables it does publish.** Two, and neither is stated to be NTFS's `$UpCase`.

doc, [MS-UCODEREF] 3.1.5.3, last updated 2024-04-23,
<https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-ucoderef/1ad259bc-24c4-4f3c-878b-55b8f2f69727>:

> To map a UTF-16 string to upper case, each UTF-16 code point is looked for in an upper casing table
> [MSDN-UCMT/Win8]. If an entry is found, the input code point is changed to the output code point.

The table is "Windows 8 Upper Case Mapping Table.txt" at
<https://www.microsoft.com/en-us/download/details.aspx?id=10921> (version 1.0, published 2024-12-19).
Its rows around the long s are:

```
0x0177	0x0176	; Y Circumflex
0x017a	0x0179	; Z Acute
0x017c	0x017b	; Z Dot Above
0x017e	0x017d	; Z Caron
```

There is no row for `0x017f`, so that table leaves the long s as it is.

doc, the exFAT specification, section 7.2.5.1, Table 25 "Recommended up-case table",
<https://learn.microsoft.com/en-us/windows/win32/fileio/exfat-specification>:

```
| 0178h | 0178h | 0179h | 0179h | 017Bh | 017Bh | 017Dh | 017Dh | 017Fh |
```

The last column is index 017Fh, and it maps to 017Fh: itself.

**Answer.** Not decided by the sources. Microsoft documents that NTFS upcases through a table and
publishes neither the table nor its Unicode version. The Unicode data alone would fold the pair. Both
upper case tables Microsoft does publish, for Windows protocols and for exFAT, leave U+017F unmapped,
which points the reviewer's way, but neither page says NTFS uses that table. A run on a real NTFS
volume decides it. The 2008 blog post the reviewer cited is not a source and was not read.

**The test as it stands.** It passes whichever way NTFS answers, for three reasons read off the code.

- The control at `test/write.test.mjs:2580` compares `existsSync` of the plain spelling with
  `foldsOnto(theirs, areaName(target, b.id))`, and `foldsOnto` (`:2515-2523`) writes one name and asks
  for the other in a fresh temp directory. It measures the volume for the exact pair, so it holds on a
  volume that folds and on one that does not.
- Every later assertion in that test is about what the writer plans and leaves, and the writer decides
  with `folded` and `spelledOtherwise` (`plugins/anatomiya/lib/rules.mjs:191-199`), which compare
  strings and never ask the volume. JavaScript's `"ſ".toUpperCase()` is `"S"` (run), so the code treats
  the pair as one name on every platform.
- The same assertions already run on a volume that folds the pair (APFS) and on one that folds nothing
  (ext4). NTFS answers each lookup of this one file one of those two ways.

One detail: Cursor's extension is `.mdc`, which has no `s`, so for Cursor the fourth spelling at
`:2568` differs by ASCII case only (`Area`). Only the Copilot name, `.inſtructions.md`, carries the
long s.

The comment at `:2524`, "as macOS and Windows fold by default", is settled for Windows. doc,
<https://learn.microsoft.com/en-us/windows/wsl/case-sensitivity>: "Windows file system treats file and
directory names as case-insensitive. FOO.txt and foo.txt will be treated as equivalent files." `FOLDS`
is measured at `:2525` in any case.

## 2. What `fs.access(dir, W_OK)` answers on Windows

**The belief.** `plugins/anatomiya/lib/write.mjs:474-475`: "`access` passed it at the audit, and on
Windows that call reads no ACL." The call is `accessSync(nearest.at, mode)` for `W_OK` then `X_OK` at
`plugins/anatomiya/lib/rules.mjs:565`.

**Node.** doc, `fs.access`, `doc/api/fs.md` at `v24.21.0` lines 2554-2557 (the same words at `v22.23.3`
lines 2135-2138), <https://nodejs.org/docs/latest-v24.x/api/fs.html#fsaccesspath-mode-callback>:

> On Windows, access-control policies (ACLs) on a directory may limit access to a file or directory.
> The `fs.access()` function, however, does not check the ACL and therefore may report that a path is
> accessible even if the ACL restricts the user from reading or writing to it.

And of `X_OK`, in the file access constants table: "This has no effect on Windows (will behave like
`fs.constants.F_OK`)."

**libuv.** read, `nodejs/node` `v24.21.0`, `deps/uv/src/win/fs.c:2528-2551` (libuv 1.52.1). The same
function is at `v22.23.3` lines 2461-2484 (libuv 1.51.0), byte for byte:

```c
static void fs__access(uv_fs_t* req) {
  DWORD attr = GetFileAttributesW(req->file.pathw);
  ...
  /*
   * Access is possible if
   * - write access wasn't requested,
   * - or the file isn't read-only,
   * - or it's a directory.
   * (Directories cannot be read-only on Windows.)
   */
  if (!(req->fs.info.mode & W_OK) ||
      !(attr & FILE_ATTRIBUTE_READONLY) ||
      (attr & FILE_ATTRIBUTE_DIRECTORY)) {
    SET_REQ_RESULT(req, 0);
  } else {
    SET_REQ_WIN32_ERROR(req, UV_EPERM);
  }
```

<https://github.com/nodejs/node/blob/v24.21.0/deps/uv/src/win/fs.c#L2528-L2551>

**Microsoft.** doc, File Attribute Constants,
<https://learn.microsoft.com/en-us/windows/win32/fileio/file-attribute-constants>, on
`FILE_ATTRIBUTE_READONLY`: "A file that is read-only. Applications can read the file, but cannot write
to it or delete it. This attribute is not honored on directories."

**Answer.** Settled, and it agrees with the comment. The call makes one `GetFileAttributesW` and reads
no security descriptor. For a directory that exists it succeeds for `W_OK` whatever the ACL says and
whether or not the read-only attribute is set, and `X_OK` is an existence check. Only a file with the
read-only attribute fails, with `EPERM`. So on Windows `blockedOnTheWay` never says "is not writable"
for a directory, and a directory an ACL closes is first met when a file is created in it. `CreateFileW`
then fails with `ERROR_ACCESS_DENIED`, which libuv turns into `EPERM` (section 4), a code `stage` in
`write.mjs` already reads as a refusal. The tests that close a directory with `chmod` are all behind
`needsPosixPermissions` and skip on Windows.

## 3. What `process.kill(pid, 0)` does on Windows

**The belief.** `running` at `plugins/anatomiya/lib/write.mjs:723-730` and `alive` at
`plugins/anatomiya/lib/refresh-run.mjs:552-560` call `process.kill(pid, 0)`, read a throw with `EPERM`
as a live process and any other throw as gone. `test/write.test.mjs:3537-3539` uses `2 ** 22 + 7` as
"a process id no system gives, since Windows hands a freed one to the next process".

**Node.** doc, `process.kill`, `doc/api/process.md` at `v24.21.0` lines 2693-2696,
<https://nodejs.org/docs/latest-v24.x/api/process.html#processkillpid-signal>:

> This method will throw an error if the target `pid` does not exist. As a special case, a signal of
> `0` can be used to test for the existence of a process.

and under Signal events (lines 794-796): "Sending signal `0` can be used as a platform independent way
to test for the existence of a process." The page names no error code for either case.

read, `nodejs/node` `v24.21.0`, `src/node_process_methods.cc:185-209`: `Kill` hands the pid and signal to
`uv_kill` and returns its result; `lib/internal/process/per_thread.js:254-280` throws an
`ErrnoException` when the result is not zero.

**libuv.** read, `nodejs/node` `v24.21.0`, `deps/uv/src/win/process.c:1382-1407`. The file differs
between the two Node tags in two lines of a crash-dump path only, and these line numbers hold for both:

```c
int uv_kill(int pid, int signum) {
  ...
  if (pid == 0) {
    process_handle = GetCurrentProcess();
  } else {
    process_handle = OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION | SYNCHRONIZE,
                                 FALSE,
                                 pid);
  }

  if (process_handle == NULL) {
    err = GetLastError();
    if (err == ERROR_INVALID_PARAMETER) {
      return UV_ESRCH;
    } else {
      return uv_translate_sys_error(err);
    }
  }
```

and for signal 0, lines 1335-1355:

```c
    case 0: {
      /* Health check: is the process still alive? */
      DWORD status;

      if (!GetExitCodeProcess(process_handle, &status))
        return uv_translate_sys_error(GetLastError());

      if (status != STILL_ACTIVE)
        return UV_ESRCH;

      switch (WaitForSingleObject(process_handle, 0)) {
        case WAIT_OBJECT_0:
          return UV_ESRCH;
        ...
        case WAIT_TIMEOUT:
          return 0;
```

<https://github.com/nodejs/node/blob/v24.21.0/deps/uv/src/win/process.c#L1382-L1407>

read, `deps/uv/src/win/error.c:158`, the same at both tags: `case ERROR_ACCESS_DENIED: return UV_EPERM;`.

So, by the code:

- A pid nothing has: `OpenProcess` fails. If the error is `ERROR_INVALID_PARAMETER` the answer is
  `ESRCH`. Any other error is translated, and only `ERROR_ACCESS_DENIED` and `ERROR_PRIVILEGE_NOT_HELD`
  become `EPERM`.
- A process that has exited while somebody still holds a handle to it: `OpenProcess` succeeds, the exit
  code is no longer `STILL_ACTIVE`, the answer is `ESRCH`. One that exited with code 259 is caught by
  the wait.
- A process the user may not open: `OpenProcess` fails with `ERROR_ACCESS_DENIED`, the answer is `EPERM`.

**Microsoft.** doc, `OpenProcess`,
<https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocess>:

> If the specified process is the System Idle Process (0x00000000), the function fails and the last
> error code is `ERROR_INVALID_PARAMETER`. If the specified process is the System process or one of the
> Client Server Run-Time Subsystem (CSRSS) processes, this function fails and the last error code is
> `ERROR_ACCESS_DENIED` because their access restrictions prevent user-level code from opening them.

The page does not say which error an identifier that names no process gives. libuv's
`ERROR_INVALID_PARAMETER` branch is libuv's reading of Windows, and Microsoft's page neither confirms
nor denies it.

doc, `PROCESS_INFORMATION`, `dwProcessId`,
<https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information>:

> A value that can be used to identify a process. The value is valid from the time the process is
> created until all handles to the process are closed and the process object is freed; at this point,
> the identifier may be reused.

doc, Process Handles and Identifiers,
<https://learn.microsoft.com/en-us/windows/win32/procthread/process-handles-and-identifiers>: "The
identifier is valid from the time the process is created until the process has been terminated."

doc, .NET `Process.Id`, <https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.id>:
"Process identifiers can be reused by the system. The Id property value is unique only while the
associated process is running. After the process has terminated, the system can reuse the Id property
value for an unrelated process."

On the range: the identifier is a `DWORD` in every one of those pages. None gives a largest value, an
alignment, or an order in which freed identifiers are handed out.

**Answer.**

- `ESRCH` as gone and `EPERM` as alive: settled by libuv's code, and it agrees with `running` and
  `alive`. The one step Microsoft does not document, the error for an unknown identifier, cannot turn a
  gone process into a live one in either function: both treat every code except `EPERM` as gone.
- Reuse: settled. A freed identifier "may be reused" once the last handle closes, and no page promises
  a delay. A stale pid in a staged file name or in the refresh lock can therefore name an unrelated live
  process, on Windows as on any system, and both functions then answer alive. The test comment's
  "hands a freed one to the next process" is stronger than what Microsoft says: reuse is allowed, and
  nothing says the next process gets it.
- `2 ** 22 + 7` (4194311): not decided by the sources. Microsoft's pages bound a process identifier
  only by its type, so they do not say Windows cannot give this value. The tests that use `gone()`
  hold on the runner as long as `OpenProcess(4194311)` finds no live process there, and no owner page
  says how likely or unlikely that is.

## 4. A rename over a file another process holds open, and an unlink of one

**The belief.** `plugins/anatomiya/lib/write.mjs:559-560`: "What a file somebody holds open, or made
read-only, answers a rename or a removal with", `LOCKED = ["EPERM", "EACCES", "EBUSY"]`. And `:625-626`:
"A rename in a directory the temporary file was just created in still fails: Windows refuses one over a
file another process holds open." A locked file in a directory another tool owns stops that directory
alone, by `err.locked`.

**libuv, rename.** read, `nodejs/node` `v24.21.0`, `deps/uv/src/win/fs.c:2333-2340` (`v22.23.3`:
2266-2273, identical):

```c
static void fs__rename(uv_fs_t* req) {
  if (!MoveFileExW(req->file.pathw, req->fs.info.new_pathw, MOVEFILE_REPLACE_EXISTING)) {
    SET_REQ_WIN32_ERROR(req, GetLastError());
    return;
  }

  SET_REQ_RESULT(req, 0);
}
```

<https://github.com/nodejs/node/blob/v24.21.0/deps/uv/src/win/fs.c#L2333-L2340>

One call, no loop, no second attempt, and no POSIX-semantics flag. read, `lib/fs.js:1072-1077` and
`:1999-2001` at `v24.21.0`: `renameSync` and `unlinkSync` are one binding call each. The only retry in
that file belongs to `rmSync` (`maxRetries`), which the writer does not use. Neither Node nor libuv
retries.

**libuv, unlink.** read, `deps/uv/src/win/fs.c:1130-1268` at `v24.21.0` (`v22.23.3`: from 1099). It
opens the file itself, asking for delete access and sharing everything:

```c
  handle = CreateFileW(pathw,
                       FILE_READ_ATTRIBUTES | DELETE,
                       FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                       NULL,
                       OPEN_EXISTING,
                       FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
                       NULL);
```

then sets `FILE_DISPOSITION_DELETE | FILE_DISPOSITION_POSIX_SEMANTICS |
FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE` (lines 1191-1199), and falls back to the older disposition
call only where POSIX delete is not supported. In libuv 1.51.0 (`v22.23.3`, line 1110) the open also
asks for `FILE_WRITE_ATTRIBUTES`; 1.52.1 dropped it.

**libuv, the table.** read, `deps/uv/src/win/error.c:66-174`, identical at both tags:

```c
    case WSAEACCES:                         return UV_EACCES;
    case ERROR_ELEVATION_REQUIRED:          return UV_EACCES;
    case ERROR_CANT_ACCESS_FILE:            return UV_EACCES;
    ...
    case ERROR_LOCK_VIOLATION:              return UV_EBUSY;
    case ERROR_PIPE_BUSY:                   return UV_EBUSY;
    case ERROR_SHARING_VIOLATION:           return UV_EBUSY;
    ...
    case ERROR_ACCESS_DENIED:               return UV_EPERM;
    case ERROR_PRIVILEGE_NOT_HELD:          return UV_EPERM;
    ...
    default:                                return UV_UNKNOWN;
```

<https://github.com/nodejs/node/blob/v24.21.0/deps/uv/src/win/error.c#L66-L174>

So `ERROR_SHARING_VIOLATION` and `ERROR_LOCK_VIOLATION` are `EBUSY`, `ERROR_ACCESS_DENIED` is `EPERM`
(not `EACCES`), and `EACCES` comes only from the three rows at the top.

**Microsoft, rename.** doc, `MoveFileExW`,
<https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw>, on
`MOVEFILE_REPLACE_EXISTING`: "If a file named lpNewFileName exists, the function replaces its contents
with the contents of the lpExistingFileName file, provided that security requirements regarding access
control lists (ACLs) are met." The page says nothing about a target that is open, and names no error
code for it.

doc, `FILE_RENAME_INFORMATION`,
<https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information>:

> Even if ReplaceIfExists is set to TRUE, the rename operation will still fail if a file with the same
> name already exists and is a directory, a read-only file, or a currently executing file.

> A file cannot be renamed if a file with the same name exists and has open handles (except in the
> batch-oplock case described earlier).

and of `FILE_RENAME_POSIX_SEMANTICS`: "If FILE_RENAME_REPLACE_IF_EXISTS is also specified, allow
replacing a file even if there are existing handles to it."

doc, [MS-FSA] 2.1.5.15.12 FileRenameInformation, last updated 2023-04-04,
<https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/87f86c9b-6c2a-4803-84b7-131a74a434fa>,
gives the status: "The operation MUST be failed with STATUS_ACCESS_DENIED under any of the following
conditions: If TargetLink.File.FileType is DirectoryFile. If TargetLink.File.FileAttributes.FILE_ATTRIBUTE_READONLY
is TRUE." and "If there was not an oplock to be broken and TargetLink.File.OpenList contains an Open
with a Stream matching the current Stream, the operation MUST be failed with STATUS_ACCESS_DENIED."
That rule does not look at the share mode of the other open, so by the specification a target opened
with `FILE_SHARE_DELETE` refuses a plain rename too.

**Microsoft, delete.** doc, `DeleteFileW`,
<https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-deletefilew>:

> The DeleteFile function fails if an application attempts to delete a file that has other handles open
> for normal I/O or as a memory-mapped file (FILE_SHARE_DELETE must have been specified when other
> handles were opened).

> If the file is a read-only file, the function fails with ERROR_ACCESS_DENIED.

libuv does not call `DeleteFile`, so the first sentence reaches it through `CreateFileW`. doc,
`CreateFileW`, `FILE_SHARE_DELETE`,
<https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew>: "Enables
subsequent open operations on a file or device to request delete access. Otherwise, no process can open
the file or device if it requests delete access." doc, [MS-FSA] 2.1.5.1.2.2,
<https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/8c0e3f4f-0729-49f4-a14d-7f7add593819>,
names the status for that refusal, `STATUS_SHARING_VIOLATION`. doc, System Error Codes,
<https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--0-499->:
`ERROR_SHARING_VIOLATION` is 32, "The process cannot access the file because it is being used by
another process."

**Answer.** Settled, and `LOCKED` covers what Windows gives.

| What happens | Win32 error | Node code | In `LOCKED` |
|---|---|---|---|
| Rename over a target another handle has open | `ERROR_ACCESS_DENIED` | `EPERM` | yes |
| Rename over a read-only target | `ERROR_ACCESS_DENIED` | `EPERM` | yes |
| Rename where an open refuses the sharing asked for | `ERROR_SHARING_VIOLATION` | `EBUSY` | yes |
| Unlink of a file open without `FILE_SHARE_DELETE` | `ERROR_SHARING_VIOLATION` | `EBUSY` | yes |
| Unlink of a file open with `FILE_SHARE_DELETE` | none, it succeeds (POSIX delete) | none | not needed |
| Create in a directory an ACL closes | `ERROR_ACCESS_DENIED` | `EPERM` | yes |
| A byte-range lock | `ERROR_LOCK_VIOLATION` | `EBUSY` | yes |

Two limits on that table. The step from `STATUS_ACCESS_DENIED` and `STATUS_SHARING_VIOLATION` to the
Win32 errors of the same name is by the names; no current Microsoft page read here prints that mapping.
And a Win32 error outside libuv's table becomes `UNKNOWN`, which is not in `LOCKED`; nothing read
names one that a rename or an unlink of a held file gives. `EACCES` is in the list and none of these
rows produces it on Windows.

The scan's rule that a locked file in another tool's directory does not stop the scan rests on
`err.locked`, which is set for exactly those three codes, so it holds for every row above.

## 5. `core.autocrlf` on `windows-latest`, and the shell a step gets

**The belief.** `docs/releasing.md:46-55` describes a local line-ending pass that clones with
`git -c core.autocrlf=true clone` and points `GIT_CONFIG_SYSTEM` at a file holding `autocrlf = true`,
"as a Windows runner checks it out". `.gitattributes` holds one rule, `*.wasm binary`.

**The image.** read, `actions/runner-images` at `e7c7cb8`,
`images/windows/scripts/build/Install-Git.ps1:25-38`:

```powershell
Install-Binary `
    -Url $downloadUrl `
    -InstallArgs @(`
        "/VERYSILENT", `
        "/NORESTART", `
        "/NOCANCEL", `
        "/SP-", `
        "/CLOSEAPPLICATIONS", `
        "/RESTARTAPPLICATIONS", `
        "/o:PathOption=CmdTools", `
        "/o:BashTerminalOption=ConHost", `
        "/o:EnableSymlinks=Enabled", `
        "/COMPONENTS=gitlfs") `
```

<https://github.com/actions/runner-images/blob/e7c7cb8f4227797c6404a4e98c2ad463c2f70f91/images/windows/scripts/build/Install-Git.ps1#L25-L38>

No line-ending option is passed. The only `git config` the script runs is
`git config --system --add safe.directory "*"` (line 42). A code search of the repository for
`autocrlf` returns nothing, and the image README lists Git's version and says nothing about its
configuration. So the image's value is whatever the installer writes by default.

**Git for Windows' installer.** read, `git-for-windows/build-extra` at `75e6f0e`,
`installer/install.iss:2358-2363`:

```pascal
    case ReplayChoice('CRLF Option','CRLFAlways') of
        'LFOnly': RdbCRLF[GC_LFOnly].Checked:=True;
        'CRLFAlways': RdbCRLF[GC_CRLFAlways].Checked:=True;
        'CRLFCommitAsIs': RdbCRLF[GC_CRLFCommitAsIs].Checked:=True;
```

and lines 3243-3251:

```pascal
    WizardForm.StatusLabel.Caption:='Configuring core.autoCRLF';
    if RdbCRLF[GC_LFOnly].checked then begin
        Cmd:='input';
    end else if RdbCRLF[GC_CRLFAlways].checked then begin
        Cmd:='true';
    end else begin
        Cmd:='false';
    end;
    GitSystemConfigSet('core.autocrlf',Cmd);
```

<https://github.com/git-for-windows/build-extra/blob/75e6f0e19c23c701dc1d56905a32e5efc28c8a8d/installer/install.iss#L3243-L3251>

The default choice is `CRLFAlways`, labelled in the same file "Checkout Windows-style, commit Unix-style
line endings", and it writes `core.autocrlf=true` to the system config.

**actions/checkout.** read, `actions/checkout` at `3d3c42e` (the commit `ci.yml` pins, tagged v7.0.1):
`README.md`, `action.yml` and everything under `src/` hold no occurrence of `autocrlf`, `crlf` or
"line ending", and no `GIT_CONFIG_NOSYSTEM`. It runs the `git` on `PATH` and neither sets the value nor
hides the system config. The README is silent on line endings.

**Git.** doc, `core.autocrlf`, Git v2.55.0, `Documentation/config/core.adoc:223-229`,
<https://git-scm.com/docs/git-config#Documentation/git-config.txt-coreautocrlf>:

> Setting this variable to "true" is the same as setting the `text` attribute to "auto" on all files
> and core.eol to "crlf". Set to true if you want to have `CRLF` line endings in your working directory
> and the repository has LF line endings.

doc, `gitattributes`, `Documentation/gitattributes.adoc:157-169` and `:1314-1318`,
<https://git-scm.com/docs/gitattributes>:

> When `text` is set to "auto", Git decides by itself whether the file is text or binary. If it is text
> and the file was not already in Git with CRLF endings, line endings are converted on checkin and
> checkout as described above. Otherwise, no conversion is done on checkin or checkout.

> If the `text` attribute is unspecified, Git uses the `core.autocrlf` configuration variable to
> determine if the file should be converted.

> The built-in macro attribute "binary" is equivalent to: `[attr]binary -diff -merge -text`

The documentation does not say how Git "decides by itself". The source does. read, `git/git` `v2.55.0`,
`convert.c:94-103`:

```c
static int convert_is_binary(const struct text_stat *stats)
{
	if (stats->lonecr)
		return 1;
	if (stats->nul)
		return 1;
	if ((stats->printable >> 7) < stats->nonprintable)
		return 1;
	return 0;
}
```

and `will_convert_lf_to_crlf` at `:246-266` returns 0 for the automatic actions when
`convert_is_binary(stats)` is true. <https://github.com/git/git/blob/v2.55.0/convert.c#L94-L103>

run, in the branch's checkout: all seven tracked `.wasm` files begin with the bytes `00 61 73 6d`, so
each holds a NUL byte. `git ls-files --eol` lists them `i/-text w/-text attr/-text` and the other 283
tracked files `i/lf w/lf attr/` with no attribute.

**Answer.** Settled: `core.autocrlf` is `true` at system level on the image, so a checkout there writes
every tracked text file with CRLF, and the local pass stands in for it correctly, down to setting the
value in the system config so a `git init` inside a test sees it too. The conclusion takes two sources,
the image script and the installer default; no single owner page states the value on the image. The
`.wasm` files are safe both ways: with the attribute `-text` forbids conversion, and without it the NUL
byte makes Git call them binary.

**The shell.** doc, Workflow syntax, `jobs.<job_id>.steps[*].shell`,
<https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsshell>.
For Windows and `pwsh`: "This is the default shell used on Windows. The PowerShell Core. GitHub appends
the extension .ps1 to your script name." For `bash` on all platforms: "When specifying a bash shell on
Windows, the bash shell included with Git for Windows is used." It is run as
`bash --noprofile --norc -eo pipefail {0}`.

read, `Install-Git.ps1:51` in the image repository: `Add-MachinePathItem "C:\Program Files\Git\bin"`.
doc, the image README's Shells table: `gitbash.exe | C:\Program Files\Git\bin\bash.exe`, and "Bash
5.3.15(2)-release" under installed software.

So a `run:` with no `shell:` is PowerShell Core on that runner, and a step that declares `shell: bash`
gets Git for Windows' bash, which is on `PATH`. In `.github/workflows/ci.yml` the steps that run on
Windows with no `shell:` are single commands (`npm ci --ignore-scripts`, and one `node -e "..."` with no
`$` in it); every multi-line step declares `shell: bash`. No workflow sets `defaults.run.shell`.

## 6. What the parent sees when a child is killed on Windows

**The belief.** `test/write.test.mjs:2053-2072` builds a child that calls
`process.kill(process.pid, "SIGKILL")` at a chosen rename, and `:2086` asserts
`assert.notEqual(child.status, 0)`, then that `stdout` has no "survived".

**Node.** doc, Signal events, `doc/api/process.md` at `v24.21.0` lines 788-794 (`v22.23.3`: 801-807),
<https://nodejs.org/docs/latest-v24.x/api/process.html#signal-events>:

> Windows does not support signals so has no equivalent to termination by signal, but Node.js offers
> some emulation with `process.kill()`, and `subprocess.kill()`:
>
> Sending `SIGINT`, `SIGTERM`, and `SIGKILL` will cause the unconditional termination of the target
> process, and afterwards, subprocess will report that the process was terminated by signal.

doc, `child_process.spawnSync`, `doc/api/child_process.md` at `v24.21.0` lines 1395-1398:

> `status` {number|null} The exit code of the subprocess, or `null` if the subprocess terminated due to
> a signal. `signal` {string|null} The signal used to kill the subprocess, or `null` if the subprocess
> did not terminate due to a signal.

The first quote reads as though the parent always sees a signal. The source says when it does.

**libuv and Node's source.** read, `deps/uv/src/win/process.c:1294-1305` at both tags:

```c
    case SIGQUIT:
    case SIGTERM:
    case SIGKILL:
    case SIGINT: {
      /* Unconditionally terminate the process. On Windows, killed processes
       * normally return 1. */
      ...
      if (TerminateProcess(process_handle, 1))
        return 0;
```

read, the same file, `:1364-1380`: `uv_process_kill`, the path `subprocess.kill()` and a `spawnSync`
timeout take, is the only place that records a signal, with `process->exit_signal = signum;`. `uv_kill`
by pid (`:1382-1407`), the path `process.kill()` takes, records none. At exit, `:843-852`, the callback
gets `GetExitCodeProcess`'s value and `handle->exit_signal`.

read, `nodejs/node` `v24.21.0`, `src/spawn_sync.cc:706-735`: `status` is null when `term_signal_ > 0`
and the exit code otherwise; `signal` is the signal's name when `term_signal_ > 0` and null otherwise.

**Microsoft.** doc, `TerminateProcess`,
<https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess>:

> When a process terminates itself, TerminateProcess stops execution of the calling thread and does not
> return. Otherwise, TerminateProcess is asynchronous; it initiates termination and returns immediately.

**Answer.** Settled, and the test's assertion holds.

- A child that sends itself `SIGKILL`: libuv opens the child's own pid and calls
  `TerminateProcess(handle, 1)`. The call does not return, so no statement after it runs: the rename the
  test means to prevent does not happen and "survived" is not printed. The parent's `spawnSync` reports
  `status: 1`, `signal: null`. `1 !== 0`, so `:2086` passes. On POSIX the same child gives
  `status: null`, `signal: "SIGKILL"` (run, here), and `null !== 0` passes too.
- A child killed from outside by pid, by `process.kill(pid)` in another process: the same, exit code 1
  and no signal.
- A child the parent kills through its own handle, `subprocess.kill()` or a `spawnSync` timeout:
  `status: null` and `signal` set to the name sent. That is the case the Signal events sentence
  describes.

run, here: the value the test passes in `ANATOMIYA_KILLED_SCAN` is 1,380 and 1,387 characters for its
two cases, far under the size a Windows environment variable may have.

## 7. A read-only file and a removal

**The belief.** The comment at `plugins/anatomiya/lib/write.mjs:559` groups "made read-only" with "holds
open" as things that answer "a rename or a removal" with a code in `LOCKED`.

**What the owners say.** For a rename it holds: section 4, a read-only target fails with
`STATUS_ACCESS_DENIED`, which is `EPERM`. For a removal it does not hold through Node. libuv sets
`FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE` on the delete (`deps/uv/src/win/fs.c:1191-1193` at
`v24.21.0`), and where POSIX delete is not supported it clears the attribute first (`:1212-1248`). doc,
`FILE_DISPOSITION_INFORMATION_EX`,
<https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntddk/ns-ntddk-_file_disposition_information_ex>:
`FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE` "Allows read-only files to be deleted."

Two owners disagree on one detail. doc, [MS-FSA] 2.1.5.15.4,
<https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/4c26c8cb-5a8f-4339-a372-b315c4974131>:
"If not InputBuffer.Flags.FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE or not
Open.GrantedAccess.FILE_WRITE_ATTRIBUTES The operation MUST be failed with STATUS_CANNOT_DELETE." libuv
1.52.1 (Node 24) no longer asks for `FILE_WRITE_ATTRIBUTES` on that handle, and its own comment at
`:1203-1206` says a `STATUS_CANNOT_DELETE` there "can only mean that there is an existing mapped view to
the file". By the specification an unlink of a read-only file on Node 24 fails; by libuv's comment it
succeeds. The sources do not settle which, and libuv 1.51.0 (Node 22) asks for the right and is not in
doubt.

**Answer.** On Windows a read-only file is removed by `unlinkSync` on Node 22, and on Node 24 either
removed or refused with a code that is in `LOCKED` if it maps to `ERROR_ACCESS_DENIED`. The comment is
true of POSIX directories and of renames, and wider than Windows for removals. No test depends on it:
every case that makes a file or directory read-only is behind `needsPosixPermissions` or the macOS-only
`chflags` guard, and the Windows lock cases are simulated by replacing `fs.renameSync`.

## 8. `realpathSync.native` and an 8.3 short name

**The belief.** `plugins/anatomiya/lib/rules.mjs:26-29`: "`realpathSync.native` where it exists, because
on Windows it is the one that expands an 8.3 short name". `test/write.test.mjs:1406-1413` names the case.

**What the owners say.** doc, `fs.realpathSync.native`, `doc/api/fs.md` at `v24.21.0` lines 6750-6763:
"Synchronous realpath(3). Only paths that can be converted to UTF8 strings are supported." Nothing about
Windows or short names. read, `deps/uv/src/win/fs.c:3025-3038` at `v24.21.0` (`v22.23.3`: 2958-2971):
the native call is `GetFinalPathNameByHandleW(handle, ..., VOLUME_NAME_DOS)`, which passes no
`FILE_NAME_OPENED` and so takes the default. doc, `GetFinalPathNameByHandleW`,
<https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew>:
`FILE_NAME_NORMALIZED` "Return the normalized drive name. This is the default." and `FILE_NAME_OPENED`
"Return the opened file name (not normalized)." The page does not define "normalized" in terms of short
and long names.

**Answer.** Which Windows call Node makes is settled. That the call expands a short name is not stated
on Microsoft's page for it. `docs/releasing.md:57` records that 8.3 short names have failed CI before,
which is this project's own measurement and the only evidence for the expansion cited here. The test at
`:1406` compares the two realpaths of the test directory, which on a runner sits under the workspace
and has no short component, so it passes whichever way the question goes.

## What the sources leave open

- Whether NTFS folds U+017F onto `s`. Needs one run on an NTFS volume: write `ſ`, ask for `s` and `S`.
  No test's result depends on the answer. The comments at `test/write.test.mjs:2513`, `:2567` and
  `plugins/anatomiya/lib/rules.mjs:190` state the NTFS half as fact.
- Whether Windows can hand out process id 4194311, and what `OpenProcess` does with an id of that
  value. Microsoft documents no range. The `gone()` tests from `test/write.test.mjs:3539` on assume no
  live process answers to it.
- Which error `OpenProcess` gives for an id no process has. libuv assumes `ERROR_INVALID_PARAMETER`.
  The branch's two functions give the same answer whatever it is.
- Whether an unlink of a read-only file succeeds under libuv 1.52.1. Section 7.
- Whether `FILE_NAME_NORMALIZED` expands short names. Section 8.

## What would fail on the Windows runner as the code stands

Nothing found. Each of the six beliefs either agrees with its owner or sits under a test that passes
both ways. The findings above are comments that say more than an owner does, in
`test/write.test.mjs:2567`, `test/write.test.mjs:3537` and `plugins/anatomiya/lib/write.mjs:559`.

## What was read, and when

All on 2026-10-08.

- Node.js: `https://nodejs.org/dist/index.json`; `nodejs/node` at tags `v22.23.3` and `v24.21.0`:
  `doc/api/fs.md`, `doc/api/process.md`, `doc/api/child_process.md`, `lib/fs.js`,
  `lib/internal/process/per_thread.js`, `src/node_process_methods.cc`, `src/spawn_sync.cc`
- libuv 1.51.0 and 1.52.1 as shipped in those two tags: `deps/uv/include/uv/version.h`,
  `deps/uv/src/win/fs.c`, `deps/uv/src/win/process.c`, `deps/uv/src/win/error.c`
- `actions/node-versions` `versions-manifest.json`, for what `setup-node` resolves
- Microsoft Learn, Win32: `OpenProcess`, `TerminateProcess`, `GetExitCodeProcess`, `GetProcessId`,
  `GetCurrentProcessId`, `CreateProcessW`, `PROCESS_INFORMATION`, Process Handles and Identifiers,
  `MoveFileExW`, `DeleteFileW`, `CreateFileW`, `GetFinalPathNameByHandleW`, File Attribute Constants,
  Naming Files, Paths, and Namespaces, System Error Codes (0-499), the exFAT specification
- Microsoft Learn, drivers: `FILE_RENAME_INFORMATION`, `FILE_DISPOSITION_INFORMATION_EX`,
  `FsRtlAreNamesEqual`
- Microsoft Open Specifications: [MS-FSA] 2.1.5.1.2.2, 2.1.5.15.3, 2.1.5.15.4, 2.1.5.15.12;
  [MS-UCODEREF] 3.1.5.3 and the "Windows 8 Upper Case Mapping Table" it cites
- Microsoft Learn, other: "How NTFS Works" (Windows Server 2003), WSL Case Sensitivity, .NET `Process.Id`
- Unicode Character Database 18.0.0: `UnicodeData.txt`, `CaseFolding.txt`
- Apple: the APFS FAQ in the Apple File System Guide (2018-06-04), Apple File System Reference
  (2020-06-22)
- `actions/runner-images` at `e7c7cb8`: `README.md`, `images/windows/Windows2025-VS2026-Readme.md`,
  `images/windows/scripts/build/Install-Git.ps1`, and a code search for `autocrlf`
- `git-for-windows/build-extra` at `75e6f0e`: `installer/install.iss`
- `actions/checkout` at `3d3c42e` (v7.0.1): `README.md`, `action.yml`, `src/`
- `git/git` at `v2.55.0`: `Documentation/config/core.adoc`, `Documentation/gitattributes.adoc`, `convert.c`
- GitHub Docs: Workflow syntax for GitHub Actions, the `shell` table
- The branch, read only: `plugins/anatomiya/lib/write.mjs`, `plugins/anatomiya/lib/refresh-run.mjs`,
  `plugins/anatomiya/lib/rules.mjs`, `plugins/anatomiya/lib/targets.mjs`, `test/write.test.mjs`,
  `test/platform.mjs`, `docs/releasing.md`, `.gitattributes`, `.github/workflows/ci.yml`
- Runs here: the fold probe on APFS; `git ls-files --eol` and the first four bytes of each `.wasm`; the
  kill test under a preload that printed the environment value's length and the child's `status` and
  `signal`
