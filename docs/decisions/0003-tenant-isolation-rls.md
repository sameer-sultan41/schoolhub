# 0003. Tenant isolation is enforced by PostgreSQL Row-Level Security

- **Status:** Accepted
- **Date:** 2026-09-26 (recording a decision already in effect)
- **Enforced by:** `apps/api/tests/test_rls_coverage.py` (every tenant table has a policy), `apps/api/tests/test_rls_enforcement.py`, and the `infra-compose.yml` database-roles job (the app role has neither `BYPASSRLS` nor table ownership)

## Context

One platform serves many schools. A leak of one school's children's records to another is
the worst failure this product can have. [`multi-tenancy.md`](../02-architecture/multi-tenancy.md)
§2 compares the isolation models.

## Decision

Shared database, shared schema, a `tenant_id` column on every tenant-owned table, and an
RLS policy on each. Tenant context is bound per transaction with `SET LOCAL app.tenant_id`.
The ORM's default manager is tenant-scoped as a second layer; bypassing it requires the
explicitly named `all_tenants` manager, a greppable security decision. Tests run on
PostgreSQL only — never SQLite, which cannot exercise RLS.

## Alternatives considered

- **Database per tenant** — why not: one database per school is expensive at hundreds of
  tenants, and fleet-wide migrations are painful (`multi-tenancy.md` §2).
- **Schema per tenant** — why not: Postgres catalogues bloat past about 100 schemas and
  per-schema migrations are slow (`multi-tenancy.md` §2).
- **Application-level filtering only** — why not: one forgotten `.filter(tenant=…)` leaks
  data. The database must be the authority; the app layer is defence in depth.

## Consequences

Every new tenant table's first migration calls `core.tenancy.rls.rls_operations(...)`.
PgBouncer runs in transaction mode so `SET LOCAL` stays per-transaction. Assertions that
depend on RLS belong in backend tests or the E2E `live` lane — a stubbed API proves nothing
about isolation ([`e2e/AGENTS.md`](../../e2e/AGENTS.md)).
