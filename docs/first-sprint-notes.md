# First Sprint — Build Notes

Source: Feature Build Order, Section 8 "First Sprint Blueprint (2 Weeks)",
and System Architecture & Technical Design Document, Sections 2–9.

## Sprint scope (as specified)

1. Repository, CI/CD, dev environment
2. PostgreSQL + PostGIS + migrations (implemented against a real Postgres + PostGIS instance, see docs/postgres-setup.md)
3. Authentication
4. RBAC skeleton
5. Admin UI — user and role management
6. One M&E form
7. Audit log for form submissions
8. Deployed to staging

## What "deployed to staging" means here

Since there is no cloud account or CI/CD pipeline connected to this session,
"staging" is a locally-run, network-reachable instance: `node src/server.js`
+ `node serve.js`, matching the "Client Devices → CDN/Load Balancer →
Application Layer → Data & Storage Layer" shape in the architecture
document's Figure 4, minus the CDN/load balancer and container
orchestration, which are Phase 4 items (infrastructure/terraform, k8s
manifests, per the Directory Structures document).

## Next steps to move from skeleton to Phase 2 ("Core Modules")

- Stand up a real PostgreSQL + PostGIS instance; port `db.js`'s schema
  1:1 and add spatial columns to `beneficiaries`/a new `sites` table.
- Add `apps/mobile` (React Native) and `packages/sync-engine` for
  offline-first field capture, per Section 2.1 of the architecture doc.
- Replace the hand-rolled token/RBAC layer with a proper JWT + refresh
  token store, keeping the same permission model (module × level).
- Rebuild `apps/web` in React/Next.js against the same `/api/*` contracts
  exercised by `apps/web/app.js` in this skeleton.
- Add the remaining six core modules (Programme & Project Mgmt, Community
  Portal, Blue Economy & Climate, Carbon & Environmental Data, AI & Data
  Intelligence, plus the public Foundation Website) as new route groups
  and `me_forms`-style entities, following the same create → validate →
  store → audit pattern already working for the Household Baseline Survey.
