import "server-only";
import { db } from "@/lib/db";
import { appUrl, sendEmail } from "@/lib/email";
import { emailModeFor } from "@/lib/notify-prefs";

// In-app notification for a workspace's owners and admins (or everyone), plus
// email according to each person's preferences (instant, daily digest or off).
export async function notifyWorkspace(
  workspaceId: string,
  n: { kind: string; title: string; body: string; path: string },
  { everyone = false, exceptUserId }: { everyone?: boolean; exceptUserId?: string } = {},
) {
  const members = await db.membership.findMany({
    where: { workspaceId, ...(everyone ? {} : { role: { in: ["OWNER", "ADMIN"] } }), ...(exceptUserId ? { userId: { not: exceptUserId } } : {}) },
    include: { user: true },
  });
  await Promise.all(
    members.map(async (m) => {
      const mode = m.user.suspendedAt ? "OFF" : emailModeFor(n.kind, m.user);
      const emailState = mode === "INSTANT" ? "sent" : mode === "DIGEST" ? "digest" : "off";
      await db.notification.create({
        data: { userId: m.userId, kind: n.kind, title: n.title, body: n.body, url: n.path, emailState, emailedAt: mode === "INSTANT" ? new Date() : null },
      });
      if (mode === "INSTANT") await sendEmail(m.user.email, n.title, n.title, n.body, { label: "Open in Linkable", url: appUrl(n.path) }).catch((err) => console.error("[email]", err));
    }),
  );
}

// One email per person with everything they chose to receive as a digest.
export async function sendDigests() {
  const pending = await db.notification.findMany({ where: { emailState: "digest" }, include: { user: true }, orderBy: { createdAt: "asc" }, take: 5000 });
  const byUser = new Map<string, typeof pending>();
  for (const n of pending) byUser.set(n.userId, [...(byUser.get(n.userId) ?? []), n]);
  let sent = 0;
  for (const [userId, items] of byUser) {
    const user = items[0].user;
    const shown = items.slice(-30);
    try {
      await sendEmail(
        user.email,
        `Your Linkable digest: ${items.length} update${items.length === 1 ? "" : "s"}`,
        "Your daily Linkable digest",
        items.length > shown.length ? `Latest ${shown.length} of ${items.length} updates:` : "Here's what happened since your last digest:",
        { label: "Open notifications", url: appUrl("/app/notifications") },
        shown.map((n) => ({ title: n.title, body: n.body.slice(0, 300), url: n.url ? appUrl(n.url) : undefined })),
      );
      await db.notification.updateMany({ where: { userId, id: { in: items.map((i) => i.id) } }, data: { emailState: "digested", emailedAt: new Date() } });
      sent++;
    } catch (err) {
      console.error("[digest]", err);
    }
  }
  return sent;
}
