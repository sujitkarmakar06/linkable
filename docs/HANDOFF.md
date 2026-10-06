# Linkable - handoff notes

Last updated: 2026-10-06, end of Phase 6 (all planned phases built). Read this first when resuming.

## Where things stand
| Branch | Contents | State |
|---|---|---|
| `main` | Phase 0: auth, workspaces, admin rules, full schema | pushed |
| `phase-1-sites` | + Phase 1: sites, 4 ownership-verification methods, metrics, quality rules, admin review | pushed |
| `phase-2-deals` | + Phase 2: marketplace, link requests, offers, ABC swaps, deals, messaging, credits | pushed |
| `phase-3-matching` | + Phase 3: automatic matching, footprint guard | pushed |
| `phase-4-trust` | + Phase 4: link crawler, escrow releases, penalties, disputes, reviews, reputation | pushed |
| `phase-5-content` | + Phase 5: guest-post workflow, AI anchors / placement finder / drafts, free plan 2 sites | pushed |
| `phase-6-launch` | + Phase 6: notifications/digest/reports, exports, analytics, security hardening, legal drafts, e2e in CI | pushed, **latest**; PR into `main` opened with the owner's approval |

Each branch is stacked on the previous one. The owner approved **one PR from `phase-6-launch` into
`main`** (contains every phase); the owner merges it. Nothing else is merged.

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

Owner decisions confirmed on 2026-10-06:
1. Escrow keeps holding back small deals (1 credit at 3 months; 2 credits = 1 now + 1 at 6 months).
2. Removal penalties may push the giver's balance negative (blocks spending, not earning).
3. Vercel Hobby for now: both crons (`/api/cron/matching`, `/api/cron/daily`) run daily.
4. Free plan raised to 2 sites (migration `*_content_ai` bumps existing settings rows).
5. Guest posts: 800+ words, 3 revision rounds; AI full drafts allowed but must be edited and are
   labelled; 20 AI suggestions + 3 drafts per workspace per month; AI never writes medical/financial/
   legal advice, competitor names, invented stats/quotes, or banned-niche content.

## Phase 5 - what was built
- `src/lib/guestpost.ts` (rules, word count, link checks, draft hashing), `src/lib/pagetext.ts`
  (page summaries, sitemap parsing), `src/lib/ai-prompts.ts` (system prompts + content rules),
  `src/server/ai.ts` (Claude API calls, quotas, usage log, fake mode), `src/server/actions/content.ts`
  (guest-post submit/review, AI actions), `src/components/guest-post.tsx`, `src/components/ai-widgets.tsx`.
- Model `claude-opus-5-5` with `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`);
  structured JSON output for anchors/placement (effort low), streamed text for drafts (effort medium).
- The real Claude API path has **not** been run (no key in the sandbox); flows were tested with
  `AI_FAKE=1`. First real calls should be watched for output quality and cost.

## Phase 6 - what was built (owner decisions 2026-10-06)
Instant + digest emails, inbox, monthly report; workspace + admin CSV exports; admin analytics;
Postgres rate limiting; legal drafts for lawyer review; e2e in repo + CI; one PR into main.
A security audit (subagent) found 3 high / 3 medium / 5 low issues - all fixed and covered by tests:
double escrow refund (refunds now derived from the ledger, `CreditEntry.legId`), check-then-act races
(lock first, conditional updates), IPv4-mapped IPv6 SSRF bypass (`src/lib/ip.ts`), raw HTML in guest
posts, sessions surviving password/2FA changes (`User.sessionVersion`; no browser-triggerable re-sync),
missing brute-force limits and TOTP replay (`LoginAttempt`, `User.lastTotpStep`), message planting,
proposal close race, missing headers, tokens in production logs, login timing.

## Next steps (ask the owner)
- Production deploy on Vercel + Neon (README checklist); Resend domain verification.
- Legal review of `/terms` and `/privacy`; then remove the draft banner (`src/components/legal.tsx`).
- First real Claude API and Ahrefs calls (Ahrefs only with explicit permission) and a cost check.
- Possible later work: paid plans (Stripe), notification bell dropdown, more admin moderation tools.

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
- 72 unit tests (`tests/`) and 10 Playwright end-to-end tests (`e2e/`, run with `npm run e2e`;
  locally set `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` in this sandbox). Both run in CI.
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
