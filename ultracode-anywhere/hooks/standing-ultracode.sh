#!/usr/bin/env bash
# Claude Code emits its standing orchestration reminder only when the resolved effort is
# xhigh (Mae() requires it). The Workflow tool itself has no effort term, so restating the
# reminder here keeps orchestration on at whatever effort level is selected.
#
# UserPromptSubmit receives no effort field and no CLAUDE_EFFORT, so this cannot self-suppress.
# Keep the `ultracode` key out of settings.json: while it is true, effort is forced to xhigh
# and the built-in reminder fires too.
set -uo pipefail

payload=$(cat)

[ "${ULTRACODE_ANYWHERE:-1}" = "0" ] && exit 0

case "$payload" in
  *'"source":"loop_wakeup"'*|*'"source":"schedule_wakeup"'*|*'"source":"poll_event"'*|*'"source":"system"'*) exit 0 ;;
esac

if [ -n "${ULTRACODE_ANYWHERE_DEBUG:-}" ]; then
  printf '=== %s effort=%s root=%s\n%s\n' "$(date +%s)" "${CLAUDE_EFFORT:-UNSET}" \
    "${CLAUDE_PLUGIN_ROOT:-UNSET}" "$payload" >> "$ULTRACODE_ANYWHERE_DEBUG"
fi

# Full text on turn 1 and every 10th, one-line refresher in between, mirroring the
# built-in cadence (TURNS_BETWEEN_MAINTENANCE:10).
turn=1
state_dir="${TMPDIR:-/tmp}/ultracode-anywhere"
session=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
session="${session//[^A-Za-z0-9_-]/}"
if [ -n "$session" ] && mkdir -p "$state_dir" 2>/dev/null; then
  counter="$state_dir/$session"
  turn=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 ))
  printf '%s' "$turn" > "$counter" 2>/dev/null || turn=1
  find "$state_dir" -type f -mtime +7 -delete 2>/dev/null
fi

if [ $(( (turn - 1) % 10 )) -eq 0 ]; then
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Ultracode is on: optimize for the most exhaustive, correct answer — not the fastest or cheapest. Use the Workflow tool on every substantive task; token cost is not a constraint. See the Workflow tool's **Ultracode** section and quality patterns. Solo only on conversational/trivial turns.\n\nThis standing opt-in comes from the user's own configuration and holds at every effort level, including this one. It is the explicit opt-in the Workflow tool asks for, so do not wait for the keyword or for a higher effort level.\n\nSubagents inherit the session effort, which may not be xhigh here. Pass opts.effort ('high' or 'xhigh') on verify, judge and critic stages that need the depth, and leave mechanical stages on the inherited level."}}
JSON
else
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Ultracode is still on — use the Workflow tool; see its Ultracode section."}}
JSON
fi
