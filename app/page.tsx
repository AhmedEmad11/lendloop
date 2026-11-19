"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// M0 placeholder: proves Clerk sign-in and the Clerk -> Convex JWT round trip.
// Replaced by the real public page in M2.
export default function Home() {
  const me = useQuery(api.users.whoami);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">LendLoop</h1>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </header>
      <p>Borrow what you need. Lend what you don&apos;t.</p>

      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="w-fit rounded bg-black px-4 py-2 text-white">
            Sign in to lend or borrow
          </button>
        </SignInButton>
      </Show>

      <section aria-label="Convex identity check" className="rounded border p-4 text-sm">
        <h2 className="font-medium">Convex sees:</h2>
        <pre>{me === undefined ? "loading…" : JSON.stringify(me, null, 2)}</pre>
      </section>
    </main>
  );
}
