"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { errorMessage } from "@/lib/errors";

// ---------- Button ----------

type Variant = "primary" | "secondary" | "danger" | "quiet";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-surface border-accent hover:bg-accent-ink hover:border-accent-ink",
  secondary: "bg-surface text-ink border-ink hover:bg-base",
  danger: "bg-surface text-bad border-bad hover:bg-bad hover:text-surface",
  quiet: "bg-transparent text-ink-2 border-transparent hover:text-ink underline underline-offset-4",
};

export function Button({
  variant = "secondary",
  busy = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border-2 px-4 text-sm font-semibold transition-colors duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 ${VARIANTS[variant]} ${className}`}
    >
      {busy ? <span aria-hidden>…</span> : null}
      {children}
    </button>
  );
}

// ---------- Form fields ----------

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (props: { id: string; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children({ id, "aria-describedby": hintId })}
      {hint ? (
        <p id={hintId} className="text-sm text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "min-h-11 w-full rounded-sm border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-3 hover:border-ink-3 disabled:opacity-55";

export function FormError({ message }: { message: string | null }) {
  // Always mounted so screen readers announce changes.
  return (
    <p role="alert" className="min-h-6 text-sm font-semibold text-bad">
      {message}
    </p>
  );
}

// ---------- Status ----------

export function Stamp({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`stamp ${tone}`}>{children}</span>;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <p role="status" className="py-8 text-ink-3">
      {label}…
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-sm border border-dashed border-line px-6 py-12 text-center">
      <p className="font-display text-lg text-ink">{title}</p>
      {children ? <div className="mt-2 text-ink-2">{children}</div> : null}
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-3">
      <h1 className="font-display text-2xl font-bold leading-none sm:text-3xl">{title}</h1>
      {children}
    </div>
  );
}

// ---------- Dialog ----------

/** Native <dialog>: focus trapping, Esc to close and inert background for free. */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop click
      }}
      className="m-auto w-[min(100%-2rem,28rem)] rounded-sm border border-line bg-surface p-0 text-ink shadow-float"
    >
      {open ? (
        <div className="p-6">
          <h2 id={titleId} className="mb-4 font-display text-xl font-bold">
            {title}
          </h2>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

/** Destructive action behind a confirmation dialog (UX: no one-click deletes). */
export function ConfirmButton({
  label,
  title,
  body,
  confirmLabel,
  onConfirm,
  variant = "danger",
}: {
  label: string;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  variant?: Variant;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
        title={title}
      >
        <div className="text-ink-2">{body}</div>
        <FormError message={error} />
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button
            variant="danger"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                setOpen(false);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** Runs a mutation, tracking busy state and a user-facing error message. */
export function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
