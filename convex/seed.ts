import { internalMutation } from "./_generated/server";
import { addDays } from "./lib/dates";
import { enqueueLoanEvent } from "./lib/outbox";

/**
 * Local demo data and failure drills. Internal only (not callable from the
 * browser):  npx convex run seed:demo
 *
 * Creates two demo neighbors, a few tools, one pending request (which fires a
 * real request.created event to n8n) and one overdue loan for the reminder
 * workflow. Re-running adds nothing if the demo users already exist.
 */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", "demo_lena"))
      .unique();
    if (existing) return { seeded: false };

    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const lena = await ctx.db.insert("users", {
      clerkId: "demo_lena",
      email: "lena.demo@example.com",
      firstName: "Lena",
      role: "user",
      trustedLender: true,
      createdAt: now,
    });
    const bob = await ctx.db.insert("users", {
      clerkId: "demo_bob",
      email: "bob.demo@example.com",
      firstName: "Bob",
      role: "user",
      trustedLender: false,
      createdAt: now,
    });

    const tool = (name: string, category: "power_tools" | "garden" | "camping", description: string) =>
      ctx.db.insert("tools", {
        ownerId: lena,
        name,
        category,
        condition: "good",
        description,
        createdAt: now,
        updatedAt: now,
      });
    const drill = await tool("Cordless drill", "power_tools", "18V with two batteries and a bit set.");
    const ladder = await tool("Extension ladder", "garden", "4 m aluminium. Needs two people to carry.");
    await tool("Two-person tent", "camping", "Packs small, includes pegs.");

    // Overdue: ended two days ago, never returned.
    await ctx.db.insert("loanRequests", {
      toolId: ladder,
      borrowerId: bob,
      ownerId: lena,
      startDate: addDays(today, -6),
      endDate: addDays(today, -2),
      status: "approved",
      decidedAt: now,
      createdAt: now,
    });

    // Pending: fires a real request.created event to n8n.
    const pending = await ctx.db.insert("loanRequests", {
      toolId: drill,
      borrowerId: bob,
      ownerId: lena,
      startDate: addDays(today, 1),
      endDate: addDays(today, 3),
      status: "pending",
      createdAt: now,
    });
    await enqueueLoanEvent(ctx, pending, "request.created");
    return { seeded: true };
  },
});
