# SchoolHub

An AI-powered, multi-tenant School Management SaaS. One platform serves many
schools — each with its own users, branding, configuration, workflows and public
website — on a shared application isolated by PostgreSQL Row-Level Security.

## Repository

| Path | What it is |
| ---- | ---------- |
| [`docs/`](docs/) | The specification: 19 module docs, architecture, ERD and entity specs, phases, AI catalog, security |
| [`apps/api/`](apps/api/) | Django 6 + DRF backend — tenancy, RBAC, audit, module apps |
| [`apps/dashboard/`](apps/dashboard/) | Next.js 16 admin dashboard |
| [`apps/website/`](apps/website/) | Next.js 16 renderer serving every school's public site |
| [`packages/`](packages/) | Shared TypeScript: `ui`, `types`, `api-client`, `config` |
| [`infra/`](infra/) | Local Docker stack, PostgreSQL role bootstrap, Terraform, runbooks |

The specification is the requirement; everything under `apps/` implements it.
Start at [`AGENTS.md`](AGENTS.md), then [`docs/context/context-map.md`](docs/context/context-map.md).

## Why one repository

These began as four. With a single maintainer and nothing deployed, the split
bought no independent deployability while charging coordination cost on every
change that crossed a boundary — and it let the API contract drift silently
between the backend and its TypeScript client, because nothing tested both sides
together. A change spanning backend and frontend is now one pull request and one
CI run.

CI is path-filtered, so a backend-only change does not rebuild the frontends.
If a second team or a genuinely independent release cadence appears, splitting
back out is far cheaper than the coordination tax was.

## Getting started

**Prerequisites.** Python 3.14 (the backend pins `>=3.14,<3.15`), Node 24 or newer,
pnpm 9.15, and Docker. `.nvmrc` and `packageManager` record the exact versions.

**1. Start the backing services first.** Migrations need a database, so this comes
before anything else.

```bash
cp infra/compose/.env.example infra/compose/.env   # fill in the DB passwords
docker compose -f infra/compose/docker-compose.yml up -d postgres pgbouncer redis
```

The application role is created without `BYPASSRLS` and owns nothing, which is what
makes Row-Level Security actually bind — see `infra/postgres/init/02-app-role.sql`.

**2. Backend.** Install into a virtual environment; never into the system Python.

```bash
cd apps/api
python3.14 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env                    # then set DJANGO_SECRET_KEY
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

**3. Frontends.** From the repository root — the pnpm workspace covers both apps and
every shared package.

```bash
pnpm install
pnpm dev
```

Next.js [recommends running the dev server natively rather than in Docker on
macOS](https://nextjs.org/docs/app/getting-started/deploying#docker) for
performance, which is why the compose stack above starts only the backing services.
The `dashboard`, `website` and `api` services exist in that file for
production-shaped builds.

| Service | URL |
| ------- | --- |
| API | http://localhost:8000/api/v1/ (docs at `/api/docs/`, health at `/healthz`) |
| Dashboard | http://localhost:3000 |
| Website renderer | http://localhost:3001 |
| Mailpit (captured email) | http://localhost:8025 |
| MinIO console | http://localhost:9001 |

PostgreSQL listens on 5432 and PgBouncer on 6432; the application connects through
PgBouncer, which is why tenant context is set with `SET LOCAL` inside a transaction.

**Changing the API contract.** The TypeScript client is generated, not written:

```bash
apps/api/scripts/generate-openapi.sh                 # refresh apps/api/openapi.yaml
pnpm --filter @schoolhub/api-client generate         # refresh the typed schema
```

CI fails if either is stale, so both regenerate in the same commit as the change.

**Documentation lookups.** `.mcp.json` registers [Context7](https://context7.com) so
assistants read version-matched library docs instead of working from recall. Export
`CONTEXT7_API_KEY` in your shell; it is interpolated at load time and never
committed.

## Stack

Python 3.14 · Django 6.1 · DRF 3.18 · PostgreSQL 18 (RLS) · Redis 8 · Celery 5.6 ·
Next.js 16 · React 19 · Tailwind 4 · Turborepo · Jest.

Versions the implementation pinned — including three that could not be the newest
release — are recorded in [`docs/02-architecture/tech-stack.md`](docs/02-architecture/tech-stack.md).

## Testing

Tests run in CI, which is the source of truth for pass/fail. The backend runs
against real PostgreSQL because Row-Level Security cannot be exercised on another
backend, and two suites enrol new code automatically: one fails the build if any
tenant-owned table ships without an RLS policy, the other if any endpoint omits or
misspells a permission key.
