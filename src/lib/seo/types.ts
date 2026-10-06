export type DomainMetrics = {
  domainRating: number | null;
  organicTraffic: number | null; // estimated monthly organic visits
};

export interface SeoProvider {
  name: string;
  getDomainMetrics(domain: string): Promise<DomainMetrics>;
}
