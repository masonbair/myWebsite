#!/bin/bash
# Reports this Claude Code session to masonbair.com/hub/sessions, where Haiku judges whether a finished turn is worth queuing.
set -u
[ "${HUB_SESSION_OFF:-}" = 1 ] && exit 0
[ "${CLAUDE_CODE_SESSION_ATTENDED:-1}" = 0 ] && exit 0

URL="${HUB_SESSION_URL:-https://masonbair.com/api/hub/sessions}"
TOKEN_FILE="${HUB_SESSION_TOKEN_FILE:-$HOME/.config/hub-session/token}"
[ -r "$TOKEN_FILE" ] || exit 0
input=$(cat)

field() { jq -r "$1 // empty" <<<"$input"; }
session=$(field .session_id)
[ -n "$session" ] || exit 0
cwd=$(field .cwd)

# Worktrees report the main repo's name, so every branch of one project groups together.
project_of() {
  local common
  common=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) &&
    basename "$(dirname "$common")" || basename "$cwd"
}

# The newest real prompt in the transcript; tool results and meta entries are not Mason's words.
last_prompt() {
  local transcript
  transcript=$(field .transcript_path)
  [ -f "$transcript" ] || return
  tail -n 2000 "$transcript" | jq -r 'select(.type=="user" and (.isMeta|not)) | .message.content
    | if type=="string" then . else (map(select(.type=="text") | .text) | join(" ")) end
    | select(length>0)' 2>/dev/null | tail -c 600
}

case "$(field .hook_event_name)" in
  Stop)
    [ "$(field .stop_hook_active)" = true ] && exit 0
    reply=$(field .last_assistant_message | tail -c 1500)
    [ -n "$reply" ] || exit 0
    body=$(jq -n --arg s "$session" --arg p "$(project_of)" --arg b "$(git -C "$cwd" branch --show-current 2>/dev/null)" \
      --arg prompt "$(last_prompt)" --arg reply "$reply" \
      '{event:"stop", sessionId:$s, project:$p, branch:(if $b == "" then null else $b end), prompt:$prompt, reply:$reply}')
    ;;
  StopFailure)
    body=$(jq -n --arg s "$session" --arg p "$(project_of)" --arg b "$(git -C "$cwd" branch --show-current 2>/dev/null)" \
      --arg e "$(field '.error // .error_type' | head -c 200)" \
      '{event:"failed", sessionId:$s, project:$p, branch:(if $b == "" then null else $b end), error:(if $e == "" then null else $e end)}')
    ;;
  UserPromptSubmit) body=$(jq -n --arg s "$session" '{event:"prompt", sessionId:$s}') ;;
  SessionEnd) body=$(jq -n --arg s "$session" '{event:"end", sessionId:$s}') ;;
  *) exit 0 ;;
esac

curl -sS --max-time 25 -o /dev/null -X POST "$URL" \
  -H "Authorization: Bearer $(tr -d '[:space:]' <"$TOKEN_FILE")" \
  -H "Content-Type: application/json" \
  --data-binary "$body" 2>/dev/null || true
