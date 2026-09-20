#!/usr/bin/env bash
# Verifies every operator credential without ever printing one.
# Usage: bash ops/check.sh
set -uo pipefail

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

pass=0
fail=0
report() { # name status detail
  case "$2" in
    ok)      printf '  %-22s ok        %s\n' "$1" "${3:-}"; pass=$((pass + 1)) ;;
    missing) printf '  %-22s not set   %s\n' "$1" "${3:-}" ;;
    *)       printf '  %-22s FAILED    %s\n' "$1" "${3:-}"; fail=$((fail + 1)) ;;
  esac
}

echo "Operator credentials"

# --- Render ---
if [ -z "${RENDER_API_KEY:-}" ]; then
  report "Render API key" missing "add RENDER_API_KEY to ops/.env.ops"
else
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    "https://api.render.com/v1/services/${RENDER_SERVICE_ID:-}")
  [ "$code" = "200" ] && report "Render API key" ok "service reachable" \
                       || report "Render API key" bad "HTTP $code from the services endpoint"
fi

# --- Vercel ---
if [ -z "${VERCEL_TOKEN:-}" ]; then
  report "Vercel token" missing "add VERCEL_TOKEN to ops/.env.ops"
else
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID:-}")
  [ "$code" = "200" ] && report "Vercel token" ok "project reachable" \
                      || report "Vercel token" bad "HTTP $code from the projects endpoint"
fi

# --- GitHub (read from the macOS keychain, never from this file) ---
gh_token=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')
if [ -z "$gh_token" ]; then
  report "GitHub token" missing "store it in the keychain; see ops/.env.ops.example"
else
  headers=$(curl -s -D - -o /dev/null -m 20 -H "Authorization: Bearer $gh_token" https://api.github.com/user)
  code=$(printf '%s' "$headers" | sed -n 's|^HTTP/[0-9.]* \([0-9]*\).*|\1|p' | tail -1)
  scopes=$(printf '%s' "$headers" | sed -n 's/^[Xx]-[Oo][Aa]uth-[Ss]copes: //p' | tr -d '\r')
  if [ "$code" = "200" ]; then
    if [ -z "$scopes" ]; then
      report "GitHub token" ok "fine-grained token; confirm Workflows is Read and write"
    elif printf '%s' "$scopes" | grep -q 'workflow'; then
      report "GitHub token" ok "workflow scope present"
    else
      report "GitHub token" bad "no workflow scope, so .github/workflows cannot be pushed"
    fi
  else
    report "GitHub token" bad "HTTP $code from the user endpoint"
  fi
fi

echo
echo "$pass ok, $fail failed"
[ "$fail" -eq 0 ]
