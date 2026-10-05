// Creates the platform settings row and promotes configured admin emails.
// Safe to run repeatedly.
import { PrismaClient } from "@prisma/client";
import { DEFAULT_CREDIT_TIERS } from "../src/lib/credits";

const BANNED = ["casino", "gambling", "adult", "pharma", "cbd", "crypto", "loans"];
const ADMINS = (process.env.PLATFORM_ADMIN_EMAILS ?? "sujitk@solguruz.com").split(",").map((e) => e.trim().toLowerCase());

const db = new PrismaClient();

async function main() {
  await db.platformSettings.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global", bannedNiches: BANNED, creditTiers: DEFAULT_CREDIT_TIERS },
  });
  const { count } = await db.user.updateMany({ where: { email: { in: ADMINS } }, data: { platformRole: "ADMIN" } });
  console.log(`[seed] settings ready; ${count} admin account(s) promoted`);
}

main().finally(() => db.$disconnect());
