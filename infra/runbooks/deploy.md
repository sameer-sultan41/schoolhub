# Runbook — Deploy

**Purpose.** Ship a verified build to staging and then to production, running
migrations before the new code serves traffic, without downtime for any tenant.

**Applies to.** `schoolhub-api-v2` (Django + Celery), `schoolhub-frontend-v2`
(dashboard + tenant website renderer).

**Spec.** [`hosting-deployment.md`](https://github.com/sameer-sultan41/schoolhub-srd/blob/main/docs/02-architecture/hosting-deployment.md) §3, §6.

## Preconditions

- [ ] The PR is merged to `main` and CI is green: lint, types, unit + API tests
      against a real Postgres service container, **cross-tenant tests**, missing
      migration check, gitleaks, dependency audit.
- [ ] One immutable image per service exists, tagged with the git SHA. Nothing is
      rebuilt between environments — production runs the exact bytes staging ran.
- [ ] Migrations are **expand-phase only**: additive columns, tables and indexes.
      No drops, no type narrowing, no renames. A `DROP` in the diff means this
      release is not deployable — split it. Indexes use `CONCURRENTLY`; any
      backfill is a resumable Celery job, not a deploy step.
- [ ] Staging has been running this exact SHA for at least one full business day,
      including an overnight Celery beat cycle.
- [ ] On-call knows a deploy is happening, and this is not a high-stakes window
      (admissions open, results publication, the first days of fee collection).

## Steps — staging (automatic on merge to `main`)

1. Confirm the workflow started and note the run URL and the SHA.
2. Watch the **migrate** job. It runs as a one-off task, as
   `schoolhub_migrator`, **connecting directly to PostgreSQL on 5432, not
   through PgBouncer** — DDL and `CREATE INDEX CONCURRENTLY` are session-scoped
   and incompatible with transaction pooling.
3. Confirm the migrate job exits 0 before the rollout starts. If it fails, stop:
   nothing has been deployed and the old code is still serving.
4. Watch the rolling deployment. ECS holds minimum healthy at 100%, so capacity
   never drops. The circuit breaker rolls back automatically if tasks fail to
   stabilize.
5. Run the smoke tests (§Verification) against staging.
6. Leave it. One business day minimum, so a nightly beat cycle and a full
   notification lane run have happened under the new code.

## Steps — production (manual gate)

7. Open the deploy workflow and request approval on the `production` GitHub
   Environment. Approval is recorded: who, what SHA, when.
8. **Before approving, re-read the migration diff.** This is the last point at
   which an accidental destructive migration is cheap to stop.
9. Approve. The same image tag that staging verified is promoted; no rebuild.
10. Watch the migrate job. Expect it to complete in seconds. If a migration is
    still running after 2 minutes, it is doing more than an expand step —
    check for a table rewrite or a lock wait (`pg_stat_activity`,
    `pg_locks`) and be ready to cancel.
11. Watch the rollout: `aws ecs describe-services --cluster schoolhub-production
    --services schoolhub-production-api` until `deployments` has a single
    `PRIMARY` entry with `runningCount == desiredCount`.
12. Repeat for `celery-worker`, `dashboard` and `website`. **`celery-beat`
    deploys last and always as exactly one task** — a second scheduler
    double-fires every periodic job.
13. Record the deploy in the change log: SHA, approver, start and end time.

## Verification

Run all of these. A deploy is not finished until they pass.

1. **Health:** `curl -fsS https://api.<platform-domain>/healthz` returns 200.
2. **Auth round trip:** log in to `app.<platform-domain>`, load the student list,
   confirm the row count matches what it was before the deploy.
3. **Tenant isolation:** log in as a second tenant and confirm the list is
   different and correct. This catches an RLS or pooling regression before
   tenants do.
4. **A tenant website renders:** load two different tenant subdomains and confirm
   each shows its own branding — not the other's. A cache-key regression looks
   exactly like this and only at the edge.
5. **Celery lanes drain:** queue depth for `emergency`, `transactional` and
   `bulk` returns to baseline within 5 minutes. A stuck lane after a deploy
   usually means the worker cannot reach Redis or the broker URL changed.
6. **Beat is singular:** `aws ecs describe-services --services
   schoolhub-production-celery-beat --query 'services[0].runningCount'` returns
   exactly `1`.
7. **Errors:** Sentry shows no new issue types in the 15 minutes after rollout.
8. **Latency:** p95 on the API is within 20% of the pre-deploy baseline.

## Rollback

If any verification step fails, stop and follow
[`rollback.md`](rollback.md). The short version:

1. **First reach for the feature flag**, not the deploy. If the fault is one
   module, disable that module's flag and the blast radius stops immediately
   with no deploy at all.
2. Otherwise redeploy the previous image tag. Because migrations are expand-only,
   the previous code runs against the migrated schema unchanged — **no schema
   reversal is required or wanted**.
3. Never "roll back" by reverting a migration under running code. If data is
   genuinely damaged, that is a PITR restore to a scratch instance plus targeted
   repair — see [`backup-restore.md`](backup-restore.md).
4. Purge ISR caches and invalidate CloudFront so the renderer serves the previous
   build.
5. Open an incident per [`incident.md`](incident.md) if any tenant was affected.
