#!/usr/bin/env bash
# Imports the LendLoop credential and workflows into the running n8n container,
# then publishes (activates) them. Safe to re-run.
#
# Reads N8N_WEBHOOK_AUTH_TOKEN from ./.env and pipes it straight into the
# container, so the secret is never written to the repo or to workflow JSON.
set -euo pipefail
cd "$(dirname "$0")/.."

token=$(grep -E '^N8N_WEBHOOK_AUTH_TOKEN=' .env | cut -d= -f2- | tr -d '\r"')
[ -n "$token" ] || { echo "N8N_WEBHOOK_AUTH_TOKEN missing from .env" >&2; exit 1; }

echo "Waiting for n8n to finish starting (migrations on a fresh volume)..."
for _ in $(seq 1 90); do
  curl -sf http://127.0.0.1:5678/healthz/readiness >/dev/null && break
  sleep 2
done
curl -sf http://127.0.0.1:5678/healthz/readiness >/dev/null || { echo "n8n did not become ready" >&2; exit 1; }

echo "Importing header-auth credential..."
printf '[{"id":"lendloopHdrAuth1","name":"LendLoop webhook header","type":"httpHeaderAuth","data":{"name":"X-LendLoop-Auth","value":"%s"}}]' "$token" |
  docker compose exec -T n8n sh -c 'umask 077; f=$(mktemp); cat > "$f"; n8n import:credentials --input="$f"; rc=$?; rm -f "$f"; exit $rc'

echo "Importing workflows..."
docker compose exec -T n8n n8n import:workflow --separate --input=/workflows

echo "Publishing workflows..."
for id in lendloopErrorWf1 lendloopNotifyWf lendloopRemindWf; do
  docker compose exec -T n8n n8n publish:workflow --id="$id"
done

echo "Restarting n8n to load active workflows..."
docker compose restart n8n >/dev/null
echo "Done. Open http://localhost:5678 to create the n8n owner account and inspect the workflows."
