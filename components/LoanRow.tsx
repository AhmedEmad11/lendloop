"use client";

import type { ReactNode } from "react";
import type { LoanStatus } from "@/convex/lib/constants";
import { Stamp } from "@/components/ui";
import { activityLine, formatRange, STATUS_LABEL, STATUS_TONE } from "@/lib/format";

export type LoanRowData = {
  toolName: string;
  startDate: string;
  endDate: string;
  status: LoanStatus;
  overdue: boolean;
  lastActivity: { type: string; status: "queued" | "sent" | "failed"; at: number } | null;
};

/** Shared loan tag used by My requests, Incoming and Admin. */
export function LoanRow({
  loan,
  party,
  actions,
}: {
  loan: LoanRowData;
  party: ReactNode;
  actions?: ReactNode;
}) {
  const activity = activityLine(loan.lastActivity);
  return (
    <li className="tag flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-lg font-bold">{loan.toolName}</h2>
        <p className="text-ink-2">
          {formatRange(loan.startDate, loan.endDate)} · {party}
        </p>
        {activity ? (
          <p
            className={`mt-1 text-sm ${loan.lastActivity?.status === "failed" ? "text-bad" : "text-ink-3"}`}
          >
            {activity}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {loan.overdue ? (
          <Stamp tone="text-bad">Overdue</Stamp>
        ) : (
          <Stamp tone={STATUS_TONE[loan.status]}>{STATUS_LABEL[loan.status]}</Stamp>
        )}
        {actions}
      </div>
    </li>
  );
}
