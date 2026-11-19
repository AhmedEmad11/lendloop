"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@/convex/lib/constants";
import { Button, ConfirmButton, Dialog, EmptyState, Loading, PageHeader, Stamp } from "@/components/ui";
import { ToolForm } from "@/components/ToolForm";

/** My listings with create / edit / delete (FR-A1, FR-A2, FR-A7). */
export default function ListingsPage() {
  const tools = useQuery(api.tools.mine);
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Id<"tools"> | null>(null);
  const editTool = tools?.find((t) => t._id === editing);

  return (
    <>
      <PageHeader title="My listings">
        <Button variant="primary" onClick={() => setAdding(true)}>
          List a tool
        </Button>
      </PageHeader>

      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <EmptyState title="You haven't listed anything yet">
          <p>Got a drill, ladder or tent that sits idle? Share it.</p>
          <div className="mt-4">
            <Button variant="primary" onClick={() => setAdding(true)}>
              List your first tool
            </Button>
          </div>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {tools.map((tool) => (
            <li key={tool._id} className="tag flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h2 className="font-display text-lg font-bold">{tool.name}</h2>
                  <span className="text-sm text-ink-3">
                    {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
                  </span>
                </div>
                {tool.description ? <p className="mt-1 text-ink-2">{tool.description}</p> : null}
                {tool.openLoanCount > 0 ? (
                  <p className="mt-1 text-sm text-ink-3">
                    {tool.openLoanCount} open {tool.openLoanCount === 1 ? "request" : "requests"} — see Incoming
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <Stamp tone={tool.available ? "text-ok" : "text-bad"}>
                  {tool.available ? "Available" : "On loan"}
                </Stamp>
                <Button variant="secondary" onClick={() => setEditing(tool._id)}>
                  Edit
                </Button>
                <ConfirmButton
                  label="Delete"
                  title={`Delete ${tool.name}?`}
                  body={
                    tool.openLoanCount > 0
                      ? "This tool has open requests or an active loan. Resolve them in Incoming first."
                      : "It will disappear from the board. Past loans keep their history."
                  }
                  confirmLabel="Delete listing"
                  onConfirm={() => remove({ toolId: tool._id })}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={adding} onClose={() => setAdding(false)} title="List a tool">
        <ToolForm
          submitLabel="List it"
          onCancel={() => setAdding(false)}
          onSubmit={async (fields) => {
            await create(fields);
            setAdding(false);
          }}
        />
      </Dialog>

      <Dialog open={editTool !== undefined} onClose={() => setEditing(null)} title="Edit listing">
        {editTool ? (
          <ToolForm
            key={editTool._id}
            initial={{
              name: editTool.name,
              category: editTool.category,
              condition: editTool.condition,
              description: editTool.description,
            }}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            onSubmit={async (fields) => {
              await update({ toolId: editTool._id, ...fields });
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
