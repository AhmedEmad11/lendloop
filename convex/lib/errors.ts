import { ConvexError } from "convex/values";

/**
 * Every expected failure is a ConvexError with a stable code, so the UI can show
 * the message inline and tests can assert on the code. Unexpected errors stay
 * plain Errors and are redacted by Convex in production.
 */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "INVALID_TRANSITION"
  | "CONFLICT";

export type AppErrorData = { code: ErrorCode; message: string };

export function appError(code: ErrorCode, message: string) {
  return new ConvexError<AppErrorData>({ code, message });
}
