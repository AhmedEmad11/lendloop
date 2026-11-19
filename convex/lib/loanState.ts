import type { LoanStatus } from "./constants";
import { appError } from "./errors";

/**
 * SRS 4.4 state machine. The only legal moves:
 *   pending  --approve-->       approved
 *   pending  --decline-->       declined
 *   pending  --cancel-->        cancelled
 *   approved --markReturned-->  returned
 */
export type LoanAction = "approve" | "decline" | "cancel" | "markReturned";

const TRANSITIONS: Record<LoanAction, { from: LoanStatus; to: LoanStatus }> = {
  approve: { from: "pending", to: "approved" },
  decline: { from: "pending", to: "declined" },
  cancel: { from: "pending", to: "cancelled" },
  markReturned: { from: "approved", to: "returned" },
};

export function nextStatus(current: LoanStatus, action: LoanAction): LoanStatus {
  const rule = TRANSITIONS[action];
  if (current !== rule.from) {
    throw appError(
      "INVALID_TRANSITION",
      `Can't ${describe(action)} a request that is ${current}.`,
    );
  }
  return rule.to;
}

/** Statuses that block deleting a tool (FR-L7). */
export const OPEN_STATUSES: readonly LoanStatus[] = ["pending", "approved"];

function describe(action: LoanAction): string {
  return action === "markReturned" ? "mark as returned" : action;
}
