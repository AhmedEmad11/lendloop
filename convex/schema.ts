import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  categoryValidator,
  conditionValidator,
  eventStatusValidator,
  eventTypeValidator,
  loanStatusValidator,
  roleValidator,
} from "./lib/validators";

export default defineSchema({
  // Convex is the single source of truth for roles (SRS 3). Clerk only proves identity.
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    firstName: v.string(),
    role: roleValidator,
    trustedLender: v.boolean(),
    createdAt: v.number(),
  }).index("by_clerkId", ["clerkId"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    // Soft delete keeps loan history intact (FR-L7).
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId", "deletedAt"])
    .index("by_deleted", ["deletedAt"])
    .index("by_category", ["category", "deletedAt"]),

  loanRequests: defineTable({
    toolId: v.id("tools"),
    borrowerId: v.id("users"),
    // Denormalized from the tool so "incoming requests" is a single index read.
    ownerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD (UTC)
    endDate: v.string(),
    status: loanStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"]),

  // Delivery outbox for Convex -> n8n events, plus write-backs from n8n.
  automationEvents: defineTable({
    loanId: v.optional(v.id("loanRequests")),
    eventId: v.string(),
    type: eventTypeValidator,
    direction: v.union(v.literal("outbound"), v.literal("inbound")),
    status: eventStatusValidator,
    attempts: v.number(),
    lastError: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    // Short, non-personal context (e.g. failing workflow/node name).
    detail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_loan", ["loanId"])
    .index("by_eventId", ["eventId"])
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_status", ["status"]),
});
