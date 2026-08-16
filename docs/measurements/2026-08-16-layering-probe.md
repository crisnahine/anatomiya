# Layering probe: import-direction claims do not survive their own gates

Date: 2026-08-16. Question: can a per-area "imports follow the repository's layer direction"
claim be counted from the baseline import graph and clear the gate battery this tool already
uses? Probe: ESM import statements with relative specifiers, resolved against the corpus,
aggregated into between-area edges, on four repositories from the measurement corpus. The probe
script was throwaway and is not committed.

## Numbers

| repo | files | areas | relative specifiers | resolved | cross-area edges | pairs n>=6 | one-way at 0.9 | at the Wilson gate | fragile |
|---|---|---|---|---|---|---|---|---|
| eslint | 853 | 29 | 5 | 2 | 0 | 0 | 0 | 0 | 0 |
| webpack | 11,925 | 403 | 3,895 | 2,563 | 137 | 8 | 7 | 0 | 2 |
| storybook | 4,688 | 258 | 7,646 | 7,229 | 2,327 | 118 | 66 (55.9%) | 1 | 37 of 66 |
| vscode | 12,215 | 500 | 113,589 | 112,694 | 87,879 | 3,076 | 2,867 (93.2%) | 473 (15.4%) | 1,018 of 2,867 |

"Fragile" is an established pair whose direction flips below 0.9 if one edge is removed.

## What the numbers say

1. **A require() repository is invisible.** eslint writes CommonJS: 853 files produced five
   relative import statements. webpack is mostly the same. An ESM-only site definition blinds
   the claim on half the JavaScript world, and adding require() parsing widens the machinery
   before the claim has earned it.
2. **The graph is sparse where it exists.** webpack's 11,925 files yield 8 area pairs with six
   or more edges. Most relative imports stay inside their own area, which is what area
   discovery already optimises for.
3. **At this tool's own evidence bar, almost nothing states.** The Wilson lower bound at 0.90,
   the gate every other dimension passes, is reached by 0 pairs on webpack, 1 of 118 on
   storybook, and 473 of 3,076 on vscode. Point-ratio establishment looks strong on vscode
   (93.2%) and then a third of it is one removed edge away from flipping.

## Decision

The hypothesized `import_direction` dimension is not built. The decision gate in the
implementation plan asked for at least 30% of enough-edge pairs establishing a stable direction
on at least 3 of 4 repositories; the result is 0 of 4 at the tool's own evidence bar, and 1 of 4
(vscode, 60%) even on the loose point-ratio-minus-fragile reading. Stating layering claims at a
weaker bar than every other claim would make the map's least verifiable sentence its least
evidenced one.

What stands instead: the capability-routing rows already carry the reviewable half of the
layering complaint (framework-default code instead of the repository's wrapper), and they count
sites a single file shows.

Revisit only with a shape that (a) reads require() as well as import, and (b) states per
forbidden edge with real evidence, not per area over a direction average.
