# Kabonix Foundation Digital Platform — First Sprint Walking Skeleton

The two-week "First Sprint Blueprint" from the Foundation's Feature Build
Order (Section 8), now running on **PostgreSQL + PostGIS** as specified in
Section 5.2 of the architecture document.

## What's implemented (Sprint 01)

| Step | Description | Where |
|---|---|---|
| 1 | Repository structure | this repo |
| 2 | Core database schema, on Postgres + PostGIS | `apps/api/src/db.js` |
| 3 | Authentication (login, password hashing, signed session tokens) | `apps/api/src/auth.js` |
| 4 | RBAC skeleton (roles → permissions → server-side middleware) | `apps/api/src/rbac.js` |
| 5 | Admin UI — user list, role assignment, deactivate | `apps/web/app.js` (Staff & Roles page) |
| 6 | One M&E form — create → submit → list → view, with GPS stored as a real PostGIS point | `apps/web/app.js`, form defined in `db.js` |
| 7 | Audit log for every write, plus logins | `apps/api/src/audit.js`, Audit Log page |
| 8 | Deployed to staging | run locally per below; same two processes deploy to any Node host with network access to Postgres |

Seven roles are seeded exactly as defined in Section 8 of the architecture
document, with a starting permission set across the eight core modules
from Section 3. Beneficiary GPS coordinates are stored as a
`GEOGRAPHY(POINT, 4326)` column with a GiST index — real PostGIS, not just
two numeric columns — so it's ready for radius/boundary queries later.

## Prerequisites

- Node.js 18+ 
- A running PostgreSQL instance with the **PostGIS** extension available.
  See `docs/postgres-setup.md` for the exact commands used to set this up
  (native install on Debian/Kali-based Linux).

## Run it

```bash
cd apps/api
npm install                 # installs the `pg` package — needs network access
export DATABASE_URL=postgresql://kabonix:ChangeMe123!@localhost:5432/kabonix_db
node src/server.js
# → http://localhost:4000  (health check: /health)
```

In a second terminal:
```bash
cd apps/web
node serve.js
# → http://localhost:3000
```

On first run, the API creates the schema and seeds two accounts:

| Email | Role | Password |
|---|---|---|
| `admin@kabonix.org` | Super Admin | `ChangeMe123!` |
| `amina@kabonix.org` | Field Officer | `ChangeMe123!` |

Sign in as Amina to see RBAC in action: she can submit the M&E form but
"Staff & Roles" and "Audit Log" are hidden/forbidden, per her role's scope
in Section 8.

To reset all data: `DROP DATABASE kabonix_db;` then recreate it and its
PostGIS extension per `docs/postgres-setup.md`, and restart the API.

**Note on `DATABASE_URL` and shells like zsh:** the `!` in the default
password triggers history expansion if typed bare on a command line.
Either wrap the whole string in single quotes, or put it in a `.env` file
(see `.env.example`) and run with `node --env-file=.env src/server.js`
instead of `export`.

## What this is not (yet)

Still a walking skeleton, not the finished platform: no offline sync, no
mobile app, no USSD/SMS, no carbon/blue-economy modules, no AI assistant.
Those are Phases 2–4 (architecture doc, Section 10). `docs/first-sprint-notes.md`
lists concrete next steps for each.

```
kabonix-platform/
├── apps/
│   ├── api/             ← built: Sprint 01 API, PostgreSQL + PostGIS
│   │   └── src/
│   └── web/              ← built: Sprint 01 UI
├── docs/
│   ├── first-sprint-notes.md
│   └── postgres-setup.md
└── README.md
```

## Design decisions

- **PostgreSQL + PostGIS**, per Section 5.2 — GPS coordinates on
  beneficiaries are a real `geography(Point,4326)` column, not two loose
  numbers, so spatial queries (radius search, boundary checks for carbon
  plots) are a straight `ST_DWithin`/`ST_Contains` away in Phase 2.
- **Hand-rolled HMAC session tokens instead of JWT + refresh rotation** —
  same shape (signed payload with expiry); upgrade path is a drop-in
  library swap in `auth.js`.
- **Plain `node:http` instead of Express/NestJS** — same route contracts,
  so migrating the framework doesn't change the API surface the frontend
  depends on.
- **Vanilla JS instead of React/Next.js** on the frontend — same
  page/permission structure as the eventual admin dashboard, so the React
  rebuild is a port, not a redesign.
