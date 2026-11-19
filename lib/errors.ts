import { ConvexError } from "convex/values";
import type { AppErrorData } from "@/convex/lib/errors";

/** Human message for an error thrown by a Convex call. Never shows stack traces. */
export function errorMessage(err: unknown): string {
  if (err instanceof ConvexError) {
    const data = err.data as Partial<AppErrorData> | undefined;
    if (data && typeof data.message === "string") return data.message;
  }
  return "Something went wrong. Please try again.";
}
