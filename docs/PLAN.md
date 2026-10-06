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
| Free plan | 2 sites per workspace (raised from 1 on 2026-10-06), 3 open link requests, 2 starter credits after first site approval |
| Notifications | Email (Resend) |
| Admin | Site/user moderation, disputes, platform analytics, editable rules |
| Admin account | sujitk@solguruz.com |
| Guest posts | 800+ words, one link with the agreed anchor, 3 revision rounds before the host may reject; host publishes within 7 days of approval |
| AI | Full drafts allowed but must be edited; AI-assisted posts labelled; 20 suggestions + 3 drafts per workspace per month; never medical/financial/legal advice, competitor names, invented stats/quotes, or banned niches |
| Escrow (confirmed 2026-10-06) | Small deals stay held back (1 credit at 3 months; 2 = 1 now + 1 at 6 months) |
| Penalties (confirmed 2026-10-06) | May push a giver's balance negative (blocks spending, not earning) |
| Vercel plan (2026-10-06) | Hobby for now: both cron jobs daily |
| Emails (2026-10-06) | Instant by default; per-category daily digest or off; urgent and security always instant; monthly report on by default |
| Reports (2026-10-06) | Workspace CSV exports, admin analytics dashboard, monthly email report, admin CSV exports |
| Rate limiting (2026-10-06) | Postgres-based (no new vendor) |
| Legal (2026-10-06) | Draft Terms/Privacy written for lawyer review |
| Merge (2026-10-06) | One PR from the Phase 6 branch into main |
| Hosting | Vercel + Neon Postgres; background jobs as Vercel Cron -> route handlers (no extra vendor; can move to Inngest if jobs outgrow cron) |
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
| 3 | Matching engine + footprint guard (cron-triggered jobs) | **Built** |
| 4 | Weekly link checker, escrow releases, penalties, disputes, reputation | **Built** |
| 5 | Guest-post workflow + AI features | **Built** |
| 6 | Email preferences + digest + monthly report, inbox, CSV exports, admin analytics, rate limiting, security hardening, legal drafts, e2e in CI | **Built** |
| 7 | Proof: link impact tracking (Search Console clicks/impressions/position at 30/60/90 days), indexing check gating escrow | **Built** |
| 8 | Safety: link profile planner (anchor mix, link velocity warnings), AI relevance score in matching | Planned |
| 9 | Placement: WordPress plugin (verify + approved insertion + report back), opt-in broken-link swaps | Planned |
| 10 | Growth: expert quote requests, invite non-member sites, branded agency client reports | Planned |

## Phase 7-10 decisions (owner, 2026-10-06)
- **Indexing gate:** escrow pays out only once Google has indexed the linking page; if not indexed within
  30 days, credits return to the receiver. Hosts must connect Search Console (stored, encrypted refresh token).
- **Impact tracking:** receiver's Search Console data for the target page, before vs 30/60/90 days after the link went live. No Ahrefs.
- **WordPress plugin:** host clicks Approve in Linkable, plugin inserts the link into the agreed post and reports back;
  also one-click ownership verification. Distributed as a zip download first; WordPress.org submission later.
- **Broken-link swaps:** opt-in per site; replacements priced like normal links.
- **Expert quotes:** free, no credits; capped per workspace per month.
- **Invites:** inviter gets 1 bonus credit once the invited site passes verification and admin approval; max 5 bonuses a month.
- **Client reports:** branded monthly PDF per client site (agency logo + colour, no Linkable branding) plus a private read-only share link.
- **Pricing:** everything free for now; features that could become paid later (plugin auto-placement, client reports) are flagged in code.
- Ahrefs is still never called without the owner's explicit permission each time.

## Risks
- Google's spam policies treat large-scale link exchanges as link schemes. Non-reciprocal
  routing and quality controls reduce but don't remove the risk; the Terms of Service must say so.
- Displaying Ahrefs metrics to the public may need a specific Ahrefs API plan/licence. Confirm before launch.
- The Ahrefs adapter is written against the documented v3 endpoints but has not been run against the live API yet.
- With 1 site per free workspace, manual ABC swaps need a second site on one side; free users trade through credits (requests/offers), which is non-reciprocal by design.
- Removal penalties go to the receiver as compensation and may push the giver below zero; a negative balance blocks spending until earned back.
- The crawler identifies as LinkableBot; sites with aggressive bot protection may need manual confirmation.
- Terms of Service and Privacy Policy are drafts and need legal review before launch.
