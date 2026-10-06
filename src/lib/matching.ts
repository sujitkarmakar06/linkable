// Ranking for automatic matching. Pure so the weights are easy to test and tune.
//
//   niche fit      30  same niche as the requesting site (20 if only in the accepted list)
//   DR             25  linear from DR 30 to DR 80+
//   traffic        20  log scale, 100k+ visits/month = full marks
//   reputation     15  giver workspace reputation (0-100)
//   capacity       10  share of this month's outbound links still free (spreads load)

export type Candidate = {
  niche: string;
  domainRating: number;
  organicTraffic: number | null;
  reputation: number;
  linksThisMonth: number;
  maxOutboundPerMonth: number;
};

export function scoreCandidate(c: Candidate, request: { siteNiche: string }): number {
  const niche = c.niche === request.siteNiche ? 30 : 20;
  const dr = 25 * Math.min(1, Math.max(0, (c.domainRating - 30) / 50));
  const traffic = 20 * Math.min(1, Math.log10(Math.max(1, c.organicTraffic ?? 1)) / 5);
  const reputation = 15 * Math.min(1, Math.max(0, c.reputation / 100));
  const capacity = 10 * Math.max(0, (c.maxOutboundPerMonth - c.linksThisMonth) / Math.max(1, c.maxOutboundPerMonth));
  return Math.round(niche + dr + traffic + reputation + capacity);
}

// Best candidate per workspace, then the top N overall: a request is never
// offered to two sites of the same workspace at once.
export function pickTop<T extends { workspaceId: string; score: number }>(candidates: T[], n: number): T[] {
  const best = new Map<string, T>();
  for (const c of candidates) {
    const cur = best.get(c.workspaceId);
    if (!cur || c.score > cur.score) best.set(c.workspaceId, c);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, n);
}
