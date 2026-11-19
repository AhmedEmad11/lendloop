import { LIMITS } from "./constants";
import { appError } from "./errors";

// Loan dates are ISO `YYYY-MM-DD` strings in UTC. ISO strings compare correctly
// as strings, which keeps range checks simple.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function todayUtc(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Returns epoch ms at UTC midnight, or null if not a real calendar date. */
export function parseIsoDate(value: string): number | null {
  if (!ISO_DATE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  // Reject rollovers such as 2026-02-30 -> 2026-03-02.
  return new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

export function daysBetween(from: string, to: string): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (a === null || b === null) throw new Error("daysBetween: invalid date");
  return Math.round((b - a) / DAY_MS);
}

/**
 * SRS FR-L2: start is today or later, end on or after start, and the loan
 * covers at most 30 calendar days (inclusive of both ends).
 */
export function assertValidLoanDates(start: string, end: string, today: string): void {
  if (parseIsoDate(start) === null || parseIsoDate(end) === null) {
    throw appError("INVALID_INPUT", "Dates must be valid dates in YYYY-MM-DD format.");
  }
  if (start < today) {
    throw appError("INVALID_INPUT", "Start date can't be in the past.");
  }
  if (end < start) {
    throw appError("INVALID_INPUT", "End date must be on or after the start date.");
  }
  if (daysBetween(start, end) + 1 > LIMITS.maxLoanDays) {
    throw appError(
      "INVALID_INPUT",
      `A loan can last at most ${LIMITS.maxLoanDays} days.`,
    );
  }
}

export function addDays(iso: string, days: number): string {
  const ms = parseIsoDate(iso);
  if (ms === null) throw new Error("addDays: invalid date");
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive ranges [aStart, aEnd] and [bStart, bEnd] share at least one day. */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
