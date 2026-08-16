/**
 * The bounds, and the one platform rule, that a module loaded inside a forked
 * parse worker has to be able to read without dragging anything in with it.
 *
 * A leaf on purpose, and that is what decides what lives here: the worker is
 * forked per file batch and everything it imports is loaded eight times over.
 *
 * A leaf on purpose. Every obvious home costs something: the per-file ceiling in
 * the corpus pulls the corpus and its git runner into each forked parse worker,
 * which then loads `node:child_process` and a table of deny regexes before it
 * can read its first file, and no parser can own it without a cycle through
 * `parse.mjs`.
 */

/**
 * The largest file any reader of this tool will take.
 *
 * The JS pool's skip, the Ruby script's skip, and every blob read, which take it
 * through `showBlob`. Two of them disagreeing splits one file's fate by which
 * side is asking: a blob refused at a size the parser accepts reports the whole
 * area as a population change, against a file that parses at HEAD.
 *
 * A source file above it is generated or minified, and skipping one is reported
 * rather than silently folded into the counts.
 *
 * One megabyte, measured across a 35-repository corpus: no hand-written source
 * file exceeds 850 KB (vscode.d.ts at 725 KB is the largest), while every file
 * between 1 and 4 MB is a bundle, compiled output or a perf fixture. Those sat
 * at the 5 s parse timeout boundary under the old 4 MB cap and flipped between
 * crashed and parsed with machine load, and each flip moved the always-loaded
 * overview (A5). A size cap is deterministic; a wall-clock timeout is not, which
 * is why a parse the clock killed is tried once more after the queue drains,
 * where the count holds still under load.
 */
export const MAX_FILE_BYTES = 1024 * 1024;

/**
 * Whether the raw parser transfer may be asked for on this platform.
 *
 * oxc hands its tree across from Rust without a serialisation step, which
 * measured 3.06x on the parse itself. To do it, it allocates a 6 GiB buffer per
 * parsing operation and takes the 4 GiB-aligned window inside it. Almost none
 * of those pages is ever touched, so where the kernel overcommits this costs
 * address space and nothing else.
 *
 * Windows commits at allocation. This pool runs up to eight workers, each
 * parsing, and Windows is also the one platform where the pool's own memory
 * guard stands down, because there is no `ps` to poll with. `rawTransferSupported()`
 * asks about pointer width and the Node version and never about the platform,
 * so the refusal has to live here. The parser answers the same tree either way;
 * only the speed differs.
 */
export const rawTransferAllowed = (platform = process.platform) => platform !== "win32";
