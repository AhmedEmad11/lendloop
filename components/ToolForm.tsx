"use client";

import { useState, type FormEvent } from "react";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  LIMITS,
  type Category,
  type Condition,
} from "@/convex/lib/constants";
import { Button, Field, FormError, inputClass, useRun } from "@/components/ui";

export type ToolFields = {
  name: string;
  category: Category;
  condition: Condition;
  description: string;
};

const EMPTY: ToolFields = { name: "", category: "power_tools", condition: "good", description: "" };

/** Create/edit form. Limits mirror the server, which validates again. */
export function ToolForm({
  initial = EMPTY,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: ToolFields;
  submitLabel: string;
  onSubmit: (fields: ToolFields) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [fields, setFields] = useState<ToolFields>(initial);
  const { busy, error, run } = useRun();

  async function handle(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => onSubmit(fields));
    if (ok && initial === EMPTY) setFields(EMPTY);
  }

  return (
    <form onSubmit={handle} className="flex flex-col gap-4" noValidate={false}>
      <Field label="Tool name">
        {(p) => (
          <input
            {...p}
            className={inputClass}
            required
            minLength={LIMITS.toolNameMin}
            maxLength={LIMITS.toolNameMax}
            value={fields.name}
            onChange={(e) => setFields({ ...fields, name: e.target.value })}
            placeholder="Cordless drill"
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category">
          {(p) => (
            <select
              {...p}
              className={inputClass}
              value={fields.category}
              onChange={(e) => setFields({ ...fields, category: e.target.value as Category })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Condition">
          {(p) => (
            <select
              {...p}
              className={inputClass}
              value={fields.condition}
              onChange={(e) => setFields({ ...fields, condition: e.target.value as Condition })}
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABELS[c]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field
        label="Short description"
        hint={`${fields.description.length}/${LIMITS.descriptionMax}. What's included, any quirks.`}
      >
        {(p) => (
          <textarea
            {...p}
            className={`${inputClass} min-h-24 py-2`}
            maxLength={LIMITS.descriptionMax}
            value={fields.description}
            onChange={(e) => setFields({ ...fields, description: e.target.value })}
          />
        )}
      </Field>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" variant="primary" busy={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
