import { appUrl } from "./email";
import { GSC_OWNER_LEVELS, gscPropertyMatches } from "./verification";

// Google Search Console ownership check. Separate from Google sign-in: it asks
// only for read-only Search Console access, once, and keeps no tokens.

export const gscEnabled = () => Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
export const gscRedirectUri = () => appUrl("/api/gsc/callback");

export function gscAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.AUTH_GOOGLE_ID ?? "",
    redirect_uri: gscRedirectUri(),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    access_type: "online",
    include_granted_scopes: "false",
    prompt: "select_account",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function gscOwnsDomain(code: string, domain: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const tokenRes = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.AUTH_GOOGLE_ID ?? "",
      client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
      redirect_uri: gscRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed (HTTP ${tokenRes.status})`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const sitesRes = await fetcher("https://www.googleapis.com/webmasters/v3/sites", { headers: { Authorization: `Bearer ${access_token}` } });
  if (!sitesRes.ok) throw new Error(`Search Console request failed (HTTP ${sitesRes.status})`);
  const { siteEntry = [] } = (await sitesRes.json()) as { siteEntry?: { siteUrl: string; permissionLevel: string }[] };

  // Best effort: we don't need the token again.
  fetcher(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(access_token)}`, { method: "POST" }).catch(() => {});

  return siteEntry.some((e) => GSC_OWNER_LEVELS.includes(e.permissionLevel) && gscPropertyMatches(e.siteUrl, domain));
}
