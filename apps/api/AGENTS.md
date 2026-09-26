# AGENTS.md — apps/api (backend)

Instructions for AI assistants working in this repository: the Django 6 + DRF backend
of **SchoolHub**, an AI-powered multi-tenant School Management SaaS.

## Read Before Coding

1. **The specification** — [`../../docs/`](../../docs/). Start at the repository root
   [`AGENTS.md`](../../AGENTS.md), then [`docs/context/context-map.md`](../../docs/context/context-map.md),
   which names the 3–6 documents worth loading for your task type. Do not load the whole spec.
2. **[`docs/ENGINEERING_STANDARDS.md`](docs/ENGINEERING_STANDARDS.md)** — this repo's
   style rules, security non-negotiables, and the authoritative external docs to consult.
   Read the official framework docs rather than relying on recall; versions here are current.
3. For module work in `apps/<module>/`, the matching `../../docs/03-modules/<module>.md` in the
   spec repo **is the requirement**: features, workflows, validations, permission keys (§4),
   endpoints (§16). Its entity doc defines the schema.

## Layout

```
config/            settings (base/dev/prod/test), root urls, api_v1 route table, celery
core/tenancy/      Tenant model, TenantOwnedModel base, RLS helpers, context, middleware
core/rbac/         User, Role, Permission, UserRole, permission registry, DRF permission classes
core/audit/        append-only audit log + recording services
core/api/          response envelope, error handler, pagination, throttling, base viewsets
core/files/        presigned uploads, signed download/display URLs, storage abstraction
core/documents/    escape-by-default HTML helpers + the WeasyPrint PDF renderer
core/exports/      exports (CSV, XLSX, PDF) behind the 202 + job lane
core/jobs/         the job resource for long-running operations (202 + polling)
core/idempotency/  Idempotency-Key replay for mutating colon-actions (money, enrol, transfers, …)
core/money/        money primitives shared by finance code
core/notifications/ notify(), templates, delivery lanes (Tier-4 apps hook in via AppConfig.ready)
core/common/       empty placeholder (nothing lives here yet)
apps/<module>/     one app per module doc. Layout: models.py + permissions.py at the app root,
                   one package per resource (serializers/viewset/urls/filters/services + tests) —
                   ADR-0010 (docs/decisions/0010-backend-module-layout.md). attendance,
                   examinations and fees_finance are still flat; student_management is
                   half-migrated. Cross-app rules: ADR-0013.
tests/             cross-cutting suites (RLS coverage, endpoint contracts, API contract)
```

## Skills To Load First

Load the matching skill before touching this code — installed on this machine,
outranking generic advice on framework questions per the precedence in the root
AGENTS.md:

| Working on | Load |
| ---------- | ---- |
| Auth, permissions, input handling, deployment settings | `django-security` |
| Background jobs, beat schedules, retries, task testing | `django-celery` |
| Query design, indexing, migrations | `postgresql-optimization` |
| A production Dockerfile | `multi-stage-dockerfile` |

## Hard Rules

1. **Tenancy.** Tenant-owned models inherit `TenantOwnedModel`. Never bypass the default
   manager; `all_tenants` is platform-scope only and every use is a security decision.
   New tenant-owned tables attach an RLS policy in the same or the next migration via
   `core.tenancy.rls.rls_operations(...)` — `tests/test_rls_coverage.py` fails the build otherwise.
2. **Tenant context is transaction-scoped.** Bind with `SET LOCAL` through
   `core.tenancy.context`. A session-level `SET` leaks across pooled connections — never do it.
3. **RBAC.** Every endpoint declares `required_permission` (or `required_permission_map`).
   The permission class fails closed when one is missing. Keys are `module.resource.action`,
   registered in the module's `permissions.py`; they come from the module doc's §4 table.
4. **Cross-tenant access returns 404**, never 403.
5. **Money is append-only.** Ledger entries are never updated or deleted; corrections are
   new entries. Money endpoints honor `Idempotency-Key`.
6. **AI calls go through the gateway** in `core/ai` (planned — it does not exist yet; build it
   before the first AI feature) — never import a provider SDK in an app.
   AI output that reaches a person is stored as a draft pending human approval.
7. **Every module PR ships:** migrations + seeds, RBAC permission rows, tests including a
   cross-tenant access test per new endpoint, OpenAPI annotations, and feature-flag wiring.
8. **Do not run tests, linters, or typechecks locally.** Commit, push, and let CI report —
   CI is the source of truth. Fix against CI, never `--no-verify`.
9. **Never add a `Co-Authored-By` trailer or any AI attribution** to a commit or PR.

## Versions

Python 3.14 · Django 6.1 · DRF 3.18 · PostgreSQL 18 · Redis 8 · Celery 5.6.
When adding a dependency, check the registry for the current release rather than
assuming a version from memory.

The backend is managed by [uv](https://docs.astral.sh/uv/) — its own `pyproject.toml` plus the
committed `uv.lock`; use `uv sync` / `uv run`, not pip or an activated venv. uv itself is pinned
to `0.11.x` in three places that must move together: `pyproject.toml`'s `[tool.uv]
required-version`, `Dockerfile`'s `ghcr.io/astral-sh/uv:0.11.9` base, and
`.github/actions/setup-api-env`'s `version:` input. `required-version` is a hard bound — every
`uv` invocation refuses to run against a mismatched local install, including the hint printed by
`pre-commit` — so a version bump is deliberately a single PR touching all three, not a rolling
one.

## Conventions Quick Reference

- Tables: plural `snake_case`. Every tenant-owned table has `id` (UUID PK), `tenant_id`,
  `created_at/updated_at`, `created_by/updated_by`, `deleted_at`.
- Routes: `/api/v1/<plural-kebab-case>`; domain verbs are colon-actions
  (`POST /api/v1/students/{id}:promote`).
- Responses: `{"data": ..., "meta": {...}}`; errors
  `{"error": {"code", "message", "details", "request_id"}}`.
- Soft delete is the default; hard deletion is a retention operation, not an API action.
