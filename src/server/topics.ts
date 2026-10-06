import "server-only";
import { db } from "@/lib/db";
import { getSitePage, safeGet } from "@/lib/net";
import { summarisePage } from "@/lib/pagetext";
import { extractTopics, withKeywords } from "@/lib/topics";
import { topicKeywords } from "@/server/ai";
import { sitemapUrls } from "@/server/sitemap";

export const SITE_TOPICS_MAX_AGE_DAYS = 30;
const POSTS_PER_SITE = 4;
// Topic reading runs inside the daily job, so slow pages are cut off sooner than link checks.
const FETCH = { timeoutMs: 8_000 };
const RETRY_FAILED_TARGET_DAYS = 7;

type Part = { text: string; weight: number };

function partsOf(html: string): { parts: Part[]; plain: string } {
  const p = summarisePage(html, 4000);
  return {
    parts: [
      { text: p.title, weight: 3 },
      { text: p.h1, weight: 3 },
      { text: p.description, weight: 2 },
      { text: p.text, weight: 1 },
    ],
    plain: [p.title, p.description, p.h1, p.text.slice(0, 1500)].filter(Boolean).join("\n"),
  };
}

// Homepage plus a few posts from the sitemap (articles say more about a site's
// topics than its homepage does). Saved even when nothing could be read, so a
// broken site isn't retried on every run.
export async function refreshSiteTopics(siteId: string) {
  const site = await db.site.findUniqueOrThrow({ where: { id: siteId } });
  const parts: Part[] = [];
  const texts: string[] = [];
  try {
    const home = await getSitePage(site.domain, "/");
    if (home.ok) {
      const p = partsOf(home.body);
      parts.push(...p.parts);
      texts.push(p.plain);
    }
  } catch {
    /* unreachable homepage: rely on posts */
  }
  const posts = (await sitemapUrls(site.domain, 200).catch(() => [] as string[])).filter((u) => new URL(u).pathname.length > 1).slice(-POSTS_PER_SITE);
  for (const url of posts) {
    try {
      const res = await safeGet(url, FETCH);
      if (!res.ok) continue;
      const p = partsOf(res.body);
      parts.push(...p.parts);
      texts.push(p.plain);
    } catch {
      /* skip */
    }
  }
  let topics = extractTopics(parts);
  let summary: string | null = null;
  if (topics.length) {
    const ai = await topicKeywords(site.workspaceId, "website", texts.join("\n\n"));
    if (ai) {
      topics = withKeywords(topics, ai.keywords);
      summary = ai.summary;
    }
  }
  await db.site.update({
    where: { id: siteId },
    data: { topicsUpdatedAt: new Date(), ...(topics.length ? { topics, topicSummary: summary } : {}) },
  });
  return topics.length;
}

// Topics of a request's target page, read once (a page that failed is retried weekly).
export async function ensureRequestTopics(requestId: string) {
  const req = await db.linkRequest.findUnique({ where: { id: requestId } });
  if (!req || req.targetTopics || (req.targetTopicsAt && req.targetTopicsAt > new Date(Date.now() - RETRY_FAILED_TARGET_DAYS * 86_400_000))) return;
  let topics: ReturnType<typeof extractTopics> = [];
  try {
    const res = await safeGet(req.targetUrl, FETCH);
    if (res.ok) {
      const p = partsOf(res.body);
      topics = extractTopics(p.parts);
      if (topics.length) {
        const ai = await topicKeywords(req.workspaceId, "target_page", p.plain);
        if (ai) topics = withKeywords(topics, ai.keywords);
      }
    }
  } catch {
    /* unreachable target: no relevance for now */
  }
  await db.linkRequest.update({ where: { id: requestId }, data: { targetTopicsAt: new Date(), ...(topics.length ? { targetTopics: topics } : {}) } });
}

// Daily: read topics for approved giving sites that have none or stale ones.
export async function refreshStaleTopics(limit = 10) {
  const stale = new Date(Date.now() - SITE_TOPICS_MAX_AGE_DAYS * 86_400_000);
  const sites = await db.site.findMany({
    where: { status: "APPROVED", canGive: true, OR: [{ topicsUpdatedAt: null }, { topicsUpdatedAt: { lt: stale } }] },
    orderBy: { topicsUpdatedAt: { sort: "asc", nulls: "first" } },
    select: { id: true },
    take: limit,
  });
  let done = 0;
  for (const s of sites) {
    try {
      await refreshSiteTopics(s.id);
      done++;
    } catch (err) {
      console.error("[topics]", s.id, err);
    }
  }
  return done;
}
