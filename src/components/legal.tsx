import type { ReactNode } from "react";
import { Logo } from "./logo";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <Logo />
      <div role="note" className="mt-8 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
        <strong>Draft - legal review required.</strong> This text is a starting point written for Linkable&apos;s lawyers to review and adapt. It is not legal advice and has not been
        approved. Placeholders appear in [square brackets].
      </div>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted">Last updated: {updated}</p>
      <div className="mt-6 flex flex-col gap-4 text-sm leading-6 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">{children}</div>
    </div>
  );
}

export function LegalLinks() {
  return (
    <span className="flex gap-4">
      <a href="/terms" className="hover:text-text">
        Terms
      </a>
      <a href="/privacy" className="hover:text-text">
        Privacy
      </a>
    </span>
  );
}
