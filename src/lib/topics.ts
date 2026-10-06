// Topic profiles and relevance. A page or site is reduced to weighted terms
// (single words and two-word phrases); relevance is the cosine similarity of
// two profiles, mapped to 0-100. Pure, so it's cheap and testable; the AI only
// adds extra keywords on top (server/topics.ts).

export type Topic = { t: string; w: number };

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) return w.slice(0, -1);
  return w;
}

const STOP_WORDS =
  (
    "a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each " +
    "few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on " +
    "once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too " +
    "under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves get got make made use used using one two new " +
    "like may might must need many much every way well also back even still really want take see know think go going come say said time year years day days " +
    // site furniture
    "home about contact privacy policy cookie cookies menu search login log sign read more click share posted comment comments copyright rights reserved terms subscribe newsletter " +
    "blog page pages post posts category categories tag tags follow facebook twitter linkedin instagram youtube pinterest email www http https com net org html php skip content main " +
    "footer header navigation previous next older newer author admin home page site website toggle close open view all"
  ).split(" ");
// Tokens are stemmed before the check, so include stemmed forms ("cookies" -> "cooky").
const STOP = new Set([...STOP_WORDS, ...STOP_WORDS.map(stem)]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w))
    .map(stem);
}

// Weighted parts (title counts more than body text) -> top `max` terms, the
// strongest scaled to 1.
export function extractTopics(parts: { text: string; weight: number }[], max = 30): Topic[] {
  const score = new Map<string, number>();
  const add = (t: string, w: number) => score.set(t, (score.get(t) ?? 0) + w);
  for (const { text, weight } of parts) {
    const words = tokenize(text);
    for (let i = 0; i < words.length; i++) {
      if (STOP.has(words[i])) continue;
      add(words[i], weight);
      const next = words[i + 1];
      if (next && !STOP.has(next)) add(`${words[i]} ${next}`, weight * 1.5);
    }
  }
  // A phrase seen once is usually noise.
  const ranked = [...score].filter(([t, w]) => !t.includes(" ") || w >= 3).sort((a, b) => b[1] - a[1]).slice(0, max);
  const top = ranked[0]?.[1] ?? 1;
  return ranked.map(([t, w]) => ({ t, w: Math.round((w / top) * 1000) / 1000 }));
}

// Add extra keywords (e.g. from the AI) at a fixed weight.
export function withKeywords(topics: Topic[], keywords: string[], weight = 0.8, max = 40): Topic[] {
  const map = new Map(topics.map((x) => [x.t, x.w]));
  for (const k of keywords) {
    const words = tokenize(k);
    // Keep phrases whole ("time tracking"); skip keywords made only of stop words.
    if (!words.length || words.every((w) => STOP.has(w))) continue;
    const t = words.join(" ");
    map.set(t, Math.max(map.get(t) ?? 0, weight));
  }
  return [...map].sort((a, b) => b[1] - a[1]).slice(0, max).map(([t, w]) => ({ t, w }));
}

// Phrases also count toward their words, so "link building" on one side
// still overlaps with "building" on the other.
function vector(topics: Topic[]): Map<string, number> {
  const v = new Map<string, number>();
  for (const { t, w } of topics) {
    v.set(t, (v.get(t) ?? 0) + w);
    if (t.includes(" ")) for (const part of t.split(" ")) v.set(part, (v.get(part) ?? 0) + w / 2);
  }
  return v;
}

export function cosine(a: Topic[], b: Topic[]): number {
  const va = vector(a);
  const vb = vector(b);
  let dot = 0;
  for (const [t, w] of va) dot += w * (vb.get(t) ?? 0);
  const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((s, w) => s + w * w, 0));
  const n = norm(va) * norm(vb);
  return n ? dot / n : 0;
}

// 0-100. Related pages rarely exceed a cosine of ~0.4, so the scale is curved:
// 0.05 -> 26, 0.1 -> 45, 0.2 -> 70, 0.35 -> 88.
export function relevanceScore(a: Topic[] | null | undefined, b: Topic[] | null | undefined): number | null {
  if (!a?.length || !b?.length) return null;
  return Math.round(100 * (1 - Math.exp(-6 * cosine(a, b))));
}

export function relevanceLabel(score: number): "High" | "Medium" | "Low" {
  return score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
}

export function asTopics(json: unknown): Topic[] | null {
  if (!Array.isArray(json)) return null;
  return json.filter((x): x is Topic => typeof x?.t === "string" && typeof x?.w === "number");
}
