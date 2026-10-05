// Pure link verification: what's on the page, and does it meet the deal terms.

export type PageAnalysis = {
  linkFound: boolean;
  anchorText: string | null;
  anchorMatch: boolean | null;
  rel: string | null;
  dofollow: boolean | null;
  noindex: boolean;
  canonicalUrl: string | null;
  canonicalElsewhere: boolean;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decode = (s: string) =>
  s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (ENTITIES[e.toLowerCase()]) return ENTITIES[e.toLowerCase()];
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return m;
  });
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(1).find((v) => v !== undefined) ?? null;

// Same page if host (minus www) and path (minus trailing slash) match.
// Query strings and fragments are ignored so tracking parameters don't fail a check.
export function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const norm = (u: URL) => `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "") || ""}`;
    return norm(x) === norm(y);
  } catch {
    return false;
  }
}

export function analysePage(html: string, opts: { pageUrl: string; targetUrl: string; anchor: string; xRobotsTag?: string | null }): PageAnalysis {
  // Ignore links inside comments, scripts and templates.
  const body = html.replace(/<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<noscript[\s\S]*?<\/noscript>|<template[\s\S]*?<\/template>/gi, " ");
  const want = opts.anchor.trim().toLowerCase();
  let best: { text: string; rel: string | null } | null = null;
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = attr(m[1], "href");
    if (!href) continue;
    let resolved: string;
    try {
      resolved = new URL(decode(href), opts.pageUrl).toString();
    } catch {
      continue;
    }
    if (!samePage(resolved, opts.targetUrl)) continue;
    const text = textOf(m[2]);
    const candidate = { text, rel: attr(m[1], "rel") };
    // Prefer the link with the agreed anchor if there are several.
    if (!best || text.toLowerCase() === want) best = candidate;
    if (text.toLowerCase() === want) break;
  }

  const metaRobots = [...body.matchAll(/<meta\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((t) => /^(robots|googlebot)$/i.test(attr(t, "name") ?? ""))
    .map((t) => attr(t, "content") ?? "");
  const noindex = [...metaRobots, opts.xRobotsTag ?? ""].some((v) => /\bnoindex\b|\bnone\b/i.test(v));

  const canonicalTag = [...body.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => (attr(t, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  let canonicalUrl: string | null = null;
  if (canonicalTag) {
    try {
      canonicalUrl = new URL(decode(attr(canonicalTag, "href") ?? ""), opts.pageUrl).toString();
    } catch {
      canonicalUrl = null;
    }
  }

  const relTokens = (best?.rel ?? "").toLowerCase().split(/\s+/);
  return {
    linkFound: Boolean(best),
    anchorText: best?.text ?? null,
    anchorMatch: best ? best.text.toLowerCase() === want : null,
    rel: best?.rel ?? null,
    dofollow: best ? !relTokens.some((t) => ["nofollow", "sponsored", "ugc"].includes(t)) : null,
    noindex,
    canonicalUrl,
    canonicalElsewhere: canonicalUrl != null && !samePage(canonicalUrl, opts.pageUrl),
  };
}

export type CheckVerdict = { ok: boolean; problems: string[]; warnings: string[] };

export function judge(httpStatus: number | null, a: PageAnalysis | null, promised: "DOFOLLOW" | "NOFOLLOW", error?: string | null): CheckVerdict {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (error) problems.push(`Couldn't load the page: ${error}`);
  else if (httpStatus == null || httpStatus < 200 || httpStatus >= 300) problems.push(`The page returned HTTP ${httpStatus ?? "-"}.`);
  else if (a) {
    if (!a.linkFound) problems.push("The link wasn't found on the page.");
    else if (promised === "DOFOLLOW" && a.dofollow === false) problems.push(`The link is marked rel="${a.rel}" but a dofollow link was agreed.`);
    if (a.noindex) problems.push("The page is set to noindex.");
    if (a.linkFound && a.anchorMatch === false) warnings.push(`Anchor text is "${a.anchorText}" instead of the agreed anchor.`);
    if (a.canonicalElsewhere) warnings.push(`The page's canonical points to ${a.canonicalUrl}.`);
  }
  return { ok: problems.length === 0, problems, warnings };
}

// ---------------------------------------------------------------------------
// Leg state machine
// ---------------------------------------------------------------------------

export type LegCheckState = { status: "PLACED" | "VERIFIED" | "FAILING"; consecutiveFailures: number; failingSince: Date | null };
export type LegEvent = "verified" | "not_found" | "failing" | "restored" | "removed" | null;

export function nextLegState(
  cur: LegCheckState,
  ok: boolean,
  now: Date,
  rules: { failuresBeforeAlert: number; graceDays: number },
): Omit<LegCheckState, "status"> & { status: LegCheckState["status"] | "REMOVED"; event: LegEvent } {
  if (cur.status === "PLACED") {
    if (ok) return { status: "VERIFIED", consecutiveFailures: 0, failingSince: null, event: "verified" };
    const n = cur.consecutiveFailures + 1;
    return { status: "PLACED", consecutiveFailures: n, failingSince: null, event: n === rules.failuresBeforeAlert ? "not_found" : null };
  }
  if (cur.status === "VERIFIED") {
    if (ok) return { ...cur, consecutiveFailures: 0, event: null };
    const n = cur.consecutiveFailures + 1;
    if (n >= rules.failuresBeforeAlert) return { status: "FAILING", consecutiveFailures: n, failingSince: now, event: "failing" };
    return { status: "VERIFIED", consecutiveFailures: n, failingSince: null, event: null };
  }
  // FAILING
  if (ok) return { status: "VERIFIED", consecutiveFailures: 0, failingSince: null, event: "restored" };
  const since = cur.failingSince ?? now;
  const graceOver = now.getTime() - since.getTime() >= rules.graceDays * 86_400_000;
  return { status: graceOver ? "REMOVED" : "FAILING", consecutiveFailures: cur.consecutiveFailures + 1, failingSince: since, event: graceOver ? "removed" : null };
}
