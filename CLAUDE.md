@AGENTS.md

# Linkable

ABC (three-way) link exchange marketplace. **When resuming work, read
docs/HANDOFF.md first** (current state, owner's rules, next steps). See
docs/PLAN.md for the agreed product plan and phase roadmap, README.md for setup.

Owner's rules: don't commit/push/open PRs without permission; never call Ahrefs
without asking first, every time; ask questions before building features.

- Next.js 16 App Router (`proxy.ts` replaces middleware; `params`/`searchParams`/`cookies()` are async).
- Prisma 6 + Postgres. Schema changes: edit `prisma/schema.prisma`, then `npm run db:migrate -- --name <change>`.
- Mutations are server actions in `src/server/actions/*`. Every action re-checks auth with
  `requireUser` / `requireMembership(role)` / `requireAdmin` from `src/server/session.ts`.
- Credits only move through `transferCredits` in `src/lib/ledger.ts` (double-entry, append-only).
- Business rules (min DR, tiers, limits) come from `getSettings()`, never hard-coded.
- Before pushing: `npm run lint && npm run typecheck && npm test && npm run build`.
