import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { expectAppError, listTool, setup, signIn } from "../tests/convexHarness";

// Acceptance criteria 2 and 3: forged IDs and non-admin calls are rejected by
// Convex itself, regardless of what the UI shows.

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("authentication", () => {
  test("signed-out callers are rejected by every protected function", async () => {
    const t = setup();
    await expectAppError(t.query(api.tools.list, {}), "UNAUTHENTICATED");
    await expectAppError(t.query(api.tools.mine, {}), "UNAUTHENTICATED");
    await expectAppError(t.query(api.loans.mine, {}), "UNAUTHENTICATED");
    await expectAppError(t.query(api.loans.incoming, {}), "UNAUTHENTICATED");
    await expectAppError(
      t.mutation(api.tools.create, {
        name: "Ladder",
        category: "other",
        condition: "good",
        description: "",
      }),
      "UNAUTHENTICATED",
    );
    await expectAppError(t.mutation(api.users.ensure, {}), "UNAUTHENTICATED");
  });

  test("a valid identity that never ran users.ensure is not treated as a user", async () => {
    const t = setup();
    const ghost = t.withIdentity({ subject: "user_ghost", email: "g@example.com" });
    await expectAppError(ghost.query(api.tools.list, {}), "UNAUTHENTICATED");
  });

  test("users.ensure always creates a plain user and derives profile from the token", async () => {
    const t = setup();
    const { as } = await signIn(t, "Alice");
    const me = await as.query(api.users.me, {});
    expect(me).toMatchObject({ role: "user", email: "alice@example.com", firstName: "Alice" });
  });

  test("ADMIN_EMAILS bootstraps an admin on sign-in", async () => {
    vi.stubEnv("ADMIN_EMAILS", "Boss@Example.com, other@example.com");
    try {
      const t = setup();
      const { as } = await signIn(t, "Boss");
      expect((await as.query(api.users.me, {}))?.role).toBe("admin");

      // Bootstrap applies on first sign-in only: a later demotion sticks.
      await t.mutation(internal.users.setRole, { email: "boss@example.com", role: "user" });
      await as.mutation(api.users.ensure, {});
      expect((await as.query(api.users.me, {}))?.role).toBe("user");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("tool ownership (FR-A2)", () => {
  test("another user cannot edit or delete my listing with its ID", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const mallory = await signIn(t, "Mallory");
    const toolId = await listTool(alice.as);

    await expectAppError(
      mallory.as.mutation(api.tools.update, {
        toolId,
        name: "Pwned",
        category: "other",
        condition: "worn",
        description: "",
      }),
      "FORBIDDEN",
    );
    await expectAppError(mallory.as.mutation(api.tools.remove, { toolId }), "FORBIDDEN");

    const tool = await t.run((ctx) => ctx.db.get(toolId));
    expect(tool?.name).toBe("Cordless drill");
    expect(tool?.deletedAt).toBeUndefined();
  });

  test("create always assigns the caller as owner", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const toolId = await listTool(alice.as);
    const tool = await t.run((ctx) => ctx.db.get(toolId));
    expect(tool?.ownerId).toBe(alice.userId);
  });

  test("admins still can't edit someone else's listing through the owner path", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const admin = await signIn(t, "Ada", { admin: true });
    const toolId = await listTool(alice.as);
    await expectAppError(admin.as.mutation(api.tools.remove, { toolId }), "FORBIDDEN");
  });
});

describe("loan parties", () => {
  async function pendingLoan() {
    const t = setup();
    const lender = await signIn(t, "Lena");
    const borrower = await signIn(t, "Bob");
    const mallory = await signIn(t, "Mallory");
    const toolId = await listTool(lender.as);
    const loanId = await borrower.as.mutation(api.loans.request, {
      toolId,
      startDate: "2026-11-20",
      endDate: "2026-11-22",
    });
    return { t, lender, borrower, mallory, toolId, loanId };
  }

  test("only the owner can approve or decline", async () => {
    const { borrower, mallory, loanId } = await pendingLoan();
    for (const as of [borrower.as, mallory.as]) {
      await expectAppError(as.mutation(api.loans.approve, { loanId }), "FORBIDDEN");
      await expectAppError(as.mutation(api.loans.decline, { loanId }), "FORBIDDEN");
    }
  });

  test("only the borrower can cancel", async () => {
    const { lender, mallory, loanId } = await pendingLoan();
    await expectAppError(lender.as.mutation(api.loans.cancel, { loanId }), "FORBIDDEN");
    await expectAppError(mallory.as.mutation(api.loans.cancel, { loanId }), "FORBIDDEN");
  });

  test("only the owner or an admin can mark returned", async () => {
    const { t, lender, borrower, mallory, loanId } = await pendingLoan();
    await lender.as.mutation(api.loans.approve, { loanId });
    await expectAppError(borrower.as.mutation(api.loans.markReturned, { loanId }), "FORBIDDEN");
    await expectAppError(mallory.as.mutation(api.loans.markReturned, { loanId }), "FORBIDDEN");

    const admin = await signIn(t, "Ada", { admin: true });
    await admin.as.mutation(api.loans.markReturned, { loanId });
    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan?.status).toBe("returned");
  });

  test("my-requests and incoming views only contain the caller's loans", async () => {
    const { lender, borrower, mallory } = await pendingLoan();
    expect(await borrower.as.query(api.loans.mine, {})).toHaveLength(1);
    expect(await lender.as.query(api.loans.incoming, {})).toHaveLength(1);
    expect(await mallory.as.query(api.loans.mine, {})).toHaveLength(0);
    expect(await mallory.as.query(api.loans.incoming, {})).toHaveLength(0);
  });
});

describe("admin-only functions (FR-AD)", () => {
  test("non-admins are rejected", async () => {
    const t = setup();
    const alice = await signIn(t, "Alice");
    const toolId = await listTool(alice.as);

    await expectAppError(alice.as.query(api.admin.allLoans, {}), "FORBIDDEN");
    await expectAppError(alice.as.query(api.admin.listUsers, {}), "FORBIDDEN");
    await expectAppError(alice.as.mutation(api.admin.removeTool, { toolId }), "FORBIDDEN");
    await expectAppError(
      alice.as.mutation(api.admin.setTrustedLender, { userId: alice.userId, trusted: true }),
      "FORBIDDEN",
    );
    const me = await alice.as.query(api.users.me, {});
    expect(me?.trustedLender).toBe(false);
  });

  test("admin can remove any listing, which declines its pending requests", async () => {
    const t = setup();
    const lender = await signIn(t, "Lena");
    const borrower = await signIn(t, "Bob");
    const admin = await signIn(t, "Ada", { admin: true });
    const toolId = await listTool(lender.as);
    const loanId = await borrower.as.mutation(api.loans.request, {
      toolId,
      startDate: "2026-11-20",
      endDate: "2026-11-21",
    });

    expect(await admin.as.mutation(api.admin.removeTool, { toolId })).toEqual({ declined: 1 });
    expect((await t.run((ctx) => ctx.db.get(loanId)))?.status).toBe("declined");
    expect(await borrower.as.query(api.tools.list, {})).toHaveLength(0);
  });

  test("admin can mark a trusted lender; signed-in users see the badge", async () => {
    const t = setup();
    const lender = await signIn(t, "Lena");
    const other = await signIn(t, "Bob");
    const admin = await signIn(t, "Ada", { admin: true });
    await listTool(lender.as);

    await admin.as.mutation(api.admin.setTrustedLender, { userId: lender.userId, trusted: true });
    const [tool] = await other.as.query(api.tools.list, {});
    expect(tool.ownerTrustedLender).toBe(true);
    expect(tool).not.toHaveProperty("ownerEmail");
  });
});
