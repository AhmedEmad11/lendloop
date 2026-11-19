import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { appError } from "./lib/errors";
import { nextStatus } from "./lib/loanState";
import { enqueueLoanEvent } from "./lib/outbox";
import { loanView } from "./loans";

/**
 * Remove any listing (FR-AD1, FR-L7). Pending requests on it are declined and
 * their borrowers notified. An active approved loan stays as is so the lender
 * or an admin can still mark it returned.
 */
export const removeTool = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    await requireAdmin(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.deletedAt !== undefined) {
      throw appError("NOT_FOUND", "That tool no longer exists.");
    }

    const pending = await ctx.db
      .query("loanRequests")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
      .collect();
    const now = Date.now();
    for (const loan of pending) {
      await ctx.db.patch(loan._id, {
        status: nextStatus(loan.status, "decline"),
        decidedAt: now,
      });
      await enqueueLoanEvent(ctx, loan._id, "request.declined");
    }
    await ctx.db.patch(toolId, { deletedAt: now, updatedAt: now });
    return { declined: pending.length };
  },
});

/** Every loan in the system (FR-AD2). */
export const allLoans = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loanRequests").order("desc").take(500);
    return await Promise.all(
      loans.map(async (loan) => {
        const [borrower, owner] = await Promise.all([
          ctx.db.get(loan.borrowerId),
          ctx.db.get(loan.ownerId),
        ]);
        return {
          ...(await loanView(ctx, loan)),
          borrowerName: borrower?.firstName ?? "Unknown",
          ownerName: owner?.firstName ?? "Unknown",
        };
      }),
    );
  },
});

/** Users list for the Trusted Lender toggle (FR-AD3). */
export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    return users
      .map((u) => ({
        _id: u._id,
        firstName: u.firstName,
        email: u.email,
        role: u.role,
        trustedLender: u.trustedLender,
      }))
      .sort((a, b) => a.firstName.localeCompare(b.firstName));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw appError("NOT_FOUND", "User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});
