import type { LinkImpact } from "@prisma/client";
import { dueWindows, formatChange, impactWindows, isoDay, positionChange } from "@/lib/impact";

// Before/after Google numbers for one linked-to page.
export function ImpactTable({ liveAt, impacts }: { liveAt: Date; impacts: LinkImpact[] }) {
  const byWindow = new Map(impacts.map((i) => [i.window, i]));
  const base = byWindow.get("BASELINE");
  const due = new Set(dueWindows(liveAt).map((w) => w.window));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr>
            <th className="py-1 pr-3 font-normal">28 days</th>
            <th className="py-1 pr-3 text-right font-normal">Clicks</th>
            <th className="py-1 pr-3 text-right font-normal">Impressions</th>
            <th className="py-1 text-right font-normal">Avg. position</th>
          </tr>
        </thead>
        <tbody>
          {impactWindows(liveAt).map((w) => {
            const row = byWindow.get(w.window);
            const compare = row && base && w.window !== "BASELINE";
            return (
              <tr key={w.window} className="border-t border-border">
                <td className="py-1.5 pr-3">
                  {w.label}
                  <div className="text-xs text-muted">
                    {isoDay(w.start)} to {isoDay(w.end)}
                  </div>
                </td>
                {row ? (
                  <>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {row.clicks.toLocaleString("en")}
                      {compare && <div className="text-xs text-muted">{formatChange(base.clicks, row.clicks)}</div>}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {row.impressions.toLocaleString("en")}
                      {compare && <div className="text-xs text-muted">{formatChange(base.impressions, row.impressions)}</div>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {row.position?.toFixed(1) ?? "-"}
                      {compare && <div className="text-xs text-muted">{positionChange(base.position, row.position)}</div>}
                    </td>
                  </>
                ) : (
                  <td colSpan={3} className="py-1.5 text-right text-muted">
                    {due.has(w.window) ? "Fetching with the next daily job" : "Not yet"}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">From your Google Search Console. Search traffic changes for many reasons; one link is rarely the only cause.</p>
    </div>
  );
}
