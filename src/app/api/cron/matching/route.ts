import { NextResponse, type NextRequest } from "next/server";
import { runMatching } from "@/server/matching";

// Called by Vercel Cron (see vercel.json) with `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await runMatching();
  console.info("[cron] matching", result);
  return NextResponse.json(result);
}
