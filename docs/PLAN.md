# Linkable - product plan

Agreed with the product owner on 2026-10-05.

## Decisions
| Area | Decision |
|---|---|
| Product | Public ABC link exchange marketplace, separate from LinkLedger |
| Users | Anyone can sign up; agencies/teams use workspaces (Owner/Admin/Member/Viewer) |
| Sign-in | Email + password (verified), Google, optional TOTP 2FA |
| Deal model | Both: credit-based automatic matching **and** manual ABC proposals |
| Money | Free for now (no payments in V1) |
| Ownership proof | DNS TXT, meta tag / HTML file, or Google Search Console - then admin approval |
| Metrics | Paid SEO API behind a provider interface; Ahrefs first, cached 30 days |
| Quality | Min DR 30, min 500 monthly organic visits, banned niches (casino, gambling, adult, pharma, CBD, crypto, loans), spam/PBN scoring, reputation and penalties |
| Content | Link insertions, guest posts, AI help (anchors, placement pages, drafts via Claude API) |
| Credit pricing | DR tiers: 30-39 = 1, 40-59 = 2, 60-79 = 4, 80+ = 8; traffic x0.75 (<1k) / x1.25 (50k+); nofollow x0.25; guest post +1 |
| Guarantee | 12 months, weekly checks; escrow released ~40% on verification, then 20% at 3, 6 and 12 months (cumulative rounding: a 1-credit link releases at 3 months, 2 credits = 1 now + 1 at 6 months) |
| Removal | 2 failed checks -> email both sides -> 7-day grace -> refund unreleased credits to requester, penalty to giver, reputation hit; repeat offenders suspended |
| Free plan | 1 site per workspace, 3 open link requests, 2 starter credits after first site approval |
| Notifications | Email (Resend) |
| Admin | Site/user moderation, disputes, platform analytics, editable rules |
| Admin account | sujitk@solguruz.com |
| Hosting | Vercel + Neon Postgres; Inngest for background jobs |
| Language | English only |
| Domain | None yet |

## Footprint guard (blocks or warns)
- Direct A<->B link, or the same two workspaces trading within 6 months
- Shared IP C-class or ASN between giver and receiver
- Same owner fingerprint (WHOIS / GSC owner)
- An existing link between the two domains
- Anchor over-use for the target URL
- Giver site over its monthly outbound cap

## Phases
| Phase | Scope | Status |
|---|---|---|
| 0 | Repo, CI, auth (email, Google, 2FA), workspaces and roles, admin rules, full schema | **Built** |
| 1 | Sites: add, 4 ownership-verification methods, Ahrefs adapter, quality rules, admin review queue, starter credits | **Built** |
| 2 | Credit ledger in use, link requests, manual ABC proposals, deals and legs, messaging | **Built** |
| 3 | Matching engine + footprint guard (Inngest jobs) | Next |
| 4 | Weekly link checker, escrow releases, penalties, disputes, reputation | |
| 5 | Guest-post workflow + AI features | |
| 6 | Email notification set, admin analytics, reports/CSV export, security hardening, launch | |

## Risks
- Google's spam policies treat large-scale link exchanges as link schemes. Non-reciprocal
  routing and quality controls reduce but don't remove the risk; the Terms of Service must say so.
- Displaying Ahrefs metrics to the public may need a specific Ahrefs API plan/licence. Confirm before launch.
- The Ahrefs adapter is written against the documented v3 endpoints but has not been run against the live API yet.
- With 1 site per free workspace, manual ABC swaps need a second site on one side; free users trade through credits (requests/offers), which is non-reciprocal by design.
- Until the Phase 4 crawler, links are confirmed by the receiving side; later escrow stages are scheduled but released by the Phase 4 job.
- Login rate limiting needs a shared store on serverless (e.g. Upstash Redis); planned for Phase 6.
