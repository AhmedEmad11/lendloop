"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ConfirmButton, EmptyState, Loading, PageHeader } from "@/components/ui";
import { LoanRow } from "@/components/LoanRow";

/** Requests I made as a borrower (FR-A8). */
export default function RequestsPage() {
  const loans = useQuery(api.loans.mine);
  const cancel = useMutation(api.loans.cancel);

  return (
    <>
      <PageHeader title="My requests" />
      {loans === undefined ? (
        <Loading />
      ) : loans.length === 0 ? (
        <EmptyState title="No requests yet">
          Find something on the{" "}
          <Link href="/tools" className="font-semibold text-ink underline underline-offset-4">
            Tools
          </Link>{" "}
          board.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {loans.map((loan) => (
            <LoanRow
              key={loan._id}
              loan={loan}
              party={`from ${loan.otherPartyFirstName}`}
              actions={
                loan.status === "pending" ? (
                  <ConfirmButton
                    label="Cancel"
                    title="Cancel this request?"
                    body={`${loan.otherPartyFirstName} will be told you no longer need the ${loan.toolName}.`}
                    confirmLabel="Cancel request"
                    onConfirm={() => cancel({ loanId: loan._id })}
                  />
                ) : null
              }
            />
          ))}
        </ul>
      )}
    </>
  );
}
