import { Resend } from "resend";

const FROM = process.env.EMAIL_FROM ?? "Linkable <no-reply@linkable.local>";
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export const appUrl = (path = "") => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;

function layout(title: string, body: string, cta?: { label: string; url: string }) {
  const button = cta
    ? `<p style="margin:24px 0"><a href="${cta.url}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${cta.label}</a></p><p style="color:#666;font-size:12px">Or paste this link: ${cta.url}</p>`
    : "";
  return `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#111"><h2>${title}</h2><p>${body}</p>${button}<p style="color:#888;font-size:12px">Linkable - ABC link exchange</p></div>`;
}

export async function sendEmail(to: string, subject: string, title: string, body: string, cta?: { label: string; url: string }) {
  const html = layout(title, body, cta);
  if (!resend) {
    // No provider configured (local dev): print so the link can be used.
    console.info(`[email] to=${to} subject="${subject}"${cta ? ` link=${cta.url}` : ""}`);
    return;
  }
  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) throw new Error(`Email send failed: ${error.message}`);
}
