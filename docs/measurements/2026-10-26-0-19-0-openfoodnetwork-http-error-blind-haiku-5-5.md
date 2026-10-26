# Plugin on against plugin off: openfoodnetwork-http-error-blind

| setting | value |
|---|---|
| repository | github.com/openfoodfoundation/openfoodnetwork |
| commit | 4e121e10f1acde5aa975a4b8a37c421f2080565d |
| area probed | app/components |
| model | claude-haiku-5-5 |
| effort | medium |
| context window | 1000000 |
| trials per arm | 20, alternating, each from a clean checkout |
| tools | Read, Write, Edit, Glob, Grep, Bash, Agent |
| max turns | 40 |
| scenario | `scripts/ab/scenarios/openfoodnetwork-http-error-blind.json`, sha256 0d76defc4355 |
| built with | claude 2.1.310 (Claude Code), anatomiya 0.18.2 at b94dd31eeb36 |

Arm A runs with the plugin and its map. Arm B runs with neither. Nothing else differs.
Injection: arm A answered "app/components 28 files", arm B answered "NONE".

The task, given to both arms word for word:

```text
Add a Stimulus controller in app/components/resend_confirmation_component/resend_confirmation_controller.js. Its `resend` action sends a POST with `fetch` to the URL in its `url` value, and when the request fails it alerts the user with a translated message: `errors.unauthorized.message` for a 401 status, `errors.network_error.message` when there is no response at all, and `errors.general_error.message` for a status of 500 or above. Keep it small.
```

| measure | plugin on | plugin off | p (Fisher, two-sided) |
|---|---|---|---|
| trials cut short by the turn cap or an error | 0 of 20 | 0 of 20 | |
| trials that did the task | 20 of 20 (1.00, 95% 0.84 to 1.00) | 20 of 20 (1.00, 95% 0.84 to 1.00) | 1.000 |
| it calls the existing showHttpError | 20 of 20 (1.00, 95% 0.84 to 1.00) | 7 of 20 (0.35, 95% 0.18 to 0.57) | below 0.001 |
| every check held | 20 of 20 (1.00, 95% 0.84 to 1.00) | 7 of 20 (0.35, 95% 0.18 to 0.57) | below 0.001 |
| median cost per trial | $0.014 | $0.004 | |
| median wall time per trial | 80s | 32s | |
| median output tokens per trial | 11053 | 3327 | |
| cost of the arm | $0.30 | $0.086 | |

## Reading this

A check counts only the trials that did the task and gave it something to judge, so an arm cannot
pass by writing nothing. "Every check held" counts a trial only where each check held, so a check
with nothing to judge in that trial keeps it out. The interval is the Wilson score interval at 95%.
A p below 0.05 is a difference this many trials can tell from chance. A p above it means this run
cannot tell, and says nothing about whether the arms are the same. Cost and tokens are what the CLI
reported for each trial, the plugin's hooks and any subagent they started included. Wall time is the
harness's own clock.

Every trial's files, checks, cost and the head of its answer are in `docs/measurements/data/2026-10-26-0-19-0-openfoodnetwork-http-error-blind-haiku-5-5.json`.
