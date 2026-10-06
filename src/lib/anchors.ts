// Anchor text types for a site's link profile.
//   branded  contains the brand ("Acme", "acme pricing")
//   url      the address itself ("acme.com", "https://acme.com/pricing")
//   generic  no topic words ("click here", "this guide")
//   keyword  everything else: descriptive topic phrases ("pricing software")

export type AnchorKind = "branded" | "url" | "generic" | "keyword";
export const ANCHOR_KINDS: AnchorKind[] = ["branded", "url", "generic", "keyword"];

export const GENERIC_ANCHORS = new Set(
  [
    "click here", "here", "this", "this site", "this website", "website", "this page", "this article", "this post", "this guide", "this resource",
    "read more", "learn more", "find out more", "more", "more info", "more information", "see more", "source", "link", "this link", "visit",
    "visit site", "visit website", "check it out", "check this out", "go here", "details", "full guide", "the guide", "this tool", "official site",
  ],
);

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9.\-/:\s]/g, "").replace(/\s+/g, " ").trim();

// "acme-tools.co.uk" + ["Acme"] -> ["acme-tools", "acme tools", "acmetools", "acme"]
export function brandTokens(domain: string, brandTerms: string[] = []): string[] {
  const label = domain.toLowerCase().replace(/^www\./, "").split(".")[0];
  const tokens = [label, label.replace(/-/g, " "), label.replace(/-/g, ""), ...brandTerms.map((b) => clean(b))];
  return [...new Set(tokens.filter((t) => t.length >= 3))];
}

export function classifyAnchor(anchor: string, domain: string, brandTerms: string[] = []): AnchorKind {
  const a = clean(anchor);
  const bare = domain.toLowerCase().replace(/^www\./, "");
  if (/^(https?:\/\/|www\.)/.test(a) || a.includes(bare)) return "url";
  if (brandTokens(domain, brandTerms).some((t) => new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}([^a-z0-9]|$)`).test(a))) return "branded";
  if (GENERIC_ANCHORS.has(a.replace(/[.:/-]/g, "").trim())) return "generic";
  return "keyword";
}
