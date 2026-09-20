#!/usr/bin/env bash
# Pushes the sign-in environment (Microsoft Entra, and mail when it is filled in) from
# ops/.env.ops onto the Render API service. Values are read from disk and sent over HTTPS;
# none is ever printed, and none is passed on a command line.
#
# Usage: bash ops/set-signin-env.sh [--dry-run]
#
# Render restarts the service itself after an environment change, so a deploy takes a minute
# or two and the API answers 502 briefly while the disk moves. That is normal; see HANDOFF.md.
set -uo pipefail

dry_run=0
[ "${1:-}" = "--dry-run" ] && dry_run=1

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
envfile="$here/.env.ops"

if [ ! -f "$envfile" ]; then
  echo "ops/.env.ops is missing. Copy ops/.env.ops.example to ops/.env.ops and fill it in."
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$envfile"
set +a

if [ -z "${RENDER_API_KEY:-}" ] || [ -z "${RENDER_SERVICE_ID:-}" ]; then
  echo "RENDER_API_KEY or RENDER_SERVICE_ID is not set in ops/.env.ops. Nothing to push."
  exit 1
fi

# Keys pushed when they have a value in ops/.env.ops. Anything blank is skipped rather than
# written as an empty string, because an empty ENTRA_CLIENT_ID turns Microsoft sign-in off.
KEYS="ENTRA_CLIENT_ID ENTRA_TENANT_ID ENTRA_CLIENT_SECRET MAIL_PROVIDER MAIL_FROM RESEND_API_KEY SMTP_URL"

pushed=0
skipped=0
failed=0

for key in $KEYS; do
  value="${!key:-}"
  if [ -z "$value" ]; then
    printf '  %-22s skipped   not set in ops/.env.ops\n' "$key"
    skipped=$((skipped + 1))
    continue
  fi
  if [ "$dry_run" = "1" ]; then
    printf '  %-22s would push\n' "$key"
    pushed=$((pushed + 1))
    continue
  fi
  # The body is built by a JSON encoder rather than string interpolation so a value containing
  # a quote or backslash cannot break the request.
  body=$(VALUE="$value" node -e 'process.stdout.write(JSON.stringify({ value: process.env.VALUE }))')
  code=$(printf '%s' "$body" | curl -s -o /dev/null -w '%{http_code}' -m 30 \
    -X PUT \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary @- \
    "https://api.render.com/v1/services/$RENDER_SERVICE_ID/env-vars/$key")
  case "$code" in
    200|201) printf '  %-22s ok\n' "$key"; pushed=$((pushed + 1)) ;;
    *)       printf '  %-22s FAILED    HTTP %s\n' "$key" "$code"; failed=$((failed + 1)) ;;
  esac
done

echo
echo "$pushed pushed, $skipped skipped, $failed failed"
if [ "$failed" -eq 0 ] && [ "$pushed" -gt 0 ] && [ "$dry_run" = "0" ]; then
  echo
  echo "Render is restarting the service. When it is back:"
  echo "  curl -s https://suprstar.social/api/auth/status"
  echo "should report \"entra\":true, and \"magicLink\":true once a mail provider is set."
fi
[ "$failed" -eq 0 ]
