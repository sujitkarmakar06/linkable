"use client";

import { useState, useTransition } from "react";
import type { AnchorSuggestion, PlacementSuggestion } from "@/server/ai";
import { suggestAnchorsAction, suggestPlacementAction } from "@/server/actions/content";
import { Alert, Button } from "./ui";

// On the "new link request" form: reads the chosen site + URL from the form
// and appends picked anchors to the anchors textarea.
export function AnchorSuggester({ formId }: { formId: string }) {
  const [items, setItems] = useState<AnchorSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const field = (name: string) => document.querySelector<HTMLInputElement & HTMLTextAreaElement>(`#${formId} [name="${name}"]`);

  const run = () =>
    start(async () => {
      setError(null);
      const res = await suggestAnchorsAction(field("siteId")?.value ?? "", field("targetUrl")?.value ?? "");
      if (res.ok) setItems(res.data);
      else setError(res.error);
    });

  const add = (text: string) => {
    const box = field("anchors");
    if (!box) return;
    const lines = box.value.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.some((l) => l.toLowerCase() === text.toLowerCase()) && lines.length < 5) box.value = [...lines, text].join("\n");
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button type="button" variant="secondary" onClick={run} disabled={pending}>
          {pending ? "Thinking..." : "Suggest anchors with AI"}
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {items && (
        <ul className="flex flex-wrap gap-2">
          {items.map((a) => (
            <li key={a.text}>
              <button type="button" onClick={() => add(a.text)} title={a.reason} className="rounded-full border border-border px-3 py-1 text-sm hover:border-accent">
                + {a.text} <span className="text-xs text-muted">{a.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PlacementSuggester({ legId }: { legId: string }) {
  const [items, setItems] = useState<PlacementSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await suggestPlacementAction(legId);
              if (res.ok) setItems(res.data);
              else setError(res.error);
            })
          }
        >
          {pending ? "Reading your sitemap..." : "Find the best page for this link (AI)"}
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {items && items.length === 0 && <p className="text-sm text-muted">No good matches in your sitemap.</p>}
      {items && items.length > 0 && (
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          {items.map((p) => (
            <li key={p.url}>
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="break-all text-accent">
                {p.url}
              </a>
              <div className="text-muted">{p.reason}</div>
              <div className="mt-1 rounded border border-border bg-bg px-2 py-1">Suggested sentence: {p.sentence}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
