import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUser } from "./lib/auth";
import { appError } from "./lib/errors";
import { roleValidator } from "./lib/validators";

/**
 * Upserts the caller's user row from the verified Clerk identity. Called by the
 * app on load. Email and first name come from JWT claims (DECISIONS D10); the
 * client can't supply them, and it can never set a role.
 */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw appError("UNAUTHENTICATED", "Please sign in.");

    const email = (identity.email ?? "").trim().toLowerCase();
    if (!email) {
      throw appError(
        "INVALID_INPUT",
        "Your account has no email address. Add one in your profile and sign in again.",
      );
    }
    const firstName = (identity.givenName ?? "").trim().slice(0, 50) || "Neighbor";
    const bootstrapAdmin = adminEmails().has(email);

    const existing = await getCurrentUser(ctx);
    if (existing) {
      const patch: Partial<typeof existing> = {};
      if (existing.email !== email) patch.email = email;
      if (existing.firstName !== firstName) patch.firstName = firstName;
      // Role is never touched here: ADMIN_EMAILS applies on first sign-in only,
      // so a later demotion via users:setRole sticks.
      if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("users", {
      clerkId: identity.subject,
      email,
      firstName,
      role: bootstrapAdmin ? "admin" : "user",
      trustedLender: false,
      createdAt: Date.now(),
    });
  },
});

/** The caller's own profile, or null when signed out / not yet registered. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      firstName: user.firstName,
      email: user.email,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});

/**
 * Seed or change a role from the CLI only:
 *   npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
 */
export const setRole = internalMutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, { email, role }) => {
    const normalized = email.trim().toLowerCase();
    const users = await ctx.db.query("users").collect();
    const user = users.find((u) => u.email === normalized);
    if (!user) throw appError("NOT_FOUND", `No user with email ${normalized}. Sign in once first.`);
    await ctx.db.patch(user._id, { role });
    return user._id;
  },
});

function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}
