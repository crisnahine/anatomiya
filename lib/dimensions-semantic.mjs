/**
 * Dimensions that need the type checker, and only reach a scan run with
 * `--deep`.
 *
 * A row here takes `({ ts, checker, source }, add)` rather than the syntactic
 * `(program, add)`. Two shapes on purpose: a signature that is sometimes a
 * checker and sometimes an AST is how a row ends up asking a program for a type
 * and getting `undefined` on every site.
 *
 * This module imports nothing of ours (F16). The registry reaches it, not the
 * other way round.
 */
export const SEMANTIC_DIMENSIONS = [];
