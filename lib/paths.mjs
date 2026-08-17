/**
 * The slices of a repository-relative path every roster module takes.
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

// A dot in a directory name is not this file's extension, and neither is the
// leading dot of a dotfile: stripping that one leaves no name at all.
export const withoutExtension = (rel) => {
  const dot = rel.lastIndexOf(".");
  return dot > rel.lastIndexOf("/") + 1 ? rel.slice(0, dot) : rel;
};

// Everything from the last dot of the name, or the label a file with none is
// counted under, which on Ruby is a Rakefile. A leading dot is the whole name
// of a dotfile rather than the start of an extension, so `.env` has none.
export const extOf = (rel) => {
  const base = baseOf(rel);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "(none)";
};

// The other half of that split: the name a namesake test is matched on.
export const stemOf = (rel) => {
  const base = baseOf(rel);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
};
