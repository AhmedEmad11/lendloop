# LendLoop: Development Plan

Goal: submit a clean, secure, well-documented take-home to Fluence in **about 4 working days**. You already know n8n, so most of the learning time goes to Convex and Clerk.

Requirements: see `SRS.md`. Agent instructions: see `AGENT_KICKOFF.md`.

---

## Milestones

| Day | Milestone | Exit check |
|---|---|---|
| 0.5 | M0: Scaffold and infrastructure | `docker compose up` runs n8n (and self-hosted Convex). The Next.js app signs in with Clerk. A Convex query returns the identity. |
| 1 | M1: Data model, RBAC and core flows | All mutations are guarded. `convex-test` covers ownership and admin rules. |
| 1 | M2: UI | Public page, tools list with filter, my listings, my requests, incoming requests, admin page. |
| 1 | M3: n8n integration | Both workflows and the error workflow work, signed in both directions, idempotent, with retries. |
| 0.5 | M4: Docs, hardening and submission | README, PRODUCTION.md, exported workflows, secret scan, demo run, email sent. |

## M0: Scaffold (half a day)

1. Run `npx create-next-app@latest lendloop --ts --app --tailwind --eslint`, then turn on strict TS.
2. Run `npm i convex @clerk/nextjs zod`, and add `vitest` and `convex-test` as dev dependencies.
3. Wire Clerk to Convex:
   - create a Clerk JWT template named `convex`;
   - add `convex/auth.config.ts`;
   - use `ConvexProviderWithClerk` in the app;
   - add `middleware.ts` with the Clerk middleware.
4. Write `docker-compose.yml`:
   - `n8n` with a volume;
   - env: `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, `LENDLOOP_N8N_HMAC_SECRET`, `LENDLOOP_CONVEX_HMAC_SECRET`, `CONVEX_HTTP_URL`, `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`, `EXECUTIONS_DATA_PRUNE=true`;
   - self-hosted Convex backend and dashboard, so Convex can reach `http://n8n:5678`;
   - fallback: Convex cloud dev plus `cloudflared` in front of n8n.
5. Add `.env.example` (names only), `.gitignore` covering every `.env*` except the example, and a gitleaks pre-commit hook.

## M1: Backend core (1 day)

1. Write the `convex/schema.ts` tables and indexes listed in SRS section 7.
2. Write `convex/lib/auth.ts` with `requireUser`, `requireAdmin`, `requireToolOwnerOrAdmin` and `requireLoanParty`.
3. Add `users.ensure`, called on first load to upsert from the Clerk identity. Role defaults to `user`. Add an `internal.users.setRole` mutation for seeding admins.
4. Tools functions:
   - `public.listAvailable`: projection of name and category only;
   - `tools.list`, with a category filter and availability;
   - `tools.create`, `tools.update` and `tools.remove`, owner-only, with the open-loan guard;
   - `admin.removeTool`.
5. Loans functions:
   - `loans.request`, with the date validation and no-own-tool rule;
   - `loans.approve` and `loans.decline`, owner-only, with the overlap check;
   - `loans.cancel`, borrower-only;
   - `loans.markReturned`, owner or admin;
   - the `loans.mine`, `loans.incoming` and `admin.allLoans` queries.
6. Add `admin.setTrustedLender`.
7. Event outbox:
   - every status change inserts an `automationEvents` row (`queued`, `eventId`);
   - it then calls `ctx.scheduler.runAfter(0, internal.notify.deliver, { eventId })`.
8. Tests:
   - ownership violations, admin-only functions, invalid transitions;
   - overlap rejection, and that the public projection holds no owner fields.

## M2: Frontend (1 day)

1. Public page `/`:
   - LendLoop name and tagline;
   - the available-tools list (name and category);
   - a "Sign in to lend or borrow" button (`SignInButton`).
2. Signed-in layout with these sections:
   - Tools, with a category filter and availability badge;
   - My listings, with create/edit/delete forms;
   - My requests;
   - Incoming requests, with approve, decline and mark returned;
   - an Admin page, shown only when the role is admin. The server still enforces this.
3. Borrow request modal with a date range and server error messages shown inline.
4. Bonus: on each loan card, an automation-activity line from `automationEvents`, e.g. "Reminder sent 2 days ago".
5. Minimal, accessible UI with empty states, loading states and confirmation for destructive actions.

## M3: n8n integration (1 day)

1. `convex/lib/hmac.ts`:
   - sign and verify with Web Crypto HMAC-SHA256;
   - constant-time compare;
   - 5-minute timestamp window;
   - unit tests.
2. `internal.notify.deliver` (action):
   - load the event and build the minimal payload;
   - sign it and POST to the n8n webhook;
   - mark `sent` on success;
   - on failure, retry with backoff through the scheduler (3 tries), then mark `failed`.
3. `convex/http.ts`, three routes:
   - `GET /n8n/overdue-loans`;
   - `POST /n8n/reminder-status`, which upserts on `idempotencyKey`;
   - `POST /n8n/automation-error`.

   Each route verifies the signature first.
4. **Workflow 1, Request notification:**
   - Webhook node, with a Header Auth credential;
   - Code node: verify the HMAC with `$env`, check the timestamp window, dedupe on `eventId`;
   - Switch on the event type;
   - notify: a mock log node, or email through an SMTP credential;
   - Retry On Fail on the send node.
5. **Workflow 2, Overdue reminders:**
   - daily Schedule Trigger;
   - Code node signs the request;
   - HTTP Request: `GET /n8n/overdue-loans`;
   - Split In Batches;
   - send the reminder;
   - signed `POST /n8n/reminder-status` with key `reminder:{loanId}:{date}`;
   - retries on the HTTP and send nodes.
6. **Error workflow:**
   - Error Trigger;
   - log or notify;
   - signed `POST /n8n/automation-error`.
   - Set it as the error workflow of workflows 1 and 2.
7. Export the workflows to `n8n/workflows/*.json`. Check the export holds no secrets: credentials are referenced by name, and secrets come from `$env`.
8. Failure drills:
   - stop n8n and check the events end up `failed`;
   - send a bad signature and check you get a 401;
   - run the overdue workflow twice and check there's still one reminder per loan.

## M4: Docs and submission (half a day)

1. README sections:
   - overview and screenshots;
   - quick start (`docker compose up`, `npx convex dev` or self-hosted, `npm run dev`, importing the n8n workflows and setting credentials);
   - the env var table;
   - an architecture diagram (Mermaid): Next.js, Clerk, Convex, n8n;
   - RBAC design;
   - HMAC scheme in both directions;
   - idempotency and retry design;
   - data minimization;
   - testing;
   - known limitations.
2. `PRODUCTION.md`, covering:
   - managed Convex and n8n with queue mode and Postgres;
   - a secrets manager and secret rotation;
   - real email provider with SPF/DKIM;
   - rate limiting;
   - audit logging;
   - monitoring (Sentry, Datadog) and alerts on the error workflow;
   - backups;
   - Clerk production instance and RBAC through Clerk organizations or metadata synced to Convex;
   - GDPR/HIPAA-style data retention, consent and a DPA with vendors;
   - CI running tests and secret scanning.
3. Final checks:
   - gitleaks clean;
   - fresh-clone setup works by following the README alone;
   - all acceptance criteria from SRS section 11 pass.
4. Write the application email yourself, by hand:
   - repo and portfolio links;
   - 1–2 other projects (DocAgent and the Agency ERP RLS work fit well);
   - the security/privacy note, e.g. row-level security for tenant isolation, data minimization in webhook payloads, or HMAC-signed integrations;
   - include the word "pineapple".

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| A cloud Convex backend can't reach local n8n | Self-hosted Convex in docker-compose (primary), or a cloudflared tunnel (fallback) |
| Secrets leak into the exported n8n JSON | `$env` plus credentials only; grep the export before every commit |
| Clerk and Convex auth setup takes longer than planned | Follow the official Convex + Clerk guide first, before any feature work |
| Scope creep in the UI | Minimal Tailwind layout; finish the bonus only after M3 passes its drills |
| Time | Cut in this order: bonus activity line, admin polish, real email (keep the mock) |
