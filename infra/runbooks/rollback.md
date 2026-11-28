# Runbook — Rollback

**Purpose.** Get the platform back to a known-good state in minutes, choosing
the smallest tool that fixes the fault.

**Escalation order — always try these in order:**

| Tool | Time | Blast radius | Use when |
| --- | --- | --- | --- |
| 1. Feature flag | seconds | One module | A single module is faulty |
| 2. Scale a lane | ~1 min | One queue | Workers are the problem |
| 3. Redeploy previous image | ~5 min | One service | The release is faulty |
| 4. CDN invalidation | ~2 min | Cached pages | Stale or wrong-tenant content |
| 5. PITR restore | hours | Everything | Data is genuinely damaged |

**Step 5 is not a rollback.** It is a recovery, it is measured in hours, and it
belongs to [`backup-restore.md`](backup-restore.md). Do not reach for it because
the first four felt slow.

**Spec.** [`hosting-deployment.md`](../../docs/02-architecture/hosting-deployment.md) §8.

## Preconditions

- [ ] You can name the symptom: which endpoint, which tenants, since when.
- [ ] You have the current SHA and the previous known-good SHA, and you know
      whether this release contained migrations and whether they were
      expand-only. (They were, or the deploy runbook was not followed.)
- [ ] An incident channel exists and someone else is writing the timeline down.

## Steps — 1. Feature flag (preferred)

1. Identify the module: fees, attendance, admissions, communication…
2. Disable that module's flag in the platform admin console. Enforcement is
   server-side, so it takes effect on the next request with no deploy.
3. Confirm the failing endpoint now returns the disabled response rather than an
   error.
4. Stop here if the platform is stable. A faulty module disabled is a much
   smaller event than a whole-platform rollback, and it buys time to fix
   forward properly.

## Steps — 2. Scale a Celery lane

5. If the fault is a backed-up or crash-looping worker:
   `aws ecs update-service --cluster schoolhub-production \
      --service schoolhub-production-celery-worker --desired-count 0`
   to stop the damage, then investigate. Queued messages survive in Redis.
6. **Never scale `celery-beat` above 1.** If beat is the problem, scale it to 0,
   not to 2. Two schedulers double-fire every periodic job — duplicate invoices,
   duplicate notifications to parents.

## Steps — 3. Redeploy the previous image

7. Run `/schoolhub-deploy rollback` (the
   [`schoolhub-deploy`](../../.claude/skills/schoolhub-deploy/SKILL.md) skill). It lists the
   environment's earlier successful deployments (`deployments.py history`), defaults to the
   one before the current one, and dispatches
   `gh workflow run deploy.yml --ref main -f environment=<env> -f sha=<previous sha> -f mode=rollback`.
   Production still waits on the Environment approval.
8. The rollback runs no build and no migration. It redeploys the previous SHA's images in
   the normal order — `api` → `celery-worker` → `dashboard` → `website` → `celery-beat`
   (one task) — each waiting for stability, then invalidates CloudFront and runs the smoke
   checks.
9. **Do not touch the database schema.** Because migrations are expand-phase
   only, the previous code runs against the migrated schema unchanged. Reversing
   a migration under running code turns one incident into two.
10. **A rollback across a contract migration is refused.** If any deployment between the
    target and the current SHA carried `contract_override` (a contract migration shipped
    under `allow_contract_migration`), the old code may not run on today's schema. `preview`
    refuses unless `allow_contract_migration=true` confirms it, and the skill sets that only
    after the user has read the list (`deployments.py overrides-between`).
11. **Images expire.** ECR expires SHA tags 365 days after push, so a target older than that
    fails at "Verify all three images exist"; the skill warns from 300 days. Pick a newer
    target.

### Break-glass, when GitHub Actions is unavailable (human only)

Only when the workflow cannot run (a GitHub outage). Agents never run these.

1. Find the previous good task definition revision per service:
   `aws ecs describe-task-definition --task-definition schoolhub-production-api \
      --query 'taskDefinition.revision'` and take the revision before the current one.
2. Roll each service back, in the order `api`, `celery-worker`, `dashboard`, `website`,
   `celery-beat`:
   `aws ecs update-service --cluster schoolhub-production \
      --service schoolhub-production-api \
      --task-definition schoolhub-production-api:<previous-revision> \
      --force-new-deployment`
   Scale `celery-beat` to 0 before its update and back to 1 after, never above 1.
3. Watch until each service shows one `PRIMARY` deployment with
   `runningCount == desiredCount`.
4. Invalidate CloudFront: `aws cloudfront create-invalidation --distribution-id <id> --paths '/*'`.
5. No GitHub Deployment records this rollback; note it in the incident timeline, and the
   next workflow deploy re-establishes the record.

## Steps — 4. Purge the edge

12. The rollback workflow already invalidates CloudFront (`/*`). Purge ISR caches for
    affected tenants by hand, via the revalidation webhook; that stays manual. For an edge
    problem with no rollback, invalidate by hand:
    `aws cloudfront create-invalidation --distribution-id <id> --paths '/*'`.
13. `/*` is blunt — it costs money and leaves a cold cache. It is still correct
    when the alternative is one tenant's content served under another's domain.

## Verification

1. The failing endpoint returns correct results for at least two different
   tenants — and different results for each.
2. Error rate in Sentry is back to the pre-incident baseline for 10 consecutive
   minutes.
3. p95 latency is back to baseline.
4. Celery queue depths are draining, not growing.
5. `celery-beat` `runningCount` is exactly 1.
6. Two tenant websites render their own branding.
7. The deployed SHA is the one you intended:
   `python3 .github/scripts/deployments.py current --env production` (`/schoolhub-deploy status`).

## Rollback (of the rollback)

If rolling back made things worse — the previous image is incompatible with the
migrated schema, which means the expand–contract rule was broken somewhere:

1. Roll forward to the current SHA again. It at least matches the schema.
2. Disable the affected module by feature flag to contain the damage.
3. Escalate: this is now a data-integrity question, not a deploy question. Bring
   in whoever wrote the migration.
4. Fix forward with a new release. Do not attempt a reverse migration on a live
   production database under time pressure.
5. Write the postmortem action item: CI must reject a release whose previous
   version cannot run against the new schema.
