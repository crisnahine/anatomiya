# Why the calls of one batch delivered twice on Windows (2026-10-12)

The batch tests in `test/hook-verbs.test.mjs` start 2, 3 or 8 echo processes at once and count the
deliveries; one per batch is the answer. On GitHub's Windows runners they gave 2 in a few rounds, on
Node 22 and on Node 24, and never on macOS or Ubuntu.

## How it was measured

The build at 8b63517a with one change: each echo call printed on stderr what it decided and why (the
lock taken, held by the batch claim, delivered, or the error that made it answer alone), and the
batch helper printed every call's lines for a round that did not deliver once. The workflow ran on
`windows-latest` only, Node 22 and Node 24, and ran the batch tests three times on each: 2 processes
for 20 rounds over a dead lock, 3 and 8 for 20 rounds each with no batch claim and with a stale one,
and 3 and 8 for 50 rounds each over a dead lock. The same build was then run with the exclusive
create tried again on EPERM (84caad8f), printing each refused create. The two runs are 38179920206
(8b63517a) and 38180569792 (84caad8f); their logs hold 6 and 12 lines naming EPERM, one per refused
create.

## What it showed

| build | leg | rounds that delivered twice | what each of them shows |
| --- | --- | --- | --- |
| 8b63517a | Node 24 | 4 | one call's exclusive create answered EPERM, so that call answered alone while another took the lock and delivered |
| 8b63517a | Node 22 | 2 | the same |
| 84caad8f | Node 24 | 0 | 8 creates answered EPERM at the first try, each taken on the first retry |
| 84caad8f | Node 22 | 0 | 4 creates answered EPERM at the first try, each taken on the first retry |

Five of the six refused creates were of the lock, one of a lock token. No call of a batch answered
alone for any other reason, and no removal was refused. Windows answers EPERM, not EEXIST, to a
create of a name another process is still deleting; the name frees in milliseconds, which is why one
retry was enough every time it happened.
