# Runbook — Deploy

**Purpose.** Ship a verified build to staging and then to production, running
migrations before the new code serves traffic, without downtime for any tenant.

**Applies to.** `apps/api` (Django + Celery), `the frontend workspace`
(dashboard + tenant website renderer).

**Spec.** [`hosting-deployment.md`](../../docs/02-architecture/hosting-deployment.md) §3, §6;
[ADR-0040](../../docs/decisions/0040-deploy-pipeline-github-actions-oidc.md).

**Entry point.** `/schoolhub-deploy` (the
[`schoolhub-deploy`](../../.claude/skills/schoolhub-deploy/SKILL.md) skill). Deploys run only
in GitHub Actions (`.github/workflows/deploy.yml`, which calls `deploy-env.yml`); nobody
deploys from a laptop. Staging deploys on every green push to `main`. Production is
`/schoolhub-deploy promote production`: a `workflow_dispatch` with an explicit SHA, held on
the `production` Environment's approval.

## Preconditions

- [ ] The PR is merged to `main` and CI is green for that SHA. The workflow's `ci-gate` job
      checks this with `.github/scripts/ci_gate.py`; the skill runs the same script.
- [ ] One immutable image per service exists in ECR, tagged with the full git SHA, built
      once by the staging run (`linux/arm64`). Nothing is rebuilt between environments —
      production runs the exact bytes staging ran. The website image takes one build
      argument, `WEBSITE_IMAGE_HOSTNAME` (repository variable): the API hosts the image
      optimiser may fetch from, as an exact comma list,
      `api.<prod domain>,api.staging.<prod domain>`, the same value for every environment.
      Prefer that list to a `**.<prod domain>` wildcard, which also admits every tenant
      subdomain.
- [ ] Migrations are **expand-phase only**: additive columns, tables and indexes. No drops,
      no type narrowing, no renames. `check_migrations.py` enforces this in `preview` and
      again before migrate; a contract finding fails the run unless
      `allow_contract_migration=true`, and a review finding (`RunPython`, an unreadable
      operation, an edited migration) fails unless `acknowledge_migration_review=true`. Both
      overrides are recorded in the run summary and the Deployment payload. Indexes use
      `CONCURRENTLY`; any backfill is a resumable Celery job, not a deploy step.
- [ ] Production only: staging has run this exact SHA successfully for at least 24 hours,
      including a working day and an overnight Celery beat cycle. `preview` refuses a SHA
      staging never ran unless `allow_unstaged_sha=true`.
- [ ] On-call knows a deploy is happening, and this is not a high-stakes window (admissions
      open, results publication, the first days of fee collection).
- [ ] **Production is blocked for the dashboard** until the dashboard runtime-env PR lands:
      the dashboard image inlines `NEXT_PUBLIC_*` at build time, so staging's image cannot be
      promoted. `docs/deferred-work.md` carries the marker `launch-blocker:dashboard-runtime-env`,
      and the skill refuses `promote production` while it is open, unless the user overrides
      it explicitly.

The skill's [`preconditions.md`](../../.claude/skills/schoolhub-deploy/preconditions.md) has
the command and pass rule for each production check.

## First-time order of operations

Nothing in AWS exists until a human runs these, in this order. Agents never run
`terraform apply` or a mutating `aws` command; the skill prints them.

1. **Region.** Choose `me-central-1` or `ap-south-1`. `me-central-1` is an opt-in region:
   `aws account get-region-opt-status --region-name <region>` must say `ENABLED` or
   `ENABLED_BY_DEFAULT`; otherwise `aws account enable-region --region-name <region>` and wait.
   Confirm the region offers every service used (Fargate on ARM64, ElastiCache with in-transit
   encryption, RDS PostgreSQL 18, regional WAF):
   `aws ssm get-parameters-by-path --path /aws/service/global-infrastructure/regions/<region>/services`.
2. **Bootstrap apply** ([`infra/terraform/bootstrap/README.md`](../terraform/bootstrap/README.md)):
   state bucket, OIDC provider, the four CI roles and the three ECR repositories. Then the
   OIDC `sub` customisation `PUT` from that README, and move the bootstrap state into the
   bucket.
3. **`/schoolhub-deploy bootstrap`**: sets the repository variables from
   `terraform output -json github_variables`, creates the `staging` and `production`
   Environments (production: the user as the only required reviewer,
   `prevent_self_review=false`; both: deploys from `main` only). `SMOKE_TENANT_SLUG` stays
   empty.
4. `infra/scripts/bootstrap-secrets.sh --env staging --phase pre-apply`.
5. **Build the first images:** dispatch `deploy.yml` for staging while `ECS_CLUSTER` is empty.
   Only the build runs; the rollout job ends with `build only: ECS_CLUSTER is not set for staging`.
6. **Create staging's tfvars object** (see "Env tfvars" below), with `image_tag` set to that SHA.
7. `terraform apply` the staging root with the downloaded tfvars (init command in
   [`infra/terraform/README.md`](../terraform/README.md)). This also issues and DNS-validates
   the regional ALB certificate.
8. `bootstrap-secrets.sh --env staging --phase post-apply --db-host <rds address>`.
9. **Run the db-bootstrap task** (creates `schoolhub_migrator`, `schoolhub_app`,
   `schoolhub_readonly` from `infra/postgres/init/`):
   ```bash
   aws ecs run-task --cluster schoolhub-<env> --task-definition schoolhub-<env>-db-bootstrap --launch-type FARGATE \
     --network-configuration "awsvpcConfiguration={subnets=[<PRIVATE_SUBNETS>],securityGroups=[<MIGRATE_SECURITY_GROUP>],assignPublicIp=DISABLED}"
   aws ecs wait tasks-stopped --cluster schoolhub-<env> --tasks <task-arn>
   aws ecs describe-tasks --cluster schoolhub-<env> --tasks <task-arn> --query 'tasks[0].containers[0].exitCode'   # must be 0
   aws logs tail /ecs/schoolhub-<env>-db-bootstrap   # NOTICE "Roles ready: …"
   ```
   Run it again after any role-password rotation.
10. **Copy the env outputs into the Environment:** paste
    `terraform output -json github_environment_variables` into `/schoolhub-deploy bootstrap`
    (`ECS_CLUSTER`, `MIGRATE_TASK_FAMILY`, `PRIVATE_SUBNETS`, `MIGRATE_SECURITY_GROUP`,
    `CLOUDFRONT_DISTRIBUTION_ID`, `PLATFORM_DOMAIN`). From the next `main` push, staging's CI
    plan row runs.
11. **Connections alarm:** run `SHOW max_connections;` as the master user and, if
    `floor(0.8 × actual)` differs from the env's `connections_alarm_threshold` (staging 360,
    production 720), set it and re-apply. v1 connects directly to RDS (no pooler).
12. **First deploy** through the workflow. Tenant smoke checks are skipped with a notice.
    Record here which `POST /deployments` path it took: the record's description is
    `deploy <sha7>` (`ref: <sha>`) or `deploy <sha7> (ref main: branch policy)` (the fallback
    when the branch policy refuses a SHA ref). Readers use `payload.target_sha` either way.
    _First deploy path: not yet recorded._
13. **Seed the smoke tenant:** create one tenant for smoke checks through the platform-admin
    console and publish its website (no seed command targets AWS; the `seed_*` commands are
    for dev and E2E). Set `SMOKE_TENANT_SLUG` on the Environment and re-run the deploy once so
    the tenant checks run.
14. Repeat 4, 6–13 for production, after the dashboard launch blocker is closed.

### Env tfvars

Each environment's non-secret tfvars are one object in the state bucket,
`s3://<TF_STATE_BUCKET>/schoolhub/<env>/terraform.tfvars`, encrypted with the state KMS key and
versioned with the bucket. The CI plan role reads it; the human apply uses the same file.
Never commit it (the repository is public).

```bash
aws s3 cp s3://$TF_STATE_BUCKET/schoolhub/<env>/terraform.tfvars ./<env>.tfvars   # git-ignored
# edit
aws s3 cp ./<env>.tfvars s3://$TF_STATE_BUCKET/schoolhub/<env>/terraform.tfvars \
  --sse aws:kms --sse-kms-key-id $TF_STATE_KMS_KEY_ARN
terraform apply -var-file=./<env>.tfvars
```

The first copy is made by `/schoolhub-deploy bootstrap` from `terraform.tfvars.example`.

## Steps — staging (automatic on merge to `main`)

1. The push starts `deploy.yml` (`deploy staging <sha> (deploy)`). `/schoolhub-deploy` finds
   and watches it.
2. `ci-gate` waits up to 45 minutes for CI on that SHA; `preview` reads the deployed SHA,
   skips a push older than it as superseded, and runs the migration guard.
3. `build` pushes the three images for that SHA (skipped if the tag exists).
4. The rollout job runs **migrate** as a one-off task on the new API image, as
   `schoolhub_migrator`, **connecting directly to PostgreSQL on 5432** — DDL and
   `CREATE INDEX CONCURRENTLY` are session-scoped. It must exit 0; if it fails, nothing has
   been deployed and the old code still serves. The log shows only the exit code and
   `ERROR`/`Traceback` lines (run logs are public); the full log is in CloudWatch.
5. Rollout in order, each waiting for service stability: `api` → `celery-worker` →
   `dashboard` → `website` → `celery-beat` (one task, stop-then-start). A failed service
   stops the ones after it; the circuit breaker has already rolled it back.
6. CloudFront invalidation, then smoke checks. The Deployment is marked `success` or
   `failure`, and on failure the summary prints the rollback command.
7. Leave it at least 24 hours, so a nightly beat cycle and a full notification lane run
   happen under the new code.

## Steps — production (manual gate)

8. `/schoolhub-deploy promote production`: the skill checks the preconditions and dispatches
   `deploy.yml` with `environment=production` and the SHA.
9. `preview` runs before the gate: it refuses a SHA staging never ran, re-runs the migration
   guard, and writes the "Deploy plan" summary. **Read the migration diff here.** This is the
   last point at which an accidental destructive migration is cheap to stop.
10. The rollout job waits on the `production` Environment. The skill shows the summary and
    approves only on the user's explicit yes in chat, through
    `POST …/actions/runs/<id>/pending_deployments`, recorded under the user's account. The
    user is the only reviewer, so `prevent_self_review=false`: there is no second person's
    check (a deferred entry). The UI's "Review deployments" button is the fallback.
11. After approval the job re-reads the deployed SHA and repeats preview's checks, so an
    approval cannot outlive a stale preview. Production never builds: it verifies all three
    images exist in ECR, then migrates and rolls out exactly as staging steps 4–6. If a
    migration is still running after 2 minutes, it is doing more than an expand step —
    check for a table rewrite or a lock wait (`pg_stat_activity`, `pg_locks`).
12. The GitHub Deployment is the change log: SHA, actor, overrides, run URL, start and end
    time. `/schoolhub-deploy status` reads it.

## Verification

Run all of these. A deploy is not finished until they pass. **Automated** means the workflow
or the skill does it; the rest stay human.

1. **Health** (automated: workflow smoke step and skill): `https://api.<platform-domain>/healthz`
   and `https://app.<platform-domain>/api/health` return 200.
2. **Auth round trip:** log in to `app.<platform-domain>`, load the student list, confirm the
   row count matches what it was before the deploy.
3. **Tenant isolation:** log in as a second tenant and confirm the list is different and
   correct. This catches an RLS or pooling regression before tenants do.
4. **A tenant website renders** (partly automated: the smoke tenant's `/api/health` and home
   page): load two different tenant subdomains and confirm each shows its own branding — not
   the other's. A cache-key regression looks exactly like this and only at the edge.
5. **Celery lanes drain:** queue depth for `emergency`, `transactional` and `bulk` returns to
   baseline within 5 minutes.
6. **Beat is singular** (automated): the rollout fails unless `celery-beat runningCount=1`,
   and prints that line.
7. **Errors:** Sentry shows no new issue types in the 15 minutes after rollout.
8. **Latency:** p95 on the API is within 20% of the pre-deploy baseline.

## Rollback

If any verification step fails, stop and follow [`rollback.md`](rollback.md). The short
version:

1. **First reach for the feature flag**, not the deploy.
2. Otherwise `/schoolhub-deploy rollback`: `deploy.yml` with `mode=rollback` and a previous
   SHA. No build, no migration — because migrations are expand-only, the previous code runs
   against the migrated schema unchanged.
3. Never "roll back" by reverting a migration under running code. If data is genuinely
   damaged, that is a PITR restore — see [`backup-restore.md`](backup-restore.md).
4. The workflow invalidates CloudFront; purge ISR caches for affected tenants by hand.
5. Open an incident per [`incident.md`](incident.md) if any tenant was affected.
