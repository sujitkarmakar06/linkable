import { createHash } from "node:crypto";
import { samePage } from "./linkcheck";

// Guest-post rules, kept pure so they're easy to test. Bodies are Markdown.

export type PostLink = { text: string; url: string };

export function extractLinks(markdown: string): PostLink[] {
  const links: PostLink[] = [];
  // [text](url "optional title")
  for (const m of markdown.matchAll(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) links.push({ text: m[1].trim(), url: m[2] });
  // raw HTML anchors, in case the writer pasted some
  for (const m of markdown.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) links.push({ text: m[2].replace(/<[^>]+>/g, "").trim(), url: m[1] });
  return links;
}

export function countWords(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]/g, " ");
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

export type PostCheck = { title: string; body: string; targetUrl: string; anchor: string; receiverDomain: string; minWords: number };

export function validateGuestPost(p: PostCheck): string[] {
  const errors: string[] = [];
  // The host pastes this into their CMS, so no raw HTML (scripts, event handlers)
  // and only http(s) links - Markdown only.
  if (/<\/?[a-z!][^>]*>/i.test(p.body)) errors.push("Raw HTML isn't allowed. Use Markdown formatting only.");
  const badLink = extractLinks(p.body).find((l) => !/^https?:\/\//i.test(l.url));
  if (badLink) errors.push(`Links must start with http:// or https:// ("${badLink.url.slice(0, 40)}").`);
  const title = p.title.trim();
  if (title.length < 10 || title.length > 150) errors.push("The title should be 10-150 characters.");
  const words = countWords(p.body);
  if (words < p.minWords) errors.push(`The article has ${words} words; the minimum is ${p.minWords}.`);
  const toReceiver = extractLinks(p.body).filter((l) => {
    const h = hostOf(l.url);
    return h === p.receiverDomain || Boolean(h?.endsWith(`.${p.receiverDomain}`));
  });
  if (toReceiver.length === 0) errors.push(`Include the agreed link: [${p.anchor}](${p.targetUrl})`);
  else if (toReceiver.length > 1) errors.push(`Only one link to ${p.receiverDomain} is allowed; found ${toReceiver.length}.`);
  else {
    const [link] = toReceiver;
    if (!samePage(link.url, p.targetUrl)) errors.push(`The link to ${p.receiverDomain} must point to ${p.targetUrl}.`);
    if (link.text.toLowerCase() !== p.anchor.trim().toLowerCase()) errors.push(`The link text must be the agreed anchor "${p.anchor}".`);
  }
  return errors;
}

// Normalised fingerprint of a draft: whitespace and case don't count as edits.
export const contentHash = (body: string) => createHash("sha256").update(body.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex");

// "# Title" on the first line becomes the title; the rest is the body.
export function splitTitle(markdown: string): { title: string; body: string } {
  const m = markdown.trimStart().match(/^#\s+(.+)\n+([\s\S]*)$/);
  return m ? { title: m[1].trim(), body: m[2].trim() } : { title: "", body: markdown.trim() };
}

// HTML for the host to paste: raw HTML in the source is escaped, never passed
// through (defence in depth; validation already rejects it).
export function safeMarkdownSource(markdown: string) {
  return markdown.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
