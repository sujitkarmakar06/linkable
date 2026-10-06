import type { DomainMetrics, SeoProvider } from "./types";

// Ahrefs API v3 (Site Explorer). Each call uses API units, so callers go
// through the cache in seo/index.ts rather than calling this directly.
// NOTE: written against the documented v3 endpoints but not yet exercised
// against the live API - do a first real lookup only with the owner's OK.
const BASE = "https://api.ahrefs.com/v3/site-explorer";

type Fetcher = typeof fetch;

export function createAhrefsProvider(apiKey: string, fetcher: Fetcher = fetch): SeoProvider {
  async function call<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const url = `${BASE}/${endpoint}?${new URLSearchParams(params)}`;
    const res = await fetcher(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ahrefs ${endpoint} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  return {
    name: "ahrefs",
    async getDomainMetrics(domain: string): Promise<DomainMetrics> {
      const date = new Date().toISOString().slice(0, 10);
      const [dr, metrics] = await Promise.all([
        call<{ domain_rating?: { domain_rating?: number } }>("domain-rating", { target: domain, date }),
        call<{ metrics?: { org_traffic?: number } }>("metrics", { target: domain, date, mode: "subdomains" }),
      ]);
      const rating = dr.domain_rating?.domain_rating;
      const traffic = metrics.metrics?.org_traffic;
      return {
        domainRating: typeof rating === "number" ? Math.round(rating) : null,
        organicTraffic: typeof traffic === "number" ? Math.round(traffic) : null,
      };
    },
  };
}
