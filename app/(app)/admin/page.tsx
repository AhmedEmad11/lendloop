"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS } from "@/convex/lib/constants";
import { Button, ConfirmButton, EmptyState, Loading, PageHeader, useRun } from "@/components/ui";
import { LoanRow } from "@/components/LoanRow";
import { useMe } from "@/components/MeContext";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Admin (FR-AD1..3). Hidden from non-admins in the nav, but the real guard is
 * requireAdmin in every admin.* function.
 */
export default function AdminPage() {
  const me = useMe();
  if (me.role !== "admin") {
    return <EmptyState title="Admins only">You don&apos;t have access to this page.</EmptyState>;
  }
  return (
    <>
      <PageHeader title="Admin" />
      <div className="flex flex-col gap-12">
        <Listings />
        <Lenders />
        <Loans />
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-4 font-display text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Listings() {
  const tools = useQuery(api.tools.list, {});
  const removeTool = useMutation(api.admin.removeTool);
  return (
    <Section title="All listings">
      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <EmptyState title="No listings" />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {tools.map((t) => (
            <li key={t._id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span>
                <strong>{t.name}</strong>{" "}
                <span className="text-sm text-ink-3">
                  {CATEGORY_LABELS[t.category]} · {t.ownerFirstName}
                </span>
              </span>
              <ConfirmButton
                label="Remove"
                title={`Remove ${t.name}?`}
                body="Pending requests on it are declined and the borrowers notified. An active loan stays open until returned."
                confirmLabel="Remove listing"
                onConfirm={() => removeTool({ toolId: t._id })}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Lenders() {
  const users = useQuery(api.admin.listUsers);
  return (
    <Section title="Trusted lenders">
      {users === undefined ? (
        <Loading />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {users.map((u) => (
            <TrustRow key={u._id} user={u} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function TrustRow({
  user,
}: {
  user: { _id: Id<"users">; firstName: string; email: string; role: string; trustedLender: boolean };
}) {
  const setTrusted = useMutation(api.admin.setTrustedLender);
  const { busy, error, run } = useRun();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <span>
        <strong>{user.firstName}</strong> <span className="text-sm text-ink-3">{user.email}</span>
        {user.role === "admin" ? <span className="ml-2 text-sm text-ink-3">(admin)</span> : null}
        {error ? <span role="alert" className="ml-2 text-sm text-bad">{error}</span> : null}
      </span>
      <Button
        variant={user.trustedLender ? "secondary" : "quiet"}
        aria-pressed={user.trustedLender}
        busy={busy}
        onClick={() => run(() => setTrusted({ userId: user._id, trusted: !user.trustedLender }))}
      >
        {user.trustedLender ? "✓ Trusted" : "Mark trusted"}
      </Button>
    </li>
  );
}

function Loans() {
  const loans = useQuery(api.admin.allLoans);
  const markReturned = useMutation(api.loans.markReturned);
  return (
    <Section title="All loans">
      {loans === undefined ? (
        <Loading />
      ) : loans.length === 0 ? (
        <EmptyState title="No loans yet" />
      ) : (
        <ul className="flex flex-col gap-3">
          {loans.map((loan) => (
            <LoanRow
              key={loan._id}
              loan={loan}
              party={`${loan.ownerName} → ${loan.borrowerName}`}
              actions={
                loan.status === "approved" ? (
                  <ConfirmButton
                    label="Mark returned"
                    variant="secondary"
                    title="Mark as returned?"
                    body="Use this when the lender can't, e.g. they confirmed by phone."
                    confirmLabel="Mark returned"
                    onConfirm={() => markReturned({ loanId: loan._id })}
                  />
                ) : null
              }
            />
          ))}
        </ul>
      )}
    </Section>
  );
}
