// Heuristic spam / PBN scoring from a site's homepage and metrics.
// Score 0-100; each signal adds weight. Admins see the signals, not just the
// number, so they can judge borderline cases.

export type SpamSignal = { code: string; label: string; weight: number };

const SALES_PHRASES = [
  /write\s+for\s+us/i,
  /guest\s+post(ing)?\s+(service|price|rate)s?/i,
  /sponsored\s+post\s+(price|rate)s?/i,
  /buy\s+(a\s+)?(guest\s+post|backlinks?|links?)/i,
  /(advertise|advertising)\s+with\s+us/i,
  /accept(ing)?\s+guest\s+posts?/i,
  /submit\s+(a\s+)?guest\s+post/i,
];

export function analyseHomepage(html: string, domain: string): SpamSignal[] {
  const signals: SpamSignal[] = [];
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length;

  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const external = new Set<string>();
  for (const href of hrefs) {
    try {
      const host = new URL(href, `https://${domain}/`).hostname.replace(/^www\./, "");
      if (host && host !== domain && !host.endsWith(`.${domain}`)) external.add(host);
    } catch {
      /* ignore bad hrefs */
    }
  }

  if (external.size > 80) signals.push({ code: "many_outbound", label: `Homepage links to ${external.size} other domains`, weight: 30 });
  else if (external.size > 40) signals.push({ code: "outbound", label: `Homepage links to ${external.size} other domains`, weight: 15 });

  const sales = SALES_PHRASES.filter((re) => re.test(text) || hrefs.some((h) => re.test(h.replace(/[-_/]/g, " "))));
  if (sales.length > 0) signals.push({ code: "sells_links", label: "Advertises guest posts or link sales", weight: 25 });

  if (words < 150) signals.push({ code: "thin", label: `Very little text on the homepage (${words} words)`, weight: 15 });

  if (/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html)) signals.push({ code: "noindex", label: "Homepage is set to noindex", weight: 30 });

  return signals;
}

export function metricSignals(domainRating: number | null, organicTraffic: number | null): SpamSignal[] {
  const signals: SpamSignal[] = [];
  // High DR with almost no organic traffic is the classic PBN / expired-domain pattern.
  if (domainRating != null && organicTraffic != null) {
    if (domainRating >= 50 && organicTraffic < 500) signals.push({ code: "dr_traffic_gap", label: `DR ${domainRating} but only ${organicTraffic} visits/month`, weight: 30 });
    else if (domainRating >= 35 && organicTraffic < 200) signals.push({ code: "dr_traffic_gap", label: `DR ${domainRating} but only ${organicTraffic} visits/month`, weight: 20 });
  }
  return signals;
}

export const spamScore = (signals: SpamSignal[]) => Math.min(100, signals.reduce((s, x) => s + x.weight, 0));

export const SPAM_REVIEW_THRESHOLD = 40;
