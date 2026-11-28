# schoolhub-infra

Infrastructure for **SchoolHub** — the AI-powered, multi-tenant School Management SaaS.
This repo owns everything that is *not* application code: the local development stack,
the database bootstrap (roles, extensions, connection pooling), the AWS Terraform target,
the CI workflows that validate infrastructure, the operational scripts, and the runbooks.

The authoritative specification lives in the separate spec repo
[`docs/`](../docs/). Where this repo and the
spec disagree, the spec wins and this repo is the bug. See [`AGENTS.md`](AGENTS.md).

---

## 1. Environments

Per `docs/02-architecture/hosting-deployment.md` §2.

| | Development | Staging | Production |
| --- | --- | --- | --- |
| Purpose | Local feature work | Pre-release verification, UAT, migration rehearsal | Live tenants |
| Runs | `compose/docker-compose.yml` (Postgres 18, PgBouncer, Redis 8, MinIO, Mailpit, API, Celery worker + beat, frontends) | Scaled-down copy of the prod topology | Full topology, autoscaled workers |
| Data | Seed/fixture tenants (`scripts/seed-dev.sh`) | Anonymized synthetic tenants — **never** production PII | Real tenant data |
| Deploy trigger | — | Auto on merge to `main` | Manual approval gate (GitHub Environments) |
| Domains | `*.localhost` | `*.staging.<platform-domain>` | `*.<platform-domain>` + tenant custom domains |
| Providers | Mocks (Mailpit, MinIO, SMS sandbox) | Sandbox credentials | Live credentials |
| Error tracking | Off | Sentry (`environment=staging`) | Sentry + paging |

**Hosting tier.** The spec recommends launching on a PaaS (Render / Railway / Fly.io) or
low-cost VMs + managed Postgres, and graduating to AWS (ECS Fargate + RDS + ElastiCache +
S3 + CloudFront) at roughly >100 active tenants, compliance demands, or multi-region needs.
Everything here is containerized and 12-factor, so that graduation is an infrastructure
exercise, not an application rewrite.

- **Now (Phases 1–5):** PaaS/VMs. Services are defined by the platform's own manifests; this
  repo supplies the database bootstrap SQL, the PgBouncer config, the scripts and the runbooks.
- **Later (Phase 6):** [`terraform/`](terraform/) — written, reviewed, **not applied**. See
  [`terraform/README.md`](terraform/README.md).

## 2. Local development

```bash
./scripts/seed-dev.sh          # do this first — see below for why
```

`seed-dev.sh` is the supported path from a clean checkout to a running stack. It generates
`compose/.env` with real random local passwords, starts Postgres, then **generates
`postgres/pgbouncer/userlist.txt` from the SCRAM verifiers Postgres actually computed** — the
pooler cannot authenticate anyone until that file exists, so starting `pgbouncer` by hand
before this step will simply fail. It finishes by asserting the tenant boundary is intact,
running migrations and loading sample tenants.

Once that has run once, the ordinary compose commands work as expected:

```bash
cd compose
docker compose up -d postgres pgbouncer redis minio mailpit          # infrastructure only
docker compose up -d                                                 # everything
docker compose up -d --build                                         # after a Dockerfile change
docker compose down                                                  # stop, keep data
```

```bash
./scripts/seed-dev.sh --check-only   # re-run the tenant-boundary assertions, change nothing
./scripts/seed-dev.sh --reset        # destroy volumes and start over (DELETES LOCAL DATA)
./scripts/seed-dev.sh --backend-only # everything but the dashboard/website (e2e-live uses this)
cp compose/docker-compose.override.yml.example compose/docker-compose.override.yml  # optional
```

The application services build from this monorepo: the API from `apps/api`, the
dashboard and website from the workspace root (`API_REPO_PATH` and `FRONTEND_REPO_PATH` in
`.env`). The frontends run `next dev` over the mounted source; each start runs a filtered
`pnpm install` first, so a lockfile change needs a restart, not a rebuild.

| Service | URL | Notes |
| --- | --- | --- |
| API | http://api.localhost:8000 | Django + DRF; OpenAPI at `/api/v1/schema/` |
| Dashboard | http://app.localhost:3000 | Next.js admin app |
| Website renderer | http://*.localhost:3001 | Any host resolves to a tenant by slug |
| Mailpit | http://localhost:8025 | Catches all outbound mail |
| MinIO console | http://localhost:9001 | S3-compatible object storage |
| PgBouncer | `localhost:6432` | **Applications connect here**, not to 5432 |
| Postgres | `localhost:5432` | Direct access for `psql`, migrations, restores |

### Three database roles, and why it matters

`postgres/init/02-app-role.sql` creates **three** roles, and the split is the tenant boundary:

- `schoolhub_migrator` — owns the schema and every table; runs migrations. Connects **directly**
  to Postgres on 5432, because DDL and `CREATE INDEX CONCURRENTLY` are session-scoped and cannot
  run through a transaction-mode pooler.
- `schoolhub_app` — what the application connects as, through PgBouncer on 6432. It has **no
  `BYPASSRLS`, no superuser, and owns nothing**. All three conditions are required for
  Row-Level Security to bind; break any one and every RLS policy in the platform silently
  becomes a no-op — no error, no failing test, just every school's data visible to every other
  school. Read the comments in that file before changing anything about roles or ownership.
- `schoolhub_readonly` — audited read-only role for platform-level aggregate reporting. Also no
  `BYPASSRLS`.

The init script refuses to finish if the app or readonly role ends up with superuser or
`BYPASSRLS`, and CI asserts the same three properties against a live PostgreSQL 18 on every PR.

Locally, applications connect through **PgBouncer in transaction pooling mode** (AWS v1 connects
directly to RDS; the code stays pooler-safe either way, ADR-0040), which means tenant
context must be set with `SET LOCAL app.tenant_id` (or `set_config(..., true)`) *inside a
transaction*. A session-level `SET` leaks one tenant's context onto the next request that
reuses the pooled server connection. See `postgres/pgbouncer/pgbouncer.ini`.

## 3. Deploy flow

Per `docs/02-architecture/hosting-deployment.md` §3 and §6, and
[ADR-0040](../docs/decisions/0040-deploy-pipeline-github-actions-oidc.md). Deploys run only in
GitHub Actions; the entry point is `/schoolhub-deploy`.

```
merge to main ─→ deploy.yml: ci-gate → preview (migration guard)
   └─→ [staging] build images (tag = SHA, ECR) → migrate → api → worker → dashboard → website → beat → smoke
dispatch (sha) ─→ deploy.yml: ci-gate → preview (staging ran it?)
   └─→ production Environment approval ─→ [production] migrate → same rollout → smoke (no build)
```

- One immutable image per service per commit, built once by the staging run. The **same image**
  moves staging → production; nothing is rebuilt between environments.
- CI reaches AWS through GitHub OIDC only: one deploy role per environment, trusted only for
  `deploy-env.yml` on `main`. No AWS keys in GitHub.
- The migrate task runs **before** new containers receive traffic, using the migrator role,
  directly on 5432. `check_migrations.py` blocks non-expand migrations unless overridden.
- Contract-phase migrations (drops) ship in a *later* release, after the release that stopped
  using the old structure is verified in production.
- Every run is a GitHub Deployment (who / what SHA / overrides / when): the record of what is
  deployed where.

**First-time order** (nothing is applied until a human does this): bootstrap apply
([`terraform/bootstrap/`](terraform/bootstrap/README.md)) and the OIDC `sub` customisation →
`/schoolhub-deploy bootstrap` (GitHub variables and Environments) →
`scripts/bootstrap-secrets.sh --phase pre-apply` → build-only staging run → env tfvars object
→ env apply → `bootstrap-secrets.sh --phase post-apply` → db-bootstrap task → env outputs into
the Environment → first deploy → smoke tenant. Full steps:
[`runbooks/deploy.md`](runbooks/deploy.md) "First-time order of operations".

## 4. Secrets

- No real secrets live in this repo. `compose/.env.example` documents every variable and where
  its real value comes from; `.env` is git-ignored and gitleaks runs in CI and pre-commit.
- Staging and production secrets live in the platform secret manager (PaaS environment secrets
  today, AWS Secrets Manager after the Phase 6 graduation) and are injected as environment
  variables at deploy time — never baked into images.
- Values that must be committed alongside IaC are encrypted with **SOPS + age/KMS** so they stay
  diffable and access-controlled.
- Rotation is quarterly for provider keys, and immediate on personnel change or suspected
  exposure: [`scripts/rotate-secrets.sh`](scripts/rotate-secrets.sh).

## 5. Backup, restore and DR targets

- Continuous WAL archiving + nightly base backups; PITR window ≥ 30 days; 90 days of weekly
  fulls. Encrypted at rest, stored in a separate account/region, access-audited.
- Redis is disposable cache and is never backed up. Object storage is versioned with lifecycle
  rules.
- A backup that has not been restore-tested is treated as nonexistent — hence the quarterly drill.

| Target | Value |
| --- | --- |
| RPO (max data loss) | ≤ 5 minutes |
| RTO — database restore | ≤ 4 hours |
| RTO — full region/platform loss | ≤ 24 hours |

## 6. Runbook index

| Runbook | Use when |
| --- | --- |
| [`deploy.md`](runbooks/deploy.md) | Shipping a release to staging or production — through `/schoolhub-deploy` |
| [`rollback.md`](runbooks/rollback.md) | A release is bad and must be reverted — `/schoolhub-deploy rollback` |
| [`backup-restore.md`](runbooks/backup-restore.md) | Restoring the database, whole or single-tenant |
| [`dr-drill.md`](runbooks/dr-drill.md) | The quarterly restore/DR exercise |
| [`incident.md`](runbooks/incident.md) | A production incident is in progress |
| [`custom-domain-onboarding.md`](runbooks/custom-domain-onboarding.md) | A tenant is attaching their own domain |

## 7. Layout

```
infra/
├── compose/      # local development stack + documented .env.example
├── postgres/     # extensions, roles/RLS bootstrap, PgBouncer config
├── terraform/    # AWS: bootstrap root + envs; planned in CI, applied by a human
├── scripts/      # backup, restore, secret rotation, dev seeding
├── runbooks/     # operational procedures
└── .github/      # infrastructure CI (terraform plan, compose validation)
```
