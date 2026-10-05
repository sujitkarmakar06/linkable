import "server-only";
import { db } from "@/lib/db";
import { appUrl, sendEmail } from "@/lib/email";

// In-app notification + email for a workspace's owners and admins (or everyone).
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
      await db.notification.create({ data: { userId: m.userId, kind: n.kind, title: n.title, body: n.body, url: n.path, emailedAt: new Date() } });
      await sendEmail(m.user.email, n.title, n.title, n.body, { label: "Open in Linkable", url: appUrl(n.path) }).catch((err) => console.error("[email]", err));
    }),
  );
}
