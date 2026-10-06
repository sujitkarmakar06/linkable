import type { AnchorKind } from "@/lib/anchors";
import type { buildProfile } from "@/lib/profile";
import { TARGET_MIX } from "@/lib/profile";

const KIND_LABEL: Record<AnchorKind, string> = { branded: "Branded", url: "URL", generic: "Generic", keyword: "Keyword" };
const pct = (x: number) => `${Math.round(x * 100)}%`;

// Anchor mix, top anchors, links per month and warnings for one receiving site.
export function LinkProfile({ profile }: { profile: ReturnType<typeof buildProfile> }) {
  const p = profile;
  const peak = Math.max(1, ...p.months.map((m) => m.n));
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted">
        {p.total === 0
          ? "No links through Linkable yet."
          : `${p.live} live and ${p.planned} agreed link${p.total === 1 ? "" : "s"} through Linkable · ${pct(p.dofollowShare)} dofollow.`}{" "}
        <strong className="text-text">{p.suggestion}</strong>
      </p>
      {p.warnings.length > 0 && (
        <ul className="list-disc pl-5 text-danger">
          {p.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {p.total > 0 && (
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="mb-2 font-medium">Anchor mix</div>
            <ul className="flex flex-col gap-2">
              {(Object.keys(KIND_LABEL) as AnchorKind[]).map((k) => (
                <li key={k}>
                  <div className="flex justify-between">
                    <span>{KIND_LABEL[k]}</span>
                    <span className="tabular-nums text-muted">
                      {pct(p.share(p.byKind[k]))} <span className="text-xs">(aim ~{pct(TARGET_MIX[k])})</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-border">
                    <div className="h-1.5 rounded bg-accent" style={{ width: pct(p.share(p.byKind[k])) }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-2 font-medium">Links per month</div>
            <div className="flex h-24 items-end gap-2" role="img" aria-label={`Links per month: ${p.months.map((m) => `${m.key} ${m.n}`).join(", ")}`}>
              {p.months.map((m) => (
                <div key={m.key} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs tabular-nums text-muted">{m.n}</span>
                  <div className="w-full rounded-t bg-accent" style={{ height: `${(m.n / peak) * 64}px`, minHeight: m.n ? 4 : 1, opacity: m.n ? 1 : 0.25 }} />
                  <span className="text-xs text-muted">{m.key.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <div className="mb-2 font-medium">Most used anchors</div>
            <table className="w-full">
              <tbody>
                {p.topAnchors.map((a) => (
                  <tr key={a.anchor} className="border-t border-border">
                    <td className="py-1 pr-3">&quot;{a.anchor}&quot;</td>
                    <td className="py-1 pr-3 text-muted">{KIND_LABEL[a.kind]}</td>
                    <td className="py-1 text-right tabular-nums">
                      {a.n} · {pct(a.share)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
