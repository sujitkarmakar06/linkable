"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { acceptMatch, declineMatch } from "@/server/matching";
import { DealError } from "@/server/deals";
import { requireMembership } from "@/server/session";
import type { FormState } from "./types";

export async function acceptMatchAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireMembership("MEMBER");
  let dealId: string;
  try {
    dealId = await acceptMatch(String(form.get("matchId")), workspace.id, String(form.get("anchor") ?? ""), user.id);
  } catch (err) {
    if (err instanceof DealError) return { error: err.message };
    throw err;
  }
  redirect(`/app/deals/${dealId}`);
}

export async function declineMatchAction(form: FormData) {
  const { workspace } = await requireMembership("MEMBER");
  await declineMatch(String(form.get("matchId")), workspace.id);
  revalidatePath("/app/matches");
}
