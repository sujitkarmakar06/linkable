import { Alert } from "./ui";

// Confirmation after an action whose form disappears once it succeeds
// (the page redirects with ?done=<key>).
const MESSAGES: Record<string, string> = {
  countered: "Counter-offer sent. It's their turn now.",
  confirmed: "Confirmed live. Thanks!",
  cancelled: "Deal cancelled. Any escrowed credits were returned.",
  declined: "Proposal declined.",
  withdrawn: "Proposal withdrawn.",
};

export function Flash({ done }: { done: string | string[] | undefined }) {
  const message = typeof done === "string" ? MESSAGES[done] : undefined;
  return message ? <Alert tone="success">{message}</Alert> : null;
}
