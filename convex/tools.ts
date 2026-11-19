import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireToolOwner, requireUser } from "./lib/auth";
import { todayUtc } from "./lib/dates";
import { appError } from "./lib/errors";
import { approvedLoansForTool, isAvailable } from "./lib/loans";
import { OPEN_STATUSES } from "./lib/loanState";
import { categoryValidator, cleanToolFields, conditionValidator } from "./lib/validators";

/** All listed tools with availability, optionally filtered by category (FR-A6). */
export const list = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const me = await requireUser(ctx);
    const today = todayUtc();

    const tools = category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", category).eq("deletedAt", undefined))
          .collect()
      : await ctx.db
          .query("tools")
          .withIndex("by_deleted", (q) => q.eq("deletedAt", undefined))
          .collect();

    const owners = new Map<string, { firstName: string; trustedLender: boolean } | null>();
    const rows = [];
    for (const tool of tools) {
      if (!owners.has(tool.ownerId)) {
        const owner = await ctx.db.get(tool.ownerId);
        owners.set(
          tool.ownerId,
          owner ? { firstName: owner.firstName, trustedLender: owner.trustedLender } : null,
        );
      }
      const owner = owners.get(tool.ownerId);
      rows.push({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
        // Signed-in users see the lender's first name and badge, never their email.
        ownerFirstName: owner?.firstName ?? "A neighbor",
        ownerTrustedLender: owner?.trustedLender ?? false,
        isMine: tool.ownerId === me._id,
        available: isAvailable(await approvedLoansForTool(ctx, tool._id), today),
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** The caller's own listings (FR-A7). */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const today = todayUtc();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id).eq("deletedAt", undefined))
      .collect();

    const rows = [];
    for (const tool of tools) {
      const approved = await approvedLoansForTool(ctx, tool._id);
      const pending = await ctx.db
        .query("loanRequests")
        .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "pending"))
        .collect();
      rows.push({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
        available: isAvailable(approved, today),
        openLoanCount: approved.length + pending.length,
        updatedAt: tool.updatedAt,
      });
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const { name, description } = cleanToolFields(args);
    const now = Date.now();
    return await ctx.db.insert("tools", {
      ownerId: me._id, // always the caller, never a client-supplied owner
      name,
      category: args.category,
      condition: args.condition,
      description,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, { toolId, ...fields }) => {
    await requireToolOwner(ctx, toolId);
    const { name, description } = cleanToolFields(fields);
    await ctx.db.patch(toolId, {
      name,
      description,
      category: fields.category,
      condition: fields.condition,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Owner delete (FR-A2, FR-L7). Refused while any request is pending or
 * approved; the owner resolves those first. Otherwise soft-deleted so past
 * loans keep their tool name.
 */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    await requireToolOwner(ctx, toolId);
    for (const status of OPEN_STATUSES) {
      const open = await ctx.db
        .query("loanRequests")
        .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", status))
        .first();
      if (open) {
        throw appError(
          "CONFLICT",
          "This tool has open requests or an active loan. Decline them or mark the loan returned first.",
        );
      }
    }
    await ctx.db.patch(toolId, { deletedAt: Date.now(), updatedAt: Date.now() });
  },
});
