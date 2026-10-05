// Ownership proofs. The matchers are pure (unit tested); the runners take
// their network functions as arguments so they can be tested without I/O.

export const DNS_PREFIX = "linkable-verify=";
export const META_NAME = "linkable-site-verification";

export const dnsRecordValue = (token: string) => `${DNS_PREFIX}${token}`;
export const metaTagHtml = (token: string) => `<meta name="${META_NAME}" content="${token}" />`;
export const htmlFilePath = (token: string) => `/linkable-${token.slice(0, 16)}.html`;
export const htmlFileContent = (token: string) => `${META_NAME}: ${token}`;

export function txtRecordsContain(records: string[][], token: string): boolean {
  // A TXT record can be split into several strings; join each record first.
  return records.some((parts) => parts.join("").trim() === dnsRecordValue(token));
}

export function htmlHasMetaToken(html: string, token: string): boolean {
  const head = html.slice(0, 200_000);
  const tags = head.match(/<meta\b[^>]*>/gi) ?? [];
  return tags.some((tag) => {
    const name = tag.match(/\bname\s*=\s*["']?([^"'\s>]+)/i)?.[1];
    const content = tag.match(/\bcontent\s*=\s*["']?([^"'\s>]+)/i)?.[1];
    return name?.toLowerCase() === META_NAME && content === token;
  });
}

export const fileHasToken = (body: string, token: string) => body.includes(htmlFileContent(token));

export type VerifyOutcome = { ok: true } | { ok: false; reason: string };

export async function verifyDnsTxt(domain: string, token: string, resolveTxt: (d: string) => Promise<string[][]>): Promise<VerifyOutcome> {
  try {
    const records = await resolveTxt(domain);
    return txtRecordsContain(records, token) ? { ok: true } : { ok: false, reason: `No TXT record "${dnsRecordValue(token)}" found on ${domain} yet. DNS changes can take up to an hour.` };
  } catch {
    return { ok: false, reason: `Couldn't read TXT records for ${domain}. Check the record was saved, then try again.` };
  }
}

type PageGetter = (domain: string, path: string) => Promise<{ ok: boolean; status: number; body: string }>;

export async function verifyMetaTag(domain: string, token: string, getPage: PageGetter): Promise<VerifyOutcome> {
  try {
    const page = await getPage(domain, "/");
    if (!page.ok) return { ok: false, reason: `Your homepage returned HTTP ${page.status}.` };
    return htmlHasMetaToken(page.body, token) ? { ok: true } : { ok: false, reason: "The meta tag wasn't found in your homepage's HTML. If you use a cache or CDN, clear it and try again." };
  } catch (err) {
    return { ok: false, reason: `Couldn't load your homepage: ${(err as Error).message}` };
  }
}

export async function verifyHtmlFile(domain: string, token: string, getPage: PageGetter): Promise<VerifyOutcome> {
  const path = htmlFilePath(token);
  try {
    const page = await getPage(domain, path);
    if (!page.ok) return { ok: false, reason: `${path} returned HTTP ${page.status}. Upload the file to your site's root folder.` };
    return fileHasToken(page.body, token) ? { ok: true } : { ok: false, reason: `${path} exists but doesn't contain the verification text.` };
  } catch (err) {
    return { ok: false, reason: `Couldn't load ${path}: ${(err as Error).message}` };
  }
}

// GSC properties look like "sc-domain:example.com" (covers all subdomains)
// or "https://www.example.com/" (URL prefix). Only root-path prefixes count:
// owning https://host.com/~user/ doesn't prove you own host.com.
export function gscPropertyMatches(siteUrl: string, domain: string): boolean {
  if (siteUrl.startsWith("sc-domain:")) {
    const prop = siteUrl.slice(10).toLowerCase();
    return domain === prop || domain.endsWith(`.${prop}`);
  }
  try {
    const url = new URL(siteUrl);
    return url.pathname === "/" && url.hostname.toLowerCase().replace(/^www\./, "") === domain;
  } catch {
    return false;
  }
}

export const GSC_OWNER_LEVELS = ["siteOwner", "siteFullUser"];
