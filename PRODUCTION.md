# Running LendLoop in production

What would change to take this from a take-home to something real neighbors (or a regulated, healthcare-like context) rely on.

## Platform

- **Convex:** use the managed cloud deployment, with separate dev, preview and prod deployments. Set env vars per deployment and turn on Convex log streaming.
- **n8n:** run n8n Cloud, or self-host in **queue mode** (main + workers + Redis) on **Postgres** instead of SQLite. Pin the image version, and set `N8N_ENCRYPTION_KEY` explicitly and back it up.
- **Networking:** expose only HTTPS endpoints behind TLS. Put the n8n editor behind SSO or a VPN; only `/webhook/lendloop/*` should be public. Allow-list Convex egress IPs on the webhook if the platform supports it.
- **Next.js:** deploy to Vercel or a container platform, with security headers (CSP, HSTS, `frame-ancestors 'none'`).

## Identity and access

- **Clerk production instance** on your own domain, with email verification required and bot protection on. Offer MFA to admins.
- **Roles:** keep Convex as the source of truth, but drive the admin role from Clerk Organizations or `publicMetadata` synced to Convex by a signed Clerk webhook. Remove `ADMIN_EMAILS` once admins are seeded.
- Use least-privilege Convex deploy keys in CI. Never use personal admin keys.

## Secrets

- Keep secrets in a manager (Doppler, AWS Secrets Manager or Vault), injected at deploy time. Nothing in `.env` files on servers.
- **Rotation:** support two active HMAC secrets per direction during a rollover window (verify against either, sign with the new one), then retire the old one. Rotate on a schedule and immediately after any suspected leak.
- Keep secret scanning (gitleaks) in CI and in the pre-commit hook, and turn on GitHub push protection.

## Messaging

- Replace the mock node with a real provider (Postmark, SES or Resend) on a sending domain with **SPF, DKIM and DMARC**.
- Add an unsubscribe and notification-preferences page, and honour bounces and complaints by suppressing the address.
- Keep payloads minimal as they are now. For a healthcare-like context, send a "you have an update" notice with a link instead of details, so no sensitive data passes through the email provider.

## Abuse and rate limiting

- Rate-limit mutations per user (`@convex-dev/rate-limiter`), especially `loans.request` and `tools.create`.
- Rate-limit `/n8n/*` per source, and add a short replay cache of `X-LendLoop-Event-Id` on top of the 5-minute window.
- Add content moderation, or an admin report button, for listing text.

## Reliability and observability

- **Errors:** Sentry for Next.js and Convex. Datadog (or similar) for logs and metrics.
- **Alerts:**
  - error-workflow executions above 0;
  - outbox events stuck in `queued` for more than 15 minutes, or any `failed`;
  - reminder runs that didn't happen by 08:30 UTC (a dead-man's switch, e.g. Healthchecks.io pinged by the workflow).
- **Outbox:**
  - a daily internal cron that re-queues `failed` events after an incident;
  - an admin "retry" button;
  - archiving of old `sent` rows.
- **Dedupe:** move n8n's eventId dedupe from workflow static data to Redis or Postgres so it survives multiple workers.
- **Performance:** paginate list queries, and keep a denormalized `availableToday` on tools (updated by mutations and a daily cron) instead of computing it per read.

## Data protection (GDPR / HIPAA-style)

- **Data map:** Convex holds email, first name and loan history. Clerk holds identity. n8n and the email provider see only the minimal payload.
- **DPAs and BAAs** with every processor (Clerk, Convex, n8n Cloud, the email provider). Choose regions to match data-residency requirements.
- **Retention:**
  - prune `automationEvents` after 90 days;
  - anonymize returned loans after 12 months;
  - n8n keeps error executions only (7 days).
- **User rights:** export and delete-my-account flows, triggered by a Clerk `user.deleted` webhook that removes or anonymizes the Convex rows.
- **Consent:** record terms and notification consent at sign-up, with a privacy notice that names the processors.
- **Audit log:** an append-only `auditLog` table written by every admin action and role change (who, what, when), readable by admins and exported to the log pipeline.
- **Encryption:** TLS everywhere. Use provider encryption at rest, and field-level encryption if a field ever becomes sensitive.

## Delivery pipeline

- **CI on every PR:** lint, typecheck, `npm test`, gitleaks, `npm audit`, and a JSON check that the exported n8n workflows contain no credential values.
- **Deploy order:** Convex functions first, then Next.js. Import n8n workflows through the n8n API from the repo JSON, with no manual edits in prod.
- **Schema changes** follow the widen → migrate → narrow pattern so running clients never break.

## Backups and recovery

- Automated Convex backups (snapshot export) plus Postgres PITR for n8n. Test restores quarterly.
- A runbook for "n8n down" (the outbox absorbs it; re-queue failed events afterwards) and for "secret leaked" (rotate, then check logs).
