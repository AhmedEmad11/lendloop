import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { listTool, setup, signIn } from "../tests/convexHarness";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

// Acceptance criterion 1 / FR-P2 / FR-P4: the public projection exposes
// name and category only, built on the server.
test("public list returns exactly {name, category} and nothing that identifies the owner", async () => {
  const t = setup();
  const lena = await signIn(t, "Lena");
  await listTool(lena.as, "Cordless drill");
  await listTool(lena.as, "Bolt cutter");

  const rows = await t.query(api.public.listAvailable, {}); // signed out
  expect(rows).toEqual([
    { name: "Bolt cutter", category: "power_tools" },
    { name: "Cordless drill", category: "power_tools" },
  ]);
  for (const row of rows) expect(Object.keys(row).sort()).toEqual(["category", "name"]);

  const serialized = JSON.stringify(rows);
  for (const leak of ["lena", "Lena", "example.com", lena.userId, "18V", "good"]) {
    expect(serialized).not.toContain(leak);
  }
});

test("public list hides deleted and currently lent-out tools", async () => {
  const t = setup();
  const lena = await signIn(t, "Lena");
  const bob = await signIn(t, "Bob");
  const lent = await listTool(lena.as, "Ladder");
  const gone = await listTool(lena.as, "Sander");
  await listTool(lena.as, "Tent");

  const loanId = await bob.as.mutation(api.loans.request, {
    toolId: lent,
    startDate: "2026-11-19",
    endDate: "2026-11-20",
  });
  await lena.as.mutation(api.loans.approve, { loanId });
  await lena.as.mutation(api.tools.remove, { toolId: gone });

  expect((await t.query(api.public.listAvailable, {})).map((r) => r.name)).toEqual(["Tent"]);
});
