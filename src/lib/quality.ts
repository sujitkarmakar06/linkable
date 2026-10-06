import { isBannedNiche } from "./niches";
import { SPAM_REVIEW_THRESHOLD } from "./spam";

// Decides what happens to a site once ownership is proven.
// Hard failures auto-reject (with the reason shown to the owner); everything
// else goes to an admin, with warnings highlighted.

export type QualityInput = {
  niche: string;
  domainRating: number | null;
  organicTraffic: number | null;
  spamScore: number | null;
};

export type QualityRules = { minDomainRating: number; minMonthlyTraffic: number; bannedNiches: string[] };

export type QualityResult = { decision: "reject" | "review"; reasons: string[]; warnings: string[] };

export function evaluateSite(site: QualityInput, rules: QualityRules): QualityResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (isBannedNiche(site.niche, rules.bannedNiches)) reasons.push(`The "${site.niche}" niche isn't allowed on Linkable.`);
  if (site.domainRating != null && site.domainRating < rules.minDomainRating) reasons.push(`DR is ${site.domainRating}; the minimum is ${rules.minDomainRating}.`);
  if (site.organicTraffic != null && site.organicTraffic < rules.minMonthlyTraffic)
    reasons.push(`Organic traffic is ${site.organicTraffic.toLocaleString("en")}/month; the minimum is ${rules.minMonthlyTraffic.toLocaleString("en")}.`);

  if (site.domainRating == null || site.organicTraffic == null) warnings.push("Metrics unavailable - an admin must enter DR and traffic.");
  if (site.spamScore != null && site.spamScore >= SPAM_REVIEW_THRESHOLD) warnings.push(`Spam score ${site.spamScore}/100 - check the signals.`);

  return { decision: reasons.length ? "reject" : "review", reasons, warnings };
}
