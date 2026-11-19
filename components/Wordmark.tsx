import Link from "next/link";

/** "LendLoop" with the double-o drawn as a linked loop: the one brand moment. */
export function Wordmark({ size = "sm" }: { size?: "sm" | "lg" }) {
  const big = size === "lg";
  return (
    <Link
      href="/"
      aria-label="LendLoop home"
      className={`inline-flex items-baseline font-display font-bold tracking-tight text-ink no-underline ${
        big ? "text-4xl sm:text-[5rem] leading-none" : "text-xl"
      }`}
    >
      LendL
      <svg
        aria-hidden
        viewBox="0 0 42 22"
        className="mx-[0.04em] h-[0.56em] w-[1.07em] self-center translate-y-[0.12em]"
      >
        <circle cx="11" cy="11" r="8.5" fill="none" stroke="currentColor" strokeWidth="4" />
        <circle cx="31" cy="11" r="8.5" fill="none" stroke="var(--color-accent)" strokeWidth="4" />
      </svg>
      p
    </Link>
  );
}
