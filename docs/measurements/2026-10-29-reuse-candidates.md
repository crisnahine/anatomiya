# The reuse check names the index's candidates

Date: 2026-10-29. Harness: `scripts/ab-scenario.mjs` (G18). Claude Code 2.1.312. Model Claude Haiku 5.5
at medium effort, 10 sessions per arm, each from a clean checkout, on the four reuse tasks 0.20.0 was
measured on (`2026-10-28-code-index.md`).

The build is commit 0d52e968, frozen as a copy before its first session. Each task's page says
"anatomiya 0.20.0" because the manifests were moved to 0.21.0 after the runs; the plugin's code at
0d52e968 is the code 0.21.0 ships, byte for byte (`git diff 0d52e968 v0.21.0 -- plugins/anatomiya/lib`
is empty).

## What changed in the reason

On a block, the reason now lists, as of the last scan, the definitions the code index holds nearest
each name the turn's added lines declare, from code the added file can call (A126). Read off the
sessions' own transcripts, the list was in the reason of every mastodon block, 9 of 10 gitea blocks
and 4 of 10 eslint blocks; the rest named no definition the index held near enough.

## Sessions that called the helper

| task | with anatomiya | mean cost | without | 0.20.0 with, 20 per arm |
|---|---|---|---|---|
| atuin `uuid_v7` | 10/10 | $0.0144 | 0/10 | 20/20, $0.0133 |
| eslint `unIndent` | 9/10 | $0.0209 | 0/10 | 20/20, $0.0197 |
| gitea `db.GetEngine` | 10/10 | $0.0126 | 10/10 | 18/20, $0.0124 |
| mastodon `TagManager#local_url?` | 5/10 | $0.0168 | 0/10 | 9/20, $0.0173 |

34 of 40 sessions called the helper, against 67 of 80 on 0.20.0, and the mean of the task means is
$0.0162 against $0.0157, the longer reason costing about 3%. Ten sessions per arm cannot tell any
task's difference from 0.20.0 from chance, so this says the build holds the 0.20.0 result, and claims
no gain.

Mastodon's check asks for one helper, and a session can reach for another that also exists. Read off
the `app/lib/link_policy.rb` each session left, 9 of 10 called an existing `TagManager` helper:
5 `local_url?`, 2 `ActivityPub::TagManager#local_uri?` and 2 another `TagManager` method; 1 wrote its
own host comparison. On 0.20.0 it was 19 of 20.

## A live session

`claude -p` with the same mastodon task, outside the harness, on the build before the runtime filter:
the map was delivered, area files loaded as the session read, the notice fired before the new file,
and the Stop hook blocked once. The session then replaced its own host check with
`TagManager.instance.local_url?`. Its reason listed TypeScript definitions for a Ruby file
(`getLinks`, `LinkedDisplayName`), which is what the runtime filter in the measured build removed.

Each task's page is `2026-10-29-candidates-<task>-haiku-5-5.md`, with every session in
`data/2026-10-29-candidates-<task>-haiku-5-5.json`.
