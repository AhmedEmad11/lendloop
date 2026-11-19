import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { daysBetween, todayUtc } from "./lib/dates";
import { isOverdue } from "./lib/loans";

/**
 * Machine-only functions behind the signed /n8n/* HTTP routes (SR-3). All are
 * internal: the browser client can't call them.
 */

export function reminderKey(loanId: string, day: string): string {
  return `reminder:${loanId}:${day}`;
}

/**
 * Overdue loans that still need today's reminder (FR-N2, RR-1). Loans already
 * reminded successfully today are left out, so a rerun sends nothing new.
 * Returns only what a reminder needs (SR-9).
 */
export const overdueLoans = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const approved = await ctx.db
      .query("loanRequests")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();

    const result = [];
    for (const loan of approved) {
      if (!isOverdue(loan, today)) continue;
      const idempotencyKey = reminderKey(loan._id, today);
      const existing = await ctx.db
        .query("automationEvents")
        .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
        .unique();
      if (existing?.status === "sent") continue;

      const [borrower, tool] = await Promise.all([ctx.db.get(loan.borrowerId), ctx.db.get(loan.toolId)]);
      if (!borrower) continue;
      result.push({
        loanId: loan._id,
        idempotencyKey,
        borrower: { email: borrower.email, firstName: borrower.firstName },
        toolName: tool?.name ?? "a tool",
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
      });
    }
    return result;
  },
});

/**
 * Upsert on idempotencyKey (RR-1, RR-5). A key already marked "sent" is never
 * changed again; a "failed" key can be upgraded to "sent" by a retry.
 */
export const recordReminder = internalMutation({
  args: {
    idempotencyKey: v.string(),
    loanId: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
    eventId: v.string(),
  },
  handler: async (ctx, args) => {
    const loanId = ctx.db.normalizeId("loanRequests", args.loanId);
    if (!loanId || !(await ctx.db.get(loanId))) return { result: "unknown_loan" as const };
    // The key must belong to this loan and be shaped reminder:{loanId}:{YYYY-MM-DD}.
    const match = /^reminder:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(args.idempotencyKey);
    if (!match || match[1] !== loanId) return { result: "bad_key" as const };

    const now = Date.now();
    const lastError = args.status === "failed" ? (args.error ?? "unknown").slice(0, 300) : undefined;
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();

    if (existing) {
      if (existing.status === "sent" || existing.status === args.status) {
        return { result: "duplicate" as const };
      }
      await ctx.db.patch(existing._id, {
        status: args.status,
        attempts: existing.attempts + 1,
        lastError,
        updatedAt: now,
      });
      return { result: "updated" as const };
    }

    await ctx.db.insert("automationEvents", {
      loanId,
      eventId: args.eventId,
      type: "reminder.overdue",
      direction: "inbound",
      status: args.status,
      attempts: 1,
      lastError,
      idempotencyKey: args.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    });
    return { result: "created" as const };
  },
});

/** Error-workflow write-back (FR-N4). Deduplicated per n8n execution. */
export const recordAutomationError = internalMutation({
  args: {
    workflow: v.string(),
    executionId: v.string(),
    node: v.string(),
    message: v.string(),
    eventId: v.string(),
  },
  handler: async (ctx, args) => {
    const idempotencyKey = `error:${args.executionId.slice(0, 64)}`;
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) return { result: "duplicate" as const };

    const detail = `${args.workflow.slice(0, 80)} › ${args.node.slice(0, 80)}`;
    const now = Date.now();
    await ctx.db.insert("automationEvents", {
      eventId: args.eventId,
      type: "automation.error",
      direction: "inbound",
      status: "failed",
      attempts: 1,
      lastError: args.message.slice(0, 300),
      idempotencyKey,
      detail,
      createdAt: now,
      updatedAt: now,
    });
    // Workflow and node names only: no payload data in logs.
    console.error(`n8n error workflow: ${detail} (execution ${args.executionId.slice(0, 64)})`);
    return { result: "created" as const };
  },
});

/** Admin view of everything that went wrong in automation (visible failures). */
export const recentIssues = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const failed = await ctx.db
      .query("automationEvents")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(50);
    return failed.map((e) => ({
      _id: e._id,
      type: e.type,
      direction: e.direction,
      attempts: e.attempts,
      lastError: e.lastError ?? null,
      detail: e.detail ?? null,
      at: e.updatedAt,
    }));
  },
});
