import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "./errors";

/**
 * Central authorization helpers (SR-1, SR-2). Every public query and mutation
 * starts with one of these. The caller is always derived from the verified
 * Clerk JWT via ctx.auth; IDs, roles and owners sent by the client are never
 * trusted.
 */

type Ctx = QueryCtx | MutationCtx;

/** The signed-in user's row, or null if signed out or not yet registered. */
export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw appError("UNAUTHENTICATED", "Please sign in.");
  const user = await getCurrentUser(ctx);
  // users.ensure runs on first load; a missing row means it hasn't yet.
  if (!user) throw appError("UNAUTHENTICATED", "Account not set up yet. Reload the page.");
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") throw appError("FORBIDDEN", "Admins only.");
  return user;
}

async function loadActiveTool(ctx: Ctx, toolId: Id<"tools">): Promise<Doc<"tools">> {
  const tool = await ctx.db.get(toolId);
  if (!tool || tool.deletedAt !== undefined) {
    throw appError("NOT_FOUND", "That tool no longer exists.");
  }
  return tool;
}

/** Owner-only actions on a listing (edit, delete: FR-A2). */
export async function requireToolOwner(ctx: Ctx, toolId: Id<"tools">) {
  const user = await requireUser(ctx);
  const tool = await loadActiveTool(ctx, toolId);
  if (tool.ownerId !== user._id) {
    throw appError("FORBIDDEN", "You can only change your own listings.");
  }
  return { user, tool };
}

export async function requireToolOwnerOrAdmin(ctx: Ctx, toolId: Id<"tools">) {
  const user = await requireUser(ctx);
  const tool = await loadActiveTool(ctx, toolId);
  if (tool.ownerId !== user._id && user.role !== "admin") {
    throw appError("FORBIDDEN", "You can only change your own listings.");
  }
  return { user, tool };
}

export type LoanParty = "owner" | "borrower" | "admin";

/**
 * Loads a loan and checks the caller plays one of the allowed parts in it.
 * e.g. approve: ["owner"], cancel: ["borrower"], markReturned: ["owner", "admin"].
 */
export async function requireLoanParty(
  ctx: Ctx,
  loanId: Id<"loanRequests">,
  allowed: readonly LoanParty[],
) {
  const user = await requireUser(ctx);
  const loan = await ctx.db.get(loanId);
  if (!loan) throw appError("NOT_FOUND", "That request no longer exists.");

  const parts: LoanParty[] = [];
  if (loan.ownerId === user._id) parts.push("owner");
  if (loan.borrowerId === user._id) parts.push("borrower");
  if (user.role === "admin") parts.push("admin");

  if (!parts.some((p) => allowed.includes(p))) {
    throw appError("FORBIDDEN", "You're not allowed to do that on this request.");
  }
  return { user, loan, parts };
}
