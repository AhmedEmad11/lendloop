"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Wordmark } from "@/components/Wordmark";
import { Loading } from "@/components/ui";
import { errorMessage } from "@/lib/errors";
import { MeProvider } from "@/components/MeContext";

const NAV = [
  { href: "/tools", label: "Tools" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming" },
] as const;

/**
 * Signed-in shell. proxy.ts already redirects signed-out visitors; this layout
 * registers the user in Convex (users.ensure) before rendering any page. The
 * Admin link is cosmetic: every admin function checks the role on the server.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const [ensureError, setEnsureError] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (isAuthenticated) ensure().catch((err) => setEnsureError(errorMessage(err)));
  }, [isAuthenticated, ensure]);

  const nav = me?.role === "admin" ? [...NAV, { href: "/admin", label: "Admin" }] : NAV;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 sm:px-8">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:bg-surface focus:p-2"
      >
        Skip to content
      </a>
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <Wordmark />
        <UserButton />
        <nav aria-label="Main" className="-mx-1 w-full overflow-x-auto">
          <ul className="flex gap-1 border-b border-line">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold no-underline transition-colors ${
                      active
                        ? "border-accent text-ink"
                        : "border-transparent text-ink-2 hover:border-line hover:text-ink"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main id="main" className="flex-1 pb-16 pt-4">
        {ensureError ? (
          <p role="alert" className="font-semibold text-bad">
            {ensureError}
          </p>
        ) : isLoading || !me ? (
          <Loading label="Opening the workshop" />
        ) : (
          <MeProvider value={me}>{children}</MeProvider>
        )}
      </main>
    </div>
  );
}
