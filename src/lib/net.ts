import "server-only";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import type { ReadableStream } from "node:stream/web";
import { Agent, fetch } from "undici";
import { isPrivateIp } from "./ip";

// Outbound fetches to user-supplied domains (verification, spam checks, link
// checks). Guards against SSRF: every connection's resolved IP must be public,
// checked inside the socket lookup itself so DNS rebinding can't slip past.

const agent = new Agent({
  connect: {
    timeout: 10_000,
    lookup(hostname, options, callback) {
      lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, "", 4);
        const list = addresses as { address: string; family: number }[];
        const bad = list.find((a) => isPrivateIp(a.address));
        if (bad || list.length === 0) return callback(new Error(`Refusing to connect to private address for ${hostname}`), "", 4);
        // undici asks for all addresses when options.all is set.
        if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
        callback(null, list[0].address, list[0].family);
      });
    },
  },
});

export const BOT_UA = `LinkableBot/1.0 (+${process.env.APP_URL ?? "http://localhost:3000"}/bot)`;
const MAX_BYTES = 2 * 1024 * 1024;

export type FetchResult = { ok: boolean; status: number; url: string; redirects: number; body: string; contentType: string; xRobotsTag: string | null };

// Local testing only: FETCH_HOST_OVERRIDES="example.com=127.0.0.1:4555,..."
// sends requests for those hosts to a local server over plain HTTP. Ignored in production.
function hostOverride(url: URL): string | null {
  if (process.env.NODE_ENV === "production" || !process.env.FETCH_HOST_OVERRIDES) return null;
  const map = Object.fromEntries(process.env.FETCH_HOST_OVERRIDES.split(",").map((p) => p.trim().split("=") as [string, string]));
  const target = map[url.hostname.replace(/^www\./, "")];
  return target ? `http://${target}${url.pathname}${url.search}` : null;
}

// GET with manual redirect handling (max 5), a timeout and a body size cap.
export async function safeGet(url: string, { maxRedirects = 5, timeoutMs = 15_000 } = {}): Promise<FetchResult> {
  let current = url;
  for (let redirects = 0; ; redirects++) {
    const parsed = new URL(current);
    const override = hostOverride(parsed);
    if (override) {
      const res = await fetch(override, { redirect: "manual", headers: { "user-agent": BOT_UA }, signal: AbortSignal.timeout(timeoutMs) });
      return { ok: res.ok, status: res.status, url: current, redirects, body: await res.text(), contentType: res.headers.get("content-type") ?? "", xRobotsTag: res.headers.get("x-robots-tag") };
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`Unsupported URL scheme: ${parsed.protocol}`);
    // IP-literal hosts skip the DNS lookup hook below, so check them here.
    const literal = parsed.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) && isPrivateIp(literal)) throw new Error("Refusing private address");
    const res = await fetch(current, {
      dispatcher: agent,
      redirect: "manual",
      headers: { "user-agent": BOT_UA, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      if (redirects >= maxRedirects) throw new Error("Too many redirects");
      current = new URL(location, current).toString();
      continue;
    }
    const body = await readCapped(res.body);
    return { ok: res.ok, status: res.status, url: current, redirects, body, contentType: res.headers.get("content-type") ?? "", xRobotsTag: res.headers.get("x-robots-tag") };
  }
}

async function readCapped(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, MAX_BYTES).toString("utf8");
}

// Fetch a page on the site, trying https://domain then https://www.domain.
export async function getSitePage(domain: string, path = "/"): Promise<FetchResult> {
  let lastError: unknown;
  for (const host of [domain, `www.${domain}`]) {
    try {
      return await safeGet(`https://${host}${path}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not reach the site");
}
