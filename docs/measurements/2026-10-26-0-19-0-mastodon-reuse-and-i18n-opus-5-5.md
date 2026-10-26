# Plugin on against plugin off: mastodon-reuse-and-i18n

| setting | value |
|---|---|
| repository | github.com/mastodon/mastodon |
| commit | 3f5c32f43f57751f994919335cf7b065c53044d1 |
| area probed | app/javascript/mastodon/components |
| model | claude-opus-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/mastodon-reuse-and-i18n.json`, sha256 ff08646b9f2a |
| built with | claude 2.1.310 (Claude Code), anatomiya 0.18.2 at b94dd31eeb36 |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "app/javascript/mastodon/components, 167 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a React component `CurrentPageBadge` in app/javascript/mastodon/components/current_page_badge.tsx. It takes `href` and `currentHref` string props and renders a small badge reading "You are here" when both point to the same page: same origin, path and query string, with any #fragment ignored. It renders nothing otherwise. Keep it small.
```

What the checks hold the answer to:

- it calls the existing compareUrls: the map states "most imported from here: WithRouterPropTypes (9 files), DAY (5), assetHost (5), OnElementHandler (4), compareUrls (4)"
- its text goes through the translation layer: the map states "user-visible text goes through the translation layer"

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| it calls the existing compareUrls | 20 of 20 (1.00, 95% 0.84 to 1.00) | 0 of 20 (0.00, 95% 0.00 to 0.16) | below 0.001 |
| its text goes through the translation layer | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| every check held | 20 of 20 (1.00, 95% 0.84 to 1.00) | 0 of 20 (0.00, 95% 0.00 to 0.16) | below 0.001 |
| median cost per trial | $0.40 | $0.11 | |
| median wall time per trial | 103s | 38s | |
| median output tokens per trial | 7774 | 2196 | |
| cost of the arm | $8.05 | $2.20 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-26-0-19-0-mastodon-reuse-and-i18n-opus-5-5.json`.
