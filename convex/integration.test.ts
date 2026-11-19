import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { sign, verify } from "./lib/hmac";
import { MAX_ATTEMPTS } from "./notify";
import { listTool, setup, signIn, type T } from "../tests/convexHarness";

const CONVEX_SECRET = "test-convex-secret"; // n8n -> Convex
const N8N_SECRET = "test-n8n-secret"; // Convex -> n8n

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
  vi.stubEnv("LENDLOOP_CONVEX_HMAC_SECRET", CONVEX_SECRET);
  vi.stubEnv("LENDLOOP_N8N_HMAC_SECRET", N8N_SECRET);
  vi.stubEnv("N8N_WEBHOOK_URL", "http://n8n.test/webhook");
  vi.stubEnv("N8N_WEBHOOK_AUTH_TOKEN", "test-header-token");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function signedFetch(
  t: T,
  path: string,
  { method = "POST", body, secret = CONVEX_SECRET, skewSeconds = 0 }: {
    method?: string;
    body?: unknown;
    secret?: string;
    skewSeconds?: number;
  } = {},
) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000) + skewSeconds);
  return t.fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-LendLoop-Timestamp": ts,
      "X-LendLoop-Event-Id": `evt_test_${Math.random()}`,
      "X-LendLoop-Signature": await sign(secret, ts, raw),
    },
    body: method === "GET" ? undefined : raw,
  });
}

/** One loan that ended yesterday and hasn't been returned. */
async function overdueWorld() {
  const t = setup();
  const lena = await signIn(t, "Lena");
  const bob = await signIn(t, "Bob");
  const toolId = await listTool(lena.as, "Ladder");
  const loanId = await bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-19", endDate: "2026-11-20" });
  await lena.as.mutation(api.loans.approve, { loanId });
  vi.setSystemTime(new Date("2026-11-22T08:00:00Z")); // 2 days overdue
  return { t, lena, bob, loanId };
}

describe("signed HTTP endpoints (SR-5, AC4)", () => {
  test.each([
    ["no headers", async (t: T) => t.fetch("/n8n/overdue-loans", { method: "GET" })],
    ["wrong secret", async (t: T) => signedFetch(t, "/n8n/overdue-loans", { method: "GET", secret: "nope" })],
    ["expired timestamp", async (t: T) => signedFetch(t, "/n8n/overdue-loans", { method: "GET", skewSeconds: -301 })],
  ])("rejects %s with 401", async (_label, call) => {
    const { t } = await overdueWorld();
    const res = await call(t);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("rejects a body that doesn't match its signature", async () => {
    const { t, loanId } = await overdueWorld();
    const ts = String(Math.floor(Date.now() / 1000));
    const signedBody = JSON.stringify({ idempotencyKey: `reminder:${loanId}:2026-11-22`, loanId, status: "sent" });
    const res = await t.fetch("/n8n/reminder-status", {
      method: "POST",
      headers: {
        "X-LendLoop-Timestamp": ts,
        "X-LendLoop-Event-Id": "evt_x",
        "X-LendLoop-Signature": await sign(CONVEX_SECRET, ts, signedBody),
      },
      body: signedBody.replace("sent", "failed"),
    });
    expect(res.status).toBe(401);
    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events.filter((e) => e.direction === "inbound")).toHaveLength(0);
  });

  test("overdue endpoint returns only what a reminder needs", async () => {
    const { t, loanId } = await overdueWorld();
    const res = await signedFetch(t, "/n8n/overdue-loans", { method: "GET" });
    expect(res.status).toBe(200);
    const { loans } = await res.json();
    expect(loans).toEqual([
      {
        loanId,
        idempotencyKey: `reminder:${loanId}:2026-11-22`,
        borrower: { email: "bob@example.com", firstName: "Bob" },
        toolName: "Ladder",
        endDate: "2026-11-20",
        daysOverdue: 2,
      },
    ]);
  });
});

describe("idempotent reminder write-back (RR-1, AC5)", () => {
  test("running the reminder flow twice the same day records one reminder per loan", async () => {
    const { t, loanId } = await overdueWorld();
    const key = `reminder:${loanId}:2026-11-22`;

    for (let run = 0; run < 2; run++) {
      const { loans } = await (await signedFetch(t, "/n8n/overdue-loans", { method: "GET" })).json();
      for (const loan of loans) {
        const res = await signedFetch(t, "/n8n/reminder-status", {
          body: { idempotencyKey: loan.idempotencyKey, loanId: loan.loanId, status: "sent" },
        });
        expect(res.status).toBe(200);
      }
      // Second run: the loan is already reminded today, so nothing comes back.
      if (run === 1) expect(loans).toHaveLength(0);
    }

    // Replaying the write-back directly is also a no-op.
    const replay = await signedFetch(t, "/n8n/reminder-status", { body: { idempotencyKey: key, loanId, status: "sent" } });
    expect(await replay.json()).toEqual({ result: "duplicate" });

    const reminders = await t.run((ctx) =>
      ctx.db.query("automationEvents").withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", key)).collect(),
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ status: "sent", type: "reminder.overdue", direction: "inbound" });
  });

  test("a failed reminder stays visible and can be upgraded by a retry, never downgraded", async () => {
    const { t, loanId } = await overdueWorld();
    const key = `reminder:${loanId}:2026-11-22`;
    await signedFetch(t, "/n8n/reminder-status", { body: { idempotencyKey: key, loanId, status: "failed", error: "SMTP down" } });

    // Still listed for retry.
    const { loans } = await (await signedFetch(t, "/n8n/overdue-loans", { method: "GET" })).json();
    expect(loans).toHaveLength(1);

    expect(await (await signedFetch(t, "/n8n/reminder-status", { body: { idempotencyKey: key, loanId, status: "sent" } })).json()).toEqual({ result: "updated" });
    expect(await (await signedFetch(t, "/n8n/reminder-status", { body: { idempotencyKey: key, loanId, status: "failed" } })).json()).toEqual({ result: "duplicate" });
  });

  test("rejects keys that don't belong to the loan", async () => {
    const { t, loanId } = await overdueWorld();
    const res = await signedFetch(t, "/n8n/reminder-status", {
      body: { idempotencyKey: "reminder:someoneelse:2026-11-22", loanId, status: "sent" },
    });
    expect(res.status).toBe(422);
  });

  test("the loan's activity line shows the reminder (FR-A11)", async () => {
    const { t, bob, loanId } = await overdueWorld();
    await signedFetch(t, "/n8n/reminder-status", {
      body: { idempotencyKey: `reminder:${loanId}:2026-11-22`, loanId, status: "sent" },
    });
    const [loan] = await bob.as.query(api.loans.mine, {});
    expect(loan.lastActivity).toMatchObject({ type: "reminder.overdue", status: "sent" });
  });
});

describe("error workflow write-back (FR-N4, AC7)", () => {
  test("records the failure once and shows it to admins", async () => {
    const { t } = await overdueWorld();
    const body = { workflow: "LendLoop – Overdue reminders", executionId: "1234", node: "Send reminder", message: "boom" };
    expect(await (await signedFetch(t, "/n8n/automation-error", { body })).json()).toEqual({ result: "created" });
    expect(await (await signedFetch(t, "/n8n/automation-error", { body })).json()).toEqual({ result: "duplicate" });

    const admin = await signIn(t, "Ada", { admin: true });
    const issues = await admin.as.query(api.automation.recentIssues, {});
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ type: "automation.error", lastError: "boom", detail: "LendLoop – Overdue reminders › Send reminder" });

    const user = await signIn(t, "Ursula");
    await expect(user.as.query(api.automation.recentIssues, {})).rejects.toThrow();
  });
});

describe("outbound delivery (SR-4, RR-3, AC6)", () => {
  async function queuedEvent() {
    const t = setup();
    const lena = await signIn(t, "Lena");
    const bob = await signIn(t, "Bob");
    const toolId = await listTool(lena.as, "Tent");
    const loanId = await bob.as.mutation(api.loans.request, { toolId, startDate: "2026-11-20", endDate: "2026-11-21" });
    const [event] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    return { t, loanId, eventId: event.eventId };
  }

  test("posts a signed, minimal payload to n8n and marks the event sent", async () => {
    const { t, loanId, eventId } = await queuedEvent();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.notify.deliver, { eventId });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://n8n.test/webhook/lendloop/request-event");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-LendLoop-Auth"]).toBe("test-header-token");
    expect(headers["X-LendLoop-Event-Id"]).toBe(eventId);
    const verified = await verify({
      secret: N8N_SECRET,
      timestamp: headers["X-LendLoop-Timestamp"],
      signature: headers["X-LendLoop-Signature"],
      eventId,
      rawBody: init.body as string,
    });
    expect(verified).toEqual({ ok: true });

    // Data minimization: exactly these fields, recipient = lender for request.created.
    const payload = JSON.parse(init.body as string);
    expect(payload).toEqual({
      eventId,
      type: "request.created",
      loanId,
      status: "pending",
      recipient: { email: "lena@example.com", firstName: "Lena" },
      tool: { name: "Tent" },
      dates: { start: "2026-11-20", end: "2026-11-21" },
      occurredAt: expect.any(Number),
    });

    const [event] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(event).toMatchObject({ status: "sent", attempts: 1 });

    // Delivering again is a no-op (already sent).
    await t.action(internal.notify.deliver, { eventId });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("with n8n down, retries with backoff then marks failed; the user's action already succeeded", async () => {
    const { t, eventId } = await queuedEvent();
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed: connect ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);

    // The request mutation already scheduled delivery; let the scheduler drive it.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    const [event] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(event).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(event.lastError).toContain("ECONNREFUSED");

    // The loan request itself is untouched.
    const loans = await t.run((ctx) => ctx.db.query("loanRequests").collect());
    expect(loans[0].status).toBe("pending");
  });

  test("a non-2xx answer counts as a failure and recovers on retry", async () => {
    const { t, eventId } = await queuedEvent();
    const responses = [new Response("", { status: 500 }), new Response("ok", { status: 200 })];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift()!));

    // The request mutation already scheduled delivery; let the scheduler drive it.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [event] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(event).toMatchObject({ status: "sent", attempts: 2 });
  });
});
