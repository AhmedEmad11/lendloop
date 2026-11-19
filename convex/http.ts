import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { HEADER_EVENT_ID, HEADER_SIGNATURE, HEADER_TIMESTAMP, verify } from "./lib/hmac";

/**
 * n8n -> Convex endpoints (SR-5). Each one verifies the HMAC signature and the
 * 5-minute window before doing any work, then calls an internal function.
 */

const MAX_BODY_BYTES = 16 * 1024;

type Handler = (ctx: ActionCtx, body: unknown, eventId: string) => Promise<Response>;

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Wraps a handler with signature verification and body parsing. */
function signed(handler: Handler) {
  return httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) return json(413, { error: "payload_too_large" });

    const eventId = request.headers.get(HEADER_EVENT_ID);
    const result = await verify({
      secret: process.env.LENDLOOP_CONVEX_HMAC_SECRET,
      timestamp: request.headers.get(HEADER_TIMESTAMP),
      signature: request.headers.get(HEADER_SIGNATURE),
      eventId,
      rawBody,
    });
    if (!result.ok) {
      // Generic answer to the caller; the reason only goes to our logs.
      console.warn(`n8n request rejected: ${result.reason} ${new URL(request.url).pathname}`);
      return json(result.reason === "not_configured" ? 503 : 401, { error: "unauthorized" });
    }

    let body: unknown = null;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return json(400, { error: "invalid_json" });
      }
    }
    return handler(ctx, body, eventId!.slice(0, 100));
  });
}

function str(obj: unknown, key: string, max: number): string | null {
  if (typeof obj !== "object" || obj === null) return null;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

const http = httpRouter();

http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: signed(async (ctx) => {
    const loans = await ctx.runQuery(internal.automation.overdueLoans, {});
    return json(200, { loans });
  }),
});

http.route({
  path: "/n8n/reminder-status",
  method: "POST",
  handler: signed(async (ctx, body, eventId) => {
    const idempotencyKey = str(body, "idempotencyKey", 120);
    const loanId = str(body, "loanId", 64);
    const status = str(body, "status", 10);
    if (!idempotencyKey || !loanId || (status !== "sent" && status !== "failed")) {
      return json(400, { error: "invalid_body" });
    }
    const result = await ctx.runMutation(internal.automation.recordReminder, {
      idempotencyKey,
      loanId,
      status,
      error: str(body, "error", 1000) ?? undefined,
      eventId,
    });
    return json(result.result === "unknown_loan" || result.result === "bad_key" ? 422 : 200, result);
  }),
});

http.route({
  path: "/n8n/automation-error",
  method: "POST",
  handler: signed(async (ctx, body, eventId) => {
    const workflow = str(body, "workflow", 200);
    const executionId = str(body, "executionId", 100);
    if (!workflow || !executionId) return json(400, { error: "invalid_body" });
    const result = await ctx.runMutation(internal.automation.recordAutomationError, {
      workflow,
      executionId,
      node: str(body, "node", 200) ?? "unknown node",
      message: str(body, "message", 2000) ?? "no message",
      eventId,
    });
    return json(200, result);
  }),
});

export default http;
