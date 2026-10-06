import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { markAllReadAction } from "@/server/actions/notifications";
import { requireUser } from "@/server/session";
import { Button, Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <>
      <PageHeader title="Notifications" description={`${unread} unread · Email settings are on the Account page.`}>
        {unread > 0 && (
          <form action={markAllReadAction}>
            <Button variant="secondary">Mark all as read</Button>
          </form>
        )}
      </PageHeader>
      <div className="max-w-3xl">
        {items.length === 0 ? (
          <Card title="Nothing yet" description="Deal, site and message updates show up here." />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((n) => (
              <li key={n.id} className={`rounded-xl border bg-surface p-4 ${n.readAt ? "border-border" : "border-accent/50"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  {n.url ? (
                    <Link href={n.url} className="font-medium text-accent">
                      {n.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{n.title}</span>
                  )}
                  <span className="text-xs text-muted">{n.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                </div>
                <p className="mt-1 text-sm whitespace-pre-line text-muted">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
