// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { sign, verify } from "../convex/lib/hmac";

const nodeRequire = createRequire(import.meta.url);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

type Env = Record<string, string | undefined>;
type Static = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Item = { json: any; binary?: { data: unknown } }; // eslint-disable-line @typescript-eslint/no-explicit-any

function loadCode(file: string, nodeName: string): string {
  const wf = JSON.parse(readFileSync(join(__dirname, "..", "n8n", "workflows", file), "utf8"));
  const node = wf.nodes.find((n: { name: string }) => n.name === nodeName);
  if (!node) throw new Error(`node not found: ${nodeName}`);
  return node.parameters.jsCode as string;
}

async function run(
  file: string,
  nodeName: string,
  opts: { items?: Item[]; json?: unknown; env?: Env; staticData?: Static; rawBody?: string } = {},
): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const fn = new AsyncFunction(
    "$input", "$env", "$getWorkflowStaticData", "$json", "$", "$itemIndex", "require",
    loadCode(file, nodeName),
  );
  const items = opts.items ?? [];
  const staticData = opts.staticData ?? {};
  const self = {
    helpers: {
      getBinaryDataBuffer: async () => Buffer.from(opts.rawBody ?? "", "utf8"),
    },
  };
  const req = (m: string) => {
    if (m === "crypto" || m === "node:crypto") return nodeRequire("node:crypto");
    throw new Error(`require not allowed: ${m}`);
  };
  const result = await fn.call(
    self, { first: () => items[0], all: () => items }, opts.env ?? {}, () => staticData,
    opts.json, () => { throw new Error("$ not stubbed"); }, 0, req,
  );
  return result;
}

const W1 = "1-request-notification.json";
const W2 = "2-overdue-reminders.json";
const W3 = "3-error-handler.json";
const SECRET = "inbound-secret";
const OUT_SECRET = "outbound-secret";
const EVENT = { eventId: "evt_1", type: "request.created", recipient: { email: "alice@example.com" } };
const nowSec = () => Math.floor(Date.now() / 1000);

async function verifyCall(o: {
  body?: string; secret?: string | undefined; signSecret?: string; ts?: number;
  headers?: Record<string, string>; eventId?: string; staticData?: Static; upper?: boolean; omit?: string;
} = {}) {
  const body = o.body ?? JSON.stringify(EVENT);
  const ts = String(o.ts ?? nowSec());
  let signature = await sign(o.signSecret ?? SECRET, ts, body);
  if (o.upper) signature = signature.toUpperCase();
  const headers: Record<string, string> = {
    "x-lendloop-timestamp": ts,
    "x-lendloop-signature": signature,
    "x-lendloop-event-id": o.eventId ?? "evt_1",
    ...o.headers,
  };
  if (o.omit) delete headers[o.omit];
  const env: Env = "secret" in o ? { LENDLOOP_N8N_HMAC_SECRET: o.secret } : { LENDLOOP_N8N_HMAC_SECRET: SECRET };
  const out = await run(W1, "Verify signature", {
    items: [{ json: { headers, body: {} }, binary: { data: {} } }],
    rawBody: body, env, staticData: o.staticData ?? {},
  });
  return out[0].json;
}

afterEach(() => vi.restoreAllMocks());

describe("workflow 1: Verify signature", () => {
  test("valid request", async () => {
    expect(await verifyCall()).toEqual({ valid: true, duplicate: false, event: EVENT });
  });
  test("falls back to JSON.stringify(body) when no binary", async () => {
    const ts = String(nowSec());
    const sig = await sign(SECRET, ts, JSON.stringify(EVENT));
    const out = await run(W1, "Verify signature", {
      items: [{ json: { headers: { "x-lendloop-timestamp": ts, "x-lendloop-signature": sig, "x-lendloop-event-id": "evt_1" }, body: EVENT } }],
      env: { LENDLOOP_N8N_HMAC_SECRET: SECRET },
    });
    expect(out[0].json.valid).toBe(true);
  });
  test("tampered body", async () => {
    const ts = String(nowSec());
    const sig = await sign(SECRET, ts, JSON.stringify(EVENT));
    const tampered = JSON.stringify({ ...EVENT, type: "request.cancelled" });
    const out = await run(W1, "Verify signature", {
      items: [{ json: { headers: { "x-lendloop-timestamp": ts, "x-lendloop-signature": sig, "x-lendloop-event-id": "evt_1" } }, binary: { data: {} } }],
      rawBody: tampered, env: { LENDLOOP_N8N_HMAC_SECRET: SECRET },
    });
    expect(out[0].json).toEqual({ valid: false, reason: "bad_signature" });
  });
  test("wrong secret", async () => {
    expect(await verifyCall({ signSecret: "other" })).toEqual({ valid: false, reason: "bad_signature" });
  });
  test.each(["x-lendloop-timestamp", "x-lendloop-signature", "x-lendloop-event-id"])("missing header %s", async (h) => {
    expect(await verifyCall({ omit: h })).toEqual({ valid: false, reason: "missing_headers" });
  });
  test("mixed-case header names are not recognised (n8n lowercases)", async () => {
    const ts = String(nowSec());
    const sig = await sign(SECRET, ts, JSON.stringify(EVENT));
    const out = await run(W1, "Verify signature", {
      items: [{ json: { headers: { "X-LendLoop-Timestamp": ts, "X-LendLoop-Signature": sig, "X-LendLoop-Event-Id": "evt_1" } }, binary: { data: {} } }],
      rawBody: JSON.stringify(EVENT), env: { LENDLOOP_N8N_HMAC_SECRET: SECRET },
    });
    expect(out[0].json.reason).toBe("missing_headers");
  });
  test("timestamp 301s old is expired", async () => {
    expect(await verifyCall({ ts: nowSec() - 301 })).toEqual({ valid: false, reason: "expired" });
  });
  test("timestamp 301s ahead is expired", async () => {
    expect(await verifyCall({ ts: nowSec() + 301 })).toEqual({ valid: false, reason: "expired" });
  });
  test("timestamp 290s old is accepted", async () => {
    expect((await verifyCall({ ts: nowSec() - 290 })).valid).toBe(true);
  });
  test("header eventId differs from body eventId", async () => {
    expect(await verifyCall({ eventId: "evt_other" })).toEqual({ valid: false, reason: "event_id_mismatch" });
  });
  test("secret unset", async () => {
    expect(await verifyCall({ secret: undefined })).toEqual({ valid: false, reason: "not_configured" });
  });
  test("uppercase hex signature accepted", async () => {
    expect((await verifyCall({ upper: true })).valid).toBe(true);
  });
});

describe("dedupe ordering", () => {
  test("duplicate only after Remember event", async () => {
    const staticData: Static = {};
    expect((await verifyCall({ staticData })).duplicate).toBe(false);
    const r = await run(W1, "Remember event", { items: [{ json: { eventId: "evt_1" } }], staticData });
    expect(r).toEqual([{ json: { status: "sent" } }]);
    expect(await verifyCall({ staticData })).toMatchObject({ valid: true, duplicate: true });
  });
  test("Remember event prunes entries older than 24h", async () => {
    const now = Date.now();
    const staticData: Static = { seen: { old: now - 86400000 - 1000, fresh: now - 1000 } };
    await run(W1, "Remember event", { items: [{ json: { eventId: "evt_new" } }], staticData });
    expect(Object.keys(staticData.seen).sort()).toEqual(["evt_new", "fresh"]);
  });
});

describe("outbound signing verifies with convex/lib/hmac", () => {
  const env = { LENDLOOP_CONVEX_HMAC_SECRET: OUT_SECRET };
  const check = (o: { ts: string; signature: string; eventId: string }, rawBody: string) =>
    verify({ secret: OUT_SECRET, timestamp: o.ts, signature: o.signature, eventId: o.eventId, rawBody });

  test("Sign fetch (empty body)", async () => {
    const out = (await run(W2, "Sign fetch", { items: [{ json: {} }], env }))[0].json;
    expect(out.eventId).toMatch(/^n8n_/);
    expect(await check(out, "")).toEqual({ ok: true });
  });
  test("Sign fetch throws without secret", async () => {
    await expect(run(W2, "Sign fetch", { items: [{ json: {} }], env: {} })).rejects.toThrow(/not set/);
  });
  test("Sign write-back", async () => {
    const json = { idempotencyKey: "k1", loanId: "l1", status: "failed", error: "x" };
    const out = (await run(W2, "Sign write-back", { json, env })).json;
    expect(JSON.parse(out.body)).toEqual(json);
    expect(out.status).toBe("failed");
    expect(await check(out, out.body)).toEqual({ ok: true });
  });
  test("Sign write-back omits error when absent", async () => {
    const out = (await run(W2, "Sign write-back", { json: { idempotencyKey: "k", loanId: "l", status: "sent" }, env })).json;
    expect(JSON.parse(out.body)).toEqual({ idempotencyKey: "k", loanId: "l", status: "sent" });
    expect(await check(out, out.body)).toEqual({ ok: true });
  });
  test("Log and sign report", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const input = {
      execution: { id: "42", lastNodeExecuted: "Send reminder (mock)", error: { message: "boom" } },
      workflow: { name: "W" },
    };
    const out = (await run(W3, "Log and sign report", { items: [{ json: input }], env }))[0].json;
    expect(JSON.parse(out.body)).toEqual({ workflow: "W", executionId: "42", node: "Send reminder (mock)", message: "boom" });
    expect(await check(out, out.body)).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("Send notification (mock)", () => {
  const json = { eventId: "evt_1", type: "request.created", to: "alice@example.com", subject: "LendLoop: Drill" };
  test("throws when LENDLOOP_FORCE_FAIL=true", async () => {
    await expect(run(W1, "Send notification (mock)", { json, env: { LENDLOOP_FORCE_FAIL: "true" } })).rejects.toThrow(/Forced failure/);
  });
  test("masks the email in the log", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const out = await run(W1, "Send notification (mock)", { json, env: {} });
    expect(out.json.delivered).toBe(true);
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("alice@example.com");
    expect(logged).toContain("a***@example.com");
  });
});
