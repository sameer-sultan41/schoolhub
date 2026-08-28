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

```bash
# Backend
cd apps/api && cp .env.example .env      # then set DJANGO_SECRET_KEY
pip install -e ".[dev]" && python manage.py migrate && python manage.py runserver

# Frontends (pnpm workspace at the repository root)
pnpm install
pnpm dev

# Supporting services
docker compose -f infra/compose/docker-compose.yml up -d
```

- API: http://localhost:8000/api/v1/ · docs at `/api/docs/`
- Dashboard: http://localhost:3000 · Website renderer: http://localhost:3001

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
