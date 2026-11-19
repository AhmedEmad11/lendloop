import type { LoanStatus } from "@/convex/lib/constants";

export function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dateFmt = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(`${iso}T00:00:00Z`));
}

export function formatRange(start: string, end: string): string {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(ms: number, now = Date.now()): string {
  const seconds = Math.round((ms - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86400), "day");
}

export const STATUS_LABEL: Record<LoanStatus, string> = {
  pending: "Requested",
  approved: "On loan",
  declined: "Declined",
  cancelled: "Cancelled",
  returned: "Returned",
};

export const STATUS_TONE: Record<LoanStatus, string> = {
  pending: "text-accent-ink",
  approved: "text-ink",
  declined: "text-ink-3",
  cancelled: "text-ink-3",
  returned: "text-ok",
};

/** FR-A11: one human line describing the latest automation event on a loan. */
export function activityLine(
  activity: { type: string; status: "queued" | "sent" | "failed"; at: number } | null,
): string | null {
  if (!activity) return null;
  const what: Record<string, string> = {
    "request.created": "New-request notice sent",
    "request.approved": "Approval notice sent",
    "request.declined": "Decline notice sent",
    "request.cancelled": "Cancellation notice sent",
    "loan.returned": "Return confirmation sent",
    "reminder.overdue": "Reminder sent",
  };
  const label = what[activity.type] ?? "Automation ran";
  if (activity.status === "queued") return "Notification sending…";
  if (activity.status === "failed") return `Notification failed ${timeAgo(activity.at)}`;
  return `${label} ${timeAgo(activity.at)}`;
}
