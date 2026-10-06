import Link from "next/link";
import { LegalLinks } from "@/components/legal";
import { Logo } from "@/components/logo";
import { getSessionUser } from "@/server/session";
import { getSettings } from "@/lib/settings";

const features = (minDr: number, months: number, everyDays: number) => [
  { title: "No reciprocal footprint", body: "You give links from one site and receive them on another. Nobody links straight back, and the footprint guard blocks shared hosting, shared owners and repeat pairs." },
  { title: "Fair credits", body: "Give a link, earn credits. Spend credits to get one. Prices follow DR tiers, so a DR 70 link costs more than a DR 35 link." },
  { title: "Links that stay live", body: `Every placed link is checked every ${everyDays} days for ${months} months. Credits are held in escrow and released in stages, and early removals are penalised.` },
  { title: "Verified, quality sites", body: `Every site proves ownership and passes admin review. Sites must be DR ${minDr} or higher, and spam or PBN networks are filtered out.` },
];

export default async function Home() {
  const [user, settings] = await Promise.all([getSessionUser(), getSettings()]);
  const cards = features(settings.minDomainRating, settings.guaranteeMonths, settings.checkIntervalDays);
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
        <Logo />
        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            <Link href="/app" className="rounded-md bg-accent px-3.5 py-2 font-medium text-accent-fg">
              Open app
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-muted hover:text-text">
                Sign in
              </Link>
              <Link href="/signup" className="rounded-md bg-accent px-3.5 py-2 font-medium text-accent-fg">
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4">
        <section className="py-16 sm:py-24">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Three-way link exchange, without the spreadsheet.</h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">
            Linkable matches you with relevant sites in your niche. You link from one site, receive a link on another, and every link is tracked until its guarantee ends.
          </p>
          <div className="mt-8 flex gap-3">
            <Link href="/signup" className="rounded-md bg-accent px-5 py-2.5 font-medium text-accent-fg">
              Create a free workspace
            </Link>
          </div>
        </section>
        <section className="grid gap-4 pb-20 sm:grid-cols-2">
          {cards.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-surface p-5">
              <h2 className="font-semibold">{f.title}</h2>
              <p className="mt-2 text-sm text-muted">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-4 border-t border-border py-6 text-xs text-muted">
        <span>Linkable</span>
        <LegalLinks />
      </footer>
    </div>
  );
}
