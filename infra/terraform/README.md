# Terraform — SchoolHub infrastructure

> **STATUS: NOT APPLIED. NOTHING IN HERE HAS EVER TOUCHED AN AWS ACCOUNT.**
>
> This is a **Phase 6 (Launch) target**. SchoolHub launches on a PaaS or on VMs
> with managed Postgres — see
> [`hosting-deployment.md`](../../docs/02-architecture/hosting-deployment.md)
> §1, which recommends graduating to AWS at roughly 100 active tenants, or when
> compliance or multi-region needs arrive first.
>
> The code exists now so the migration is a configuration exercise rather than a
> design exercise, and so the security posture (no public database, no BYPASSRLS,
> WORM backups, Host in the cache key) is written down while it is still cheap to
> get right. There is no state file, no backend bucket, and no `terraform.tfvars`
> anywhere. **Treat every module as unvalidated: it has been reviewed, not run.**

## Before the first apply

Work through this list in order. Steps 1–4 are one-time bootstrap that Terraform
cannot do for itself, because it needs somewhere to put its state before it can
create anything.

1. **Apply [`bootstrap/`](bootstrap/README.md)** once, with admin credentials. It
   creates the shared state bucket (versioned, SSE-KMS, history-erasure deny), the
   GitHub OIDC provider, the per-environment plan and deploy roles, and the three
   ECR repositories. Its README has the first-run sequence, including the OIDC
   subject customisation.
2. **Record the bootstrap outputs as GitHub variables** (`terraform output -json
   github_variables`); the `schoolhub-deploy` skill's bootstrap mode sets them.
3. **Register the platform domain and create the Route 53 hosted zone.** The `cdn`
   module takes `hosted_zone_id` as an input; it does not create the zone, because
   a destroyed and recreated zone means new nameservers and a domain-wide outage.
4. **Fill in `terraform.tfvars`** from the environment's `terraform.tfvars.example`.
   It is git-ignored. Real secret values never appear in it — only ARNs and names.
   **Check the quota `L-0EA8095F` (inbound rules per security group) is at least 55**
   in the environment's region: the ALB admits CloudFront's origin-facing prefix list,
   which counts as 55 rules (the default quota is 60).
5. `terraform init` then **`terraform plan` and read every line of it.** The first
   plan for an environment is 150+ resources; that is the plan to review most
   carefully, not least.
6. Apply **staging first**, in full, and leave it running for at least one release
   cycle before pointing anything at production.
7. **Run the `db-bootstrap` task** (`schoolhub-<env>-db-bootstrap`, declared in
   `envs/*/main.tf`) with admin credentials, after `infra/scripts/bootstrap-secrets.sh
   --phase post-apply`. It runs `postgres/init/01-extensions.sql` and
   `postgres/init/02-app-role.sql` against RDS as the master user, from the same
   files compose runs. **The application role does not exist until you do this,
   and it is the role RLS binds to.** Terraform deliberately does not create it —
   see `modules/database/main.tf`. The task must exit 0; its log ends with
   `Roles ready`. Re-run it after any role-password rotation.
8. Verify the tenant boundary before any real data lands. The `db-bootstrap`
   task's exit 0 proves the role half: `02-app-role.sql` raises if `schoolhub_app`
   or `schoolhub_readonly` is a superuser or has `BYPASSRLS`. The ownership half
   (`schoolhub_migrator` owns every table in `public`) is checked after the first
   migrate.

## Layout

```
terraform/
├── modules/
│   ├── network/       VPC, three subnet tiers, NAT, security groups, flow logs
│   ├── database/      RDS PostgreSQL 18, KMS, parameter group, PITR, alarms
│   ├── cache/         ElastiCache Redis 8, TLS + AUTH, no backups by design
│   ├── storage/       S3 uploads + backups, versioning, lifecycle, Object Lock
│   ├── ecs-service/   One Fargate service: task def, roles, target group, scaling
│   ├── cdn/           CloudFront, wildcard ACM cert, Route 53, WAF
│   └── gha-deploy-policy/  The env-scoped half of the CI deploy role
├── bootstrap/         State bucket, GitHub OIDC, CI roles, ECR (applied once, local state)
└── envs/
    ├── staging/       Scaled-down copy of the production topology
    └── production/    Multi-AZ, WAF, Object Lock, no auto-apply
```

Modules are called only from `envs/*`. No module calls another module: the
environment wires outputs to inputs, so the dependency graph is visible in one
file per environment instead of hidden three levels down.

## Conventions

- **Provider `~> 6.0`, Terraform `>= 1.9`** in modules; environments and
  `bootstrap/` require `>= 1.11`, where native S3 state locking (`use_lockfile`)
  is GA.
- **Every variable has a description and, where a wrong value is dangerous, a
  `validation` block.** `engine_version` refusing anything but PostgreSQL 18 and
  `master_username` refusing `schoolhub_app` are the load-bearing ones.
- **No `count` on a whole module** to toggle an environment. Differences between
  staging and production are expressed as variable values so the two `main.tf`
  files stay diffable side by side.
- **`ignore_changes` is used deliberately and only where CI owns the field**:
  ECS `task_definition` and `desired_count` (CI deploys), RDS `password` and
  ElastiCache `auth_token` (rotated by `scripts/rotate-secrets.sh`). Every one is
  commented with why.
- **Secrets never appear in `.tf` or `.tfvars`.** Generated passwords land in
  Secrets Manager; task definitions reference secrets by ARN. Note that generated
  values *are* in state — which is why the state bucket is encrypted and
  access-controlled like a production database.

## What is not here yet

Honest gaps, so nobody assumes coverage that does not exist:

- **The ECS cluster itself** — `envs/*/main.tf` creates one inline; extract it to
  a module if a second cluster ever appears.
- **The ALB** — also inline in the environments, since there is exactly one.
- **Bastion instance / SSM document** for migrations and restores. The security
  group exists in `modules/network`; the instance does not.
- **Sentry, alert routing and PagerDuty wiring** — managed outside Terraform today.
- **Cross-region backup replication.** `hosting-deployment.md` §9 targets a
  24-hour RTO for full region loss; that needs S3 replication and a snapshot copy
  schedule that this code does not yet create.
- **A second region.** Everything here is single-region.

## Cost sketch

Rough monthly figures for planning only, us-east-1, before any committed-use
discount. Staging assumes it is stopped outside business hours.

| | Staging | Production |
| --- | ---: | ---: |
| RDS (t4g.medium / m7g.large Multi-AZ) | ~$60 | ~$420 |
| ElastiCache | ~$15 | ~$110 |
| ECS Fargate (5 services) | ~$70 | ~$400 |
| NAT gateway(s) | ~$35 | ~$105 |
| ALB + CloudFront + WAF | ~$30 | ~$140 |
| S3 + backups | ~$10 | ~$60 |
| **Total** | **~$220** | **~$1,235** |

The single largest lever is `single_nat_gateway`, then RDS Multi-AZ. Both are
correctness choices in production and cost choices in staging — do not "optimize"
production by turning them off.
