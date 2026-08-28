# Runbook — Backup & Restore

**Purpose.** Recover data after loss or corruption, at whole-database or
single-tenant granularity, without breaking tenant isolation on the way back in.

**Targets.** RPO ≤ 5 minutes. RTO for a database restore ≤ 4 hours.

**Backup inventory.**

| Layer | Mechanism | Retention | Recovers |
| --- | --- | --- | --- |
| PostgreSQL | Continuous WAL + automated snapshots (PITR) | 30 days | Any moment in the window |
| PostgreSQL | Logical dumps via `scripts/backup.sh` | 35 days in S3 | Cross-version, cross-provider, single tenant |
| Object storage | Bucket versioning + lifecycle | 90 days noncurrent | Overwritten or deleted files |
| Redis | **Nothing, deliberately** | — | Nothing. It is disposable cache. |

**Spec.** [`database-architecture.md`](https://github.com/sameer-sultan41/schoolhub-srd/blob/main/docs/02-architecture/database-architecture.md) §6.

## Preconditions

- [ ] You know **what** was lost, **when**, and **which tenants** are affected,
      and you have a timestamp immediately **before** the damage. PITR restores
      to a moment, so the moment must be right.
- [ ] Scope decided: one tenant (the common case — operator error inside one
      school) or the whole database (rare).
- [ ] **You are restoring to a NEW instance.** Never restore in place over a live
      production database. Other tenants are fine and must stay fine.
- [ ] An incident is open and the timeline is being written down.

## Steps — single-tenant recovery (the common case)

1. Identify the tenant UUID and the last-good timestamp (UTC).
2. Restore PITR into a **scratch instance**, using the same subnet group and
   parameter group so it stays off the internet:
   ```
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier schoolhub-production-postgres \
     --target-db-instance-identifier schoolhub-restore-scratch \
     --restore-time 2026-08-17T09:15:00Z \
     --db-subnet-group-name schoolhub-production-postgres \
     --no-publicly-accessible
   ```
3. Wait for `available`. On a production-sized instance expect 20–60 minutes.
   This is the bulk of the RTO.
4. Connect **through the bastion, directly on 5432**, and confirm the data at
   that timestamp is what you want. Count the tenant's rows before copying.
5. Copy that tenant's rows back, in FK dependency order, one transaction per
   table, with `tenant_id` explicit in every statement. Never
   `INSERT ... SELECT` without a `WHERE tenant_id = ...`.
6. Re-run affected background jobs (search re-index, cache warm).
7. Delete the scratch instance. A forgotten one holding production PII is its
   own incident.

## Steps — whole-database restore

8. Restore PITR into a new instance as above.
9. Point the application at the restored instance by updating the
   `DATABASE_URL` secret and redeploying. **The URL must still be the
   `schoolhub_app` role through PgBouncer** — not the master, not port 5432. A
   restore is exactly when someone pastes the master URL to "just get it
   working", and that turns off every tenant boundary in the platform.
10. Reload PgBouncer's userlist against the new instance.
11. Delete the old instance only after verification passes and only after a
    final snapshot exists.

## Steps — restore from a logical dump

12. `scripts/restore.sh --file <dump> --target <scratch-url>`
13. The script verifies the checksum, restores with `--no-owner
    --no-privileges`, re-applies `postgres/init/02-app-role.sql`, and then
    **asserts the tenant boundary** before reporting success. Those flags are
    not optional: restoring ownership from a dump is how the app role ends up
    owning tables, and an owner is exempt from RLS unless `FORCE` is set.
14. Run the Django migrations against the restored database if the dump predates
    the current schema. RLS policies live in migrations, so this is also what
    re-creates them.

## Verification

The restore is not complete until every one of these passes.

1. **Row counts** for the affected tenant match the pre-incident figures from the
   incident report — not from memory.
2. **`scripts/restore.sh` reported all three assertions green:** the app role has
   no `BYPASSRLS`, owns no tables, and every `tenant_id` table has RLS enabled.
3. **Cross-tenant check, run as `schoolhub_app`:**
   ```
   BEGIN;
   SET LOCAL app.tenant_id = '<tenant-a-uuid>';
   SELECT count(*) FROM students;   -- only tenant A
   COMMIT;
   ```
   Then the same with no tenant set: it must return **0 rows**, never all rows.
4. **Application smoke test:** log in as two tenants; each sees only its own
   data.
5. **Financial integrity** if fees were in scope: invoice balances equal the sum
   of their ledger entries; no receipt numbers are duplicated or missing.
6. **Object storage** references resolve — a restored row pointing at a deleted
   S3 key is a half-restore.
7. Record the **elapsed time**. That is your measured RTO; compare it to the
   4-hour target and log the result.

## Rollback

If the restore made things worse:

1. **Stop writes immediately.** Scale `api` and `celery-worker` to 0. A bad
   restore that keeps accepting writes gets harder to undo every second.
2. The pre-restore state is still recoverable: PITR to a timestamp just before
   your restore began. Take that timestamp from the incident timeline.
3. Restore into yet another new instance — never over the one you just touched.
4. If a partial tenant copy left inconsistent rows, prefer restoring that
   tenant's tables wholesale over hand-editing rows under pressure.
5. Escalate to the engineer who owns the affected module before making further
   data changes.
6. Postmortem action item: whatever verification step would have caught this
   before step 5 becomes a check in `scripts/restore.sh`.
