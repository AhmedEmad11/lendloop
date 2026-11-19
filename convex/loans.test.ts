import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { expectAppError, listTool, setup, signIn } from "../tests/convexHarness";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T12:00:00Z")); // "today" = 2026-11-19 UTC
});
afterEach(() => vi.useRealTimers());

async function world() {
  const t = setup();
  const lender = await signIn(t, "Lena");
  const bob = await signIn(t, "Bob");
  const cara = await signIn(t, "Cara");
  const toolId = await listTool(lender.as);
  return { t, lender, bob, cara, toolId };
}

describe("request validation (FR-L1, FR-L2)", () => {
  test("cannot request your own tool", async () => {
    const { lender, toolId } = await world();
    await expectAppError(
      lender.as.mutation(api.loans.request, { toolId, startDate: "2026-11-20", endDate: "2026-11-21" }),
      "FORBIDDEN",
    );
  });

  test.each([
    ["start in the past", "2026-11-18", "2026-11-20"],
    ["end before start", "2026-11-22", "2026-11-21"],
    ["longer than 30 days", "2026-11-20", "2026-12-20"],
    ["not a real date", "2026-02-30", "2026-03-01"],
    ["wrong format", "20/11/2026", "2026-11-21"],
  ])("rejects %s", async (_label, startDate, endDate) => {
    const { bob, toolId } = await world();
    await expectAppError(
      bob.as.mutation(api.loans.request, { toolId, startDate, endDate }),
      "INVALID_INPUT",
    );
  });

  test("accepts today, same-day loans and exactly 30 days", async () => {
    const { bob, cara, toolId } = await world();
    await bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-19", endDate: "2026-11-19" });
    await cara.as.mutation(api.loans.request, { toolId, startDate: "2026-11-20", endDate: "2026-12-19" });
  });

  test("one pending request per borrower per tool", async () => {
    const { bob, toolId } = await world();
    await bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-20", endDate: "2026-11-21" });
    await expectAppError(
      bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-25", endDate: "2026-11-26" }),
      "CONFLICT",
    );
  });
});

describe("state transitions (FR-L4)", () => {
  test("happy path: pending -> approved -> returned", async () => {
    const { t, lender, bob, toolId } = await world();
    const loanId = await bob.as.mutation(api.loans.request, {
      toolId,
      startDate: "2026-11-19",
      endDate: "2026-11-21",
    });
    await lender.as.mutation(api.loans.approve, { loanId });
    await lender.as.mutation(api.loans.markReturned, { loanId });
    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan).toMatchObject({ status: "returned" });
    expect(loan?.decidedAt).toBeTypeOf("number");
    expect(loan?.returnedAt).toBeTypeOf("number");
  });

  test("terminal and wrong-state transitions are rejected", async () => {
    const { lender, bob, toolId } = await world();
    const loanId = await bob.as.mutation(api.loans.request, {
      toolId,
      startDate: "2026-11-20",
      endDate: "2026-11-21",
    });

    // pending can't be returned
    await expectAppError(lender.as.mutation(api.loans.markReturned, { loanId }), "INVALID_TRANSITION");

    await lender.as.mutation(api.loans.decline, { loanId });
    // declined is terminal
    await expectAppError(lender.as.mutation(api.loans.approve, { loanId }), "INVALID_TRANSITION");
    await expectAppError(lender.as.mutation(api.loans.decline, { loanId }), "INVALID_TRANSITION");
    await expectAppError(bob.as.mutation(api.loans.cancel, { loanId }), "INVALID_TRANSITION");
  });

  test("approved loans can't be cancelled, declined or re-approved", async () => {
    const { lender, bob, toolId } = await world();
    const loanId = await bob.as.mutation(api.loans.request, {
      toolId,
      startDate: "2026-11-20",
      endDate: "2026-11-21",
    });
    await lender.as.mutation(api.loans.approve, { loanId });
    await expectAppError(bob.as.mutation(api.loans.cancel, { loanId }), "INVALID_TRANSITION");
    await expectAppError(lender.as.mutation(api.loans.decline, { loanId }), "INVALID_TRANSITION");
    await expectAppError(lender.as.mutation(api.loans.approve, { loanId }), "INVALID_TRANSITION");
  });

  test("borrower can cancel a pending request", async () => {
    const { t, bob, toolId } = await world();
    const loanId = await bob.as.mutation(api.loans.request, {
      toolId,
      startDate: "2026-11-20",
      endDate: "2026-11-21",
    });
    await bob.as.mutation(api.loans.cancel, { loanId });
    expect((await t.run((ctx) => ctx.db.get(loanId)))?.status).toBe("cancelled");
  });
});

describe("overlap check (FR-L3)", () => {
  test("approval is rejected when dates overlap an approved loan", async () => {
    const { lender, bob, cara, toolId } = await world();
    const first = await bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-20", endDate: "2026-11-25" });
    const second = await cara.as.mutation(api.loans.request, { toolId, startDate: "2026-11-25", endDate: "2026-11-27" });
    await lender.as.mutation(api.loans.approve, { loanId: first });
    await expectAppError(lender.as.mutation(api.loans.approve, { loanId: second }), "CONFLICT");
  });

  test("adjacent ranges don't overlap; returned loans don't block", async () => {
    const { lender, bob, cara, toolId } = await world();
    const first = await bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-20", endDate: "2026-11-22" });
    const second = await cara.as.mutation(api.loans.request, { toolId, startDate: "2026-11-23", endDate: "2026-11-24" });
    await lender.as.mutation(api.loans.approve, { loanId: first });
    await lender.as.mutation(api.loans.approve, { loanId: second });

    // A returned loan frees its dates.
    await lender.as.mutation(api.loans.markReturned, { loanId: first });
    const third = await bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-21", endDate: "2026-11-22" });
    await lender.as.mutation(api.loans.approve, { loanId: third });
  });
});

describe("tool deletion guard (FR-L7)", () => {
  test("owner can't delete a tool with open requests, can after resolving them", async () => {
    const { t, lender, bob, toolId } = await world();
    const loanId = await bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-20", endDate: "2026-11-21" });
    await expectAppError(lender.as.mutation(api.tools.remove, { toolId }), "CONFLICT");

    await lender.as.mutation(api.loans.approve, { loanId });
    await expectAppError(lender.as.mutation(api.tools.remove, { toolId }), "CONFLICT");

    await lender.as.mutation(api.loans.markReturned, { loanId });
    await lender.as.mutation(api.tools.remove, { toolId });
    expect((await t.run((ctx) => ctx.db.get(toolId)))?.deletedAt).toBeTypeOf("number");
    // History keeps the tool name.
    expect((await bob.as.query(api.loans.mine, {}))[0].toolName).toBe("Cordless drill");
  });

  test("can't request a deleted tool", async () => {
    const { lender, bob, toolId } = await world();
    await lender.as.mutation(api.tools.remove, { toolId });
    await expectAppError(
      bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-20", endDate: "2026-11-21" }),
      "NOT_FOUND",
    );
  });
});

describe("availability and overdue (FR-L5, FR-L6)", () => {
  test("tool is unavailable once an approved loan has started, available again when returned", async () => {
    const { lender, bob, toolId } = await world();
    const loanId = await bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-19", endDate: "2026-11-20" });
    expect((await bob.as.query(api.tools.list, {}))[0].available).toBe(true); // pending doesn't block
    await lender.as.mutation(api.loans.approve, { loanId });
    expect((await bob.as.query(api.tools.list, {}))[0].available).toBe(false);
    await lender.as.mutation(api.loans.markReturned, { loanId });
    expect((await bob.as.query(api.tools.list, {}))[0].available).toBe(true);
  });

  test("future approved loans don't make the tool unavailable today", async () => {
    const { lender, bob, toolId } = await world();
    const loanId = await bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-25", endDate: "2026-11-26" });
    await lender.as.mutation(api.loans.approve, { loanId });
    expect((await bob.as.query(api.tools.list, {}))[0].available).toBe(true);
  });

  test("overdue loans are flagged and keep the tool unavailable", async () => {
    const { lender, bob, toolId } = await world();
    const loanId = await bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-19", endDate: "2026-11-20" });
    await lender.as.mutation(api.loans.approve, { loanId });

    vi.setSystemTime(new Date("2026-11-22T08:00:00Z"));
    const [loan] = await bob.as.query(api.loans.mine, {});
    expect(loan.overdue).toBe(true);
    expect((await bob.as.query(api.tools.list, {}))[0].available).toBe(false);
  });
});

describe("event outbox", () => {
  test("every status change queues exactly one outbound event with a unique eventId", async () => {
    const { t, lender, bob, toolId } = await world();
    const loanId = await bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-19", endDate: "2026-11-20" });
    await lender.as.mutation(api.loans.approve, { loanId });
    await lender.as.mutation(api.loans.markReturned, { loanId });

    const events = await t.run((ctx) =>
      ctx.db.query("automationEvents").withIndex("by_loan", (q) => q.eq("loanId", loanId)).collect(),
    );
    expect(events.map((e) => e.type)).toEqual(["request.created", "request.approved", "loan.returned"]);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(3);
    expect(events.every((e) => e.direction === "outbound" && e.status === "queued")).toBe(true);
  });

  test("a rejected transition queues nothing", async () => {
    const { t, lender, bob, toolId } = await world();
    const loanId = await bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-20", endDate: "2026-11-21" });
    await expectAppError(lender.as.mutation(api.loans.markReturned, { loanId }), "INVALID_TRANSITION");
    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events).toHaveLength(1);
  });
});
