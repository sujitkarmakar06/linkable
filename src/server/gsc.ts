import "server-only";
import type { GscConnection } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { gscApi, GscAuthError, type GscApi } from "@/lib/gsc";
import { notifyWorkspace } from "@/server/notify";

// Access tokens last an hour; reuse them within one server instance.
const accessCache = new Map<string, { token: string; until: number }>();

export async function saveConnection(a: { siteId: string; properties: string[]; refreshToken: string; email: string | null; userId: string }) {
  const data = { properties: a.properties, refreshToken: encrypt(a.refreshToken), googleEmail: a.email, connectedById: a.userId, connectedAt: new Date(), lastError: null, lastErrorAt: null };
  const conn = await db.gscConnection.upsert({ where: { siteId: a.siteId }, create: { siteId: a.siteId, ...data }, update: data });
  // Never revoke the replaced token: Google revokes a whole account's grant at
  // once, which would also cut off the token just saved.
  accessCache.delete(conn.id);
}

export async function disconnect(siteId: string) {
  const conn = await db.gscConnection.findUnique({ where: { siteId } });
  if (!conn) return;
  await db.gscConnection.delete({ where: { id: conn.id } });
  accessCache.delete(conn.id);
  // Revoking ends the Google account's whole grant to Linkable, so only do it
  // when no other site still relies on the same account.
  const shared = conn.googleEmail ? await db.gscConnection.count({ where: { googleEmail: conn.googleEmail } }) : 1;
  if (!shared) await gscApi().revoke(decrypt(conn.refreshToken)).catch(() => {});
}

// Run `fn` with a working access token for the site's connection. Returns null
// (and records why) when the site has no connection or Google refuses it; the
// site's workspace is told once per week to reconnect.
export async function withGsc<T>(siteId: string, fn: (api: GscApi, accessToken: string, conn: GscConnection) => Promise<T>): Promise<T | null> {
  const conn = await db.gscConnection.findUnique({ where: { siteId }, include: { site: true } });
  if (!conn) return null;
  const api = gscApi();
  try {
    let cached = accessCache.get(conn.id);
    if (!cached || cached.until < Date.now()) {
      cached = { token: await api.refresh(decrypt(conn.refreshToken)), until: Date.now() + 50 * 60_000 };
      accessCache.set(conn.id, cached);
    }
    let result: T;
    try {
      result = await fn(api, cached.token, conn);
    } catch (err) {
      if (!(err instanceof GscAuthError)) throw err;
      // The cached token may have been revoked; retry once with a fresh one.
      accessCache.delete(conn.id);
      const token = await api.refresh(decrypt(conn.refreshToken));
      accessCache.set(conn.id, { token, until: Date.now() + 50 * 60_000 });
      result = await fn(api, token, conn);
    }
    await db.gscConnection.updateMany({ where: { id: conn.id }, data: { lastUsedAt: new Date(), lastError: null, lastErrorAt: null } });
    return result;
  } catch (err) {
    if (!(err instanceof GscAuthError)) throw err;
    accessCache.delete(conn.id);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const { count } = await db.gscConnection.updateMany({
      where: { id: conn.id, OR: [{ lastErrorAt: null }, { lastErrorAt: { lt: weekAgo } }] },
      data: { lastError: err.message, lastErrorAt: new Date() },
    });
    if (count)
      await notifyWorkspace(
        conn.site.workspaceId,
        {
          kind: "gsc.disconnected",
          title: `Reconnect Search Console for ${conn.site.domain}`,
          body: `${err.message} Until you reconnect, Linkable can't confirm indexing (payouts for your links wait) or measure link impact.`,
          path: `/app/sites/${conn.siteId}`,
        },
        { everyone: true },
      );
    return null;
  }
}
