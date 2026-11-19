#!/usr/bin/env bash
# One-time local setup after cloning. Safe to re-run.
#
#   1. generates HMAC secrets + webhook token into .env (if missing)
#   2. starts Docker (self-hosted Convex + n8n)
#   3. writes the Convex admin key to .env.local
#   4. sets the Convex deployment env vars and pushes the functions
#   5. imports + publishes the n8n credential and workflows
#
# Prerequisite: .env contains NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY.
# Secret values are never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

touch .env .env.local
chmod 600 .env .env.local

has() { grep -qE "^$1=.+" "$2"; }
get() { grep -E "^$1=" "$2" | tail -1 | cut -d= -f2- | tr -d '\r"'; }

for key in NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY; do
  has "$key" .env || { echo "Add $key to .env first (see README > Clerk)." >&2; exit 1; }
done

for key in LENDLOOP_N8N_HMAC_SECRET LENDLOOP_CONVEX_HMAC_SECRET N8N_WEBHOOK_AUTH_TOKEN; do
  if ! has "$key" .env; then
    [ -n "$(tail -c1 .env)" ] && echo >> .env
    echo "$key=$(openssl rand -hex 32)" >> .env
    echo "generated $key"
  fi
done

echo "Starting Docker services..."
docker compose up -d
until curl -sf http://127.0.0.1:3210/version >/dev/null; do sleep 2; done

if ! has CONVEX_SELF_HOSTED_ADMIN_KEY .env.local; then
  key=$(docker compose exec -T backend ./generate_admin_key.sh | tail -1)
  [ -n "$(tail -c1 .env.local)" ] && echo >> .env.local
  {
    echo "NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210"
    echo "CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210"
    echo "CONVEX_SELF_HOSTED_ADMIN_KEY=$key"
  } >> .env.local
  echo "wrote Convex admin key to .env.local"
fi

# The publishable key encodes the Clerk Frontend API host: pk_test_<base64(host$)>.
pk=$(get NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY .env)
issuer="https://$(echo "${pk#pk_*_}" | base64 -d 2>/dev/null | tr -d '$')"

echo "Setting Convex env vars..."
npx convex env set CLERK_JWT_ISSUER_DOMAIN "$issuer" >/dev/null
npx convex env set N8N_WEBHOOK_URL "http://n8n:5678/webhook" >/dev/null
for key in LENDLOOP_N8N_HMAC_SECRET LENDLOOP_CONVEX_HMAC_SECRET N8N_WEBHOOK_AUTH_TOKEN; do
  npx convex env set "$key" "$(get "$key" .env)" >/dev/null
done
if has ADMIN_EMAILS .env; then npx convex env set ADMIN_EMAILS "$(get ADMIN_EMAILS .env)" >/dev/null; fi

echo "Pushing Convex functions..."
mkdir -p .convex-tmp
CONVEX_TMPDIR="$PWD/.convex-tmp" npx convex dev --once

echo "Setting up n8n..."
./scripts/n8n-setup.sh

echo
echo "Ready. Run:  npm run dev   then open http://localhost:3000"
echo "Optional demo data:  npx convex run seed:demo"
