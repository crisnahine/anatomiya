# How a growth test's ratio reads on the CI runners (2026-10-12)

`test/growth.mjs` times work at n and at 2n and refuses a ratio of 3 or more (DECISIONS F26). Linear
work reads about 2. On the GitHub runners some reads of linear work came out past 3.

## Reads past 3 in CI

| run | leg | test | read |
| --- | --- | --- | --- |
| 37293047045 | Node 24, Windows | `rules.test.mjs`, the same shape closed at the end | 3.32 |
| 37401210560 | Node 24, Windows | `rules.test.mjs`, the same shape closed at the end | 3.31 |
| 37560053778 | Node 24, Windows | `encode.test.mjs`, the cap bounds the length | 3.43 |
| 38182558688 | Node 24, macOS | `rules.test.mjs`, a directory of names in another case | 3.16 |
| 38186753762 | Node 22, Ubuntu | `rules.test.mjs`, an unclosed frontmatter | 3.15 |
| 38186753762 | Node 24, Windows | `introduced.test.mjs`, alike copies edited at both ends | 3.51 |
| 38187642812 | Node 24, Windows | `dimensions.test.mjs`, a chain of `!` links (on main) | 3.25 |
| 38188845786 | Node 24, macOS | `rules.test.mjs`, a directory of names in another case | 3.10 |

Each of these tests passed on the other legs of the same run and in the runs after it.

## What the reads depend on

Run 38188290422 timed the `isOwned` work alone on all six legs, three reads for each of five sizes
from 2,000 to 24,965 lines, and again at 4,000 and 24,965 lines beside three processes that stream
64 MB and allocate. Every read was between 1.81 and 2.49: neither the size nor plain CPU contention
moves it past 3.

Run 38188845786 ran the whole suite on all six legs, every growth test logging two reads of the same
rounds: the harness's, where the larger side runs as many calls as the smaller and so twice as long,
and one where the larger side runs half the calls, so both run as long. Over 156 paired reads, 9 of
the harness's reads and 10 of the other's are 2.5 or more, and 1 of the harness's and 3 of the
other's passed 3: `rules.test.mjs`, a directory of names in another case, 3.105 and 3.050 in the
same round, and `walk.test.mjs`'s nested shapes at 3.030 and 3.162 for the other alone. Running the
two sides equally long is not what keeps a read under 3.

## What the harness does

A read of 3 or more is taken again, up to three reads, and the smallest stands. Linear work that
read past 3 read under it on the other legs and in later runs. Quadratic work reads about 4, and
each case F26 checked by putting its quadratic code back read 3.55 or more, so the check still
refuses it.
