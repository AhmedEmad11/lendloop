import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireLoanParty, requireUser } from "./lib/auth";
import { assertValidLoanDates, rangesOverlap, todayUtc } from "./lib/dates";
import { appError } from "./lib/errors";
import { approvedLoansForTool, isOverdue } from "./lib/loans";
import { nextStatus, type LoanAction } from "./lib/loanState";
import { enqueueLoanEvent } from "./lib/outbox";
import type { OutboundEventType } from "./lib/constants";

// ---------- Mutations ----------

/** Borrow request (FR-A3, FR-L1, FR-L2). */
export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.deletedAt !== undefined) {
      throw appError("NOT_FOUND", "That tool no longer exists.");
    }
    if (tool.ownerId === me._id) {
      throw appError("FORBIDDEN", "You can't borrow your own tool.");
    }
    assertValidLoanDates(startDate, endDate, todayUtc());

    // One open request per borrower per tool keeps the lender's inbox sane.
    const mine = await ctx.db
      .query("loanRequests")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .collect();
    if (mine.some((l) => l.toolId === toolId && l.status === "pending")) {
      throw appError("CONFLICT", "You already have a pending request for this tool.");
    }

    const loanId = await ctx.db.insert("loanRequests", {
      toolId,
      borrowerId: me._id,
      ownerId: tool.ownerId,
      startDate,
      endDate,
      status: "pending",
      createdAt: Date.now(),
    });
    await enqueueLoanEvent(ctx, loanId, "request.created");
    return loanId;
  },
});

/** Owner approves (FR-A4, FR-L3, FR-L4). Rejected if it overlaps an approved loan. */
export const approve = mutation({
  args: { loanId: v.id("loanRequests") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await requireLoanParty(ctx, loanId, ["owner"]);
    const status = nextStatus(loan.status, "approve");
    if (loan.endDate < todayUtc()) {
      throw appError("INVALID_TRANSITION", "This request has expired: its dates are in the past. Decline it instead.");
    }

    const clash = (await approvedLoansForTool(ctx, loan.toolId)).find(
      (other) =>
        other._id !== loan._id &&
        rangesOverlap(loan.startDate, loan.endDate, other.startDate, other.endDate),
    );
    if (clash) {
      throw appError(
        "CONFLICT",
        `These dates overlap a loan you already approved (${clash.startDate} to ${clash.endDate}).`,
      );
    }

    await ctx.db.patch(loanId, { status, decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, loanId, "request.approved");
  },
});

export const decline = mutation({
  args: { loanId: v.id("loanRequests") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await requireLoanParty(ctx, loanId, ["owner"]);
    await transition(ctx, loan, "decline", "request.declined", { decidedAt: Date.now() });
  },
});

/** Borrower withdraws a pending request. */
export const cancel = mutation({
  args: { loanId: v.id("loanRequests") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await requireLoanParty(ctx, loanId, ["borrower"]);
    await transition(ctx, loan, "cancel", "request.cancelled", { decidedAt: Date.now() });
  },
});

/** Lender confirms the tool came back (FR-A5). Admins may also do this. */
export const markReturned = mutation({
  args: { loanId: v.id("loanRequests") },
  handler: async (ctx, { loanId }) => {
    const { loan } = await requireLoanParty(ctx, loanId, ["owner", "admin"]);
    await transition(ctx, loan, "markReturned", "loan.returned", { returnedAt: Date.now() });
  },
});

async function transition(
  ctx: MutationCtx,
  loan: Doc<"loanRequests">,
  action: LoanAction,
  event: OutboundEventType,
  extra: Partial<Pick<Doc<"loanRequests">, "decidedAt" | "returnedAt">>,
) {
  const status = nextStatus(loan.status, action);
  await ctx.db.patch(loan._id, { status, ...extra });
  await enqueueLoanEvent(ctx, loan._id, event);
}

// ---------- Queries ----------

/** The caller's requests as borrower (FR-A8). */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loanRequests")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .collect();
    return await Promise.all(
      loans.map(async (loan) => ({
        ...(await loanView(ctx, loan)),
        otherPartyFirstName: await firstNameOf(ctx, loan.ownerId),
      })),
    );
  },
});

/** Requests on the caller's tools (FR-A9). */
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loanRequests")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .collect();
    return await Promise.all(
      loans.map(async (loan) => ({
        ...(await loanView(ctx, loan)),
        otherPartyFirstName: await firstNameOf(ctx, loan.borrowerId),
      })),
    );
  },
});

/** Shared, minimal loan shape for the UI. Exported for admin.allLoans. */
export async function loanView(ctx: QueryCtx, loan: Doc<"loanRequests">) {
  const tool = await ctx.db.get(loan.toolId);
  return {
    _id: loan._id,
    toolName: tool?.name ?? "Removed tool",
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    overdue: isOverdue(loan, todayUtc()),
    createdAt: loan.createdAt,
    lastActivity: await lastActivity(ctx, loan._id),
  };
}

/** FR-A11 (bonus): the most recent automation event on this loan. */
async function lastActivity(ctx: QueryCtx, loanId: Id<"loanRequests">) {
  const event = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .order("desc")
    .first();
  if (!event) return null;
  return { type: event.type, status: event.status, at: event.updatedAt };
}

async function firstNameOf(ctx: QueryCtx, userId: Id<"users">): Promise<string> {
  return (await ctx.db.get(userId))?.firstName ?? "A neighbor";
}
