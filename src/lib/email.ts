import { appendFileSync } from "node:fs";
import { Resend } from "resend";

const FROM = process.env.EMAIL_FROM ?? "Linkable <no-reply@linkable.local>";
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export const appUrl = (path = "") => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;

// Everything interpolated into email HTML is escaped: titles and bodies can
// contain workspace names, messages and other user-written text.
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type EmailItem = { title: string; body: string; url?: string };

function layout(title: string, body: string, cta?: { label: string; url: string }, items?: EmailItem[]) {
  const button = cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escapeHtml(cta.label)}</a></p><p style="color:#666;font-size:12px">Or paste this link: ${escapeHtml(cta.url)}</p>`
    : "";
  const list = items?.length
    ? `<ul style="padding-left:18px">${items
        .map((i) => `<li style="margin:0 0 12px"><strong>${i.url ? `<a href="${escapeHtml(i.url)}">${escapeHtml(i.title)}</a>` : escapeHtml(i.title)}</strong><br><span style="color:#444">${escapeHtml(i.body)}</span></li>`)
        .join("")}</ul>`
    : "";
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;color:#111"><h2>${escapeHtml(title)}</h2><p style="white-space:pre-line">${escapeHtml(body)}</p>${list}${button}<p style="color:#888;font-size:12px">Linkable - ABC link exchange. Change which emails you get in Account settings.</p></div>`;
}

export async function sendEmail(to: string, subject: string, title: string, body: string, cta?: { label: string; url: string }, items?: EmailItem[]) {
  const html = layout(title, body, cta, items);
  if (!resend) {
    // Never print live verification/reset/invite links in production logs.
    if (process.env.NODE_ENV === "production") throw new Error("Email isn't configured: set RESEND_API_KEY.");
    // No provider configured (local dev / tests): print so the link can be used.
    console.info(`[email] to=${to} subject="${subject}"${cta ? ` link=${cta.url}` : ""}`);
    if (process.env.EMAIL_OUTBOX_FILE) {
      appendFileSync(process.env.EMAIL_OUTBOX_FILE, JSON.stringify({ to, subject, link: cta?.url ?? null, items: items?.length ?? 0 }) + "\n");
    }
    return;
  }
  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) throw new Error(`Email send failed: ${error.message}`);
}
