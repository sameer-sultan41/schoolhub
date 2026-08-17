# Database Architecture

> **Agent Context**
> **Summary:** Platform-wide database rules for PostgreSQL 16 (scope §8, non-entity parts): RLS enforcement mechanics and the `app.tenant_id` GUC with PgBouncer transaction pooling, standard column conventions (UUID PKs, `tenant_id`, audit columns, soft delete, `timestamptz`), migration strategy (Django, expand–contract), transaction requirements, retention/archiving classes, backup/PITR strategy, and indexing guidelines. Entity-level table specs live in [`../05-database/entities/`](../05-database/entities/).
> **Co-load with:** [`multi-tenancy.md`](multi-tenancy.md) · [`../05-database/entities/`](../05-database/entities/) · [`hosting-deployment.md`](hosting-deployment.md)

## 1. Engine & Isolation Enforcement

PostgreSQL 16 is the single system of record (see [`tech-stack.md`](tech-stack.md)). Tenant isolation is enforced **in the database**, not only in application code, via Row-Level Security:

- Every tenant-owned table carries `tenant_id UUID NOT NULL REFERENCES tenants(id)`.
- Each such table has RLS enabled with a policy of the form:

```sql
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;  -- applies even to the table owner

CREATE POLICY tenant_isolation ON students
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

- The application connects as a dedicated role **without** `BYPASSRLS` or superuser rights. Platform-admin aggregate queries use a separate, audited role and read path (see [`multi-tenancy.md`](multi-tenancy.md) §8).
- `current_setting('app.tenant_id')` is a custom GUC set by request middleware from the authenticated context. With no tenant set, the policy evaluates to false — the safe default is *no rows*, never *all rows*.

### 1.1 Connection Pooling and the RLS Interplay

Connection pooling (recommendation: **PgBouncer in transaction mode**) multiplexes many app requests over few server connections — which means a session-level `SET app.tenant_id` would leak between requests sharing a server connection. Therefore:

- The middleware issues `SET LOCAL app.tenant_id = '<uuid>'` **inside the transaction** that wraps each request (Django `ATOMIC_REQUESTS` or an explicit transaction per unit of work). `SET LOCAL` is automatically discarded at commit/rollback, so no tenant context can survive onto the next pooled transaction.
- Plain session `SET`, session-level advisory locks, prepared statements at session scope, and `LISTEN/NOTIFY` are prohibited in application code — all are incompatible with transaction pooling.
- Celery tasks establish their own transaction and `SET LOCAL` the tenant from the job payload before touching tenant data.
- CI includes a regression test that runs two interleaved fake tenants over a pool of one connection and asserts zero cross-tenant leakage.

## 2. Standard Column Conventions

Every tenant-owned table follows this shape; entity docs only specify their domain columns.

| Column | Type | Rule |
| ------ | ---- | ---- |
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()`; never expose sequential integers |
| `tenant_id` | `uuid` | `NOT NULL`, FK → `tenants(id)`, covered by RLS policy |
| `created_at` / `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()`; **all** timestamps are `timestamptz` (UTC stored, tenant timezone applied at presentation) |
| `created_by` / `updated_by` | `uuid` | FK → `users(id)`, nullable only for system-generated rows |
| `deleted_at` | `timestamptz` | Soft delete: `NULL` = live; default managers exclude soft-deleted rows |

- **Naming:** plural `snake_case` table names (`fee_invoices`, `student_guardians`); singular `snake_case` columns; FK columns `<entity>_id`; join tables named after both sides (`class_subjects`).
- **Soft delete** is the default for user-facing entities (recoverability + referential history). Hard delete is reserved for tenant purge ([`multi-tenancy.md`](multi-tenancy.md) §7) and retention jobs. Unique constraints on soft-deletable tables are partial: `UNIQUE (...) WHERE deleted_at IS NULL`.
- **Money** columns are `numeric(12,2)` with a `currency` code where multi-currency applies — never floats.
- Configurable/tenant-variable attributes use `jsonb` columns validated at the service layer; core relational structure is never pushed into JSON.

## 3. Migration Strategy

- **Tooling:** Django migrations, one linear history per app, committed with the code that requires them; CI fails on missing or conflicting migrations.
- **Zero-downtime via expand–contract:** (1) *expand* — add new nullable columns/tables/indexes (indexes `CONCURRENTLY`), deploy code that writes both shapes; (2) *migrate* — backfill in batched background jobs, never one giant `UPDATE`; (3) *contract* — after verification, remove old columns in a later release. No release both adds and drops the same structure.
- Destructive operations (drop column/table, type narrowing) require an explicit two-release deprecation and a reversible plan; `RunPython` migrations must define reverse functions or be marked irreversible with justification.
- RLS policies, the app role's grants, and seed permissions are themselves managed as migrations, so a restored database is complete from migrations alone.
- Deploy-time execution order is defined in [`hosting-deployment.md`](hosting-deployment.md) §CI/CD (migrate step runs before new code serves traffic).

## 4. Transaction Requirements

Invariants that must hold under concurrency are protected by explicit transactions plus row locks, not application-level checks alone:

- **Money:** fee collection, refunds, waivers, and payroll postings run in a single transaction that writes the payment row, updates the invoice balance, and appends the ledger entry — with `SELECT … FOR UPDATE` on the invoice. Combined with API idempotency keys ([`api-architecture.md`](api-architecture.md) §2.5), a retried payment can never double-post.
- **Enrollment:** seat allocation (class/section capacity), admission acceptance, and student promotion lock the target section row so capacity checks and inserts are atomic; bulk promotion runs per-student transactions inside a resumable job.
- **Counters/sequences with gaps forbidden** (receipt numbers, admission numbers per tenant) use a per-tenant counter row updated `FOR UPDATE` in the same transaction as the document it numbers.
- Default isolation is `READ COMMITTED`; hotspots use explicit locking rather than `SERIALIZABLE` retries (recommendation, simpler operationally).

## 5. Data Retention & Archiving

Retention classes (recommendation — final values to be confirmed against local compliance in [`../07-quality/non-functional.md`](../07-quality/non-functional.md)):

| Class | Examples | Live retention | Then |
| ----- | -------- | -------------- | ---- |
| Academic record | enrollment, results, certificates | Life of tenant | Export on tenant exit |
| Financial | invoices, payments, ledger, payroll | 7 years minimum | Archive, then purge |
| Operational | attendance, timetables, library loans | Current + 2 academic sessions | Archive table / cold storage |
| Communications | notification logs, announcements | 12 months | Purge |
| Security | audit_log, login events | 24 months (append-only) | Cold storage |
| Soft-deleted rows | any | 90 days | Hard purge job |

- Archiving moves aged rows to `archive_*` tables (same shape + `archived_at`) or exported Parquet/CSV in object storage under `tenants/{tenant_id}/archive/…`; archives remain tenant-scoped and covered by the deletion pipeline.
- Nightly Celery retention jobs enforce the table above; every purge is logged with counts per tenant.

## 6. Backup Strategy

- **Continuous WAL archiving + nightly base backups** (pgBackRest or the managed provider's equivalent), giving point-in-time recovery (PITR) to any moment inside the retention window (recommendation: 30 days of PITR, 90 days of weekly fulls).
- Backups are encrypted at rest, stored in a separate account/region from production, and access-audited.
- **Restore drills:** quarterly automated restore of the latest backup into an isolated environment with checksum + row-count verification and a timed RTO measurement; a backup that has not been restore-tested is treated as nonexistent.
- Single-tenant recovery (operator error inside one school) is performed by restoring PITR to a scratch instance and copying that tenant's rows back by `tenant_id` — no per-tenant backup infrastructure required.
- RTO/RPO targets and disaster-recovery topology live in [`hosting-deployment.md`](hosting-deployment.md).

## 7. Indexing Guidelines

- **`tenant_id` leads every composite index** on tenant-owned tables — all real query plans filter by tenant first: e.g. `(tenant_id, student_id, date)` on attendance, `(tenant_id, status, due_date)` on fee invoices.
- FK columns are indexed by default; partial indexes exclude soft-deleted rows (`WHERE deleted_at IS NULL`) for hot lists.
- Text search uses Postgres FTS with `GIN` indexes on generated `tsvector` columns; `jsonb` settings columns get `GIN` only when actually queried.
- Index creation in migrations is always `CONCURRENTLY` (run outside the migration transaction); unused-index review is a quarterly maintenance task driven by `pg_stat_user_indexes`.
- Query budgets: new endpoints must show `EXPLAIN` plans without sequential scans on large tenant tables in review; N+1 patterns are blocked at code review per module testing standards.

## 8. What Lives Elsewhere

- Per-entity table specifications (columns, constraints, relationships, ERDs): [`../05-database/entities/`](../05-database/entities/)
- Tenant lifecycle, export, deletion: [`multi-tenancy.md`](multi-tenancy.md)
- Redis usage (cache, broker, rate limits): [`system-architecture.md`](system-architecture.md) §2.9
