import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Delivers one outbox event to n8n. Placeholder until M3, which adds the signed
 * POST, retries with backoff and the queued -> sent | failed bookkeeping.
 */
export const deliver = internalAction({
  args: { eventId: v.string() },
  handler: async () => {},
});
