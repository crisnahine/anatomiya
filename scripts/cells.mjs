/**
 * The cells two measurement tables share, so the corpus run and the layout
 * measurement print one reading of a record and neither loads the other.
 */

/**
 * The checker's answer for one repository, off its facts record: the status and
 * rate when it ran, and the reason when it did not, so a corpus that never ran
 * it says so in every row.
 */
export function semanticCell(semantic) {
  if (!semantic) return "-";
  if (!semantic.ran) return `off ${semantic.reason}`;
  const rate = semantic.typedResolutionRate;
  return [semantic.status, semantic.reason, rate === null ? null : `${(rate * 100).toFixed(1)}%`].filter(Boolean).join(" ");
}
