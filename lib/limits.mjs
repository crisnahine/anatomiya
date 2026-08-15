/**
 * The bounds more than one module has to agree on, in a module that imports
 * nothing.
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
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
