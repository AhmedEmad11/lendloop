import { describe, expect, test } from "vitest";
import { sign, signedHeaders, timingSafeEqual, verify } from "./hmac";

const SECRET = "test-secret-not-real";
const NOW = Date.parse("2026-11-19T12:00:00Z");
const TS = String(Math.floor(NOW / 1000));
const BODY = JSON.stringify({ hello: "world", n: 1 });

describe("hmac", () => {
  test("matches a reference HMAC computed with openssl", async () => {
    // printf '%s' '1763553600.{"hello":"world"}' | openssl dgst -sha256 -hmac 'Jefe'
    expect(await sign("Jefe", "1763553600", '{"hello":"world"}')).toBe(
      "d435a69d53acebb849bff90005c52026e223eb34c42ab56d5339deeeeffd699c",
    );
  });

  test("round trip verifies", async () => {
    const h = await signedHeaders(SECRET, "evt_1", BODY, NOW);
    const r = await verify({
      secret: SECRET,
      timestamp: h["X-LendLoop-Timestamp"],
      signature: h["X-LendLoop-Signature"],
      eventId: h["X-LendLoop-Event-Id"],
      rawBody: BODY,
      nowMs: NOW,
    });
    expect(r).toEqual({ ok: true });
  });

  test("rejects a tampered body, wrong secret, or missing headers", async () => {
    const signature = await sign(SECRET, TS, BODY);
    const base = { secret: SECRET, timestamp: TS, signature, eventId: "evt_1", rawBody: BODY, nowMs: NOW };

    expect(await verify({ ...base, rawBody: BODY.replace("world", "w0rld") })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verify({ ...base, secret: "other-secret" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verify({ ...base, signature: null })).toEqual({ ok: false, reason: "missing_headers" });
    expect(await verify({ ...base, eventId: null })).toEqual({ ok: false, reason: "missing_headers" });
    expect(await verify({ ...base, secret: undefined })).toEqual({ ok: false, reason: "not_configured" });
  });

  test("signature covers the timestamp, so it can't be re-dated", async () => {
    const signature = await sign(SECRET, TS, BODY);
    const later = String(Number(TS) + 60);
    expect(
      await verify({ secret: SECRET, timestamp: later, signature, eventId: "e", rawBody: BODY, nowMs: NOW }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("enforces the 5-minute window in both directions", async () => {
    const at = async (offsetSeconds: number) => {
      const ts = String(Number(TS) + offsetSeconds);
      const signature = await sign(SECRET, ts, BODY);
      return verify({ secret: SECRET, timestamp: ts, signature, eventId: "e", rawBody: BODY, nowMs: NOW });
    };
    expect(await at(-300)).toEqual({ ok: true });
    expect(await at(300)).toEqual({ ok: true });
    expect(await at(-301)).toEqual({ ok: false, reason: "expired" });
    expect(await at(301)).toEqual({ ok: false, reason: "expired" });
  });

  test("rejects non-numeric timestamps", async () => {
    const r = await verify({ secret: SECRET, timestamp: "1e9", signature: "x", eventId: "e", rawBody: "", nowMs: NOW });
    expect(r).toEqual({ ok: false, reason: "bad_timestamp" });
  });

  test("timingSafeEqual", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
