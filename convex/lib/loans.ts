import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** Approved loans are by definition not yet returned (returning moves them to "returned"). */
export async function approvedLoansForTool(
  ctx: QueryCtx,
  toolId: Id<"tools">,
): Promise<Doc<"loanRequests">[]> {
  return await ctx.db
    .query("loanRequests")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
}

/**
 * FR-L5. A tool is out when an approved loan has started and hasn't been
 * returned. That includes overdue loans: the tool isn't back yet, so it must
 * not show as available (see docs/DECISIONS.md D12).
 */
export function isAvailable(approvedLoans: Doc<"loanRequests">[], today: string): boolean {
  return !approvedLoans.some((loan) => loan.startDate <= today);
}

/** FR-L6: approved, end date before today (UTC), not returned. */
export function isOverdue(loan: Doc<"loanRequests">, today: string): boolean {
  return loan.status === "approved" && loan.endDate < today && loan.returnedAt === undefined;
}
