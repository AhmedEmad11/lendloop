# LendLoop: Software Requirements Specification

Version 1.0, 2026-11-19
Author: Ahmed Emad Mahfouz
Context: take-home assignment for Fluence International (Full-Stack Developer). Requirements below come from the posting; items marked **[Design]** are my own decisions to meet them.

---

## 1. Purpose and scope

LendLoop is a neighborhood tool-lending board. Neighbors list tools they are willing to lend, request to borrow tools for a date range, and receive automated notifications and overdue reminders run by n8n.

The submission is graded on:
1. Code structure and clarity
2. Security-minded thinking
3. UX and practicality
4. Integration design, reliability and error handling (n8n)
5. Documentation and reasoning

Out of scope: payments, deposits, messaging between users, ratings, maps, image uploads.

## 2. Stack (fixed by the assignment)

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), TypeScript |
| Auth | Clerk |
| Data and backend logic | Convex (queries, mutations, actions, HTTP actions, scheduler) |
| Automation | n8n, self-hosted via Docker (or n8n Cloud) |

**[Design]** Supporting choices: Tailwind CSS for the minimal layout, Zod for input validation at the edges, Vitest with `convex-test` for backend tests.

## 3. Actors and roles

| Actor | Description |
|---|---|
| Visitor | Not signed in. Sees the public page only. |
| User | Signed in via Clerk. Role `user`. |
| Admin | Signed in via Clerk. Role `admin`. |
| n8n | Machine client. Receives signed webhooks from Convex and calls signed Convex HTTP endpoints. |

**[Design]** The role lives in the Convex `users` table, which is the single source of truth for authorization. New users default to `user`. Admins are seeded by an internal Convex mutation run from the CLI, or bootstrapped from an `ADMIN_EMAILS` environment variable on first sign-in. Clients can never set or change a role.

## 4. Functional requirements

### 4.1 Public page (FR-P)

| ID | Requirement |
|---|---|
| FR-P1 | Show the name "LendLoop" and a tagline, e.g. "Borrow what you need. Lend what you don't." |
| FR-P2 | Show a read-only list of available tools from Convex with **name and category only**. No owner details, condition, description or IDs that reveal the owner. |
| FR-P3 | Show a "Sign in to lend or borrow" button wired to Clerk. |
| FR-P4 | **[Design]** The public query returns a projection built on the server, not a full document filtered on the client. |

### 4.2 Authenticated experience (FR-A)

Only signed-in users can do the following.

| ID | Requirement |
|---|---|
| FR-A1 | List a tool with: name, category, condition and short description. |
| FR-A2 | Edit and delete **only their own** listings. |
| FR-A3 | Request to borrow a tool for a date range (start date, end date). |
| FR-A4 | Approve or decline requests on their own tools. |
| FR-A5 | Mark a loan as returned. **[Design]** The lender (owner) marks the return, because they confirm the tool came back. Admins may also mark a return. |
| FR-A6 | See all tools with their availability status, filterable by category. |
| FR-A7 | See a "My listings" view. |
| FR-A8 | See a "My requests" view (as borrower). |
| FR-A9 | See an "Incoming requests" view (requests on my tools). |
| FR-A10 | Nice, minimal layout. |
| FR-A11 | (Bonus) Show recent automation activity on each loan, e.g. "Reminder sent 2 days ago". |

**[Design] Categories** are a fixed enum: `power_tools`, `hand_tools`, `garden`, `kitchen`, `camping`, `cleaning`, `other`.

**[Design] Condition** is a fixed enum: `new`, `good`, `fair`, `worn`.

### 4.3 Admin (FR-AD)

| ID | Requirement |
|---|---|
| FR-AD1 | Remove any listing. |
| FR-AD2 | View all loans. |
| FR-AD3 | Mark a lender as "Trusted Lender", and unmark them. The badge shows next to that lender's listings for signed-in users. |

### 4.4 Loan lifecycle (FR-L)

**[Design]** A request moves through these states:

```
pending ──approve──▶ approved ──mark returned──▶ returned
   │
   ├──decline──▶ declined
   └──cancel (borrower)──▶ cancelled
```

| ID | Rule |
|---|---|
| FR-L1 | A user cannot request their own tool. |
| FR-L2 | The start date is today or later, and the end date is on or after the start date. Maximum length 30 days. |
| FR-L3 | An approval is rejected if the dates overlap another `approved` loan on the same tool that has not been returned. |
| FR-L4 | Only a `pending` request can be approved, declined or cancelled. Only an `approved` loan can be marked returned. Every transition is checked on the server. |
| FR-L5 | A tool is **available** when it has no `approved`, unreturned loan covering today. Availability is computed on the server. |
| FR-L6 | A loan is **overdue** when its status is `approved`, the end date is before today (UTC), and `returnedAt` is unset. |
| FR-L7 | A listing with open `pending` or `approved` loans cannot be deleted by its owner. It is soft-deleted instead, or the owner is told to resolve the loans first. An admin removal declines the pending requests on it. |

### 4.5 Automation (FR-N)

| ID | Requirement |
|---|---|
| FR-N1 | **Request notification.** When a borrow request is created or changes status, Convex calls an n8n Webhook. The workflow notifies the relevant user (email, Slack, Discord or a logged mock notification) using **only the fields it needs**. |
| FR-N2 | **Overdue reminders.** A scheduled workflow runs daily, fetches overdue loans from a Convex HTTP endpoint, sends a reminder to each borrower, and writes the reminder status back to Convex. |
| FR-N3 | At least these two workflows, exported as JSON into the repo. |
| FR-N4 | **[Design]** An error workflow (n8n Error Trigger) is attached to both workflows and reports failures to a visible channel. It also writes a failure record to Convex so the app can show it. |

Who gets notified:

| Event | Recipient |
|---|---|
| `request.created` | Lender (tool owner) |
| `request.approved`, `request.declined` | Borrower |
| `request.cancelled` | Lender |
| `loan.returned` | Borrower (confirmation) |

## 5. Security requirements (SR)

| ID | Requirement |
|---|---|
| SR-1 | **RBAC is enforced inside Convex functions**, never only in the UI. Every public query and mutation resolves the caller from `ctx.auth.getUserIdentity()`, loads the Convex user and checks role and ownership before reading or writing. |
| SR-2 | **[Design]** Authorization helpers are centralised: `requireUser`, `requireAdmin`, `requireToolOwnerOrAdmin`, `requireLoanParty`. Functions do not hand-roll checks. |
| SR-3 | Functions that only n8n or the scheduler may call are `internal*`, so the client cannot call them. |
| SR-4 | **Convex to n8n:** each webhook payload is signed with HMAC-SHA256 using a shared secret. Headers: `X-LendLoop-Timestamp`, `X-LendLoop-Event-Id`, `X-LendLoop-Signature` = `hex(HMAC(secret, timestamp + "." + rawBody))`. n8n verifies the signature and rejects timestamps older than 5 minutes. |
| SR-5 | **n8n to Convex:** HTTP endpoints require the same signing scheme in the other direction, with a separate secret. Convex verifies the signature with Web Crypto in constant time and checks the timestamp window before doing any work. |
| SR-6 | Secrets live only in environment variables (Convex dashboard or `.env.local`, Docker env) and n8n credentials or `$env`. They never appear in code, committed `.env` files or exported workflow JSON. `.env.example` lists the names only. |
| SR-7 | **[Design]** The n8n secret comes from the n8n container environment (`$env.LENDLOOP_N8N_HMAC_SECRET`), so it never reaches workflow JSON. This needs `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. The Webhook node also uses a Header Auth credential as a cheap first gate. |
| SR-8 | All inputs are validated on the server with Convex validators: lengths, enums, date ranges. Text is rendered as text, never as HTML. |
| SR-9 | **Data minimization:** the public list exposes name and category only. Webhook payloads carry only what the message needs (recipient email, first name, tool name, dates, status). The overdue endpoint returns only what a reminder needs. n8n stores no execution data with personal details beyond what debugging needs (`EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`, pruning on). |
| SR-10 | Secret scanning (gitleaks or similar) runs before submission, and a check confirms the exported JSON holds no secret values. |

## 6. Reliability requirements (RR)

| ID | Requirement |
|---|---|
| RR-1 | **Idempotent write-backs.** Each write from n8n carries an idempotency key, and Convex upserts by that key. Overdue reminders use `reminder:{loanId}:{YYYY-MM-DD}`, so a rerun on the same day records nothing new and sends no duplicate reminder. |
| RR-2 | **[Design]** The outbound side is idempotent too: each domain event has a unique `eventId`, and n8n deduplicates on it. A delivery outbox (`automationEvents` table) records each attempt. |
| RR-3 | **[Design]** Convex sends webhooks from a scheduled internal action (`ctx.scheduler.runAfter(0, ...)`) after the mutation commits. A failed send is retried with backoff (for example 3 tries at 30 s, 2 min and 10 min) and then marked `failed`. It never blocks or fails the user's action. |
| RR-4 | The relevant n8n nodes use "Retry On Fail" (3 tries, with a wait). Both workflows have the error workflow attached, so no run fails silently. |
| RR-5 | The overdue reminder writes back its status per loan (`sent` or `failed`), so a partial failure is visible and can be retried. |

## 7. Data model (Convex) [Design]

```
users            { clerkId (idx), email, firstName, role: "user"|"admin", trustedLender: bool, createdAt }
tools            { ownerId (idx), name, category (idx), condition, description, deletedAt?, createdAt, updatedAt }
loanRequests     { toolId (idx), borrowerId (idx), ownerId (idx), startDate, endDate,
                   status: "pending"|"approved"|"declined"|"cancelled"|"returned" (idx),
                   decidedAt?, returnedAt?, createdAt }
automationEvents { loanId (idx), eventId (unique idx), type, direction: "outbound"|"inbound",
                   status: "queued"|"sent"|"failed", attempts, lastError?, idempotencyKey (unique idx)?, createdAt }
```

Dates are stored as ISO `YYYY-MM-DD` strings for loans and epoch milliseconds for timestamps.

## 8. Interfaces [Design]

### 8.1 Convex to n8n: request notification webhook

`POST {N8N_WEBHOOK_URL}/lendloop/request-event`

```json
{
  "eventId": "evt_...",
  "type": "request.approved",
  "loanId": "...",
  "recipient": { "email": "...", "firstName": "..." },
  "tool": { "name": "Cordless drill" },
  "dates": { "start": "2026-11-20", "end": "2026-11-22" },
  "occurredAt": 1763560000000
}
```

### 8.2 n8n to Convex: HTTP actions

| Method and path | Purpose |
|---|---|
| `GET /n8n/overdue-loans` | Returns `[{ loanId, borrower: { email, firstName }, toolName, endDate, daysOverdue }]` |
| `POST /n8n/reminder-status` | Body `{ idempotencyKey, loanId, status: "sent"\|"failed", error? }`. Upserts on `idempotencyKey`. |
| `POST /n8n/automation-error` | Body from the error workflow: `{ workflow, executionId, node, message }` |

Every endpoint requires a valid signature (SR-5).

## 9. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | One-command local setup. `docker compose up` starts n8n. **[Design]** Self-hosted Convex runs in the same compose file, so the backend can reach the n8n webhook without a public tunnel. Fallback: a Convex cloud dev deployment plus a cloudflared tunnel to n8n. |
| NFR-2 | TypeScript strict mode. No `any` in domain code. |
| NFR-3 | Tests: RBAC and state-transition tests with `convex-test`, and HMAC sign/verify unit tests. |
| NFR-4 | Accessible, responsive and minimal UI: semantic HTML, labelled form fields, keyboard-usable controls. |

## 10. Deliverables

1. A GitHub repository with the app source.
2. Exported n8n workflow JSON files in `n8n/workflows/`, with no secrets.
3. A README covering:
   - local setup, including a docker-compose file for n8n (and Convex);
   - environment variables;
   - architecture, with a diagram;
   - security and data-minimization decisions.
4. `PRODUCTION.md`: a short note on what to change to run this in production.
5. The application email to techjobs@fluencetraining.com. It must include:
   - a portfolio link and the repo link;
   - optionally, 1–2 other relevant projects;
   - a short security/privacy note about a healthcare-like context;
   - the word "pineapple", because the posting asks every applicant to include it.

## 11. Acceptance criteria

1. A signed-out visitor sees name and category only. No API response on the public page contains owner data (check the network tab).
2. A user calling another user's mutation with forged IDs, straight from the Convex client, gets an authorization error.
3. A non-admin calling an admin function gets an error.
4. A webhook with a bad or missing signature, or an expired timestamp, is rejected on both sides.
5. Running the overdue workflow twice on the same day sends one reminder per loan and writes one record per loan.
6. With n8n stopped, the app keeps working, and the outbound events end up `failed` with a visible error.
7. A forced node failure triggers the error workflow and shows up in Convex and in the logs.
8. Grepping the repo and the workflow JSON for secret values finds nothing.
