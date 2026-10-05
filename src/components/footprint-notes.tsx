import type { FootprintResult } from "@/lib/footprint";
import { Card } from "./ui";

export function FootprintNotes({ result, title = "Footprint check" }: { result: FootprintResult; title?: string }) {
  if (!result.blocks.length && !result.warnings.length) return null;
  return (
    <Card title={title}>
      <ul className="flex flex-col gap-1 text-sm">
        {result.blocks.map((b) => (
          <li key={b} className="text-danger">
            Blocked: {b}
          </li>
        ))}
        {result.warnings.map((w) => (
          <li key={w} className="text-muted">
            Warning: {w}
          </li>
        ))}
      </ul>
    </Card>
  );
}
