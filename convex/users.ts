import { query } from "./_generated/server";

/**
 * M0 smoke test: returns the minimal identity Convex derived from the Clerk JWT,
 * or null when signed out. Replaced by users.ensure / users.me in M1.
 */
export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return { subject: identity.subject, email: identity.email ?? null };
  },
});
