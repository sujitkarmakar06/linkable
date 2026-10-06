import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { contentHash, splitTitle } from "@/lib/guestpost";
import { ANCHOR_SYSTEM, DRAFT_SYSTEM, PLACEMENT_SYSTEM, TOPIC_SYSTEM } from "@/lib/ai-prompts";
import { safeGet } from "@/lib/net";
import { summarisePage } from "@/lib/pagetext";
import { sitemapUrls } from "@/server/sitemap";
import { getSettings } from "@/lib/settings";

export const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
// Refusals are re-run server-side on Anthropic's recommended fallback model.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// Dev/test only: canned responses so flows can be tested without an API key or cost.
const fakeMode = () => process.env.NODE_ENV !== "production" && process.env.AI_FAKE === "1";
export const aiEnabled = () => fakeMode() || Boolean(process.env.ANTHROPIC_API_KEY);

export class AiError extends Error {}

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

// "topics" is platform work (relevance profiles): recorded for cost tracking, never counted against a workspace quota.
type Kind = "anchors" | "placement" | "draft" | "topics";

// Free-plan monthly limits: anchors + placement share the "suggestions" quota.
async function assertQuota(workspaceId: string, kind: Kind) {
  const s = await getSettings();
  const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const kinds = kind === "draft" ? ["draft"] : ["anchors", "placement"];
  const used = await db.aiUsage.count({ where: { workspaceId, kind: { in: kinds }, createdAt: { gte: since } } });
  const limit = kind === "draft" ? s.aiDraftsPerMonth : s.aiSuggestionsPerMonth;
  if (used >= limit) throw new AiError(`You've used all ${limit} AI ${kind === "draft" ? "drafts" : "suggestions"} for this month. They reset on the 1st.`);
}

// `model` is the model that actually answered (a refusal fallback bills at its own rates).
async function record(workspaceId: string, userId: string | null, kind: Kind, usage: { input_tokens?: number; output_tokens?: number } | null, extra: { legId?: string; outputHash?: string; model?: string } = {}) {
  const { model, ...rest } = extra;
  extra = rest;
  await db.aiUsage.create({ data: { workspaceId, userId, kind, model: fakeMode() ? "fake" : (model ?? AI_MODEL), inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0, ...extra } });
}

function checkStop(msg: Anthropic.Beta.BetaMessage) {
  if (msg.stop_reason === "refusal") throw new AiError("The AI declined this request. Try rephrasing the topic, or write it yourself.");
  if (msg.stop_reason === "max_tokens") throw new AiError("The AI response was cut off. Please try again.");
}

function toApiError(err: unknown): never {
  if (err instanceof AiError) throw err;
  if (err instanceof Anthropic.RateLimitError) throw new AiError("The AI service is busy. Try again in a minute.");
  if (err instanceof Anthropic.AuthenticationError) throw new AiError("AI isn't configured correctly (API key). Tell an admin.");
  if (err instanceof Anthropic.APIError) throw new AiError(`The AI service returned an error (${err.status ?? "network"}). Try again.`);
  throw err;
}

// One structured call: JSON-schema output, validated with zod afterwards.
async function structured<T extends z.ZodType>(schema: T, system: string, user: string): Promise<{ data: z.infer<T>; usage: Anthropic.Beta.BetaUsage; model: string }> {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  try {
    const msg = await getClient().beta.messages.create({
      model: AI_MODEL,
      max_tokens: 4000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: jsonSchema } },
      system,
      messages: [{ role: "user", content: user }],
    });
    checkStop(msg);
    const text = msg.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new AiError("The AI returned an unexpected answer. Please try again.");
    return { data: parsed.data, usage: msg.usage, model: msg.model };
  } catch (err) {
    if (err instanceof SyntaxError) throw new AiError("The AI returned an unexpected answer. Please try again.");
    toApiError(err);
  }
}

async function describeUrl(url: string) {
  try {
    const res = await safeGet(url);
    if (!res.ok) return `(page returned HTTP ${res.status})`;
    const s = summarisePage(res.body);
    return `Title: ${s.title}\nDescription: ${s.description}\nH1: ${s.h1}\nText: ${s.text}`;
  } catch (err) {
    return `(page could not be loaded: ${(err as Error).message})`;
  }
}

// ---------------------------------------------------------------------------
// Anchor suggestions
// ---------------------------------------------------------------------------

const AnchorSchema = z.object({
  anchors: z.array(z.object({ text: z.string(), type: z.enum(["branded", "partial", "natural", "exact", "url"]), reason: z.string() })),
});
export type AnchorSuggestion = z.infer<typeof AnchorSchema>["anchors"][number];

export async function suggestAnchors(a: { workspaceId: string; userId: string; siteId: string; targetUrl: string }): Promise<AnchorSuggestion[]> {
  await assertQuota(a.workspaceId, "anchors");
  const site = await db.site.findUniqueOrThrow({ where: { id: a.siteId } });
  const used = await db.dealLeg.groupBy({ by: ["anchor"], where: { toSiteId: site.id, status: { notIn: ["CANCELLED", "REMOVED"] } }, _count: true, orderBy: { _count: { anchor: "desc" } }, take: 15 });

  let anchors: AnchorSuggestion[];
  if (fakeMode()) {
    anchors = [
      { text: site.domain.split(".")[0], type: "branded", reason: "Brand name keeps the profile natural." },
      { text: "pricing tool", type: "partial", reason: "Describes the page." },
      { text: "this pricing guide", type: "natural", reason: "Reads naturally in a sentence." },
    ];
    await record(a.workspaceId, a.userId, "anchors", null);
  } else {
    const page = await describeUrl(a.targetUrl);
    const { data, usage, model } = await structured(
      AnchorSchema,
      ANCHOR_SYSTEM,
      `Target page: ${a.targetUrl}\nSite: ${site.domain} (niche: ${site.niche})\n\nAnchors already pointing to this site (text: count):\n${used.map((u) => `${u.anchor}: ${u._count}`).join("\n") || "(none yet)"}\n\n<page>\n${page}\n</page>\n\nSuggest 8 anchors with a healthy mix of types.`,
    );
    anchors = data.anchors;
    await record(a.workspaceId, a.userId, "anchors", usage, { model });
  }
  const seen = new Set<string>();
  return anchors
    .map((x) => ({ ...x, text: x.text.trim() }))
    .filter((x) => x.text && x.text.length <= 100 && !seen.has(x.text.toLowerCase()) && seen.add(x.text.toLowerCase()))
    .slice(0, 8);
}

// ---------------------------------------------------------------------------
// Placement pages on the host site
// ---------------------------------------------------------------------------

const PlacementSchema = z.object({ pages: z.array(z.object({ url: z.string(), reason: z.string(), sentence: z.string() })) });
export type PlacementSuggestion = z.infer<typeof PlacementSchema>["pages"][number];

export async function suggestPlacement(a: { workspaceId: string; userId: string; legId: string }): Promise<PlacementSuggestion[]> {
  await assertQuota(a.workspaceId, "placement");
  const leg = await db.dealLeg.findUniqueOrThrow({ where: { id: a.legId }, include: { fromSite: true } });
  const candidates = await sitemapUrls(leg.fromSite.domain);
  if (candidates.length === 0) throw new AiError(`Couldn't read a sitemap at https://${leg.fromSite.domain}/sitemap.xml, so there are no pages to choose from.`);

  let pages: PlacementSuggestion[];
  if (fakeMode()) {
    pages = candidates.slice(0, 3).map((url) => ({ url, reason: "Closely related topic.", sentence: `For more detail, see this [${leg.anchor}](${leg.targetUrl}).` }));
    await record(a.workspaceId, a.userId, "placement", null, { legId: leg.id });
  } else {
    const target = await describeUrl(leg.targetUrl);
    const { data, usage, model } = await structured(
      PlacementSchema,
      PLACEMENT_SYSTEM,
      `Host site: ${leg.fromSite.domain} (niche: ${leg.fromSite.niche})\nLink to place: anchor "${leg.anchor}" -> ${leg.targetUrl}\n\n<target_page>\n${target}\n</target_page>\n\n<host_urls>\n${candidates.join("\n")}\n</host_urls>\n\nPick up to 5 pages.`,
    );
    pages = data.pages;
    await record(a.workspaceId, a.userId, "placement", usage, { legId: leg.id, model });
  }
  const allowed = new Set(candidates);
  return pages.filter((p) => allowed.has(p.url)).slice(0, 5); // never trust a URL the model invented
}

// ---------------------------------------------------------------------------
// Guest-post drafts
// ---------------------------------------------------------------------------

export async function draftGuestPost(a: { workspaceId: string; userId: string; legId: string; topic: string }): Promise<{ title: string; body: string }> {
  await assertQuota(a.workspaceId, "draft");
  const s = await getSettings();
  const leg = await db.dealLeg.findUniqueOrThrow({ where: { id: a.legId }, include: { fromSite: true, toSite: true } });
  const words = Math.max(s.guestPostMinWords + 150, 900);

  let markdown: string;
  let usage: Anthropic.Beta.BetaUsage | null = null;
  let answeredBy: string | undefined;
  if (fakeMode()) {
    const filler = Array.from({ length: words }, (_, i) => `insight${i % 50}`).join(" ");
    markdown = `# ${a.topic || "A practical guide"} for ${leg.fromSite.niche} teams\n\n${filler}\n\n## Tools that help\n\nA good [${leg.anchor}](${leg.targetUrl}) saves hours. [VERIFY: source for time saved]`;
  } else {
    const target = await describeUrl(leg.targetUrl);
    try {
      const msg = await getClient()
        .beta.messages.stream({
          model: AI_MODEL,
          max_tokens: 16000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          output_config: { effort: "medium" },
          system: DRAFT_SYSTEM,
          messages: [
            {
              role: "user",
              content: `Host site: ${leg.fromSite.domain} (niche: ${leg.fromSite.niche})\nGuest link: [${leg.anchor}](${leg.targetUrl})\nTopic idea from the guest: ${a.topic || "(none - choose a topic that suits the host's audience and relates to the linked page)"}\nLength: about ${words} words.\n\n<linked_page>\n${target}\n</linked_page>`,
            },
          ],
        })
        .finalMessage();
      checkStop(msg);
      markdown = msg.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      usage = msg.usage;
      answeredBy = msg.model;
    } catch (err) {
      toApiError(err);
    }
  }
  const draft = splitTitle(markdown);
  await record(a.workspaceId, a.userId, "draft", usage, { legId: leg.id, outputHash: contentHash(draft.body), model: answeredBy });
  return draft;
}

export async function aiUsageThisMonth(workspaceId: string) {
  const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const rows = await db.aiUsage.groupBy({ by: ["kind"], where: { workspaceId, createdAt: { gte: since } }, _count: true });
  const n = (k: string) => rows.find((r) => r.kind === k)?._count ?? 0;
  return { suggestions: n("anchors") + n("placement"), drafts: n("draft") };
}

// ---------------------------------------------------------------------------
// Topic keywords for relevance scoring (best effort: null when AI is off or fails)
// ---------------------------------------------------------------------------

const TopicSchema = z.object({ summary: z.string(), keywords: z.array(z.string()) });

export async function topicKeywords(workspaceId: string, label: string, pageText: string): Promise<{ summary: string; keywords: string[] } | null> {
  if (!aiEnabled() || !pageText.trim()) return null;
  try {
    if (fakeMode()) {
      await record(workspaceId, null, "topics", null);
      return { summary: `Pages about ${label}.`, keywords: [] };
    }
    const { data, usage, model } = await structured(TopicSchema, TOPIC_SYSTEM, `<${label}>\n${pageText.slice(0, 6000)}\n</${label}>`);
    await record(workspaceId, null, "topics", usage, { model });
    return { summary: data.summary.slice(0, 300), keywords: data.keywords.map((k) => k.trim()).filter((k) => k && k.length <= 60).slice(0, 15) };
  } catch (err) {
    console.error("[ai topics]", (err as Error).message);
    return null;
  }
}
