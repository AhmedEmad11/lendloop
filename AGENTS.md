# AGENT KICKOFF: LendLoop

Copy this file into the new repo root as `AGENTS.md` (and/or `CLAUDE.md`), together with `SRS.md` and `DEVELOPMENT_PLAN.md` under `docs/`.

## Mission

Build **LendLoop**, a neighborhood tool-lending board with n8n automations, as a take-home assignment. Graders look at:
1. code clarity
2. security thinking
3. UX
4. n8n integration reliability
5. documentation

Build exactly what `docs/SRS.md` specifies, follow `docs/DEVELOPMENT_PLAN.md` milestone by milestone, and stop for human review at the end of each milestone.

## Stack (do not substitute)

| Layer | Use |
|---|---|
| App | Next.js App Router, TypeScript strict |
| Styling | Tailwind CSS |
| Auth | Clerk (`@clerk/nextjs`), using the Convex JWT template |
| Data and backend | Convex: queries, mutations, actions, HTTP actions, scheduler |
| Automation | n8n in Docker; workflows exported to `n8n/workflows/` |
| Tests | Vitest with `convex-test` |

## Repository layout

```
app/                    Next.js routes (public page, (app) signed-in area, admin)
components/             UI components
convex/
  schema.ts
  lib/auth.ts           requireUser / requireAdmin / requireToolOwnerOrAdmin / requireLoanParty
  lib/hmac.ts           sign/verify (Web Crypto, constant-time, 5-min window)
  users.ts tools.ts loans.ts admin.ts public.ts
  notify.ts             internal action: deliver outbox events to n8n with retries
  http.ts               /n8n/overdue-loans, /n8n/reminder-status, /n8n/automation-error
  *.test.ts
n8n/workflows/          exported JSON (no secrets)
docker-compose.yml      n8n (+ self-hosted Convex backend/dashboard)
docs/                   SRS.md, DEVELOPMENT_PLAN.md, architecture diagram
README.md  PRODUCTION.md  .env.example
```

## Non-negotiable rules

1. **Authorization lives in Convex.**
   - Every public query and mutation starts with a helper from `convex/lib/auth.ts`.
   - Never trust a user ID, role or owner ID sent by the client. Derive the caller from `ctx.auth.getUserIdentity()`.
   - UI checks are cosmetic only.
2. **Use the internal variants for machine-only code.** Anything only n8n, the scheduler or other functions call is an `internalQuery`, `internalMutation` or `internalAction`.
3. **Public data is a projection.** The signed-out tool list returns `{ name, category }` only, built on the server.
4. **Never commit secrets.**
   - No secrets in code, `.env*` files (except `.env.example` with names only) or exported n8n JSON.
   - In n8n, secrets come from `$env.*` or credentials.
   - Check the export before every commit.
5. **Sign the integration in both directions.**
   - HMAC-SHA256 over `timestamp + "." + rawBody`.
   - Headers: `X-LendLoop-Timestamp`, `X-LendLoop-Event-Id`, `X-LendLoop-Signature`.
   - Use a separate secret per direction.
   - Reject requests outside a 5-minute window.
   - Compare signatures in constant time.
6. **Make write-backs idempotent.**
   - Upsert on `idempotencyKey`. Reminders use `reminder:{loanId}:{YYYY-MM-DD}`.
   - Outbound events carry a unique `eventId`.
7. **Nothing fails silently.**
   - Outbound delivery retries with backoff through the scheduler, then marks the event `failed` with `lastError`.
   - n8n nodes use Retry On Fail.
   - Both workflows have the Error Trigger workflow attached.
   - A notification failure never fails the user's mutation.
8. **Data minimization.**
   - Payloads carry only recipient email, first name, tool name, dates and status.
   - Don't log personal data beyond what debugging needs.
9. **Validate every input** with Convex validators: enums for category, condition and status; length limits; date rules from SRS FR-L2.
10. **Enforce state transitions on the server** exactly as in SRS 4.4. Approval also checks for overlapping approved loans.
11. **Keep it simple.** No extra services, ORMs or state libraries. Don't add features outside the SRS. The bonus activity line comes last.

## Working method

- Work milestone by milestone (M0 → M4). At the end of each milestone:
  - run lint, typecheck and tests;
  - summarize what changed and how you verified it;
  - then stop for human review.
- Write tests alongside the code: RBAC violations, admin-only functions, invalid transitions, the overlap check, the public projection, HMAC sign/verify, the timestamp window, and idempotent upsert.
- Keep commits small and descriptive.
- If a requirement is ambiguous, pick the more secure or simpler option, record the decision in `docs/DECISIONS.md`, and continue.
- Never invent results. If a command fails, show the output.

## Commands (once scaffolded)

```bash
docker compose up -d          # n8n (+ convex backend/dashboard)
npx convex dev                # or point CONVEX_SELF_HOSTED_URL at the local backend
npm run dev                   # Next.js
npm test                      # vitest + convex-test
npm run lint && npx tsc --noEmit
npx gitleaks detect           # before every push
```

## Environment variables (names only)

```
NEXT_PUBLIC_CONVEX_URL
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
CLERK_JWT_ISSUER_DOMAIN            # Convex auth.config
ADMIN_EMAILS                       # optional admin bootstrap
N8N_WEBHOOK_URL                    # Convex -> n8n
LENDLOOP_N8N_HMAC_SECRET           # Convex signs, n8n verifies
LENDLOOP_CONVEX_HMAC_SECRET        # n8n signs, Convex verifies
CONVEX_HTTP_URL                    # n8n -> Convex HTTP actions base
```

## Definition of done

- Every acceptance criterion in `docs/SRS.md` section 11 passes and has been shown working.
- README:
  - lets a fresh clone run by following it alone;
  - documents the architecture (Mermaid diagram), RBAC, the HMAC scheme, idempotency, retries and error handling, and data minimization.
- `PRODUCTION.md` exists.
- The three workflows are exported to `n8n/workflows/`, and a check shows they hold no secrets.
- Lint, typecheck and tests are green, and gitleaks is clean.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
