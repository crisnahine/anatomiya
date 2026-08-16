/**
 * The three slices of a repository-relative path every roster module takes.
 *
 * Kept here rather than three copies because they are read together: a rule
 * that matches on the basename and a rule that matches on the directory have to
 * agree on where one ends, and one copy drifting is a file counted twice.
 *
 * String slicing rather than `node:path`, since a corpus path is always posix
 * and `dirname` answers "." at the top level, which is a directory name no
 * repository has.
 */

export const baseOf = (rel) => rel.slice(rel.lastIndexOf("/") + 1);

export const dirOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

// A dot in a directory name is not this file's extension.
export const withoutExtension = (rel) => {
  const dot = rel.lastIndexOf(".");
  return dot > rel.lastIndexOf("/") ? rel.slice(0, dot) : rel;
};
