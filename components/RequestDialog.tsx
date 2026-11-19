"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LIMITS } from "@/convex/lib/constants";
import { Button, Dialog, Field, FormError, inputClass, useRun } from "@/components/ui";
import { addDaysIso, todayUtcIso } from "@/lib/format";

/** Borrow request with a date range. Server errors (overlap, dates) show inline. */
export function RequestDialog({
  tool,
  onClose,
}: {
  tool: { _id: Id<"tools">; name: string } | null;
  onClose: () => void;
}) {
  const request = useMutation(api.loans.request);
  const today = todayUtcIso();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDaysIso(today, 2));
  const [sent, setSent] = useState(false);
  const { busy, error, setError, run } = useRun();

  function close() {
    setSent(false);
    setError(null);
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!tool) return;
    const ok = await run(() => request({ toolId: tool._id, startDate: start, endDate: end }));
    if (ok) setSent(true);
  }

  return (
    <Dialog open={tool !== null} onClose={close} title={sent ? "Request sent" : `Borrow ${tool?.name ?? ""}`}>
      {sent ? (
        <div className="flex flex-col gap-4">
          <p className="text-ink-2">
            The lender has been notified. You&apos;ll find it under <strong>My requests</strong>.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={close} autoFocus>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From">
              {(p) => (
                <input
                  {...p}
                  type="date"
                  required
                  className={inputClass}
                  min={today}
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    if (e.target.value > end) setEnd(e.target.value);
                  }}
                />
              )}
            </Field>
            <Field label="Until">
              {(p) => (
                <input
                  {...p}
                  type="date"
                  required
                  className={inputClass}
                  min={start}
                  max={addDaysIso(start, LIMITS.maxLoanDays - 1)}
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              )}
            </Field>
          </div>
          <p className="text-sm text-ink-3">Up to {LIMITS.maxLoanDays} days. Dates are in UTC.</p>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="quiet" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" busy={busy}>
              Send request
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
