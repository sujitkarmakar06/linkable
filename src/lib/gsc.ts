import { appUrl } from "./email";
import { GSC_OWNER_LEVELS, gscPropertyMatches } from "./verification";

// Google Search Console, read-only. One OAuth grant per site both proves
// ownership and keeps a refresh token, used to check that linking pages are
// indexed (host side) and to measure link impact (receiver side).

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

// Dev/test only: a fake Google that needs no network or keys (like AI_FAKE).
export const gscFake = () => process.env.NODE_ENV !== "production" && process.env.GSC_FAKE === "1";
export const gscEnabled = () => gscFake() || Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
export const gscRedirectUri = () => appUrl("/api/gsc/callback");

export function gscAuthUrl(state: string): string {
  if (gscFake()) return `${gscRedirectUri()}?${new URLSearchParams({ code: "fake", state })}`;
  const params = new URLSearchParams({
    client_id: process.env.AUTH_GOOGLE_ID ?? "",
    redirect_uri: gscRedirectUri(),
    response_type: "code",
    scope: `openid email ${GSC_SCOPE}`,
    // Offline + consent so Google always returns a refresh token.
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "false",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// The stored grant no longer works (revoked, expired, password changed).
export class GscAuthError extends Error {}

export type GscGrant = { accessToken: string; refreshToken: string | null; email: string | null };
export type IndexResult = { indexed: boolean; coverage: string };
export type SearchTotals = { clicks: number; impressions: number; ctr: number; position: number | null };

export interface GscApi {
  exchangeCode(code: string): Promise<GscGrant>;
  refresh(refreshToken: string): Promise<string>;
  ownedProperties(accessToken: string, domain: string): Promise<string[]>;
  inspect(accessToken: string, property: string, url: string): Promise<IndexResult>;
  totals(accessToken: string, property: string, page: string, start: string, end: string): Promise<SearchTotals>;
  revoke(token: string): Promise<void>;
}

// Property to query for a URL: a domain property covers every URL on the
// domain; otherwise the longest URL-prefix property the URL starts with.
export function propertyForUrl(properties: string[], url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const domainProp = properties.find((p) => {
    if (!p.startsWith("sc-domain:")) return false;
    const d = p.slice(10).toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  });
  if (domainProp) return domainProp;
  return properties.filter((p) => !p.startsWith("sc-domain:") && url.startsWith(p)).sort((a, b) => b.length - a.length)[0] ?? null;
}

function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    // Straight from Google's token endpoint over TLS, so no signature check needed.
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

export function googleGsc(fetcher: typeof fetch = fetch): GscApi {
  const token = async (body: Record<string, string>) => {
    const res = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.AUTH_GOOGLE_ID ?? "", client_secret: process.env.AUTH_GOOGLE_SECRET ?? "", ...body }),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; id_token?: string; error?: string };
    if (json.error === "invalid_grant") throw new GscAuthError("Google access was revoked or has expired.");
    if (!res.ok || !json.access_token) throw new Error(`Google token request failed (HTTP ${res.status})`);
    return json;
  };
  const call = async <T>(accessToken: string, url: string, body?: unknown): Promise<T> => {
    const res = await fetcher(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new GscAuthError("Google rejected the stored Search Console access.");
    if (!res.ok) throw new Error(`Search Console request failed (HTTP ${res.status})`);
    return (await res.json()) as T;
  };
  return {
    async exchangeCode(code) {
      const t = await token({ code, redirect_uri: gscRedirectUri(), grant_type: "authorization_code" });
      return { accessToken: t.access_token!, refreshToken: t.refresh_token ?? null, email: emailFromIdToken(t.id_token) };
    },
    async refresh(refreshToken) {
      return (await token({ refresh_token: refreshToken, grant_type: "refresh_token" })).access_token!;
    },
    async ownedProperties(accessToken, domain) {
      const { siteEntry = [] } = await call<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(accessToken, "https://www.googleapis.com/webmasters/v3/sites");
      return siteEntry.filter((e) => GSC_OWNER_LEVELS.includes(e.permissionLevel) && gscPropertyMatches(e.siteUrl, domain)).map((e) => e.siteUrl);
    },
    async inspect(accessToken, property, url) {
      const r = await call<{ inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string } } }>(
        accessToken,
        "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
        { inspectionUrl: url, siteUrl: property, languageCode: "en-US" },
      );
      const s = r.inspectionResult?.indexStatusResult;
      return { indexed: s?.verdict === "PASS", coverage: s?.coverageState ?? "Unknown" };
    },
    async totals(accessToken, property, page, start, end) {
      const query = (expression: string) =>
        call<{ rows?: { clicks: number; impressions: number; ctr: number; position: number }[] }>(
          accessToken,
          `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
          { startDate: start, endDate: end, dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression }] }] },
        );
      let { rows } = await query(page);
      // Google reports the canonical URL; try the other trailing-slash form too.
      if (!rows?.length) ({ rows } = await query(page.endsWith("/") ? page.slice(0, -1) : `${page}/`));
      const row = rows?.[0];
      return row ? { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position } : { clicks: 0, impressions: 0, ctr: 0, position: null };
    },
    async revoke(t) {
      await fetcher(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: "POST" }).catch(() => {});
    },
  };
}

// Deterministic fake: owns every domain except ones containing "notowner",
// indexes every URL except ones containing "not-indexed", and reports more
// search traffic for more recent date ranges.
export const fakeGsc: GscApi = {
  async exchangeCode() {
    return { accessToken: "fake-access", refreshToken: "fake-refresh", email: "owner@example.test" };
  },
  async refresh(refreshToken) {
    if (refreshToken !== "fake-refresh") throw new GscAuthError("Google access was revoked or has expired.");
    return "fake-access";
  },
  async ownedProperties(_, domain) {
    return domain.includes("notowner") ? [] : [`sc-domain:${domain}`];
  },
  async inspect(_, __, url) {
    return url.includes("not-indexed") ? { indexed: false, coverage: "Crawled - currently not indexed" } : { indexed: true, coverage: "Submitted and indexed" };
  },
  async totals(_, __, ___, ____, end) {
    const daysAgo = Math.max(0, Math.round((Date.now() - Date.parse(end)) / 86_400_000));
    const clicks = Math.max(0, 200 - daysAgo);
    return { clicks, impressions: clicks * 20, ctr: clicks ? 0.05 : 0, position: clicks ? Math.round((25 - clicks / 10) * 10) / 10 : null };
  },
  async revoke() {},
};

export const gscApi = (): GscApi => (gscFake() ? fakeGsc : googleGsc());
