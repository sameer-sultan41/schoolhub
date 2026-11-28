# 0040. Deploys run only in GitHub Actions, authenticated by OIDC, recorded as GitHub Deployments

- **Status:** Accepted
- **Date:** 2026-11-28
- **Enforced by:** the trust policies in `infra/terraform/bootstrap/roles.tf` and `bootstrap/tests/bootstrap.tftest.hcl` (each deploy role trusts only `deploy-env.yml@refs/heads/main` called by `deploy.yml@refs/heads/main`, in its own Environment; the production role's ECR actions are `ecr:DescribeImages` only; every role's session is 7200 s); `modules/gha-deploy-policy` and its test (services listed exactly, `iam:PassRole` to the env's own roles); `deploy-env.yml`'s `environment:` and `concurrency: deploy-<env>`; `.github/scripts/check_task_definition.py` (a render naming another environment's role, account or registry fails); `.github/scripts/check_migrations.py`, `ci_gate.py`, `deployments.py` and their tests in `.github/scripts/tests/` (the `deploy-scripts` job); `infra-terraform.yml`'s counts-only plan output; the `production` Environment's required reviewer, and the `main`-only branch policy on both `staging` and `production` (GitHub settings, checked by the skill's bootstrap mode); `.claude/settings.json`'s `ask` rules on `pending_deployments` (a second control); the guardrail hook (blocks `terraform apply` and mutating `aws` from agents)

## Context

`infra/runbooks/deploy.md` described a deploy workflow that did not exist, the Terraform plan
step was disabled for lack of a state backend, and the AWS account was empty. Deploys had to
be designed from scratch for a **public** repository, with one human operator, an agent (the
`schoolhub-deploy` skill) driving routine work, and a guardrail that forbids agents
`terraform apply` and mutating `aws` commands. Plan:
[`2026-11-23-deploy-pipeline-and-skill.md`](../superpowers/plans/2026-11-23-deploy-pipeline-and-skill.md).

## Decision

1. **GitHub Actions is the only deploy path.** `deploy.yml` deploys staging on every green push
   to `main` and production or a rollback on `workflow_dispatch` with an explicit SHA. It calls
   `deploy-env.yml`, the only file that assumes a deploy role.
2. **AWS access is GitHub OIDC, no stored keys.** Per environment, a plan role (read-only) and
   a deploy role (least privilege). The repository's OIDC `sub` is customised with
   `["repo", "context", "job_workflow_ref", "workflow_ref"]`, and each deploy role trusts only
   `environment:<env>:job_workflow_ref:<repo>/.github/workflows/deploy-env.yml@refs/heads/main:workflow_ref:<repo>/.github/workflows/deploy.yml@refs/heads/main`.
   `job_workflow_ref` names the called file, so without `workflow_ref` a workflow on any
   branch could call `deploy-env.yml@main` and take a deploy role; `workflow_ref` pins the
   caller to `deploy.yml` on `main`. Both Environments also allow `main` only.
   Sessions last at most 7200 s. The production plan role trusts `main` only (its state holds
   the database master password); the staging plan role also trusts same-repository PRs.
3. **One image per SHA, promoted unchanged.** The three ECR repositories live in the bootstrap
   root, not the env roots. Only the staging run builds (`linux/arm64`, tag = full SHA,
   immutable); the production role can only describe images. SHA tags expire 365 days after
   push (age-based, because the production role can neither push nor retag), and the deploy
   warns from 300 days.
4. **GitHub Deployments record what is deployed.** One record per run, `task: deploy`, the SHA
   in `payload.target_sha` with every override; all readers go through `deployments.py`.
   A record counts only when the Actions bot created it and its `payload.run_id` is a
   `deploy.yml` run on `main` that was running when the record was made.
5. **Infrastructure is applied by a human** from the CI plan. CI shows only a plan's
   add/change/destroy counts and the destructive flag; no full plan in logs, comments, the step
   summary or artifacts. There is no apply role in v1.
6. **Env tfvars live in the state bucket**, one KMS-encrypted object per environment, read by
   the plan role and used by the human apply. Never committed.
7. **Region near Pakistan** (`me-central-1` or `ap-south-1`), with a regional ALB certificate;
   CloudFront keeps its `us-east-1` certificate.
8. **The app connects directly to RDS on 5432 in v1**, with a `DatabaseConnections` alarm at
   about 80% of `max_connections`; a pooler is deferred. This amends `infra/AGENTS.md` rule 2:
   code stays pooler-safe.
9. **Production approval** is the `production` Environment's required reviewer. The user is
   the only reviewer, so `prevent_self_review=false`. The skill approves through
   `POST …/actions/runs/<id>/pending_deployments` only on the user's explicit yes in chat,
   after a summary. The Claude Code `ask` rules on that call are a **second control, not
   enforcement**: a differently spelled command can sidestep a pattern rule. Enforcement is the
   Environment's reviewer rule.
10. **Migrations are guarded.** `check_migrations.py` fails a contract (non-expand) finding
    unless `allow_contract_migration=true`, and a review finding unless
    `acknowledge_migration_review=true`; production refuses a SHA staging never ran unless
    `allow_unstaged_sha=true`; a rollback across a `contract_override` deployment needs
    confirmation. Every override is recorded in the run summary and the Deployment.
11. **Dashboard promotion to production is a launch blocker** until the dashboard reads its
    `NEXT_PUBLIC_*` values at runtime (`launch-blocker:dashboard-runtime-env` in
    `docs/deferred-work.md`); the skill refuses `promote production` while it is open.
12. **Run logs are public.** No step prints a secret, a full migrate log (only exit status and
    error lines) or AWS output beyond IDs and statuses.

## Alternatives considered

- **Deploy from a laptop through the skill** — why not: the guardrail blocks it, credentials
  would live on a laptop, and nothing would record who deployed what.
- **Long-lived AWS keys in GitHub secrets** — why not: OIDC gives short-lived, per-environment
  credentials with nothing to rotate or leak.
- **ECR repositories per environment** — why not: promotion would need a copy, breaking "the
  exact bytes staging ran".
- **Deployed SHA in SSM or an ECS tag** — why not: the Deployments API already records
  environment, SHA, status and actor, readable with `gh` and no AWS credentials.
- **Terraform apply from CI** — deferred: infra changes are rare and high-risk.
- **A deploy tool (Copilot, Proton, Spinnaker)** — why not: plain ECS with Terraform; the
  official `aws-actions/*` ECS actions cover render, deploy and wait.
- **Approval only in the GitHub UI** — not chosen by the user; the UI is the fallback.
- **Count-based ECR expiry, or retagging production's image** — why not: enough staging builds
  expire the image production runs; retagging needs `ecr:PutImage` on the production role.
- **A pooler in v1** — deferred: direct connections with an alarm suffice at launch load.
- **Trusting any workflow in the `production` Environment (default `sub`)** — why not: a new
  workflow file naming `environment: production`, once merged, could assume the role.
- **Env tfvars as `TF_VAR_*` repository variables, or committed tfvars** — why not: about thirty
  values per environment visible to every collaborator and drifting from the applied file; and
  a public repository must not publish account IDs, ARNs and CIDRs.

## Consequences

- Deploys need no AWS credentials on any laptop, and every deploy has a record and a run log.
- Nothing works until a human runs the first-time order of operations in
  `infra/runbooks/deploy.md` (bootstrap apply, OIDC customisation, secrets, env apply).
- A single approver means no second person checks a production deploy (a deferred entry).
- Production's image must be refreshed within 365 days, or the next scale-out cannot pull it.
- A GitHub outage blocks deploys; `rollback.md` keeps a human-only break-glass path.
