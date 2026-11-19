"use client";

import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS } from "@/convex/lib/constants";
import { Wordmark } from "@/components/Wordmark";
import { Loading, EmptyState } from "@/components/ui";

const buttonPrimary =
  "inline-flex min-h-11 items-center rounded-sm border-2 border-accent bg-accent px-6 text-base font-semibold text-surface no-underline transition-colors hover:border-accent-ink hover:bg-accent-ink active:translate-y-px";

/**
 * Public page (FR-P1..P3). The tool list comes from public.listAvailable, which
 * returns only {name, category}: nothing about owners ever reaches this page.
 */
export default function Home() {
  const tools = useQuery(api.public.listAvailable);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 sm:px-8">
      <header className="flex min-h-20 items-center justify-end py-6">
        <Show when="signed-in">
          <div className="flex items-center gap-4">
            <Link href="/tools" className="text-sm font-semibold text-ink underline underline-offset-4">
              Open the board
            </Link>
            <UserButton />
          </div>
        </Show>
      </header>

      <main className="grid flex-1 gap-12 pb-16 pt-8 md:grid-cols-[1.1fr_1fr] md:gap-16 md:pt-16">
        <section aria-labelledby="hero" className="flex flex-col gap-6">
          <Wordmark size="lg" />
          <h1 id="hero" className="max-w-[18ch] font-display text-2xl font-bold leading-tight sm:text-3xl">
            Borrow what you need. Lend what you don&apos;t.
          </h1>
          <p className="max-w-[46ch] text-lg text-ink-2">
            A lending shelf for your street. List the drill you use twice a year, borrow the
            ladder you need once, and let the reminders do the chasing.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className={buttonPrimary}>Sign in to lend or borrow</button>
              </SignInButton>
            </Show>
            <Show when="signed-in">
              <Link href="/tools" className={buttonPrimary}>
                Go to the board
              </Link>
            </Show>
          </div>
        </section>

        <section aria-labelledby="shelf" className="md:border-l-2 md:border-ink md:pl-12">
          <div className="flex items-baseline justify-between border-b-2 border-ink pb-2">
            <h2 id="shelf" className="font-display text-lg font-bold">
              On the shelf today
            </h2>
            {tools ? (
              <span className="text-sm text-ink-3">
                {tools.length} {tools.length === 1 ? "tool" : "tools"}
              </span>
            ) : null}
          </div>

          {tools === undefined ? (
            <Loading label="Checking the shelf" />
          ) : tools.length === 0 ? (
            <div className="mt-6">
              <EmptyState title="The shelf is empty">Be the first to list a tool.</EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {tools.map((tool, i) => (
                <li key={`${tool.name}-${i}`} className="flex items-baseline justify-between gap-4 py-3">
                  <span className="font-semibold">{tool.name}</span>
                  <span className="shrink-0 text-sm text-ink-3">{CATEGORY_LABELS[tool.category]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="border-t border-line py-6 text-sm text-ink-3">
        Lenders&apos; details are only shown to signed-in neighbors.
      </footer>
    </div>
  );
}
