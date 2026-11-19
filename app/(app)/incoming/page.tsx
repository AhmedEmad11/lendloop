"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button, ConfirmButton, EmptyState, Loading, PageHeader, useRun } from "@/components/ui";
import { LoanRow } from "@/components/LoanRow";

/** Requests on my tools: approve, decline, mark returned (FR-A4, FR-A5, FR-A9). */
export default function IncomingPage() {
  const loans = useQuery(api.loans.incoming);

  return (
    <>
      <PageHeader title="Incoming requests" />
      {loans === undefined ? (
        <Loading />
      ) : loans.length === 0 ? (
        <EmptyState title="No requests on your tools yet">
          When a neighbor asks to borrow something, it shows up here.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {loans.map((loan) => (
            <LoanRow
              key={loan._id}
              loan={loan}
              party={`for ${loan.otherPartyFirstName}`}
              actions={<LenderActions loanId={loan._id} status={loan.status} borrower={loan.otherPartyFirstName} />}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function LenderActions({
  loanId,
  status,
  borrower,
}: {
  loanId: Id<"loanRequests">;
  status: string;
  borrower: string;
}) {
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const markReturned = useMutation(api.loans.markReturned);
  const { busy, error, run } = useRun();

  if (status === "pending") {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex gap-2">
          <ConfirmButton
            label="Decline"
            title="Decline this request?"
            body={`${borrower} will be notified.`}
            confirmLabel="Decline"
            onConfirm={() => decline({ loanId })}
          />
          <Button variant="primary" busy={busy} onClick={() => run(() => approve({ loanId }))}>
            Approve
          </Button>
        </div>
        {/* Overlap and other server errors appear next to the action. */}
        <p role="alert" className="max-w-xs text-right text-sm font-semibold text-bad">
          {error}
        </p>
      </div>
    );
  }
  if (status === "approved") {
    return (
      <ConfirmButton
        label="Mark returned"
        variant="secondary"
        title="Got it back?"
        body={`Confirm the tool is back with you. ${borrower} gets a confirmation.`}
        confirmLabel="Mark returned"
        onConfirm={() => markReturned({ loanId })}
      />
    );
  }
  return null;
}
