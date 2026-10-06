// Which preference controls a notification kind. "urgent" kinds always email
// instantly: they need action (a failing link, a dispute) or are about safety.

export type NotifyCategory = "urgent" | "deals" | "messages" | "sites";

const URGENT = [/^dispute\./, /^leg\.(failing|removed|overdue|not_found|index_reminder)$/, /^admin\./, /^workspace\./, /^gsc\./];

export function categoryOf(kind: string): NotifyCategory {
  if (URGENT.some((re) => re.test(kind))) return "urgent";
  if (kind.startsWith("message.")) return "messages";
  if (kind.startsWith("site.")) return "sites";
  return "deals";
}

export type EmailPrefs = { emailDeals: "INSTANT" | "DIGEST" | "OFF"; emailMessages: "INSTANT" | "DIGEST" | "OFF"; emailSites: "INSTANT" | "DIGEST" | "OFF" };

export function emailModeFor(kind: string, prefs: EmailPrefs): "INSTANT" | "DIGEST" | "OFF" {
  const c = categoryOf(kind);
  if (c === "urgent") return "INSTANT";
  return c === "messages" ? prefs.emailMessages : c === "sites" ? prefs.emailSites : prefs.emailDeals;
}
