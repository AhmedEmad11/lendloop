"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORIES, CATEGORY_LABELS, CONDITION_LABELS, type Category } from "@/convex/lib/constants";
import { Button, EmptyState, Loading, PageHeader, Stamp } from "@/components/ui";
import { RequestDialog } from "@/components/RequestDialog";

/** All tools with availability, filterable by category (FR-A6). */
export default function ToolsPage() {
  const [category, setCategory] = useState<Category | undefined>(undefined);
  const tools = useQuery(api.tools.list, { category });
  const [borrowing, setBorrowing] = useState<{ _id: Id<"tools">; name: string } | null>(null);

  return (
    <>
      <PageHeader title="Tools" />

      <fieldset className="mb-6">
        <legend className="mb-2 text-sm font-semibold">Category</legend>
        <div className="flex flex-wrap gap-2">
          {[undefined, ...CATEGORIES].map((c) => {
            const active = c === category;
            return (
              <button
                key={c ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(c)}
                className={`min-h-11 rounded-sm border px-3 text-sm font-semibold transition-colors ${
                  active
                    ? "border-ink bg-ink text-surface"
                    : "border-line bg-surface text-ink-2 hover:border-ink hover:text-ink"
                }`}
              >
                {c ? CATEGORY_LABELS[c] : "All"}
              </button>
            );
          })}
        </div>
      </fieldset>

      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <EmptyState title={category ? `Nothing in ${CATEGORY_LABELS[category]} yet` : "No tools listed yet"}>
          List one from <strong>My listings</strong>.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {tools.map((tool) => (
            <li key={tool._id} className="tag flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="font-display text-lg font-bold">{tool.name}</h2>
                  <span className="text-sm text-ink-3">
                    {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
                  </span>
                </div>
                {tool.description ? <p className="mt-1 text-ink-2">{tool.description}</p> : null}
                <p className="mt-1 text-sm text-ink-3">
                  {tool.isMine ? "Your listing" : `Lent by ${tool.ownerFirstName}`}
                  {tool.ownerTrustedLender ? (
                    <span className="ml-2 font-semibold text-ok">✓ Trusted lender</span>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-4 sm:flex-col sm:items-end">
                <Stamp tone={tool.available ? "text-ok" : "text-bad"}>
                  {tool.available ? "Available" : "On loan"}
                </Stamp>
                {tool.isMine ? null : (
                  <Button variant="secondary" onClick={() => setBorrowing({ _id: tool._id, name: tool.name })}>
                    Request
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <RequestDialog tool={borrowing} onClose={() => setBorrowing(null)} />
    </>
  );
}
