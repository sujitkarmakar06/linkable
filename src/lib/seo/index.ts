import "server-only";
import { db } from "@/lib/db";
import { createAhrefsProvider } from "./ahrefs";
import type { DomainMetrics, SeoProvider } from "./types";

export type { DomainMetrics, SeoProvider };

const CACHE_DAYS = 30;

// Pick the configured provider. Add others (Moz, Semrush) here; with none
// configured, admins enter metrics by hand during review.
export function getSeoProvider(): SeoProvider | null {
  if (process.env.AHREFS_API_KEY) return createAhrefsProvider(process.env.AHREFS_API_KEY);
  return null;
}

export async function getDomainMetrics(domain: string, { force = false } = {}): Promise<(DomainMetrics & { provider: string }) | null> {
  const provider = getSeoProvider();
  if (!provider) return null;
  if (!force) {
    const cached = await db.metricsCache.findUnique({ where: { domain_provider: { domain, provider: provider.name } } });
    if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_DAYS * 86_400_000) {
      return { ...(cached.data as DomainMetrics), provider: provider.name };
    }
  }
  const data = await provider.getDomainMetrics(domain);
  await db.metricsCache.upsert({
    where: { domain_provider: { domain, provider: provider.name } },
    update: { data, fetchedAt: new Date() },
    create: { domain, provider: provider.name, data },
  });
  return { ...data, provider: provider.name };
}
