import "server-only";
import { resolve4, resolveTxt } from "node:dns/promises";
import { Prisma, type Site, type VerificationMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { transferCredits } from "@/lib/ledger";
import { getSitePage } from "@/lib/net";
import { evaluateSite } from "@/lib/quality";
import { getDomainMetrics } from "@/lib/seo";
import { getSettings } from "@/lib/settings";
import { analyseHomepage, metricSignals, spamScore, type SpamSignal } from "@/lib/spam";
import { notifyWorkspace } from "@/server/notify";
import { verifyDnsTxt, verifyHtmlFile, verifyMetaTag, type VerifyOutcome } from "@/lib/verification";

const pageGetter = async (domain: string, path: string) => getSitePage(domain, path);

export async function runVerification(site: Site, method: Exclude<VerificationMethod, "GSC">): Promise<VerifyOutcome> {
  if (method === "DNS_TXT") return verifyDnsTxt(site.domain, site.verificationToken, resolveTxt);
  if (method === "META_TAG") return verifyMetaTag(site.domain, site.verificationToken, pageGetter);
  return verifyHtmlFile(site.domain, site.verificationToken, pageGetter);
}

// Record a successful proof. Fails if another workspace already verified the domain.
export async function markVerified(site: Site, method: VerificationMethod): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await db.site.update({
      where: { id: site.id },
      data: { verificationMethod: method, verifiedAt: new Date(), verifiedDomain: site.domain, lastVerifyAt: new Date(), lastVerifyError: null },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, reason: `${site.domain} is already verified by another workspace. If you own it, contact support.` };
    }
    throw err;
  }
  await db.auditLog.create({ data: { workspaceId: site.workspaceId, action: "site.verified", target: site.id, meta: { method } } });
  await assessSite(site.id);
  return { ok: true };
}

export async function recordVerifyFailure(siteId: string, reason: string) {
  await db.site.update({ where: { id: siteId }, data: { lastVerifyAt: new Date(), lastVerifyError: reason } });
}

// After verification: footprint, metrics, spam signals, then the quality
// rules decide between auto-reject and the admin review queue.
export async function assessSite(siteId: string, { forceMetrics = false } = {}) {
  const site = await db.site.findUniqueOrThrow({ where: { id: siteId } });
  const settings = await getSettings();
  const signals: SpamSignal[] = [];

  const ips = await resolve4(site.domain).catch(() => [] as string[]);
  const ipAddress = ips[0] ?? null;

  let domainRating = site.domainRating;
  let organicTraffic = site.organicTraffic;
  let metricsProvider = site.metricsProvider;
  // Manually entered metrics stay unless an admin forces a refresh.
  if (forceMetrics || metricsProvider !== "manual") {
    try {
      const metrics = await getDomainMetrics(site.domain, { force: forceMetrics });
      if (metrics) ({ domainRating, organicTraffic, provider: metricsProvider } = metrics);
    } catch (err) {
      console.error(`[metrics] ${site.domain}: ${(err as Error).message}`);
    }
  }

  try {
    const home = await getSitePage(site.domain, "/");
    if (home.ok) signals.push(...analyseHomepage(home.body, site.domain));
    else signals.push({ code: "unreachable", label: `Homepage returned HTTP ${home.status}`, weight: 20 });
  } catch (err) {
    signals.push({ code: "unreachable", label: `Homepage unreachable: ${(err as Error).message}`, weight: 20 });
  }
  signals.push(...metricSignals(domainRating, organicTraffic));
  const score = spamScore(signals);

  const result = evaluateSite({ niche: site.niche, domainRating, organicTraffic, spamScore: score }, settings);
  // Only sites still waiting on a decision move; approved/suspended sites keep
  // their status when an admin refreshes metrics.
  const decide = site.status === "DRAFT" || site.status === "PENDING_REVIEW";
  const status = !decide ? site.status : result.decision === "reject" ? "REJECTED" : "PENDING_REVIEW";

  await db.site.update({
    where: { id: site.id },
    data: {
      ipAddress,
      ipCClass: ipAddress ? ipAddress.split(".").slice(0, 3).join(".") : null,
      domainRating,
      organicTraffic,
      metricsProvider,
      metricsUpdatedAt: metricsProvider && metricsProvider !== site.metricsProvider ? new Date() : site.metricsUpdatedAt,
      spamScore: score,
      spamSignals: { signals, warnings: result.warnings },
      status,
      ...(decide && status === "REJECTED" ? { reviewNote: result.reasons.join(" "), reviewedAt: new Date() } : {}),
    },
  });

  if (decide && status === "REJECTED") await notifySiteDecision(site.workspaceId, site.domain, site.id, "rejected", result.reasons.join(" "));
}

export async function notifySiteDecision(workspaceId: string, domain: string, siteId: string, decision: "approved" | "rejected" | "suspended", note?: string | null) {
  const body =
    decision === "approved"
      ? `${domain} is approved and now listed on Linkable. ${note ?? ""}`
      : decision === "rejected"
        ? `${domain} wasn't approved. ${note ?? ""}`
        : `${domain} has been suspended. ${note ?? ""}`;
  await notifyWorkspace(workspaceId, { kind: `site.${decision}`, title: `${domain} was ${decision}`, body: body.trim(), path: `/app/sites/${siteId}` });
}

// Grants starter credits the first time any site in the workspace is approved.
// The workspace row lock makes concurrent approvals grant at most once.
export async function grantStarterCreditsOnce(tx: Prisma.TransactionClient, workspaceId: string, amount: number, adminId: string) {
  if (amount <= 0) return false;
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
  const already = await tx.creditEntry.findFirst({ where: { workspaceId, reason: "SIGNUP_GRANT" } });
  if (already) return false;
  await transferCredits(tx, {
    from: { workspaceId: null, bucket: "PLATFORM" },
    to: { workspaceId, bucket: "AVAILABLE" },
    amount,
    reason: "SIGNUP_GRANT",
    note: "Starter credits for first approved site",
    createdById: adminId,
  });
  return true;
}
