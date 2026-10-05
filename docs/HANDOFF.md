# Linkable - handoff notes

Last updated: 2026-10-05, end of Phase 4. Read this first when resuming.

## Where things stand
| Branch | Contents | State |
|---|---|---|
| `main` | Phase 0: auth, workspaces, admin rules, full schema | pushed |
| `phase-1-sites` | + Phase 1: sites, 4 ownership-verification methods, metrics, quality rules, admin review | pushed |
| `phase-2-deals` | + Phase 2: marketplace, link requests, offers, ABC swaps, deals, messaging, credits | pushed |
| `phase-3-matching` | + Phase 3: automatic matching, footprint guard | pushed |
| `phase-4-trust` | + Phase 4: link crawler, escrow releases, penalties, disputes, reviews, reputation | pushed, **latest** |

Each branch is stacked on the previous one. Nothing is merged into `main` and **no PRs exist** -
the owner hasn't asked for any. Start Phase 5 on a new branch `phase-5-content` from `phase-4-trust`.

Not deployed anywhere yet (no Vercel project, no domain).

## Owner's working rules (must follow)
- Don't commit, push or open a PR without the owner's permission. (Pushing each finished phase
  to its own branch has been approved; PRs and merges have not.)
- **Never call Ahrefs without asking first, every time** ("Should I touch Ahrefs?"). This also
  applies to the owner's team. The Ahrefs adapter (`src/lib/seo/ahrefs.ts`) has never been run
  against the live API - a first test lookup needs explicit permission.
- Ask questions before building features; the owner prefers to decide.
- Platform admin: sujitk@solguruz.com. English only. No domain yet.

## Decisions made
See `docs/PLAN.md` for the full table. Key numbers: min DR 30, min 500 visits/month, banned niches
(casino, gambling, adult, pharma, cbd, crypto, loans), free plan = 1 site + 3 open requests,
2 starter credits on first approved site, DR-tier pricing (30-39=1, 40-59=2, 60-79=4, 80+=8),
12-month guarantee, weekly checks, 7-day grace, 2-credit removal penalty, 6-month pair cooldown.

Choices Claude made that the owner should confirm:
1. Escrow uses cumulative rounding: 1 credit releases at 3 months; 2 credits = 1 now + 1 at 6 months.
   (Option: pay 1-credit links immediately.)
2. Removal penalties can push the giver's balance negative (blocks spending, not earning).
   (Option: cap at the current balance.)
3. Background jobs use Vercel Cron -> `/api/cron/matching` and `/api/cron/daily`, both daily so
   the Hobby plan can deploy. On Pro, make matching hourly. (Plan originally said Inngest.)
4. With 1 site per free workspace, manual ABC swaps need a second site on one side; free users
   trade via credits. Owner was asked whether to raise the free limit to 2 - **no answer yet**.

## Phase 5 - agreed scope (start here)
From the owner's answers: "Insertions + guest posts + AI help (Claude API)".
1. Guest-post workflow on `DealLeg` with `placementType = GUEST_POST` (model `GuestPost` already
   exists in the schema): receiver submits title + body -> host approves / requests changes
   (revision count) -> host publishes and marks the leg placed -> crawler verifies as usual.
   Leg statuses CONTENT_SUBMITTED / CONTENT_APPROVED already exist.
2. AI features via the Claude API (`ANTHROPIC_API_KEY`; load the `claude-api` skill before coding
   and use the latest model IDs):
   - anchor text suggestions for a target URL (varied, natural, avoids over-used anchors -
     reuse the footprint anchor stats)
   - best placement page on the host site (read its sitemap via `safeGet`, rank pages by relevance)
   - guest-post draft generation (marked `aiDrafted`), editable before submission
3. Questions to ask the owner before building Phase 5:
   - word-count / quality rules for guest posts? who can reject and how many revisions?
   - should AI drafts be allowed at all for guest posts, or only as outlines?
   - monthly AI usage limits per free workspace (cost control)?
   - any content the AI must never write (YMYL, competitor mentions)?
4. Phase 6 after that: notification preferences, admin analytics, reports/CSV export,
   login rate limiting (needs a shared store, e.g. Upstash), security hardening, launch.

## How to run locally
```bash
npm install
service postgresql start            # or any Postgres 16
# .env: DATABASE_URL, DIRECT_URL, AUTH_SECRET, ENCRYPTION_KEY, APP_URL (see .env.example)
npx prisma migrate deploy && npm run db:seed
npm run dev
```
Checks before every push: `npm run lint && npm run typecheck && npm test && npm run build`.
Schema changes: `prisma migrate dev` refuses to run non-interactively here, so generate SQL with
`prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma
--shadow-database-url <empty db> --script` into a new `prisma/migrations/<timestamp>_<name>/` folder,
then `prisma migrate deploy`. Set both `DATABASE_URL` and `DIRECT_URL` when targeting another DB.

## Testing notes
- 57 unit tests (`tests/`). Browser end-to-end scripts used Playwright with
  `/opt/pw-browsers/chromium` against a separate `linkable_e2e` database; they lived in the
  session scratchpad and are not in the repo (worth adding under `e2e/` in Phase 6).
- The sandbox blocks direct outbound HTTP, so live DNS/meta/file/GSC verification and real crawls
  were never run; local page serving uses `FETCH_HOST_OVERRIDES` (ignored in production).

## Env vars still needed for a real deployment
DATABASE_URL, DIRECT_URL (Neon), AUTH_SECRET, ENCRYPTION_KEY, APP_URL, PLATFORM_ADMIN_EMAILS,
CRON_SECRET, RESEND_API_KEY + EMAIL_FROM, AUTH_GOOGLE_ID/SECRET (sign-in + Search Console;
redirect URIs `/api/auth/callback/google` and `/api/gsc/callback`), AHREFS_API_KEY,
and for Phase 5 ANTHROPIC_API_KEY.

## Known risks (tell the owner again before launch)
- Google treats large-scale link exchanges as link schemes; the Terms of Service must say so.
- Showing Ahrefs metrics publicly may need a specific Ahrefs licence.
