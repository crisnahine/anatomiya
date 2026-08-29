# What a hook reads and what an install runs: the parse, the megabyte, the working directory, and the lockfile

Research notes, August 2026. Issues #125, #126 and #127 each rest on a platform fact none of them
measured. #126 says a payload cap keeps the first megabyte so a turn does not lose its map. #127 says
`process.cwd()` refuses once a worktree is unlinked, and that the fix is to let the absent case travel.
#125 says a plugin install never installs a plugin's dependencies, so every version upgrade leaves the
parser engines missing until `setup` runs by hand. This note establishes the four facts underneath
them from the specifications, from Node's own source, from the installed Claude Code build, and from
runs on this machine.

Every claim below carries its source, in the three kinds the companion notes use: **read**, a string or
a function recovered from an installed build or from published source, with its offset or its path;
**run**, a command and its output on this machine, today; **doc**, a first-party page or a
specification clause, quoted, with its URL and section number.

Everything was measured on **2026-08-29** with **node v22.22.3**, macOS **26.5.2** build 25F84
(`Darwin 25.5.0`), **arm64**, against **anatomiya 0.4.2** (`7080e7b`) and **Claude Code 2.1.251**, the
file `<home>/.local/share/claude/versions/2.1.251`, 197,171,680 bytes. Offsets are into that file.

```
$ node --version
v22.22.3
$ sw_vers
ProductName:		macOS
ProductVersion:		26.5.2
BuildVersion:		25F84
$ uname -m
arm64
```

## Summary

Each of the four turned out narrower than the issue that leans on it, and one is the opposite of what
was assumed.

`JSON.parse` takes a whole document or nothing. Trailing anything that is not JSON whitespace is a
`SyntaxError`, and JSON whitespace is four characters: tab, line feed, carriage return, space. That
much #126 has right. What it gets wrong is "every path through that branch answers `{}`". Three inputs
make the cap branch answer a real payload, and one of them is the comment's own scenario.

The megabyte is not a megabyte. `data.length` under `setEncoding("utf8")` counts UTF-16 code units, so
the cap fires anywhere between 1 MiB and 3 MiB of bytes depending on what is in the payload. A 3 MiB
payload of three-byte characters never reaches it.

`process.cwd()` in Node is a cache, not a syscall. It throws `ENOENT` only when nothing read it
successfully first, and after one success it returns the stale path forever. `path.resolve()` with no
arguments goes through that same cache, so it throws in exactly the same case, which is the fact
#127's fix depends on. `path.resolve(undefined, "/abs")` does not throw, but for the reason #127 does
not name, and `path.resolve(undefined, "rel")` throws a `TypeError`.

The largest finding is #125's. **A marketplace install does install a plugin's Node dependencies.** It
is automatic, documented, and cannot be turned off, and it was already running for this plugin at
0.1.8, the oldest version cached on this machine. It runs only when the plugin's own root directory
holds a `package.json` **and** a lockfile.
`plugins/anatomiya/` holds a `package.json` and no lockfile, so the install is skipped, and the docs
say it is skipped without a log entry. The repository root does hold `package-lock.json`, and before
the 0.3.0 relocation the plugin root was the repository root. That boundary is visible on disk: the 20
versions up to 0.2.13 have their `node_modules` within a second of their `lib`, and the 6 from 0.3.0 on
have it 47 to 892 seconds later.

## 1. `JSON.parse` takes a whole document or nothing

### The specification defers to ECMA-404, and has no JSON grammar of its own

**doc**, [ECMAScript 2027 draft, 25.5.2.1 ParseJSON](https://tc39.es/ecma262/multipage/structured-data.html#sec-parsejson),
step 1, the whole of the rule:

> If StringToCodePoints(text) is not a valid JSON text as specified in ECMA-404, throw a **SyntaxError**
> exception.

and, in the same clause:

> It is not permitted for a conforming implementation of `JSON.parse` to extend the JSON grammars. If an
> implementation wishes to support a modified or extended JSON interchange format it must do so by
> defining a different parse function.

`JSON.parse` is 25.5.2 and its first step is `Let jsonString be ? ToString(text)` followed by
`Let parseResult be ? ParseJSON(jsonString)`. So the whole argument is the JSON text. There is no
prefix, no offset, and no partial acceptance anywhere in the operation.

Worth naming because the question is often asked in the old terms: the ECMAScript specification no
longer defines a JSON grammar or a `WhiteSpace` production for it. **run**, the multipage table of
contents holds no JSON grammar clause; the only `sec-json-*` anchors are `sec-json`, `sec-json-object`,
`sec-json-parse-record` and `sec-json-serialization-record`. The grammar lives in ECMA-404 and the
specification points at it.

### JSON whitespace is four characters

**doc**, [ECMA-404, 2nd edition, December 2017](https://www.ecma-international.org/wp-content/uploads/ECMA-404_2nd_edition_december_2017.pdf),
section 4, "JSON Text":

> A JSON text is a sequence of tokens formed from Unicode code points that conforms to the JSON value
> grammar.

> Insignificant whitespace is allowed before or after any token. Whitespace is any sequence of one or
> more of the following code points: character tabulation (U+0009), line feed (U+000A), carriage return
> (U+000D), and space (U+0020). Whitespace is not allowed within any token, except that space is
> allowed in strings.

**doc**, [RFC 8259, section 2](https://www.rfc-editor.org/rfc/rfc8259.txt), the same rule as a grammar:

```
JSON-text = ws value ws

Insignificant whitespace is allowed before or after any of the six
structural characters.

   ws = *(
           %x20 /              ; Space
           %x09 /              ; Horizontal tab
           %x0A /              ; Line feed or New line
           %x0D )              ; Carriage return
```

**run**, sixteen candidates, each built from its code point in ASCII-only source so no editor could
rewrite it, tried once leading and once trailing:

| code point | leading | trailing |
|---|---|---|
| U+0009 character tabulation | ok | ok |
| U+000A line feed | ok | ok |
| U+000D carriage return | ok | ok |
| U+0020 space | ok | ok |
| U+000B line tabulation | SyntaxError | SyntaxError |
| U+000C form feed | SyntaxError | SyntaxError |
| U+0085 next line | SyntaxError | SyntaxError |
| U+00A0 no-break space | SyntaxError | SyntaxError |
| U+1680 ogham space mark | SyntaxError | SyntaxError |
| U+2000 en quad | SyntaxError | SyntaxError |
| U+2003 em space | SyntaxError | SyntaxError |
| U+2028 line separator | SyntaxError | SyntaxError |
| U+2029 paragraph separator | SyntaxError | SyntaxError |
| U+202F narrow no-break space | SyntaxError | SyntaxError |
| U+3000 ideographic space | SyntaxError | SyntaxError |
| U+FEFF byte order mark | SyntaxError | SyntaxError |

Four pass. Two of the failures are worth holding: U+000B and U+000C are ECMAScript `WhiteSpace` and are
not JSON whitespace, so a reader who reaches for the language's own rule gets a wider set than the
parser takes. And a leading byte order mark is rejected, so a payload written by something that emits
one never parses.

### The four cases

**run**:

```
(a) complete object then "x"                THREW  Unexpected non-whitespace character after JSON at position 7 (line 1 column 8)
(b) complete object then three U+0020       PARSED {"a":1}
(c) complete object then one U+00A0         THREW  Unexpected non-whitespace character after JSON at position 7 (line 1 column 8)
(d) truncated mid-object                    THREW  Expected ',' or '}' after property value in JSON at position 6 (line 1 column 7)
(e) two complete objects                    THREW  Unexpected non-whitespace character after JSON at position 7 (line 1 column 8)
(f) all four WhiteSpace chars, both ends    PARSED {"a":1}
```

One correction to how the case was posed. A single trailing **U+0020** parses; the character in case
(c) is **U+00A0**, a no-break space, which is not JSON whitespace. Leading and trailing whitespace is
allowed and any amount of it is allowed, but only those four characters count.

### There is no way to parse a prefix and learn where it ended

`JSON.parse` cannot. The specification hands the whole string to ParseJSON, which either accepts it or
throws.

The error carries a position, and only inside its message string. **run**, on node v22.22.3, the error
object for every case above:

```
name: SyntaxError | ctor: SyntaxError
own props: ["stack","message"]
e.position: undefined | e.index: undefined | e.offset: undefined | e.column: undefined | e.lineNumber: undefined
```

Two own properties, `stack` and `message`. No `position`, no `index`, no `offset`, no `column`, no
`lineNumber`, and nothing on the prototype chain either. The number is in the prose:
`"Unexpected non-whitespace character after JSON at position 7 (line 1 column 8)"`. That wording is
V8's, it is not in any specification, and V8 has changed it before. Parsing it back out is reading a
diagnostic string as an API.

So the honest answer is: **no**. Nothing standard and non-deprecated in Node parses a JSON prefix and
reports where it ended. The alternatives are all outside `JSON.parse`: a streaming parser as a
dependency, or reading the fields the code needs without parsing the whole document.

## 2. Stdin, and whether a size bound can be honest

### A split multi-byte character arrives whole, and no empty chunk is emitted

**doc**, [node:string_decoder](https://nodejs.org/docs/latest-v22.x/api/string_decoder.html):

> The `node:string_decoder` module provides an API for decoding `Buffer` objects into strings in a
> manner that preserves encoded multi-byte UTF-8 and UTF-16 characters.

> When a `Buffer` instance is written to the `StringDecoder` instance, an internal buffer is used to
> ensure that the decoded string does not contain any incomplete multibyte characters. These are held
> in the buffer until the next call to `stringDecoder.write()` or until `stringDecoder.end()` is
> called.

**doc**, [readable.setEncoding(encoding)](https://nodejs.org/docs/latest-v22.x/api/stream.html#readablesetencodingencoding):

> The `Readable` stream will properly handle multi-byte characters delivered through the stream that
> would otherwise become improperly decoded if simply pulled from the stream as `Buffer` objects.

**run**. U+1F600 is `f0 9f 98 80`. A writer sends `"A"` plus the first two bytes, waits 1.2 seconds,
then sends the last two bytes plus `"B"`. The reader has `setEncoding("utf8")`:

```
  t+ 602ms chunk 1: length=1 [U+0041]
  t+1802ms chunk 2: length=3 [U+1F600 U+0042]
  end: chunks=2 data.length=4 [U+0041 U+1F600 U+0042]
  Buffer.byteLength(data,"utf8")=6
```

The two orphaned bytes were held back. Chunk 1 is the `"A"` alone. Chunk 2 opens with the whole
character. The same two writes with no `setEncoding` show what is being avoided:

```
  chunk 1: Buffer 3b hex=41f09f naive-toString="A�"
  chunk 2: Buffer 3b hex=988042 naive-toString="��B"
```

One behaviour to hold, because it cost a run here. When a write decodes to nothing, because every byte
in it is an incomplete tail, the stream emits **no** `data` event rather than an empty string. A first
attempt sent the four emoji bytes split two and two with a 1.5 second gap and saw one chunk, not two.
A test that counts chunks to prove the split has to put a complete character on each side of it.

### `data.length` is never a byte count

**run**:

```
=== the same 1 MiB of bytes, four ways ===
1 MiB of ASCII 'a'                       units=  1048576 bytes=  1048576 bytes/unit=1.00 | at units>=1MiB? capped
1 MiB of bytes as U+00E9 (2 bytes each)  units=   524288 bytes=  1048576 bytes/unit=2.00 | at units>=1MiB? not capped
1 MiB of bytes as U+4E2D (3 bytes each)  units=   349525 bytes=  1048575 bytes/unit=3.00 | at units>=1MiB? not capped
1 MiB of bytes as U+1F600 (4 bytes each) units=   524288 bytes=  1048576 bytes/unit=2.00 | at units>=1MiB? not capped

=== the cap the plugin uses: data.length >= 1024*1024 ===
exactly 1 MiB units of ASCII                units=  1048576 bytes=  1048576 capped
exactly 1 MiB units of U+1F600 (2 units ea) units=  1048576 bytes=  2097152 capped
3 MiB of bytes as U+4E2D, only 1 MiB units  units=  1048576 bytes=  3145728 capped
```

and the two directions stated plainly:

```
a payload of 2097152 bytes hits the cap at 1048576 units
a payload of 3145725 bytes (3.00 MiB) never hits it: 1048575 units, cap is 1048576
```

`PAYLOAD_MOST = 1024 * 1024` in `plugins/anatomiya/lib/hook.mjs` is 1,048,576 UTF-16 code units. The
byte size at which it fires runs from 1 MiB, for ASCII, to 3 MiB, for the U+0800 to U+FFFF range where
one unit costs three bytes. Calling it "one megabyte" is right only for an all-ASCII payload, which a
hook payload usually is, since it is JSON carrying paths. It is wrong for a payload carrying non-ASCII
file content, which is exactly the payload the cap exists for.

The reverse case is the one that matters for a bound meant to keep work down: a 3 MiB payload of CJK
text is under the cap and is read whole.

### The cap branch does not always answer `{}`

`readPayload` fires the branch when `data.length >= PAYLOAD_MOST` and parses `cutAt(data, PAYLOAD_MOST)`.
**run**, every shape of input that can reach it:

```
exactly MOST units, a complete document    len= 1048576 capfires=yes kept= 1048576 -> {hook_event_name,tool_name,pad}
MOST units of complete doc + 1 'x'         len= 1048577 capfires=yes kept= 1048576 -> {hook_event_name,tool_name,pad}
MOST units of complete doc + 1 space       len= 1048577 capfires=yes kept= 1048576 -> {hook_event_name,tool_name,pad}
a short doc + padding to over MOST         len= 1048583 capfires=yes kept= 1048576 -> {}
a short doc + whitespace to over MOST      len= 1048583 capfires=yes kept= 1048576 -> {a}
a document genuinely longer than MOST      len= 1048637 capfires=yes kept= 1048576 -> {}
```

Three of six answer a real payload. Issue #126's "every path through that branch answers `{}`" is too
strong. The precise rule is that the branch answers a payload when the JSON text is **exactly**
`PAYLOAD_MOST` units long, whatever follows it, because the cut removes the rest; or when everything
past the document is JSON whitespace, because the parser skips it. Every other input answers `{}`.

The first of those is the comment's own scenario working, and it works only for a document of exactly
1,048,576 units, which is not what the comment means. The issue's direction stands. Its reasoning needs
the narrower statement.

**run**, end to end against the installed 0.4.2, in a repository that has a map, with a 240-byte
payload naming a real file:

```
complete payload + 2MB of 'x'      exit=0 stdout=2b     {}
complete payload + 2MB of spaces   exit=0 stdout=1942b  {"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"<repository-map ...
```

### `destroy()` and `pause()` both release the handle

**doc**, [readable.destroy([error])](https://nodejs.org/docs/latest-v22.x/api/stream.html#readabledestroyerror):

> Destroy the stream. Optionally emit an `'error'` event, and emit a `'close'` event (unless
> `emitClose` is set to `false`). After this call, the readable stream will release any internal
> resources and subsequent calls to `push()` will be ignored.

> Once `destroy()` has been called any further calls will be a no-op and no further errors except from
> `_destroy()` may be emitted as `'error'`.

**doc**, [readable.pause()](https://nodejs.org/docs/latest-v22.x/api/stream.html#readablepause):

> The `readable.pause()` method will cause a stream in flowing mode to stop emitting `'data'` events,
> switching out of flowing mode. Any data that becomes available will remain in the internal buffer.

**run**. A writer opens the pipe, writes nothing, and holds it for 6 seconds. The reader releases stdin
at t+800ms four different ways, and the question is when its process can exit:

| released with | process exit | `destroyed` | `isPaused()` |
|---|---|---|---|
| nothing | t+6006ms | false | false |
| `pause()` | t+804ms | false | true |
| `destroy()` | t+805ms | true | false |
| both | t+805ms | true | true |

Either one is enough on node v22.22.3. With neither, the process waits for the writer. The docs promise
this for `destroy()`, which says it releases internal resources; they do not promise it for `pause()`,
which is documented as a flow-control call and says nothing about the handle. `readPayload` calls both,
which is the safe order to depend on.

The visible consequence, **run**, is that the writer gets a broken pipe once the hook has answered:

```
BrokenPipeError: [Errno 32] Broken pipe
```

## 3. `process.cwd()` when the directory is unlinked

### POSIX does not require ENOENT; macOS and Linux both document it

**doc**, [POSIX getcwd](https://pubs.opengroup.org/onlinepubs/9799919799/functions/getcwd.html):

> The *getcwd*() function shall place an absolute pathname of the current working directory in the
> array pointed to by *buf*, and return *buf*.

Its ERRORS section lists `[EINVAL]` and `[ERANGE]` under shall fail, and `[EACCES]` and `[ENOMEM]`
under may fail. **`ENOENT` is not listed at all**, and nothing on the page says what happens when the
current directory has been removed. So the behaviour every platform actually has is a platform
extension, not a standard guarantee.

**doc**, the macOS man page on this machine, `man 3 getcwd`, under "The getcwd() function will fail if":

> [ENOENT]		A component of the pathname no longer exists.

**doc**, [Linux man-pages, getcwd(3)](https://man7.org/linux/man-pages/man3/getcwd.3.html), ERRORS:

> **ENOENT** The current working directory has been unlinked.

Linux was not run here. Every run in this note is macOS on arm64, and the Linux behaviour is quoted
from its man page rather than measured.

**run**, the C call directly, in a directory removed under the process:

```
$ cc -o getcwd getcwd.c && ( cd /tmp/cold3 && rm -rf /tmp/cold3 && ./getcwd )
getcwd -> NULL, errno=2 (No such file or directory)
```

### Node caches it, and that decides everything

**read**, node v22.22.3, `lib/internal/bootstrap/switches/does_own_process_state.js`:

```js
let cachedCwd = '';

function wrappedChdir(directory) {
  validateString(directory, 'directory');
  rawMethods.chdir(directory);
  // Mark cache that it requires an update.
  cachedCwd = '';
}
function wrappedCwd() {
  if (cachedCwd === '')
    cachedCwd = rawMethods.cwd();
  return cachedCwd;
}
```

The syscall runs once. Every later `process.cwd()` reads the string. Only `process.chdir()` clears it,
plus a snapshot serialize or deserialize.

**run**, warm, a successful call before the removal. The cwd itself removed, and separately its parent
removed:

```
############ CASE A: the cwd itself is removed ############
  process.cwd() before removal       -> ".../gone-a/here"
  removed .../gone-a/here
  process.cwd() call 1 after removal -> ".../gone-a/here"
  process.cwd() call 2 after removal -> ".../gone-a/here"
  process.cwd() call 3 after removal -> ".../gone-a/here"

############ CASE B: the PARENT of the cwd is removed ############
  process.cwd() before removal       -> ".../gone-b/mid/here"
  removed .../gone-b/mid
  process.cwd() call 1 after removal -> ".../gone-b/mid/here"
  process.cwd() call 2 after removal -> ".../gone-b/mid/here"
  process.cwd() call 3 after removal -> ".../gone-b/mid/here"
```

No throw, three calls, a stale path, and the two cases are indistinguishable. **run**, that the cache is
what is answering:

```
  cwd() #1 (warms the cache)             -> ".../ch/a"
  removed the cwd
  cwd() #2 (cache still warm, stale)     -> ".../ch/a"
  chdir(/tmp) ok, cache marked dirty
  cwd() #3 after chdir                   -> "/private/tmp"
```

**run**, cold, node started with its working directory already unlinked, which is what a hook process
gets. This is the case #127 reports and it is the only one that throws:

```
  process.cwd() call 1               -> THREW Error code=ENOENT syscall=uv_cwd errno=-2 message="ENOENT: no such file or directory, uv_cwd"
  process.cwd() call 2               -> THREW Error code=ENOENT syscall=uv_cwd errno=-2 message="ENOENT: no such file or directory, uv_cwd"
```

The error is a plain `Error`, not a `TypeError`. `code` is `"ENOENT"`, `syscall` is `"uv_cwd"`, `errno`
is `-2`, and the message is `"ENOENT: no such file or directory, uv_cwd"`. Both calls throw, because a
throw never populates the cache.

The shell disagrees with the process, which is worth knowing when reproducing this by hand:

```
shell pwd builtin: /private/tmp/.../cold2
/private/tmp/.../cold2
node process.cwd() THREW ENOENT uv_cwd "ENOENT: no such file or directory, uv_cwd"
```

`$PWD` and zsh's `pwd -P` both answer from the shell's own cached string. Only the fresh process asks
the kernel.

> **What shipped differs from the two quotes below.** Both guards read `here === null` rather than
> `here === undefined`, and both readers pass `resolve(here ?? "/", raw)`, so no behaviour of
> `resolve` with an absent first argument is relied on. The measurements are still what they say;
> see "What shipped, where it differs from what this note proposed" at the end.

### `path.resolve()` with no arguments is the load-bearing throw

**doc**, [path.resolve([...paths])](https://nodejs.org/docs/latest-v22.x/api/path.html#pathresolvepaths):

> The given sequence of paths is processed from right to left, with each subsequent `path` prepended
> until an absolute path is constructed.

> If no `path` segments are passed, `path.resolve()` will return the absolute path of the current
> working directory.

> A `TypeError` is thrown if any of the arguments is not a string.

**read**, node v22.22.3 `lib/path.js`, the posix `resolve`, which is the one that runs here:

```js
resolve(...args) {
    if (args.length === 0 || (args.length === 1 && (args[0] === '' || args[0] === '.'))) {
      const cwd = posixCwd();
      ...
    }
    let resolvedPath = '';
    let resolvedAbsolute = false;

    for (let i = args.length - 1; i >= 0 && !resolvedAbsolute; i--) {
      const path = args[i];
      validateString(path, `paths[${i}]`);
      ...
    }

    if (!resolvedAbsolute) {
      const cwd = posixCwd();
      ...
    }
```

Two things are lazy in the same direction. The loop condition carries `&& !resolvedAbsolute`, so it
stops the moment a segment starts with `/`. Earlier arguments are never reached, so they are never
handed to `validateString`. And `posixCwd()` is called only when the loop finished without an absolute
path.

**run**, cold, inside a directory unlinked before node started, with nothing calling `process.cwd()`
first:

```
  -- path.resolve BEFORE any process.cwd() call --
  path.resolve(undefined, "/abs")    -> "/abs"
  path.resolve("/a", "b")            -> "/a/b"
  path.resolve()                     -> THREW Error code=ENOENT syscall=uv_cwd errno=-2 message="ENOENT: no such file or directory, uv_cwd"
  path.resolve(undefined, "rel")     -> THREW TypeError code=ERR_INVALID_ARG_TYPE message="The \"paths[0]\" argument must be of type string. Received undefined"
  path.resolve(undefined)            -> THREW TypeError code=ERR_INVALID_ARG_TYPE message="The \"paths[0]\" argument must be of type string. Received undefined"
```

Four results a fix has to hold apart:

1. **`path.resolve(undefined, "/abs")` does not throw**, and #127 is right that it does not. The reason
   is the loop's early exit, not a tolerance for `undefined`. It is a property of the argument
   list, so it holds for any call whose rightmost non-empty segment is absolute, and it holds whether
   or not there is a working directory.
2. **`path.resolve(undefined, "rel")` throws a `TypeError`**, `ERR_INVALID_ARG_TYPE`, naming `paths[0]`.
   This is not the graceful absent case. A relative path with an absent base is a throw, not a null.
   `targetIn` already guards it: `if (!isAbsolute(raw) && here === undefined) return null`, and
   `aboutDir` ends `here === undefined ? null : deepestDir(resolve(here))`. Both guards are load
   bearing and neither is optional.
3. **`path.resolve()` throws the same `ENOENT` `uv_cwd` error `process.cwd()` throws**, because it is
   the same call behind the same cache. This is the fact the fix rests on: an entry point that catches
   `process.cwd()` and hands `undefined` onward has not removed the throw if anything downstream calls
   `resolve()` with nothing absolute in hand.
4. **The cache means a hook is either always fine or always broken.** A hook process is fresh, reads its
   working directory before anything else could have warmed the cache, and either gets it or throws.
   There is no state where the first call works and a later one does not.

## 4. A plugin install does install dependencies, when a lockfile is at the plugin root

### The documented rule

**doc**, [Claude Code plugins reference, Node.js package
dependencies](https://code.claude.com/docs/en/plugins-reference#node-js-package-dependencies):

> When Claude Code copies a plugin into the cache, it also installs the plugin's Node.js package
> dependencies there, so the plugin's hooks and MCP servers can load them.

> Claude Code runs the install inside the copied version directory each time it creates one: when you
> install a plugin, when Claude Code updates a plugin to a new version, and at session start when an
> enabled plugin isn't cached yet, such as on a new machine. The install runs only when the plugin's
> root directory contains both a `package.json` and a supported lockfile:

> | Lockfile | Command |
> | `bun.lock` or `bun.lockb` | `bun install --frozen-lockfile --ignore-scripts` |
> | `npm-shrinkwrap.json` or `package-lock.json` | `npm ci --ignore-scripts` |

> **No lifecycle scripts:** `--ignore-scripts` keeps `preinstall`, `install`, and `postinstall` scripts
> from running, so dependencies that build native modules in those scripts download but don't compile
> during this install.

> **60-second timeout:** Claude Code stops an install that runs longer and treats it as failed.

> A failed or skipped install never blocks the plugin. When the install fails, or Claude Code skips a
> yarn or pnpm lockfile, it records the reason as a warning in debug output. **A plugin with a
> `package.json` and no lockfile is skipped without a log entry.**

> You can't turn the automatic install off; no setting or environment variable disables it.

### The code, in the installed build

**read**, offsets 162,749,019 and 162,749,783, the table and the function that walks it:

```js
var Qsr=60000,
HNe=[{lockfile:"bun.lock",command:"bun",args:["install","--frozen-lockfile","--ignore-scripts"]},
     {lockfile:"bun.lockb",command:"bun",args:["install","--frozen-lockfile","--ignore-scripts"]},
     {lockfile:"npm-shrinkwrap.json",command:"npm",args:["ci","--ignore-scripts"],
      completionRecord:"node_modules/.package-lock.json"},
     {lockfile:"package-lock.json",command:"npm",args:["ci","--ignore-scripts"],
      completionRecord:"node_modules/.package-lock.json"}];

async function Qae(e){
  let t; try{t=await Xsr(e)}catch(o){if(Ht(o))return{ran:!1};throw o}
  let r=new Set(t);
  if(!r.has("package.json"))return{ran:!1};
  for(let o of HNe){
    if(!r.has(o.lockfile))continue;
    n(`Installing plugin dependencies: ${o.command} ${o.args.join(" ")} in ${e}`);
    let u=await qe(o.command,o.args,{cwd:e,timeout:Qsr,toolCgroupClass:"plugin"});
    if(u.code!==0)return{ran:!0,error:`Plugin dependency install failed (${o.command}): ...`.slice(0,500)};
    return n(`Plugin dependency install succeeded (${o.command}) in ${e}`),{ran:!0}
  }
  if(r.has("yarn.lock")||r.has("pnpm-lock.yaml"))
    return{ran:!1,error:"Skipped: yarn/pnpm lockfiles are not supported (resolution-time hooks bypass --ignore-scripts). Use bun or npm."};
  return{ran:!1}
}
```

Three things the code adds to the prose. `Xsr` is `readdir`, not a recursive walk, so the lockfile has
to be a top-level entry of the plugin root; one in a parent or a subdirectory does not count. The two
silent exits are the early `if(!r.has("package.json"))return{ran:!1}` and the final bare
`return{ran:!1}`, both returning no error, which is the "skipped without a log entry" the docs name.
And `completionRecord` is `node_modules/.package-lock.json`, npm's own hidden lockfile, which every
cached anatomiya version has.

`Qsr` is 60000, matching the documented 60-second timeout.

### There is no install-time lifecycle hook

**doc**, the same reference page's manifest schema. The documented metadata fields are `$schema`,
`displayName`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`,
`metadata`, `defaultEnabled`. The documented component fields are `skills`, `commands`, `agents`,
`workflows`, `hooks`, `mcpServers`, `outputStyles`, `lspServers`, `experimental.themes`,
`experimental.monitors`, `userConfig`, `channels`, `dependencies`. The one called `dependencies` is
about other plugins, not packages:

> Other plugins this plugin requires, optionally with semver version constraints.

No `postinstall`, no `setup`, no `install` field anywhere in either table, and no hook event fires at
install time. Adding one would be silently accepted and would do nothing:

> Claude Code ignores top-level fields it does not recognize.

The documented substitute is a `SessionStart` hook, and the page gives one that reinstalls when
`package.json` changes. It also says, in the same section, that a marketplace-installed plugin usually
does not need it, because the automatic install already ran.

### What the install copies

**read**, offset 162,798,149, the copy step:

```js
if(o&&typeof o.source==="string"&&u){
  let Ke=KNe(u,o.source);
  n(`Copying source directory ${o.source} for plugin ${t}`);
  ...
} else n(`Copying plugin ${t} to versioned cache (fallback to full copy)`),await MHt(e,pe,e,M);
let Fe=Ks(pe,".git");
await Tc(Fe);
```

A directory copy of the marketplace checkout's plugin source directory, then `.git` is removed. Nothing
reads `package.json`'s `files`.

**doc**, [npm docs, package.json `files`](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#files):

> The optional `files` field is an array of file patterns that describes the entries to be included
> when your package is installed as a dependency.

> File patterns follow a similar syntax to `.gitignore`, but reversed: including a file, directory, or
> glob pattern will make it so that file is included in the tarball when it's packed.

It governs the tarball `npm pack` and `npm publish` build. A git-based plugin install builds no
tarball. So `files` in `plugins/anatomiya/package.json` governs nothing about what a plugin install
copies. What governs it is the `source` field in `.claude-plugin/marketplace.json` and what is in the
git checkout. The docs say nothing about `.gitignore` handling either way; the mechanism makes it moot,
since an ignored file is not in the checkout to copy.

### The measurement on this machine, and why 0.3.0 is the boundary

**run**, 26 cached anatomiya versions, `lib` against `node_modules`:

| version | lib | node_modules | gap |
|---|---|---|---|
| 0.1.8 | 08-15 07:57:33 | 08-15 07:57:33 | 0s |
| 0.1.9 | 08-15 14:22:37 | 08-15 14:22:37 | 0s |
| 0.1.10 | 08-15 19:18:34 | 08-15 19:18:34 | 0s |
| 0.1.11 | 08-16 16:43:08 | 08-16 16:43:09 | 1s |
| 0.1.12 | 08-16 23:33:25 | 08-16 23:33:26 | 1s |
| 0.1.13 | 08-17 13:30:12 | 08-17 13:30:12 | 0s |
| 0.2.0 | 08-17 18:21:29 | 08-17 18:21:30 | 1s |
| 0.2.1 | 08-17 21:26:53 | 08-17 21:26:53 | 0s |
| 0.2.2 | 08-18 02:44:10 | 08-18 02:44:11 | 1s |
| 0.2.3 | 08-19 10:56:33 | 08-19 10:56:33 | 0s |
| 0.2.4 | 08-19 13:47:47 | 08-19 13:47:48 | 1s |
| 0.2.5 | 08-20 20:36:40 | 08-20 20:36:41 | 1s |
| 0.2.6 | 08-21 10:03:20 | 08-21 10:03:20 | 0s |
| 0.2.7 | 08-21 10:52:04 | 08-21 10:52:04 | 0s |
| 0.2.8 | 08-21 12:53:33 | 08-21 12:53:34 | 1s |
| 0.2.9 | 08-21 19:21:47 | 08-21 19:21:48 | 1s |
| 0.2.10 | 08-22 02:07:51 | 08-22 02:07:51 | 0s |
| 0.2.11 | 08-22 12:13:18 | 08-22 12:13:18 | 0s |
| 0.2.12 | 08-22 14:11:59 | 08-22 14:11:59 | 0s |
| 0.2.13 | 08-22 22:56:38 | 08-22 22:56:39 | 1s |
| **0.3.0** | 08-24 00:43:15 | 08-24 00:45:58 | **163s** |
| 0.3.1 | 08-24 08:13:42 | 08-24 08:15:24 | 102s |
| 0.3.2 | 08-24 12:30:49 | 08-24 12:45:41 | 892s |
| 0.3.3 | 08-24 23:04:59 | 08-24 23:05:46 | 47s |
| 0.4.1 | 08-29 09:48:04 | 08-29 09:51:56 | 232s |
| 0.4.2 | 08-29 12:25:48 | 08-29 12:28:01 | 133s |

Issue #125's claim, "across the 26 versions cached on this machine, `node_modules` is always younger
than `lib`, by minutes", holds for **6 of 26**. The other 20 are within a second. The issue's own three
sampled rows are all from the 6.

The boundary is exactly 0.3.0, and it is exactly the relocation. **run**, the `source` field in
`.claude-plugin/marketplace.json` across its whole history:

```
917e469 Each plugin is a directory under plugins/, and the root is the marketplace
      "name": "anatomiya",  "source": "./plugins/anatomiya",
399b609 The marketplace carries a second plugin, and nothing here imports it
      "name": "anatomiya",  "source": "./",
cef801f Initial release: a counted map of what a repository already does
      "name": "anatomiya",  "source": "./",
```

**run**, where the lockfile is:

```
  plugins/anatomiya/package-lock.json      absent
  plugins/anatomiya/npm-shrinkwrap.json    absent
  plugins/anatomiya/bun.lock               absent
  plugins/anatomiya/bun.lockb              absent
  (no lockfile tracked under plugins/anatomiya/)

  ./package-lock.json                      PRESENT, tracked

  v0.2.13: root lock = 1 ; plugins/anatomiya lock = 0
  v0.3.0:  root lock = 1 ; plugins/anatomiya lock = 0
  v0.4.2:  root lock = 1 ; plugins/anatomiya lock = 0
```

Up to 0.2.13 the plugin root was the repository root, which ships `package-lock.json`, so the automatic
`npm ci --ignore-scripts` ran and finished within a second of the copy. From 0.3.0 the plugin root is
`plugins/anatomiya/`, which ships no lockfile, so the install is skipped with nothing logged, and
`node_modules` appears only when someone runs `setup` by hand, minutes later.

Two more confirmations of the same story. The cached 0.2.13 has `package-lock.json` at 22:56:38,
the same second as `lib`, so it was copied. The cached 0.4.2 has it at 12:28, the same second as
`node_modules`, so it was written by the `setup` run rather than copied. And the marketplace checkout at
`~/.claude/plugins/marketplaces/crisnahine` holds no `node_modules` anywhere, with `node_modules/` on
line 1 of `.gitignore`, so a copy from it could never carry one.

### A lockfile at the plugin root does fix it, measured

Not inferred. **run**, in a scratch directory holding nothing but a copy of
`plugins/anatomiya/package.json`:

```
$ npm install --package-lock-only
$ ls -l package-lock.json
-rw-r--r--  15255  package-lock.json

$ time npm ci --ignore-scripts        # the exact command the build runs
found 0 vulnerabilities
npm ci --ignore-scripts  0.558 total

$ ls -1 node_modules
@oxc-parser  @oxc-project  flow-remove-types  hermes-estree  hermes-parser
node-modules-regexp  oxc-parser  pirates  typescript  vlq

$ node --input-type=module -e 'const o=await import("oxc-parser");const r=o.parseSync("a.js","const x=1;");console.log("oxc parsed ok, errors:",r.errors.length)'
oxc parsed ok, errors: 0
$ node --input-type=module -e 'const f=await import("flow-remove-types");console.log("flow-remove-types loaded:", typeof (f.default??f))'
flow-remove-types loaded: function
```

0.56 seconds against a 60-second budget. All ten packages. Both engines load, and oxc parses. The
`--ignore-scripts` flag costs nothing here because none of these packages compiles in a lifecycle
script; `oxc-parser` ships its platform binary as an optional dependency.

The generated lockfile is byte-identical to the one `setup` wrote into the 0.4.2 cache directory:

```
$ diff -q lockprobe/package-lock.json ~/.claude/plugins/cache/crisnahine/anatomiya/0.4.2/package-lock.json
  IDENTICAL
```

So the file that would make the install run is the file `setup` already produces, two minutes later, in
the same place.

### Size limits

**doc**, [plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces), two limits, both
tied to a source type:

> Claude Code refuses archives larger than 256 MiB.

> Claude Code refuses to install a directory larger than 256 MiB or containing more than 20,000 entries.

The second is `command` sources in copy mode. **There is no documented size limit for `github`, `url`,
`git-subdir`, or relative-path sources**, which is what this marketplace uses.

A policy for or against vendoring `node_modules` in a plugin is **not documented**. The nearest
statement is the opposite, for link mode, which expects it:

> Claude Code also skips the Node.js package dependency install for a link-mode plugin, so print a
> directory that already contains any `node_modules` the plugin needs.

## What is a documented contract

- `JSON.parse` accepts one whole JSON text and throws `SyntaxError` otherwise, ECMAScript 25.5.2 and
  25.5.2.1, deferring to ECMA-404 for the grammar. JSON whitespace is U+0009, U+000A, U+000D, U+0020,
  ECMA-404 section 4 and RFC 8259 section 2.
- `setEncoding` preserves multi-byte characters across chunk boundaries, and `string_decoder` says how.
- `readable.destroy()` releases internal resources. `readable.pause()` stops `'data'` events.
- `path.resolve` processes right to left, uses the working directory when no segment is absolute, and
  throws `TypeError` for a non-string argument.
- `getcwd` returns an absolute pathname; POSIX lists `EINVAL`, `ERANGE`, `EACCES` and `ENOMEM` and does
  not list `ENOENT`. macOS and Linux each document `ENOENT` for a removed directory in their own man
  pages.
- The plugin dependency install: that it happens, the lockfile table, `--ignore-scripts`, the
  60-second timeout, that a `package.json` with no lockfile is skipped with nothing logged, and that
  it cannot be disabled.
- The plugin cache at `~/.claude/plugins/cache`, one directory per version, grouped by marketplace and
  plugin.
- The plugin manifest schema, and that unrecognized top-level fields are ignored.
- The 256 MiB limits for `archive` and `command` copy-mode sources.

## What is one build's or one platform's behaviour

- Every V8 `SyntaxError` message string, including `"Unexpected non-whitespace character after JSON at
  position 7 (line 1 column 8)"`, and that the error carries only `stack` and `message` as own
  properties. The position is in the prose and nowhere else.
- That Node caches `process.cwd()` and invalidates only on `chdir`. It is in Node's source, not in the
  `process.cwd()` documentation.
- That `path.resolve()`'s cwd read and its argument validation are both skipped once a segment is
  absolute. Read out of `lib/path.js`; the docs say "processed from right to left" and stop there.
- The exact error shape `Error`, `code: "ENOENT"`, `syscall: "uv_cwd"`, `errno: -2`.
- That `pause()` alone releases the stdin handle enough for the process to exit.
- That a decode producing an empty string emits no `data` event.
- The `HNe` lockfile table and `Qae` in build 2.1.251, the non-recursive `readdir`, and
  `completionRecord: "node_modules/.package-lock.json"`.
- That the plugin install is a directory copy with `.git` removed afterwards.

## What could not be established

- **Linux.** Every run was macOS on arm64. The Linux `getcwd` ENOENT behaviour is quoted from
  man7.org, not measured. The same goes for anything about `uv_cwd` on another platform.
- **Windows.** Not touched at all. `path.win32.resolve` has a second `process.cwd()` call for
  drive-relative paths that the posix branch does not, and it was not exercised.
- **Whether `npm ci --ignore-scripts` succeeds on a platform other than darwin-arm64.** The run here
  resolved `@oxc-parser/binding-darwin-arm64`. A lockfile pins the optional binaries for every
  platform it was generated with; the one that shipped carries all nineteen `@oxc-parser` bindings, so every runner is covered, and a CI leg installs from it on Linux.
- **Whether the automatic install fires on this account's next anatomiya upgrade.** No install was
  performed for this note. The claim rests on the build's code, the docs, and the mtime boundary at
  0.3.0, not on a fresh install watched end to end.
- **What the debug output says when the install is skipped.** The docs say a missing lockfile is
  skipped with no log entry, and the code returns `{ran:!1}` with no error. No debug session was run
  to confirm the silence from the other side.
- **Whether a JSON payload can carry enough non-ASCII to matter.** The 1 MiB to 3 MiB spread is real
  arithmetic. No real hook payload was measured with a byte-to-unit ratio above 1.
- **Whether V8's message wording is stable within a Node major.** One version was tested. The wording
  has changed across V8 releases before.

## Reproducing this

The JSON and path runs need nothing but node. Build every non-ASCII character from its code point in
ASCII-only source; an invisible character pasted into a test is the one thing that will make the result
wrong without saying so.

```sh
# the cold cwd case: node must START with the directory already gone
mkdir -p /tmp/cold && ( cd /tmp/cold && rm -rf /tmp/cold && node /abs/path/to/probe.mjs )

# the warm case, for contrast: call process.cwd() once before removing
node -e 'process.cwd(); require("fs").rmSync(process.argv[1],{recursive:true,force:true}); console.log(process.cwd())' /tmp/warm

# the split character: a complete character must sit on each side of the split,
# or the empty-decode write emits no data event and you see one chunk
python3 -c "
import sys, time
b = '\U0001F600'.encode('utf-8')
time.sleep(0.6); sys.stdout.buffer.write(b'A' + b[:2]); sys.stdout.buffer.flush()
time.sleep(1.2); sys.stdout.buffer.write(b[2:] + b'B'); sys.stdout.buffer.flush()
" | node reader.mjs
```

The plugin-install check is three commands and touches nothing:

```sh
P=~/.claude/plugins/cache/crisnahine/anatomiya
for v in $(ls -1 "$P" | sort -V); do
  printf '%-8s lib=%s node_modules=%s\n' "$v" \
    "$(stat -f '%Sm' -t '%F %T' "$P/$v/lib")" \
    "$(stat -f '%Sm' -t '%F %T' "$P/$v/node_modules" 2>/dev/null || echo NONE)"
done
ls plugins/anatomiya/package-lock.json plugins/anatomiya/npm-shrinkwrap.json 2>&1
```

The bundle reads use `LC_ALL=C grep -a -b -o -F -e '<literal>'` for offsets, then a seek and read of a
few kilobytes around each. Quote the pattern with `-e` when it starts with a dash, or `ugrep` reads it
as an option. The file is 197 MB and a wide context pattern is refused by the stock macOS `grep`.

## Sources

Specifications:

- [ECMAScript 2027 draft, 25.5.2 JSON.parse and 25.5.2.1 ParseJSON](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.parse)
- [ECMA-404, 2nd edition, December 2017](https://www.ecma-international.org/wp-content/uploads/ECMA-404_2nd_edition_december_2017.pdf), section 4
- [RFC 8259, section 2](https://www.rfc-editor.org/rfc/rfc8259.txt)
- [POSIX getcwd](https://pubs.opengroup.org/onlinepubs/9799919799/functions/getcwd.html)
- [Linux man-pages, getcwd(3)](https://man7.org/linux/man-pages/man3/getcwd.3.html)
- `man 3 getcwd` on this machine

First-party documentation:

- [Node v22, string_decoder](https://nodejs.org/docs/latest-v22.x/api/string_decoder.html)
- [Node v22, stream: setEncoding, destroy, pause](https://nodejs.org/docs/latest-v22.x/api/stream.html)
- [Node v22, path.resolve](https://nodejs.org/docs/latest-v22.x/api/path.html#pathresolvepaths)
- [npm, package.json `files`](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#files)
- [Claude Code plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [Claude Code plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)

Published source, read at v22.22.3:

- `lib/internal/bootstrap/switches/does_own_process_state.js`, `cachedCwd`, `wrappedCwd`, `wrappedChdir`
- `lib/path.js`, the posix `resolve`

The installed build, `<home>/.local/share/claude/versions/2.1.251`, 197,171,680 bytes. Named sites: the
dependency-install table `HNe` at 162,749,019, its log line at 162,749,783 and its yarn/pnpm refusal at
162,750,227; the plugin copy step at 162,798,149; the cache path helpers and the `.orphaned_at`,
`.in_use`, `.gcs-sha`, `.links_materialized` markers at 157,433,627; the installed-plugins reader at
162,713,312.

This repository:

- `plugins/anatomiya/lib/hook.mjs` (`PAYLOAD_MOST`, `cutAt`, `asPayload`, `readPayload`, `aboutDir`,
  `targetIn`), `plugins/anatomiya/bin/anatomiya.mjs` (the `process.cwd()` line inside the guard),
  `plugins/anatomiya/package.json`, `package.json`, `.claude-plugin/marketplace.json`, `.gitignore`
- `docs/research/what-a-hook-payload-carries.md` and
  `docs/research/what-a-pretooluse-hook-can-do.md`, whose wire-capture and bundle-read recipes this
  reuses
- issues #125, #126, #127

## What shipped, where it differs from what this note proposed

Added after the fixes landed, because two passages here read as a design and the code took another
one. This note rests #127's fix on `path.resolve(undefined, "/abs")` not throwing, and quotes both
guards as `here === undefined`. What shipped does neither: the base is picked once, by `baseIn`,
which answers `null` rather than `undefined` because this repository returns null for an absent
value at 125 of 129 sites; and the readers pass `resolve(here ?? "/", raw)`, so no node behaviour
about an absent first argument is relied on at all. Section 3's measurements are still what they
say they are, and `test/hook.test.mjs` pins them; they are belt and braces rather than the load.

For #126, this note treats the branch as choosing between keeping and discarding the capped prefix.
What shipped keeps it and reads it: `JSON.parse` first, and where that refuses, the members that can
still be taken out of the text. Section 1's finding, that there is no standard way to parse a JSON
prefix, is why that reader had to be written rather than borrowed.

## What this means for the three issues

**#127 is right about the symptom and needs one more fact.** `process.cwd()` does throw
`ENOENT`/`uv_cwd` in a hook process whose directory was unlinked, and reading it defensively at the
entry point is the fix. The fact the issue does not have is that Node caches the value, so the throw is
all or nothing per process: a hook either gets its directory or never does. That makes the failure
total for the session, as the issue reports, and it also means a test has to start a process with the
directory already gone. Removing the directory after the test process has called `process.cwd()` once
proves nothing, because the cache answers. The issue's own note, that
`path.resolve(undefined, "/abs")` did not throw and should be pinned by a test, is confirmed, but the
reason is `resolve`'s early exit rather than tolerance for `undefined`. `path.resolve(undefined, "rel")`
throws a `TypeError`, and `path.resolve()` throws the same `ENOENT` as `process.cwd()`, so the guards
in `targetIn` and `aboutDir` are what keep the absent base safe and neither can be dropped.

**#126 is right about the direction and overstates the claim.** `JSON.parse` rejects trailing anything
that is not one of four whitespace characters, and a truncated document never parses. But the branch
answers a real payload in three shapes, not zero: a document of exactly `PAYLOAD_MOST` units, that
document with any trailing bytes, since the cut removes them, and any document followed only by JSON
whitespace. The issue's second option is the one the evidence supports. The hooks read four small
fields and discard the rest, so the cap is bounding work rather than data, and the branch cannot serve
the case it names while it parses the whole slice. One thing to fix alongside it: the bound counts
UTF-16 units, so "one megabyte" is 1 MiB only for ASCII and up to 3 MiB otherwise. Whichever way the
branch goes, the name should stop claiming bytes.

**#125's premise is wrong, and the fix is one tracked file.** A marketplace install does install a
plugin's Node dependencies, automatically, at install and at update and at session start, and it cannot
be turned off. It runs only when the plugin's own root holds a `package.json` and a lockfile.
`plugins/anatomiya/` holds a `package.json` and no lockfile, so it is skipped, silently, by design. It
was not always so: up to 0.2.13 the plugin root was the repository root and the root lockfile made it
run, which is why 20 of 26 cached versions have `node_modules` within a second of `lib`. The 0.3.0
relocation moved the plugin root away from the lockfile and nobody noticed, because the failure has no
message.

Adding `plugins/anatomiya/package-lock.json` makes `npm ci --ignore-scripts` run inside every new
version directory. Measured here at 0.56 seconds against a 60-second budget, all ten packages, with
both engines loading and oxc parsing. The file is byte-identical to the one `setup` already writes.
None of the three things the issue asks for is then needed: there is no per-version step to document,
no half-installed state for `doctor` to describe, and nothing to vendor. `setup` should stay, for a
checkout run from source and for the case where the install fails or times out, but it stops being
something a user has to know about.

Two smaller things fall out of the same reading. The `files` array in `plugins/anatomiya/package.json`
governs nothing here; it shapes an `npm pack` tarball, and a git-based plugin install builds none, so
adding a lockfile to `files` is neither necessary nor sufficient. And a lockfile at the plugin root has
to be a real top-level entry of that directory: the build calls `readdir` on the plugin root and
nothing deeper, so the root lockfile two levels up is invisible to it.
