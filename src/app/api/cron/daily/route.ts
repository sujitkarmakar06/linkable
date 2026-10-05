import { NextResponse, type NextRequest } from "next/server";
import { runDaily } from "@/server/jobs";

// Long enough for a batch of link checks.
export const maxDuration = 300;

// Vercel Cron (see vercel.json): overdue placements, link checks, escrow releases, completions.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await runDaily();
  console.info("[cron] daily", result);
  return NextResponse.json(result);
}
