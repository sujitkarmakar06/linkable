import type { Site } from "@prisma/client";
import type { LegTerm } from "@/lib/terms";

// Read-only view of proposal terms.
export function LegsTable({ legs, sites, workspaceNames }: { legs: LegTerm[]; sites: Map<string, Site>; workspaceNames: Map<string, string> }) {
  return (
    <ol className="flex flex-col gap-3">
      {legs.map((l, i) => {
        const from = sites.get(l.fromSiteId);
        const to = sites.get(l.toSiteId);
        return (
          <li key={i} className="rounded-lg border border-border p-3 text-sm">
            <div className="font-medium">
              {i + 1}. {from?.domain} <span className="text-muted">({workspaceNames.get(from?.workspaceId ?? "")})</span> → {to?.domain}{" "}
              <span className="text-muted">({workspaceNames.get(to?.workspaceId ?? "")})</span>
            </div>
            <div className="mt-1 break-all text-muted">
              &quot;{l.anchor}&quot; → {l.targetUrl}
            </div>
            <div className="mt-1 text-xs text-muted">
              {l.placementType === "GUEST_POST" ? "Guest post" : "Link insertion"} · {l.rel.toLowerCase()} · from DR {from?.domainRating ?? "-"}
              {l.credits > 0 && ` · ${workspaceNames.get(to?.workspaceId ?? "")} pays ${l.credits} cr`}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
