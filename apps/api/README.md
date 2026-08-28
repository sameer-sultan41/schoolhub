# schoolhub-api

Backend API for **SchoolHub** — an AI-powered, multi-tenant School Management SaaS.
One deployment serves many schools; each school (a *tenant*) is isolated by
PostgreSQL Row-Level Security.

**Specification:** [`../../docs/`](../../docs/) — the docs there
define what to build. This repo implements it.

## Stack

Python 3.14 · Django 6.1 · Django REST Framework 3.18 · PostgreSQL 18 · Redis 8 ·
Celery 5.6 · JWT auth · OpenAPI via drf-spectacular.

## Getting Started

```bash
cp .env.example .env          # then fill in DJANGO_SECRET_KEY
docker compose up -d          # from the schoolhub-infra repo: postgres, pgbouncer, redis
pip install -e ".[dev]"
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

- API: http://localhost:8000/api/v1/
- Interactive docs: http://localhost:8000/api/docs/
- Health: `/healthz` (liveness), `/readyz` (readiness)

## Architecture in One Page

**Tenant isolation** is enforced in the database. Every tenant-owned table carries
`tenant_id` and an RLS policy reading the `app.tenant_id` setting, which
`TenantMiddleware` binds per transaction with `SET LOCAL`. The application role has
neither `BYPASSRLS` nor table ownership, so the policy genuinely binds. On top of
that, `TenantOwnedModel`'s default manager filters by the active tenant and fails
closed when none is set; `all_tenants` is the explicit, greppable escape hatch for
platform code.

**Authorization** is role-based with static permission keys (`module.resource.action`)
declared in code and seeded to the database. Views declare `required_permission`
rather than checking inline, so the requirement is introspectable — published in the
OpenAPI schema and asserted by contract tests. Record-level scopes (`own`,
`assigned`, `campus`, `all`) narrow within a tenant.

**Every mutation is audited** to an append-only table that the application role cannot
update or delete.

```
config/            settings, routes, celery
core/tenancy/      Tenant, TenantOwnedModel, RLS helpers, request context + middleware
core/rbac/         User, Role, Permission, UserRole, permission registry, DRF permissions
core/audit/        append-only audit log
core/api/          envelope renderer, error handler, pagination, throttling, base viewsets
apps/<module>/     one app per module in the specification's docs/03-modules/
tests/             cross-cutting contract suites (RLS coverage, permission registry)
```

## Conventions

Full detail in [`docs/ENGINEERING_STANDARDS.md`](docs/ENGINEERING_STANDARDS.md) and
[`AGENTS.md`](AGENTS.md).

- Routes: `/api/v1/<plural-kebab-case>`, domain verbs as colon-actions
  (`POST /api/v1/academic-sessions/{id}:activate`).
- Responses: `{"data": ..., "meta": {...}}`. Errors:
  `{"error": {"code", "message", "details", "request_id"}}`.
- Cross-tenant access returns **404**, never 403.
- Soft delete via `deleted_at`; hard deletion is a retention operation.
- Business logic lives in `services.py`, not in views or serializers.

## Testing

Tests run against real PostgreSQL — never SQLite — because RLS cannot be exercised on
another backend. Two suites protect the invariants and enroll new code automatically:

- `tests/test_rls_coverage.py` — fails if any tenant-owned table ships without a
  forced RLS policy.
- `tests/test_endpoint_contracts.py` — fails if any endpoint omits a permission key,
  references an unregistered key, or skips the permission class.

CI runs lint, typecheck, migration-drift check, tests with coverage, and Django's
deployment checks. **CI is the source of truth for pass/fail.**

## Adding a Module

1. Read the module doc in the spec repo (`docs/03-modules/<module>.md`) and its
   entity doc (`docs/05-database/entities/<domain>.md`).
2. Create `apps/<module>/` following `apps/school_organization/` as the reference.
3. Models inherit `TenantOwnedModel`; the first migration calls
   `core.tenancy.rls.rls_operations("<table>", ...)`.
4. Register permission keys in `permissions.py`, the app in `MODULE_APPS`, and routes
   in `config/api_v1.py`.
