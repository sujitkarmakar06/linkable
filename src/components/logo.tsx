import Link from "next/link";

// Three linked nodes: the A -> B -> C idea in one mark.
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="text-accent">
        <path d="M6 18 12 6l6 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="12" cy="6" r="2.6" fill="currentColor" />
        <circle cx="6" cy="18" r="2.6" fill="currentColor" />
        <circle cx="18" cy="18" r="2.6" fill="currentColor" />
      </svg>
      Linkable
    </Link>
  );
}
