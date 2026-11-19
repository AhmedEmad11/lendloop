import { v } from "convex/values";
import { LIMITS } from "./constants";
import { appError } from "./errors";

// Convex validators for the enums in ./constants. Literals are spelled out so
// the inferred types stay exact (a mapped array would widen to string).

export const categoryValidator = v.union(
  v.literal("power_tools"),
  v.literal("hand_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("other"),
);

export const conditionValidator = v.union(
  v.literal("new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("worn"),
);

export const loanStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export const roleValidator = v.union(v.literal("user"), v.literal("admin"));

export const eventTypeValidator = v.union(
  v.literal("request.created"),
  v.literal("request.approved"),
  v.literal("request.declined"),
  v.literal("request.cancelled"),
  v.literal("loan.returned"),
  v.literal("reminder.overdue"),
  v.literal("automation.error"),
);

export const eventStatusValidator = v.union(
  v.literal("queued"),
  v.literal("sent"),
  v.literal("failed"),
);

/**
 * Validators check types; lengths need a runtime check. Trims, rejects control
 * characters, and enforces bounds. The UI renders text as text, never HTML.
 */
export function cleanText(
  value: string,
  field: string,
  { min, max }: { min: number; max: number },
): string {
  const trimmed = value.trim();
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(trimmed)) {
    throw appError("INVALID_INPUT", `${field} contains invalid characters.`);
  }
  if (trimmed.length < min) {
    throw appError(
      "INVALID_INPUT",
      min <= 1 ? `${field} is required.` : `${field} must be at least ${min} characters.`,
    );
  }
  if (trimmed.length > max) {
    throw appError("INVALID_INPUT", `${field} must be at most ${max} characters.`);
  }
  return trimmed;
}

export function cleanToolFields(input: { name: string; description: string }) {
  return {
    name: cleanText(input.name, "Name", {
      min: LIMITS.toolNameMin,
      max: LIMITS.toolNameMax,
    }),
    description: cleanText(input.description, "Description", {
      min: 0,
      max: LIMITS.descriptionMax,
    }),
  };
}
