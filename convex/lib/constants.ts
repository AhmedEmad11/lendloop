// Shared enums and limits. Safe to import from both Convex functions and the UI
// (no server-only imports here).

export const CATEGORIES = [
  "power_tools",
  "hand_tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  power_tools: "Power tools",
  hand_tools: "Hand tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  cleaning: "Cleaning",
  other: "Other",
};

export const CONDITIONS = ["new", "good", "fair", "worn"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABELS: Record<Condition, string> = {
  new: "New",
  good: "Good",
  fair: "Fair",
  worn: "Worn",
};

export const LOAN_STATUSES = [
  "pending",
  "approved",
  "declined",
  "cancelled",
  "returned",
] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

/** Domain events Convex sends to n8n (SRS 4.5). */
export const OUTBOUND_EVENT_TYPES = [
  "request.created",
  "request.approved",
  "request.declined",
  "request.cancelled",
  "loan.returned",
] as const;
export type OutboundEventType = (typeof OUTBOUND_EVENT_TYPES)[number];

/** Records n8n writes back into Convex. */
export const INBOUND_EVENT_TYPES = ["reminder.overdue", "automation.error"] as const;
export type InboundEventType = (typeof INBOUND_EVENT_TYPES)[number];

export const LIMITS = {
  toolNameMin: 2,
  toolNameMax: 80,
  descriptionMax: 500,
  maxLoanDays: 30,
} as const;
