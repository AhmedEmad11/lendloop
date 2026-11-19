/**
 * HMAC-SHA256 request signing, both directions (SR-4, SR-5).
 *
 *   signature = hex(HMAC(secret, timestamp + "." + rawBody))
 *
 * Headers: X-LendLoop-Timestamp (unix seconds), X-LendLoop-Event-Id,
 * X-LendLoop-Signature. Each direction uses its own secret. Web Crypto only,
 * so it runs in the Convex runtime without Node.
 */

export const HEADER_TIMESTAMP = "X-LendLoop-Timestamp";
export const HEADER_EVENT_ID = "X-LendLoop-Event-Id";
export const HEADER_SIGNATURE = "X-LendLoop-Signature";

export const MAX_SKEW_SECONDS = 5 * 60;

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sign(secret: string, timestamp: string, rawBody: string): Promise<string> {
  if (!secret) throw new Error("HMAC secret is not configured");
  return await hmacHex(secret, `${timestamp}.${rawBody}`);
}

/** Compares every byte regardless of where the first mismatch is. */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "bad_timestamp" | "expired" | "bad_signature" | "not_configured" };

export async function verify(params: {
  secret: string | undefined;
  timestamp: string | null;
  signature: string | null;
  eventId: string | null;
  rawBody: string;
  nowMs?: number;
}): Promise<VerifyResult> {
  const { secret, timestamp, signature, eventId, rawBody } = params;
  if (!secret) return { ok: false, reason: "not_configured" };
  if (!timestamp || !signature || !eventId) return { ok: false, reason: "missing_headers" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };

  const nowSeconds = Math.floor((params.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "expired" };
  }
  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  return timingSafeEqual(expected, signature.toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "bad_signature" };
}

/** Builds the three signed headers for an outbound request. */
export async function signedHeaders(
  secret: string,
  eventId: string,
  rawBody: string,
  nowMs: number = Date.now(),
): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    [HEADER_TIMESTAMP]: timestamp,
    [HEADER_EVENT_ID]: eventId,
    [HEADER_SIGNATURE]: await sign(secret, timestamp, rawBody),
  };
}
