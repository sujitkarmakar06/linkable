import { db } from "@/lib/db";
import { sendMessageAction } from "@/server/actions/proposals";
import { ActionForm } from "./action-form";
import { Card } from "./ui";

export async function Thread({ dealId, proposalId, workspaceIds, canPost }: { dealId?: string; proposalId?: string; workspaceIds: string[]; canPost: boolean }) {
  const messages = await db.message.findMany({
    where: dealId ? { dealId } : { proposalId },
    include: { author: { include: { memberships: { where: { workspaceId: { in: workspaceIds } }, include: { workspace: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  return (
    <Card title="Messages">
      {messages.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
      <ul className="flex flex-col gap-3">
        {messages.map((m) => (
          <li key={m.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="mb-1 text-xs text-muted">
              {m.author.name ?? "Someone"} · {m.author.memberships[0]?.workspace.name ?? ""} · {m.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
            </div>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ul>
      {canPost && (
        <div className="mt-4">
          <ActionForm action={sendMessageAction} submit="Send" variant="secondary">
            {dealId && <input type="hidden" name="dealId" value={dealId} />}
            {proposalId && <input type="hidden" name="proposalId" value={proposalId} />}
            <textarea name="body" rows={3} maxLength={4000} required aria-label="Message" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
          </ActionForm>
        </div>
      )}
    </Card>
  );
}
