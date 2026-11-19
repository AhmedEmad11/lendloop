import { query } from "./_generated/server";
import { todayUtc } from "./lib/dates";
import { approvedLoansForTool, isAvailable } from "./lib/loans";

/**
 * Signed-out tool list (FR-P2, FR-P4, SR-9). The projection is built here on
 * the server: name and category only. No IDs, owner fields, condition or
 * description ever leave this function.
 */
export const listAvailable = query({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_deleted", (q) => q.eq("deletedAt", undefined))
      .collect();

    const result: { name: string; category: (typeof tools)[number]["category"] }[] = [];
    for (const tool of tools) {
      if (isAvailable(await approvedLoansForTool(ctx, tool._id), today)) {
        result.push({ name: tool.name, category: tool.category });
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});
