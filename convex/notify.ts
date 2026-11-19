import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { OutboundEventType } from "./lib/constants";
import { signedHeaders } from "./lib/hmac";

/**
 * Outbound delivery (RR-3). Runs after the user's mutation committed, so a
 * failure here can never fail the user's action. Retries with backoff through
 * the scheduler, then marks the event failed with lastError.
 */

/** Delay before retry n (after attempt n failed). 3 retries: 30s, 2m, 10m. */
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const REQUEST_TIMEOUT_MS = 10_000;

const RECIPIENT: Record<OutboundEventType, "owner" | "borrower"> = {
  "request.created": "owner",
  "request.approved": "borrower",
  "request.declined": "borrower",
  "request.cancelled": "owner",
  "loan.returned": "borrower",
};

/**
 * Builds the minimal payload (SR-9): recipient email + first name, tool name,
 * dates, status. Nothing else about either party.
 */
export const buildPayload = internalQuery({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db
      .query("automationEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .unique();
    if (!event || event.direction !== "outbound" || event.status !== "queued" || !event.loanId) {
      return null; // already delivered, failed for good, or not ours to send
    }
    const type = event.type as OutboundEventType;
    const loan = await ctx.db.get(event.loanId);
    if (!loan) return { kind: "skip" as const, reason: "loan no longer exists" };
    // Don't send a stale request.created (e.g. retried after the borrower cancelled).
    if (type === "request.created" && loan.status !== "pending") {
      return { kind: "skip" as const, reason: `request already ${loan.status}` };
    }
    const [tool, recipient] = await Promise.all([
      ctx.db.get(loan.toolId),
      ctx.db.get(RECIPIENT[type] === "owner" ? loan.ownerId : loan.borrowerId),
    ]);
    if (!recipient) return { kind: "skip" as const, reason: "recipient no longer exists" };
    const payload = {
      eventId: event.eventId,
      type,
      loanId: loan._id,
      status: loan.status,
      recipient: { email: recipient.email, firstName: recipient.firstName },
      tool: { name: tool?.name ?? "a tool" },
      dates: { start: loan.startDate, end: loan.endDate },
      occurredAt: event.createdAt,
    };
    return { kind: "send" as const, payload };
  },
});

export const recordAttempt = internalMutation({
  args: { eventId: v.string(), ok: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, { eventId, ok, error }) => {
    const event = await ctx.db
      .query("automationEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .unique();
    if (!event || event.status !== "queued") return;

    const attempts = event.attempts + 1;
    const now = Date.now();
    if (ok) {
      await ctx.db.patch(event._id, { status: "sent", attempts, lastError: undefined, updatedAt: now });
      return;
    }
    const lastError = (error ?? "unknown error").slice(0, 300);
    if (attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(event._id, { status: "failed", attempts, lastError, updatedAt: now });
      console.error(`notify: event ${eventId} failed after ${attempts} attempts: ${lastError}`);
      return;
    }
    await ctx.db.patch(event._id, { attempts, lastError, updatedAt: now });
    await ctx.scheduler.runAfter(RETRY_DELAYS_MS[attempts - 1], internal.notify.deliver, { eventId });
  },
});

/** Settles an event that no longer needs sending, so it never sits in `queued`. */
export const settleSkipped = internalMutation({
  args: { eventId: v.string(), reason: v.string() },
  handler: async (ctx, { eventId, reason }) => {
    const event = await ctx.db
      .query("automationEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .unique();
    if (!event || event.status !== "queued") return;
    await ctx.db.patch(event._id, { status: "sent", detail: `skipped: ${reason}`, updatedAt: Date.now() });
  },
});

/**
 * Safety net for rule 7 ("nothing fails silently"). Convex doesn't retry
 * actions, so if deliver dies between fetch and recordAttempt (deploy,
 * timeout) the event would stay queued with nothing scheduled. A healthy
 * retry chain always touches the row within 10 minutes; anything quieter than
 * STALE_AFTER_MS is re-queued, or failed if it already used every attempt.
 */
export const STALE_AFTER_MS = 15 * 60_000;

export const sweepStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_AFTER_MS;
    const queued = await ctx.db
      .query("automationEvents")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect();
    let requeued = 0;
    let failed = 0;
    for (const event of queued) {
      if (event.direction !== "outbound" || event.updatedAt > cutoff) continue;
      if (event.attempts >= MAX_ATTEMPTS) {
        await ctx.db.patch(event._id, {
          status: "failed",
          lastError: event.lastError ?? "delivery stalled",
          updatedAt: Date.now(),
        });
        failed++;
      } else {
        await ctx.db.patch(event._id, { updatedAt: Date.now() });
        await ctx.scheduler.runAfter(0, internal.notify.deliver, { eventId: event.eventId });
        requeued++;
      }
    }
    if (requeued + failed > 0) console.warn(`notify sweep: requeued ${requeued}, failed ${failed}`);
    return { requeued, failed };
  },
});

export const deliver = internalAction({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    const built = await ctx.runQuery(internal.notify.buildPayload, { eventId });
    if (!built) return;
    if (built.kind === "skip") {
      await ctx.runMutation(internal.notify.settleSkipped, { eventId, reason: built.reason });
      return;
    }
    const { payload } = built;

    const baseUrl = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_N8N_HMAC_SECRET;
    const authToken = process.env.N8N_WEBHOOK_AUTH_TOKEN;

    let ok = false;
    let error: string | undefined;
    if (!baseUrl || !secret || !authToken) {
      error = "n8n delivery not configured (N8N_WEBHOOK_URL / secrets missing)";
    } else {
      const body = JSON.stringify(payload);
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/lendloop/request-event`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-LendLoop-Auth": authToken,
            ...(await signedHeaders(secret, payload.eventId, body)),
          },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        ok = res.ok;
        if (!ok) error = `n8n responded ${res.status}`;
      } catch (err) {
        // Network errors carry no personal data; keep only the message.
        error = err instanceof Error ? `${err.name}: ${err.message}` : "network error";
      }
    }
    await ctx.runMutation(internal.notify.recordAttempt, { eventId, ok, error });
  },
});
