#!/usr/bin/env bash
# Pushes the sign-in environment (Microsoft Entra, and mail when it is filled in) from
# ops/.env.ops onto the Render API service. Values are read from disk and sent over HTTPS;
# none is ever printed, and none is passed on a command line.
#
# Usage: bash ops/set-signin-env.sh [--dry-run] [--no-deploy]
#
# Setting an environment variable through Render's API does NOT restart the service on its own
# (unlike editing one in the dashboard), so this script triggers a deploy afterwards and waits
# for it to go live. The API answers 502 for a few seconds during the swap, because the disk can
# only attach to one instance; that is normal. --no-deploy skips it.
set -uo pipefail

dry_run=0
deploy=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --no-deploy) deploy=0 ;;
    *) echo "Unknown option: $arg"; exit 2 ;;
  esac
done

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
KEYS="ROOT_ADMIN_EMAILS ENTRA_CLIENT_ID ENTRA_TENANT_ID ENTRA_CLIENT_SECRET MAIL_PROVIDER MAIL_FROM RESEND_API_KEY SMTP_URL"

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

if [ "$failed" -ne 0 ] || [ "$pushed" -eq 0 ] || [ "$dry_run" = "1" ]; then
  [ "$failed" -eq 0 ]
  exit $?
fi

if [ "$deploy" = "0" ]; then
  echo
  echo "Skipped the deploy. The new values only take effect on the next one, because a variable"
  echo "set through the API does not restart the service by itself."
  exit 0
fi

echo
echo "Triggering a deploy so the service picks the new values up..."
deploy_id=$(curl -s -m 60 -X POST \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"clearCache":"do_not_clear"}' \
  "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys" |
  node -e 'let b="";process.stdin.on("data",c=>b+=c).on("end",()=>{try{process.stdout.write(JSON.parse(b).id||"")}catch{}})')

if [ -z "$deploy_id" ]; then
  echo "  could not trigger a deploy. Trigger one from the Render dashboard, or the values stay dormant."
  exit 1
fi
echo "  deploy $deploy_id started"

# Poll rather than guess: a Render deploy takes a couple of minutes and briefly 502s on the swap.
for _ in $(seq 1 60); do
  sleep 10
  state=$(curl -s -m 30 -H "Authorization: Bearer $RENDER_API_KEY" \
    "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys/$deploy_id" |
    node -e 'let b="";process.stdin.on("data",c=>b+=c).on("end",()=>{try{process.stdout.write(JSON.parse(b).status||"")}catch{}})')
  case "$state" in
    live) echo "  deploy live"; break ;;
    build_failed|update_failed|canceled|pre_deploy_failed)
      echo "  deploy ended as: $state"; exit 1 ;;
  esac
done

echo
echo "Check what the API now reports:"
echo "  curl -s https://suprstar-api.onrender.com/api/auth/status"
echo "Expect \"entra\":true, and \"magicLink\":true once a mail provider is set."
[ "$failed" -eq 0 ]
