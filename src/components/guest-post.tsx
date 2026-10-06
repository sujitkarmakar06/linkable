"use client";

import { useActionState, useState, useTransition } from "react";
import { draftGuestPostAction, reviewGuestPostAction, submitGuestPostAction } from "@/server/actions/content";
import { SubmitButton } from "./action-form";
import { Alert, Button, Field, Input, Select } from "./ui";

const wordCount = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export function GuestPostEditor(props: {
  legId: string;
  anchor: string;
  targetUrl: string;
  minWords: number;
  aiEnabled: boolean;
  aiDraftsLeft: number;
  initial?: { title: string; body: string; hostNote: string | null; revision: number } | null;
}) {
  const [state, action] = useActionState(submitGuestPostAction, undefined);
  const [title, setTitle] = useState(props.initial?.title ?? "");
  const [body, setBody] = useState(props.initial?.body ?? "");
  const [topic, setTopic] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState(false);
  const [drafting, start] = useTransition();
  const words = wordCount(body);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="legId" value={props.legId} />
      {props.initial?.hostNote && (
        <Alert tone="error">
          Changes requested (revision {props.initial.revision}): {props.initial.hostNote}
        </Alert>
      )}
      <p className="text-sm text-muted">
        At least {props.minWords} words, in Markdown. Include exactly one link to your site:{" "}
        <code className="break-all">
          [{props.anchor}]({props.targetUrl})
        </code>
      </p>
      {props.aiEnabled && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label="Topic idea (optional)">
                <Input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} placeholder="e.g. How small teams set prices" />
              </Field>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={drafting || props.aiDraftsLeft <= 0}
              onClick={() =>
                start(async () => {
                  setAiError(null);
                  const res = await draftGuestPostAction(props.legId, topic);
                  if (!res.ok) return setAiError(res.error);
                  setTitle(res.data.title);
                  setBody(res.data.body);
                  setAiNote(true);
                })
              }
            >
              {drafting ? "Writing a draft (up to a minute)..." : "Write a draft with AI"}
            </Button>
          </div>
          <p className="text-xs text-muted">{props.aiDraftsLeft} AI drafts left this month. AI-assisted posts are labelled for the host.</p>
          {aiError && <Alert tone="error">{aiError}</Alert>}
          {aiNote && (
            <Alert tone="success">
              Draft added below. You must review and edit it before submitting, and replace every [VERIFY: ...] note with a real source.
            </Alert>
          )}
        </div>
      )}
      <Field label="Title">
        <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required />
      </Field>
      <Field label={`Article (Markdown) - ${words} words`}>
        <textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={18} required className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm" />
      </Field>
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      {state?.ok && <Alert tone="success">{state.ok}</Alert>}
      <div>
        <SubmitButton>Submit for review</SubmitButton>
      </div>
    </form>
  );
}

export function GuestPostReview({ legId, canReject, canRequestChanges }: { legId: string; canReject: boolean; canRequestChanges: boolean }) {
  const [state, action] = useActionState(reviewGuestPostAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="legId" value={legId} />
      <Field label="Decision">
        <Select name="decision" defaultValue="approve">
          <option value="approve">Approve - I&apos;ll publish it</option>
          {canRequestChanges && <option value="changes">Request changes</option>}
          {canReject && <option value="reject">Reject (refunds the writer)</option>}
        </Select>
      </Field>
      <textarea name="note" rows={3} maxLength={4000} placeholder="Note to the writer (required for changes or rejection)" aria-label="Note" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      {state?.ok && <Alert tone="success">{state.ok}</Alert>}
      <div>
        <SubmitButton>Send decision</SubmitButton>
      </div>
    </form>
  );
}
