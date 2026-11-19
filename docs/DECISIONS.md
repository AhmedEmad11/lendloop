# Decisions

Ambiguities resolved during the build. Rule applied: pick the more secure or simpler option.

| # | Date | Decision | Why |
|---|---|---|---|
| D1 | 2026-11-19 | `proxy.ts` instead of `middleware.ts` | Next.js 16 renamed the middleware convention. Clerk's `clerkMiddleware()` lives there; it only attaches session state and is not an authorization boundary. |
| D2 | 2026-11-19 | Clerk Core 3 `<Show when="signed-in">` instead of `<SignedIn>` | `<SignedIn>`/`<SignedOut>` were removed in `@clerk/nextjs@7`. |
| D3 | 2026-11-19 | `cacheComponents` / `partialPrefetching` disabled | All data loads client-side via Convex subscriptions; the scaffold defaults add complexity without benefit. |
| D4 | 2026-11-19 | Extra env var `N8N_WEBHOOK_AUTH_TOKEN` | SR-7 requires a Header Auth credential on the n8n Webhook node, so Convex must send a matching header. It is a cheap first gate; the HMAC signature remains the real check. |
| D5 | 2026-11-19 | `@types/node` 24 instead of the scaffold's 20 | vitest 5 requires `@types/node` ≥ 22; local runtime is Node 24. |
| D6 | 2026-11-19 | Docker ports bound to `127.0.0.1` | Local stack should not be reachable from the LAN. |
| D7 | 2026-11-19 | Gitleaks via pinned Docker image when no local binary | No extra install step for reviewers; same scanner in hook and `npm run secrets`. |
| D8 | 2026-11-19 | Convex images from `ghcr.io/convex/*`, pinned by digest; n8n pinned to `2.48.6` | The plan's `ghcr.io/get-convex/*` path now returns 403. Convex publishes no semantic tag, so the digest is the reproducible pin. |
| D9 | 2026-11-19 | `npm run typecheck` runs `next typegen` first | Next 16 route types (`LayoutProps`) are generated, so a fresh clone needs them before `tsc`. |
| D10 | 2026-11-19 | Email and first name come from Clerk JWT claims (`email`, `given_name`), not from the client or a Clerk Backend API call | Clerk's Convex token carries only `sub` by default. Adding two claims keeps identity server-derived (SR-1) and avoids giving Convex the Clerk secret key. |
| D11 | 2026-11-19 | Loan length counts both ends: 20th to 20th is 1 day; max is 30 such days | Matches how people describe a borrow ("3 days" = Fri–Sun). |
| D12 | 2026-11-19 | A tool is unavailable once an approved loan has *started* and is unreturned, including overdue loans | FR-L5's "covering today" would show an overdue, not-yet-returned tool as available. Future approved loans don't block today. |
| D13 | 2026-11-19 | Owner delete with open loans is refused (not silently soft-deleted); all deletes are soft | FR-L7 offers either; refusing is clearer to the owner, and soft delete keeps loan history readable. |
| D14 | 2026-11-19 | Expected failures are `ConvexError({ code, message })` | Stable codes for tests, human messages for inline UI errors. |
| D15 | 2026-11-19 | One pending request per borrower per tool | Prevents request spam on a lender; not in SRS but a minimal guard. |
| D16 | 2026-11-19 | `ADMIN_EMAILS` bootstrap only promotes, never demotes; relies on Clerk verifying primary emails | Avoids lockout by env edits; an unverified email can't be a Clerk primary address. |
| D17 | 2026-11-19 | Signed-in users see a lender's first name and Trusted badge, never their email | Data minimization; email is only used server-side for notifications. |
| D18 | 2026-11-19 | Signed-in pages live under the `(app)` route group; `proxy.ts` redirects signed-out visitors to sign-in | UX only. Pages render nothing until `users.ensure` has registered the caller; every function re-checks on the server. |
| D19 | 2026-11-19 | Destructive actions (delete, decline, cancel, remove, mark returned) go through a native `<dialog>` confirmation | Native dialog gives focus trap, Esc and inert background without a UI library. |
