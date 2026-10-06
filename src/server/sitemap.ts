import "server-only";
import { getSitePage, safeGet } from "@/lib/net";
import { parseSitemap } from "@/lib/pagetext";

// URLs listed in a site's sitemap (following up to 5 child sitemaps).
export async function sitemapUrls(domain: string, max = 300): Promise<string[]> {
  const urls = new Set<string>();
  const onDomain = (u: string) => {
    try {
      const h = new URL(u).hostname.replace(/^www\./, "");
      return h === domain || h.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  };
  let queue: string[] = [];
  try {
    const root = await getSitePage(domain, "/sitemap.xml");
    if (root.ok) {
      const p = parseSitemap(root.body);
      p.urls.filter(onDomain).forEach((u) => urls.add(u));
      queue = p.sitemaps.filter(onDomain).slice(0, 5);
    }
  } catch {
    /* fall through */
  }
  for (const sm of queue) {
    if (urls.size >= max) break;
    try {
      const res = await safeGet(sm);
      if (res.ok) parseSitemap(res.body).urls.filter(onDomain).forEach((u) => urls.add(u));
    } catch {
      /* skip broken child sitemaps */
    }
  }
  return [...urls].slice(0, max);
}
