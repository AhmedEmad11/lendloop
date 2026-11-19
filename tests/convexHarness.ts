/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import type { AppErrorData, ErrorCode } from "../convex/lib/errors";

// Lives outside convex/ so the Convex bundler never ships test code.
export const modules = import.meta.glob("../convex/**/*.*s");

export function setup() {
  return convexTest(schema, modules);
}

export type T = ReturnType<typeof setup>;

/** Registers a user through the real users.ensure path and returns a client acting as them. */
export async function signIn(
  t: T,
  name: string,
  opts: { admin?: boolean } = {},
) {
  const as = t.withIdentity({
    subject: `user_${name}`,
    email: `${name.toLowerCase()}@example.com`,
    givenName: name,
  });
  const userId = await as.mutation(api.users.ensure, {});
  if (opts.admin) {
    await t.mutation(internal.users.setRole, {
      email: `${name.toLowerCase()}@example.com`,
      role: "admin",
    });
  }
  return { as, userId: userId as Id<"users"> };
}

export async function listTool(as: Awaited<ReturnType<typeof signIn>>["as"], name = "Cordless drill") {
  return await as.mutation(api.tools.create, {
    name,
    category: "power_tools",
    condition: "good",
    description: "18V, two batteries.",
  });
}

/** Asserts a call fails with our ConvexError code. */
export async function expectAppError(promise: Promise<unknown>, code: ErrorCode) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<AppErrorData>).data.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code} error, but the call succeeded`);
}
