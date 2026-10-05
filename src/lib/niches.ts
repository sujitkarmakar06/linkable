// Fixed niche list so matching can compare like with like. Admins can ban
// any of these (by name) from the rules page.
export const NICHES = [
  "Automotive",
  "Business",
  "Career & Jobs",
  "Education",
  "Entertainment",
  "Fashion & Beauty",
  "Finance",
  "Food & Drink",
  "Gaming",
  "Health & Fitness",
  "Home & Garden",
  "Legal",
  "Lifestyle",
  "Marketing & SEO",
  "News & Media",
  "Parenting",
  "Pets",
  "Real Estate",
  "Software & SaaS",
  "Sports",
  "Technology",
  "Travel",
  "Other",
] as const;

export type Niche = (typeof NICHES)[number];

export const isNiche = (value: string): value is Niche => (NICHES as readonly string[]).includes(value);

export function isBannedNiche(niche: string, banned: string[]): boolean {
  const n = niche.trim().toLowerCase();
  return banned.some((b) => b.trim().toLowerCase() === n);
}
