// Credit pricing for a single link. Pure so it can be unit tested and reused
// by the matching engine, proposals and the admin preview.

export type CreditTier = { minDr: number; maxDr: number; credits: number };

export const DEFAULT_CREDIT_TIERS: CreditTier[] = [
  { minDr: 30, maxDr: 39, credits: 1 },
  { minDr: 40, maxDr: 59, credits: 2 },
  { minDr: 60, maxDr: 79, credits: 4 },
  { minDr: 80, maxDr: 100, credits: 8 },
];

// Traffic nudges the DR price: a high-DR site with almost no organic traffic
// is worth less, a site with strong traffic for its DR is worth a bit more.
export function trafficMultiplier(monthlyTraffic: number | null | undefined): number {
  if (monthlyTraffic == null) return 1;
  if (monthlyTraffic < 1_000) return 0.75;
  if (monthlyTraffic >= 50_000) return 1.25;
  return 1;
}

export type PriceInput = {
  domainRating: number;
  monthlyTraffic?: number | null;
  rel: "DOFOLLOW" | "NOFOLLOW";
  placementType: "INSERTION" | "GUEST_POST";
};

export type PriceRules = {
  tiers: CreditTier[];
  nofollowMultiplier: number;
  guestPostBonus: number;
};

export function priceLink(input: PriceInput, rules: PriceRules): number | null {
  const tier = rules.tiers.find((t) => input.domainRating >= t.minDr && input.domainRating <= t.maxDr);
  if (!tier) return null; // below the platform minimum - not tradable
  let price = tier.credits * trafficMultiplier(input.monthlyTraffic);
  if (input.rel === "NOFOLLOW") price *= rules.nofollowMultiplier;
  if (input.placementType === "GUEST_POST") price += rules.guestPostBonus;
  // Credits are whole numbers; never price a tradable link at zero.
  return Math.max(1, Math.round(price));
}

// Staged escrow release over the guarantee period: 40% on verification,
// then 20% at 3, 6 and 12 months. Amounts follow the cumulative schedule
// rounded to whole credits, so small deals still hold most credits back
// (1 credit -> released at 3 months; 2 -> 1 now, 1 at 6 months) and the
// stages always add up to the total.
export const RELEASE_SCHEDULE = [
  { afterMonths: 0, share: 0.4 },
  { afterMonths: 3, share: 0.2 },
  { afterMonths: 6, share: 0.2 },
  { afterMonths: 12, share: 0.2 },
] as const;

export function releaseStages(total: number, verifiedAt: Date): { amount: number; releaseAt: Date; afterMonths: number }[] {
  let cumulativeShare = 0;
  let releasedSoFar = 0;
  return RELEASE_SCHEDULE.map((s, i) => {
    cumulativeShare += s.share;
    const target = i === RELEASE_SCHEDULE.length - 1 ? total : Math.round(total * cumulativeShare);
    const amount = target - releasedSoFar;
    releasedSoFar = target;
    const releaseAt = new Date(verifiedAt);
    releaseAt.setUTCMonth(releaseAt.getUTCMonth() + s.afterMonths);
    return { amount, releaseAt, afterMonths: s.afterMonths };
  }).filter((s) => s.amount > 0);
}
