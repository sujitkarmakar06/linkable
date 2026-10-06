# Linkable

An ABC (three-way) link exchange marketplace. Site owners list sites that can
**give** links (C) and sites that should **receive** links (A). They earn
credits by placing links and spend credits to get them. Because value flows
through credits, nobody links straight back, so there's no reciprocal footprint.
Every placed link is checked weekly and guaranteed for 12 months.

See [`docs/PLAN.md`](docs/PLAN.md) for the full product plan and roadmap.

## Status: Phase 6 (launch readiness) built - all planned phases complete

Phase 6:
- Email preferences per person: deals, messages and site reviews each instant, daily digest or off;
  failing/removed links, overdue placements, disputes and security emails are always instant
- In-app notification inbox with unread badge; daily digest email; monthly report email per workspace
- CSV exports: workspace links, credit ledger and link-check history; admin users, workspaces, deals and
  disputes (spreadsheet-formula injection neutralised)
- Admin analytics: users, workspaces, live links and survival rate, deals per week, deals by status,
  credit economy (must net to zero), AI usage and estimated spend
- Security: Postgres-backed rate limits on login (per account and IP, also inside Auth.js), signup and
  password reset; constant-time login; TOTP replay protection; 2FA-attempt limits; password or 2FA
  changes end every existing session; security headers (CSP, frame-ancestors, HSTS, nosniff);
  escrow refunds made idempotent and every deal transition re-checked under row locks; IPv6-mapped
  addresses blocked in the outbound-fetch guard; guest posts reject raw HTML and non-http links;
  user text escaped in emails; no live email links logged in production
- Draft Terms of Service and Privacy Policy (marked for legal review), accepted at signup/onboarding
- Browser end-to-end suite in `e2e/` (Playwright) running in CI

Phase 5:
- Guest-post workflow for links agreed as guest posts: the side receiving the link writes the post
  (Markdown, at least 800 words, exactly one link with the agreed anchor to the agreed page); the host
  approves, requests changes (up to 3 rounds) or, after that, rejects (escrow refunded). Once approved
  the host gets copy-ready Markdown and HTML, has 7 days to publish, then marks it placed and the
  crawler verifies it as usual.
- AI (Claude API, `claude-opus-5-5`, with server-side refusal fallback):
  - anchor suggestions on new link requests (mix of branded / partial / natural, avoiding anchors the
    site already over-uses)
  - "find the best page" for insertion links, chosen from the host's sitemap (only real URLs kept)
  - full guest-post drafts that must be edited before submission; `[VERIFY: ...]` placeholders mark
    facts to check and block submission until replaced; AI-assisted posts are labelled for the host
  - content rules in every prompt: no medical/financial/legal advice, no competitor names, no invented
    stats or quotes, no banned-niche content; web pages are passed as untrusted data
  - monthly limits per workspace (20 suggestions, 3 drafts; editable in Admin); every call is logged
- Free plan now allows 2 sites, so free users can run a real ABC swap

Phase 4:
- Link crawler: checks a link as soon as it's marked placed, then every 7 days (daily while failing).
  It confirms the link exists, the anchor, dofollow vs nofollow/sponsored/ugc, noindex (meta or
  X-Robots-Tag) and a foreign canonical. Receivers can still confirm manually if the crawler is blocked.
- Lifecycle: 2 failed checks -> FAILING + email to both sides -> 7-day grace -> restored, or REMOVED:
  unreleased escrow refunded, a 2-credit penalty paid to the receiver (the giver's balance may go
  negative), -15 reputation; 3 removals in 12 months auto-suspends the workspace
- Scheduled escrow releases (3/6/12 months) paid by the daily job; held while a link fails or a deal is disputed
- Deals complete when the guarantee ends with every link live
- Overdue placements flagged once (both sides emailed, -5 reputation)
- Disputes: either side opens one (pauses checks and releases); admins dismiss, refund, or refund and penalise
- Reviews (1-5 stars) after a deal is live; ratings move reputation and show on partner pages
- Reputation events: +2 on-time placement, +3 completed deal, -5 overdue, -15 removal, -10 lost dispute, ±4 reviews
- Admin: Disputes page, "Run daily jobs now"

Phase 3:
- Automatic matching: each open request (with "Match automatically" on) is offered to the 3 best
  giver sites - one per workspace - ranked by niche fit, DR, traffic, reputation and spare monthly
  capacity. Offers last 72 hours; the first giver to accept gets the deal and the price moves to escrow.
  Declines and expiries hand the request to the next best site.
- Runs when a request is posted, when a giving site is approved, hourly via cron, and on demand from Admin.
- Footprint guard on every offer, swap, counter, accept and match:
  - blocks: same owner, same IP or IP range (shared CDN ranges ignored), a reverse link between the
    same two sites within the cooldown, a duplicate link, the giver's monthly outbound cap
  - warns: repeat deals between the same two workspaces, one anchor over 30% of a target's links
- Matches page for givers, matching status on requests, footprint notes on proposals and deals

Phase 2:
- Marketplace: browse approved sites from other workspaces (niche, DR, domain filters) and open link requests
- Link requests: ask for a link to one of your sites with anchors, niches, min DR and a credit budget
  (free plan: 3 open at a time)
- Offers: other workspaces offer a link from a matching site at the DR-tier price
- ABC swap proposals: their site links to yours, you link back from a different site; reciprocal
  A<->B swaps are refused. Counter-offers flip the turn; accepts re-check sites and balances
- Deals: givers mark links placed (page must be on their domain), receivers confirm them live,
  either side can cancel before placement; per-deal message threads
- Credits: escrow locked on accept, released in stages (about 40% on confirmation, then 3/6/12 months),
  refunded on cancel; full ledger history on the Credits page
- Email + in-app notifications for proposals, counters, accepts, placements, confirmations and messages

Phase 1:
- Add sites (domain normalised, niche from a fixed list, give/receive roles, monthly outbound cap)
- Free plan limit (1 site; rejected sites don't count) and banned-niche checks
- Ownership verification by DNS TXT record, homepage meta tag, uploaded HTML file, or Google Search Console
- One verified claim per domain across the platform (unverified claims can't squat a domain)
- After verification: IP / C-class footprint, metrics from the SEO provider (Ahrefs, cached 30 days),
  homepage spam/PBN signals, then the quality rules auto-reject or queue for admin review
- Admin review queue: approve, reject, suspend, enter metrics by hand, re-fetch metrics
- 2 starter credits on a workspace's first approved site (granted once, via the double-entry ledger)
- Email + in-app notification of every decision

Phase 0:
- Email + password signup with email verification, password reset
- Google sign-in (turns on when `AUTH_GOOGLE_ID/SECRET` are set)
- Optional TOTP two-factor auth with 8 single-use recovery codes
- Team workspaces with Owner / Admin / Member / Viewer roles, email invites, role changes, leave/remove
- Platform admin area (`PLATFORM_ADMIN_EMAILS`) with editable marketplace rules
- Full database schema for all phases (sites, link requests, deals and legs, guest posts,
  double-entry credit ledger, escrow releases, link checks, disputes, reviews, audit log)
- Credit pricing and escrow-release logic, with unit tests

Next: production deploy (see the checklist below) and legal review of the draft Terms/Privacy pages.

## Stack
Next.js 16 (App Router, server actions) · TypeScript · Tailwind CSS 4 · Prisma 6 + PostgreSQL ·
Auth.js v5 · Resend · Vitest. Hosting: Vercel + Neon. Background jobs run as cron-triggered route handlers (`/api/cron/*`, scheduled in `vercel.json`).

## Run locally
```bash
npm install
cp .env.example .env        # fill DATABASE_URL, DIRECT_URL, AUTH_SECRET, ENCRYPTION_KEY
npm run db:migrate          # creates tables
npm run db:seed             # platform settings + admin promotion
npm run dev                 # http://localhost:3000
```
Without `RESEND_API_KEY`, emails (verification, reset, invites) are printed to the
terminal with their link, so you can click through locally.

### Testing link checks locally
Outbound checks refuse private addresses. For local testing only (ignored when `NODE_ENV=production`),
`FETCH_HOST_OVERRIDES="partner.com=127.0.0.1:4555"` sends requests for that domain to a local server.
`AI_FAKE=1` (also ignored in production) returns canned AI responses so flows can be tested without
an API key or cost.

## Checks
```bash
npm run lint && npm run typecheck && npm test && npm run build
```

### End-to-end tests
Playwright drives the real app (`next dev`) against a throwaway database. Every test wipes it, so the
database name must contain `e2e` or `test`:
```bash
createdb linkable_e2e && DATABASE_URL=postgresql://.../linkable_e2e npx prisma migrate deploy
npx playwright install chromium        # once
E2E_DATABASE_URL=postgresql://.../linkable_e2e npm run e2e
```
The suite uses dev-only hooks (fake AI, local partner sites, an email outbox file); they are ignored in
production. CI (`.github/workflows/ci.yml`) runs the checks and the e2e suite on every push and PR.

## Production checklist
- [ ] Neon database created; `DATABASE_URL` (pooled) and `DIRECT_URL` (direct) set
- [ ] `AUTH_SECRET`, `ENCRYPTION_KEY` (never change after launch), `APP_URL`, `CRON_SECRET`, `PLATFORM_ADMIN_EMAILS`
- [ ] `RESEND_API_KEY` + `EMAIL_FROM` on a verified domain - **required in production** (signup and reset fail without it)
- [ ] Google OAuth client with both redirect URIs; Search Console API enabled
- [ ] `ANTHROPIC_API_KEY` (optional), `AHREFS_API_KEY` (optional; confirm the Ahrefs licence allows showing metrics)
- [ ] Build command `prisma migrate deploy && npm run build`
- [ ] Terms of Service and Privacy Policy reviewed by a lawyer and the draft banner removed
- [ ] Custom domain, then update `APP_URL` and the OAuth redirect URIs

## Deploy (Vercel + Neon)
1. Create a Neon project. Copy the **pooled** URL to `DATABASE_URL` and the **direct** URL to `DIRECT_URL`.
2. Import the repo in Vercel. Add every variable from `.env.example` (production values).
   Set `APP_URL` to the Vercel/custom domain.
3. Build command: `prisma migrate deploy && npm run build` (runs migrations on each deploy).
4. After the first deploy, run `npm run db:seed` once against production (or just sign up with
   an admin email; admins are promoted on signup).
5. Google: in Google Cloud Console add both redirect URIs
   `https://<your-domain>/api/auth/callback/google` (sign-in) and
   `https://<your-domain>/api/gsc/callback` (Search Console verification), and enable the
   "Google Search Console API" for the project.
6. Resend: verify your sending domain and set `EMAIL_FROM` to an address on it.
7. Cron: set `CRON_SECRET` (any long random string). Vercel sends it to `/api/cron/matching`
   and `/api/cron/daily`. `vercel.json` schedules both once a day so it deploys on the Hobby plan;
   on Pro, change matching to hourly (`0 * * * *`). Matching also runs instantly on new requests
   and approvals, and Admin has "Run matching now" / "Run daily jobs now".
8. AI: set `ANTHROPIC_API_KEY` (optional `ANTHROPIC_MODEL`, default `claude-opus-5-5`). Without it
   the AI buttons are hidden and everything else works.
9. Ahrefs: set `AHREFS_API_KEY`. Without it, admins enter DR and traffic by hand during review.
   The adapter targets the v3 Site Explorer `domain-rating` and `metrics` endpoints; do one
   test lookup after adding the key to confirm the response shape.

## Project layout
```
prisma/schema.prisma        full data model
src/auth.ts                 Auth.js config (credentials + Google, 2FA enforcement)
src/lib/                    pure logic: credits, ledger, crypto, totp, roles, settings, email
src/server/session.ts       requireUser / requireMembership / requireAdmin
src/server/actions/         server actions (auth, security, workspace, admin)
src/app/                    routes: (auth) pages, /onboarding, /app, /admin, /invite/[token]
tests/                      unit tests
```
