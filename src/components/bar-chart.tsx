// Single-series vertical bar chart as inline SVG (server-rendered).
// Thin bars with a 4px rounded top, recessive grid, a hover target taller
// than the bar with a native tooltip, and a table view for accessibility.

export function BarChart({ data, label, valueLabel }: { data: { x: string; y: number }[]; label: string; valueLabel: string }) {
  const W = 640;
  const H = 200;
  const pad = { l: 32, r: 8, t: 12, b: 28 };
  const max = Math.max(1, ...data.map((d) => d.y));
  const step = Math.ceil(max / 4) || 1;
  const top = step * 4;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / data.length;
  const bw = Math.min(28, slot - 2); // >= 2px gap between bars
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(i * step)} y2={y(i * step)} stroke="var(--border)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(i * step) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {i * step}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          const h = Math.max(0, y(0) - y(d.y));
          const r = Math.min(4, h, bw / 2);
          const x0 = cx - bw / 2;
          const yTop = y(d.y);
          // bar anchored to the baseline, rounded only at the data end (top)
          const path = h > 0 ? `M${x0},${y(0)} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x0 + bw - r} Q${x0 + bw},${yTop} ${x0 + bw},${yTop + r} V${y(0)} Z` : "";
          return (
            <g key={d.x} className="group">
              <title>{`${d.x}: ${d.y} ${valueLabel}`}</title>
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={plotH} fill="transparent" />
              {path && <path d={path} fill="var(--accent)" className="opacity-85 group-hover:opacity-100" />}
              {(i % 2 === 0 || data.length <= 8) && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  {d.x}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Show as table</summary>
        <table className="mt-2 text-sm">
          <tbody>
            {data.map((d) => (
              <tr key={d.x}>
                <td className="pr-6 text-muted">{d.x}</td>
                <td className="tabular-nums">{d.y}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
