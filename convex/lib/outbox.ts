import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { OutboundEventType } from "./constants";

/**
 * Transactional outbox (RR-2, RR-3). The event row is written in the same
 * transaction as the status change, and delivery is scheduled to run after the
 * mutation commits. Delivery failures can never roll back or fail the user's
 * action.
 */
export async function enqueueLoanEvent(
  ctx: MutationCtx,
  loanId: Id<"loanRequests">,
  type: OutboundEventType,
): Promise<string> {
  const now = Date.now();
  const eventId = `evt_${crypto.randomUUID()}`;
  await ctx.db.insert("automationEvents", {
    loanId,
    eventId,
    type,
    direction: "outbound",
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.notify.deliver, { eventId });
  return eventId;
}
