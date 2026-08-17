# AGENTS.md — schoolhub-api

Instructions for AI assistants working in this repository: the Django 6 + DRF backend
of **SchoolHub**, an AI-powered multi-tenant School Management SaaS.

## Read Before Coding

1. **Specification repo** — https://github.com/sameer-sultan41/schoolhub-srd
   Start at its `AGENTS.md`, then `context/context-map.md`, which tells you the exact
   3–6 documents to load for your task type. Do not load the whole spec.
2. **[`docs/ENGINEERING_STANDARDS.md`](docs/ENGINEERING_STANDARDS.md)** — this repo's
   style rules, security non-negotiables, and the authoritative external docs to consult.
   Read the official framework docs rather than relying on recall; versions here are current.
3. For module work in `apps/<module>/`, the matching `docs/03-modules/<module>.md` in the
   spec repo **is the requirement**: features, workflows, validations, permission keys (§4),
   endpoints (§16). Its entity doc defines the schema.

## Layout

```
config/            settings (base/dev/prod/test), root urls, api_v1 route table, celery
core/tenancy/      Tenant model, TenantOwnedModel base, RLS helpers, context, middleware
core/rbac/         User, Role, Permission, UserRole, permission registry, DRF permission classes
core/audit/        append-only audit log + recording services
core/api/          response envelope, error handler, pagination, throttling, base viewsets
apps/<module>/     one app per module doc — models/serializers/services/views/urls/permissions/tests
tests/             cross-cutting suites (RLS coverage, permission registry, cross-tenant matrix)
```

## Hard Rules

1. **Tenancy.** Tenant-owned models inherit `TenantOwnedModel`. Never bypass the default
   manager; `all_tenants` is platform-scope only and every use is a security decision.
   New tenant-owned tables attach an RLS policy in their first migration via
   `core.tenancy.rls.rls_operations(...)` — `tests/test_rls_coverage.py` fails the build otherwise.
2. **Tenant context is transaction-scoped.** Bind with `SET LOCAL` through
   `core.tenancy.context`. A session-level `SET` leaks across pooled connections — never do it.
3. **RBAC.** Every endpoint declares `required_permission` (or `required_permission_map`).
   The permission class fails closed when one is missing. Keys are `module.resource.action`,
   registered in the module's `permissions.py`; they come from the module doc's §4 table.
4. **Cross-tenant access returns 404**, never 403.
5. **Money is append-only.** Ledger entries are never updated or deleted; corrections are
   new entries. Money endpoints honor `Idempotency-Key`.
6. **AI calls go through the gateway** in `core/ai` — never import a provider SDK in an app.
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

## Conventions Quick Reference

- Tables: plural `snake_case`. Every tenant-owned table has `id` (UUID PK), `tenant_id`,
  `created_at/updated_at`, `created_by/updated_by`, `deleted_at`.
- Routes: `/api/v1/<plural-kebab-case>`; domain verbs are colon-actions
  (`POST /api/v1/students/{id}:promote`).
- Responses: `{"data": ..., "meta": {...}}`; errors
  `{"error": {"code", "message", "details", "request_id"}}`.
- Soft delete is the default; hard deletion is a retention operation, not an API action.
