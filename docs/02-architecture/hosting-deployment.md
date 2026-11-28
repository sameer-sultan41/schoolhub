# Hosting & Deployment

> **Agent Context**
> **Summary:** Hosting options compared (scope §16) — AWS (ECS Fargate + RDS), low-cost VMs (DigitalOcean/Hetzner + managed Postgres), and PaaS (Render/Railway/Fly.io) — with the recommendation to launch on PaaS or VMs and graduate to AWS at scale. Defines the dev/staging/prod matrix, GitHub Actions CI/CD pipeline with a manual prod gate, wildcard DNS + custom-domain/TLS automation, secrets management, in-deploy migrations, backup/restore, rollback, and DR targets.
> **Co-load with:** [`system-architecture.md`](system-architecture.md) · [`database-architecture.md`](database-architecture.md) · [`repo-structure.md`](repo-structure.md)

## 1. Hosting Options Comparison

Scored 1–5 (5 best) for this workload: containerized Django + Celery + two Next.js apps, managed Postgres 16 with RLS, Redis, S3 storage, wildcard + custom domains.

| Criterion | (a) AWS — ECS Fargate · RDS · ElastiCache · S3 · CloudFront | (b) DO/Hetzner VMs + managed Postgres | (c) PaaS — Render / Railway / Fly.io |
| --------- | :---: | :---: | :---: |
| Cost (early stage) | 2 | **5** | 4 |
| Scalability | **5** | 3 | 4 |
| Reliability | **5** | 3 | 4 |
| Deployment workflow | 3 (IaC-heavy) | 3 (self-managed) | **5** (git-push) |
| Database support | **5** (RDS PITR, replicas) | 4 (managed PG) | 4 (managed PG, fewer knobs) |
| Storage | **5** (S3 native) | 4 (Spaces/R2) | 4 (external S3/R2) |
| CDN | **5** (CloudFront) | 3 (add Cloudflare) | 4 (built-in edge or Cloudflare) |
| Monitoring | **5** (CloudWatch + ecosystem) | 3 (self-hosted Grafana) | 4 (platform metrics + Sentry) |
| Security posture | **5** (IAM, VPC, KMS) | 3 (self-managed hardening) | 4 |
| Backup | **5** | 4 | 4 |
| Disaster recovery | **5** (multi-AZ/region) | 3 | 3–4 |
| Ops effort required | High | High | **Low** |

**Recommendation:** start on **(c) PaaS** (fastest to production, near-zero ops for a small team) or **(b) VMs + managed Postgres** if unit cost dominates, and **graduate to (a) AWS** when scale justifies it (roughly: > ~100 active tenants, compliance demands, or multi-region needs). Everything is containerized and 12-factor ([`repo-structure.md`](repo-structure.md) §4), so migration between tiers is an infrastructure exercise, not an application rewrite. Object storage should be S3-compatible from day one (S3 or Cloudflare R2) so files never migrate.

## 2. Environment Matrix

| | Development | Staging | Production |
| --- | --- | --- | --- |
| Purpose | Local feature work | Pre-release verification, UAT, migration rehearsal | Live tenants |
| Runs | docker-compose (Postgres, Redis, MinIO, Mailpit) | Scaled-down copy of prod topology | Full topology, autoscaled workers |
| Data | Seed/fixture tenants | Anonymized synthetic tenants — **never** production PII | Real tenant data |
| Deploy trigger | — | Auto on green push to `main` (`deploy.yml`) | Dispatch with a SHA + Environment approval |
| Domains | `*.localhost` | `*.staging.<platform-domain>` | `*.<platform-domain>` + custom domains |
| Providers | Mocks/sandboxes (Mailpit, SMS sandbox) | Sandbox credentials | Live credentials |
| Error tracking | Off/local | Sentry (staging env tag) | Sentry + alerting |

## 3. CI/CD Pipeline (GitHub Actions)

Deploys run only in GitHub Actions, never from a laptop ([ADR-0040](../decisions/0040-deploy-pipeline-github-actions-oidc.md)).
The operator's entry point is the `schoolhub-deploy` skill (`/schoolhub-deploy`), which
starts and watches runs with `gh` ([`infra/runbooks/deploy.md`](../../infra/runbooks/deploy.md)).

```
PR:    lint → test → build check (CI workflows, path-filtered)

main:  push ─▶ deploy.yml: resolve → ci-gate (CI green for this SHA) → preview (migration guard)
             └─▶ deploy-env.yml [staging]: build images (arm64, tag = SHA, push to ECR)
                                          → migrate → api → celery-worker → dashboard → website → celery-beat
                                          → CloudFront invalidation → smoke → GitHub Deployment success

dispatch (sha): deploy.yml [production]: resolve → ci-gate → preview (staging ran it? migrations?)
             └─▶ deploy-env.yml: ── production Environment approval ──▶ verify images exist (no build)
                                          → migrate → rollout (same order) → invalidation → smoke → Deployment
```

- **PR checks:** lint (ruff / eslint), type checks (mypy / tsc), unit + API tests with a real Postgres service container (RLS and cross-tenant tests included), missing-migration check, gitleaks, dependency audit.
- **Build:** one immutable image per service per commit, built once by the staging run, tagged with the full git SHA, pushed to ECR. The ECR repositories live in the Terraform **bootstrap** root, shared by both environments, so the same image moves staging → prod (no rebuilds between environments). Tags are immutable and expire 365 days after push.
- **One settings module:** every deployed environment runs the API with `config.settings.prod` and differs only by values (`ENVIRONMENT`, hosts, secret ARNs), so staging rehearses production's configuration. `repo-hygiene` fails if Terraform names a settings module that has no file.
- **Migrate step** runs as a one-off ECS task against the target database **before** the new version receives traffic (see §6). `check_migrations.py` blocks non-expand migrations unless explicitly overridden.
- **AWS access:** GitHub OIDC, one deploy role per environment, trusted only for `deploy-env.yml` on `main` in that environment's GitHub Environment. No stored keys.
- **Prod gate:** the `production` GitHub Environment's required reviewer. **Record:** every run creates a GitHub Deployment (SHA, actor, overrides, status), which is the source of "what is deployed where".
- **Infrastructure:** `infra-terraform.yml` plans on PRs and `main` (CI shows only add/change/destroy counts; the repository is public); a human applies.
- Frontend CI additionally regenerates the OpenAPI client and fails on contract breaks ([`repo-structure.md`](repo-structure.md) §6.1).

## 4. Domains, DNS & TLS

- **Platform domains:** `app.<platform-domain>` (dashboard), `api.<platform-domain>` (API), and a **wildcard record** `*.<platform-domain>` → the website renderer for tenant subdomains.
- **Custom domains:** automated pipeline — tenant adds domain → DNS TXT verification + CNAME to the renderer edge → certificate issued automatically (ACME via the platform edge / Cloudflare for SaaS-style custom hostnames) → activation. Detail in [`website-builder.md`](website-builder.md) §1.
- **TLS everywhere:** HTTPS enforced with HSTS; a managed wildcard certificate covers tenant subdomains; per-hostname certificates cover custom domains; internal service traffic stays on the private network.

## 5. Secrets Management

- Production/staging secrets live in the **platform secret manager** (PaaS/environment secrets, or AWS Secrets Manager on tier (a)), injected as environment variables at deploy; never in images, never in git (gitleaks-enforced).
- Where secrets must live in the repo (e.g. IaC values), use **SOPS with age/KMS encryption** (recommendation) so encrypted files are diffable and access-controlled.
- **CI reaches AWS by OIDC only:** short-lived role sessions per environment, no AWS keys stored in GitHub ([ADR-0040](../decisions/0040-deploy-pipeline-github-actions-oidc.md)). App secrets stay in Secrets Manager and are never GitHub secrets.
- Rotation: quarterly for provider keys, immediately on personnel change or suspected exposure; DB credentials rotated via the managed provider. Access to prod secrets is limited to the deploy pipeline plus named operators, and audited.

## 6. Database Migration Process in Deploys

1. CI verifies migrations exist, are linear, and follow expand–contract rules ([`database-architecture.md`](database-architecture.md) §3).
2. Deploy job runs `migrate` as a one-off task before rollout; because migrations are expand-phase only, the **currently running old code keeps working** during and after migration.
3. New containers roll out (rolling/blue-green per platform); health checks gate traffic shift.
4. Contract-phase migrations (drops) ship only after the release using them is verified in prod.
5. Every prod migration is rehearsed on staging against an anonymized, production-scale schema first; long backfills run as resumable Celery jobs, never inside the deploy.

## 7. Backup & Restore Procedure

- **Backups:** continuous WAL archiving + nightly base backups (PITR window ≥ 30 days), encrypted, stored in a separate account/region; object storage versioned with lifecycle rules; Redis is treated as disposable cache (recreatable).
- **Restore:** documented runbook in `schoolhub-infra/runbooks/` — provision instance → restore base + replay WAL to target time → verify checksums/row counts → repoint the app or extract single-tenant rows ([`database-architecture.md`](database-architecture.md) §6).
- **Drills:** quarterly automated restore test with a timed RTO measurement; drill results logged.

## 8. Rollback Strategy

- **Application:** redeploy the previous immutable image tag — `/schoolhub-deploy rollback`, which runs `gh workflow run deploy.yml --ref main -f environment=<env> -f sha=<previous sha> -f mode=rollback` (no build, no migration). A minutes-scale operation because images are versioned and config is external. A rollback across a deployment that shipped a contract migration needs explicit confirmation.
- **Database:** expand–contract means the previous app version always runs against the migrated schema, so rollback normally requires **no** schema reversal. Reverse migrations exist for expand steps where meaningful; data-destructive rollback is instead handled via PITR to a scratch instance and targeted repair.
- **Websites:** ISR caches are purged on rollback; CDN serves the previous renderer build immediately.
- **Kill switches:** per-module feature flags ([`multi-tenancy.md`](multi-tenancy.md) §5) allow disabling a faulty feature without any deploy — the first rollback tool, not the last.

## 9. Disaster Recovery (recommendations)

| Scenario | Target |
| -------- | ------ |
| RPO (max data loss) | ≤ 5 minutes (WAL shipping interval) |
| RTO — database restore | ≤ 4 hours |
| RTO — full region/platform loss | ≤ 24 hours (rebuild from IaC + backups in secondary region) |

- All infrastructure is reproducible from `schoolhub-infra` IaC + the secret store + backups; nothing exists only as console configuration.
- DR runbook covers: DNS failover, restore order (DB → storage → API → workers → frontends), provider credential re-issue, and tenant communication templates.
- Business-continuity review (including these targets) recurs annually and after any major incident; targets tighten when the platform graduates to hosting tier (a).

## 10. Monitoring & Alerting per Environment

- **Production:** Sentry error alerting (paged), uptime checks on `api`, `app`, and a sample of tenant sites, database metrics (connections, replication lag, slow queries), Celery queue-depth alarms per lane, and certificate-expiry monitoring for custom domains.
- **Staging:** same dashboards without paging — used to validate alert rules before they guard production.
- Alert routing, on-call expectations, and incident severity definitions live in `schoolhub-infra/runbooks/`; observability requirements are detailed in [`../07-quality/non-functional.md`](../07-quality/non-functional.md).
