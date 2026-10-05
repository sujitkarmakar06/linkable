# Linkable

An ABC (three-way) link exchange marketplace. Site owners list sites that can
**give** links (C) and sites that should **receive** links (A). They earn
credits by placing links and spend credits to get them. Because value flows
through credits, nobody links straight back, so there's no reciprocal footprint.
Every placed link is checked weekly and guaranteed for 12 months.

See [`docs/PLAN.md`](docs/PLAN.md) for the full product plan and roadmap.

## Status: Phase 1 (sites) built

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

Next: Phase 2, link requests, manual ABC proposals, deals and messaging.

## Stack
Next.js 16 (App Router, server actions) · TypeScript · Tailwind CSS 4 · Prisma 6 + PostgreSQL ·
Auth.js v5 · Resend · Vitest. Hosting: Vercel + Neon. Background jobs (link checks, matching) will use Inngest from Phase 3.

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

## Checks
```bash
npm run lint && npm run typecheck && npm test && npm run build
```
CI (`.github/workflows/ci.yml`) runs the same steps against a Postgres service.

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
7. Ahrefs: set `AHREFS_API_KEY`. Without it, admins enter DR and traffic by hand during review.
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
