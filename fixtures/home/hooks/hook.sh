#!/bin/sh
# Conformance fixture hook. usage: hook.sh <EventName>
# Logs every invocation (event + the JSON the harness sent on stdin) and, for SessionStart, prints a context line.
input=$(cat)
log="${HC_HOOK_LOG:-$HOME/.hc-hook.log}"
printf '%s\t%s\n' "$1" "$(printf '%s' "$input" | tr '\n\t' '  ' | cut -c1-600)" >> "$log"
if [ "$1" = SessionStart ]; then
  echo "HC-SESSION-HOOK-CANARY-e5f9: session started."
  case "$input" in
    *'"agent_type":"coordinator"'*|*'"agent":"coordinator"'*) : ;;
    *) echo "HC-DEFAULT-AGENT-WARNING-2d6b: main agent is not coordinator." ;;
  esac
fi
exit 0
