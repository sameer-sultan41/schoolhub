# Deploy Pipeline and `schoolhub-deploy` Skill: Implementation Plan

> **For agentic workers:**
> - REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.
> - One implementer pass, then one `change-reviewer` pass with this plan, then one fix pass.
> - **L11 overrides (carry these into every brief):**
>   - Never run tests, lint, typecheck, `manage.py`, `terraform fmt`, `terraform validate` or the new `.github/scripts` checkers locally (ADR-0007). CI runs them.
>   - Never run `terraform init`, `plan`, `apply` or `output`, any `aws` command, or `docker build`. The guardrail blocks `apply`/`destroy` and mutating `aws` anyway.
>   - Stage only your own files, by path. Never `git add -A` or `git add .`.
>   - Never create, edit or read any `.env*` file.
>   - No AI attribution: no `Co-Authored-By` trailer, no "Generated with" line. The commit-msg hook and CI reject it.
>   - Never `--no-verify` or `SKIP_HOOKS=1`. Fix what a hook rejects.
>   - Never commit or push without the user's go-ahead.
>   - Write the report early, and update it as you go.
>   - `fix` commits carry a `Root cause:` line (ADR-0016).
>   - Run `docs/07-quality/agent-lessons.md` §2 before handing back.
> - Library mechanics come from Context7, version-matched (Decisions cite what was checked).

**Work tier:** 2

**Revision 2 (2026-11-28):** revised after the plan-reviewer's REVISE verdict (2026-11-26). The user's decisions of 2026-11-28 and the author's three rulings are recorded under "User decisions"; the finding-by-finding map is in "Independent review".

**Goal:** Deploys run only through GitHub Actions, never by hand. One `schoolhub-deploy` skill asks the operator for every input, checks every precondition it can, starts and watches the deploy, explains failures from an error catalogue, verifies the result, and drives rollback.

---

## Context

- `infra/runbooks/deploy.md` describes a deploy workflow that does not exist: staging deploys automatically on merge to `main`, and production waits for a manual Environment gate. `.github/workflows/` has no deploy workflow.
- `infra-terraform.yml` only plans, and its plan step is disabled because no state backend exists. `envs/*/backend.tf` points at an S3 backend nobody has created.
- The AWS account is **not set up at all** (user, 2026-11-23). The role ARNs in the repo use the placeholder account `123456789012`, and Terraform declares no ECR repositories and no GitHub OIDC trust.
- The guardrail hook blocks agents from `terraform apply/destroy` and from mutating `aws`, so the skill never deploys from a laptop. It drives GitHub Actions through `gh`.
- PR #200 (this branch's base) makes the stack deployable: real settings module, health checks, website secrets, ALB restricted to CloudFront, and a `website-image` CI build.

## Decisions

These are fixed here so every task uses the same names.

| # | Decision | Choice |
|---|---|---|
| D1 | Where deploys run | GitHub Actions only. The skill triggers and watches with `gh`; it never runs `terraform apply` or a mutating `aws` command. |
| D2 | AWS auth from CI | GitHub OIDC (`token.actions.githubusercontent.com`), no stored keys. Each role trusts only this repository. The repository's OIDC `sub` is **customised** (author ruling 2) with `include_claim_keys = ["repo", "context", "job_workflow_ref"]`, so every token's `sub` reads `<prefix>:<context>:job_workflow_ref:<owner>/<repo>/.github/workflows/<file>@<ref>`. The production deploy role trusts only `<prefix>:environment:production:job_workflow_ref:<owner>/<repo>/.github/workflows/deploy-env.yml@refs/heads/main`; the staging deploy role trusts the same with `environment:staging`. No other workflow file, and no other branch, can assume a deploy role (Task 1). |
| D3 | Roles | Per environment: `schoolhub-gha-plan-<env>` (read-only, used by `infra-terraform.yml`) and `schoolhub-gha-deploy-<env>` (least privilege: register task definitions, update the env's ECS services, `iam:PassRole` for that env's task and execution roles only, `ecs:RunTask` for the migrate task, CloudWatch Logs read, `cloudfront:CreateInvalidation` on that env's distribution). Only the **staging** deploy role pushes to ECR; the production role can only describe images (`ecr:DescribeImages`), and cannot pull, push or retag; ECS pulls with each task's execution role. Every role has `max_session_duration = 7200`, and the workflow requests at most 7200 s. The staging plan role trusts `pull_request` and `ref:refs/heads/main` runs of `infra-terraform.yml`; the production plan role trusts only `ref:refs/heads/main`. Plan roles can write only the state lock file (S3 and KMS). Infra changes are applied by a human; there is no apply role in v1. |
| D4 | Accounts | One AWS account holds both environments, separated by name prefix and state key. A second account for production can come later without changing the workflow (role ARNs are variables). |
| D5 | ECR | Three repositories (`schoolhub/api`, `schoolhub/dashboard`, `schoolhub/website`) live in the **bootstrap** root, not in the env roots, because one image tagged by git SHA is promoted from staging to production unchanged (`infra/AGENTS.md` rule 5). Tags are immutable. Expiry is **age-based** (author ruling 3): SHA tags expire 365 days after push, untagged images after 7 days. A count-based rule could expire the image production still runs after enough staging builds; an age-based one cannot surprise anyone, and the deploy warns when production's SHA passes 300 days (Task 5, Task 7). Retagging a running image to protect it would need `ecr:PutImage` on the production role, which D3 withholds. Scanning is a registry-level `aws_ecr_registry_scanning_configuration`. |
| D6 | State | One S3 bucket with versioning and encryption, native S3 locking (`use_lockfile = true`, no DynamoDB table), state keys `schoolhub/<env>/terraform.tfstate`. The bootstrap root keeps local state, committed nowhere, and its outputs are recorded in GitHub variables. |
| D7 | GitHub configuration | **The single list; every task uses exactly these names.** Repository variables: `AWS_REGION`, `AWS_ACCOUNT_ID`, `ECR_REGISTRY`, `WEBSITE_IMAGE_HOSTNAME`, `PLAN_ROLE_ARN_STAGING`, `PLAN_ROLE_ARN_PRODUCTION`, `TF_STATE_BUCKET`, `TF_STATE_KMS_KEY_ARN` (plan roles are repo variables because a pull-request plan cannot enter a gated Environment). Environment variables (`staging`, `production`): `DEPLOY_ROLE_ARN`, `ECS_CLUSTER`, `SMOKE_TENANT_SLUG`, `PLATFORM_DOMAIN`, `CLOUDFRONT_DISTRIBUTION_ID`, `MIGRATE_TASK_FAMILY`, `PRIVATE_SUBNETS`, `MIGRATE_SECURITY_GROUP`. `SMOKE_TENANT_SLUG` may stay empty until the smoke tenant is seeded (D12). No secrets in GitHub: AWS access is OIDC, app secrets stay in Secrets Manager. `production` has the user as its only required reviewer, `prevent_self_review = false` (user decision), and allows deploys from `main` only. |
| D8 | Build | Images are built once per SHA, on the push to `main`, after CI is green, tagged with the full git SHA, for `linux/arm64` (the task definitions run on ARM64), on GitHub's `ubuntu-24.04-arm` runners (free for public repositories; no QEMU path). The build job lives in `deploy-env.yml` and runs only for staging deploys, so that the staging deploy role's trust (D2) names one workflow file. A production deploy never builds; it promotes a tag that already exists in ECR and fails if the tag is missing. |
| D9 | Rollout order | migrate (one-off task, exit 0 required) → api → celery-worker → dashboard → website → celery-beat. Beat goes last and always at desired count 1, with deployment max 100% / min 0% so the old scheduler stops before the new one starts (the module's 200%/100% default would run two schedulers during a deploy; Task 2 fixes it). Each step waits for service stability; the ECS circuit breaker rolls back a failed service. |
| D10 | Tracking what is deployed | GitHub Deployments API: each run creates a deployment for the environment with the SHA, and marks it `success` or `failure`. "Currently deployed SHA" is the latest successful deployment for that environment. Jobs that name an Environment set `deployment: false` so GitHub does not create a second record, and records carry `task: deploy` so reads filter on it. Because `auto_inactive` retires old records, the promotion check accepts any past `success` status for the SHA, not only the latest. Every record carries the deployed SHA in `payload.target_sha`, and every reader uses that field, not the record's `sha`, so the `ref: main` fallback of Task 5.5 (N13) changes nothing for readers. The skill and the migration guard both read it through `deployments.py`. |
| D11 | Migration safety | A checker (`.github/scripts/check_migrations.py`, with a unittest run in CI) scans migrations added between the deployed SHA and the target SHA. **Contract** findings (non-expand: `RemoveField`, `DeleteModel`, `RenameField`, `RenameModel`, `AlterField` that narrows, sets NOT NULL or changes `db_column`, `AddField` NOT NULL without `db_default`, and the raw-SQL patterns of Task 4.1) fail unless `allow_contract_migration=true`. **Review** findings (`RunPython`, unknown or unreadable operations, edited migrations) fail unless `acknowledge_migration_review=true` (decided here: a human must look; a warning nobody reads is not a gate). `preview` runs it before approval, and `deploy-env.yml` re-runs it; both record any override. |
| D12 | Smoke tests | After rollout: `https://api.<domain>/healthz`, `https://app.<domain>/api/health`, a seeded tenant site at `https://<slug>.<domain>/api/health`, and a home-page render. The tenant checks are **skipped, with a `::notice::`**, while `SMOKE_TENANT_SLUG` is empty, so the first deploy (before any tenant exists) can pass; the order of operations seeds the smoke tenant right after it (Task 2). They run from the workflow; failure marks the deployment failed and prints the rollback command. |
| D13 | Rollback | The same workflow with `mode=rollback` and a previous SHA: no build, no migration (expand-only means the old code runs on the new schema), redeploy that SHA's images, then invalidate the CloudFront distribution. A rollback across a deployment that carried `contract_override` is refused unless `allow_contract_migration=true` confirms it (Task 5). |
| D14 | Production approval | The workflow waits on the `production` Environment. The skill shows the SHA, the migration diff and the check results, asks the user in chat, and only on an explicit yes approves with `gh api -X POST repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments` (`state=approved`), recorded under the user's account. A Claude Code `ask` rule on that call (Task 7.8) is a second control, not enforcement (ADR-0040). |
| D15 | Concurrency | `concurrency: deploy-<env>`, never cancel in progress. CI workflows the gate reads never cancel a `main` run either (Task 4.4). |
| D16 | Triggers | Staging: `push` to `main`, gated by a `ci_gate.py` check that CI is green for that SHA (`workflow_run` is unusable because the CI workflows are path-filtered). Production and rollback: `workflow_dispatch` only, with an explicit `sha`. `run-name` is `deploy <environment> <sha> (<mode>)`, with the SHA as `inputs.sha \|\| github.sha` (Task 5.2), so the skill can find its run. Inputs: `environment`, `sha`, `mode` (deploy\|rollback), `allow_contract_migration`, `allow_unstaged_sha`, `acknowledge_migration_review`, `dry_run`. Every override is passed through `deploy-env.yml` and recorded in the run summary and the deployment payload. A deploy never goes backwards: in `mode=deploy` the target must descend from the running SHA (`git merge-base --is-ancestor`); a push run that fails this is skipped as superseded, and a dispatch fails and points to `mode=rollback` (Task 5.3, N6). The workflow's `name:` is `deploy`. |
| D18 | Runtime wiring found missing | Task 2 also fixes two existing gaps: every execution role gets `kms:Decrypt` on the Redis auth-token key (api, worker and beat otherwise fail at task start), and the API settings build `REDIS_URL`, `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND` from `REDIS_HOST`/`REDIS_PORT` plus the `REDIS_AUTH_TOKEN` secret, as `rediss://…?ssl_cert_reqs=required` (they fall back to `localhost` today, and nothing reads `REDIS_AUTH_TOKEN`). The token never appears in a task definition. |
| D19 | Bootstrap details | `backend.tf` takes bucket, region, key and KMS key at `terraform init` (a backend block cannot read variables). The OIDC `sub` prefix is a bootstrap variable, because repositories created after 15 July 2026 use the immutable `repo:owner@id/repo@id` form. The production plan role trusts `ref:refs/heads/main` only, because a plan reads production state, which holds the database master password. Bootstrap state starts local and is moved into the state bucket right after the first run. Terraform `required_version >= 1.11` everywhere this plan touches (S3 native locking is GA there). |
| D17 | Dashboard promotion | The dashboard inlines `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_PLATFORM_DOMAIN` at build time, so its image cannot be promoted unchanged. Moving them to runtime is **split out into its own plan and PR** (author ruling 1; pointer in "Task 5b"). Until that PR lands, **dashboard promotion to production is a LAUNCH BLOCKER**: `docs/deferred-work.md` carries the marker `launch-blocker:dashboard-runtime-env`, and the skill's `promote production` refuses while it is open, unless the user overrides it explicitly in chat. This plan's dashboard Dockerfile gets build-only placeholders so the image builds. |
| D20 | Region | A region near Pakistan (`me-central-1` or `ap-south-1`), chosen at bootstrap (user decision). Everything except CloudFront's certificate lives there. The ALB gets its own regional ACM certificate, DNS-validated in Route 53; CloudFront keeps its `us-east-1` certificate (Task 2). |
| D21 | Database connections | The app connects directly to RDS on 5432 for v1; no PgBouncer (user decision). A `DatabaseConnections` alarm at about 80% of the instance's `max_connections` watches it, and a pooler (PgBouncer or RDS Proxy) is a deferred entry. `infra/AGENTS.md` rule 2 is amended (Task 8). |
| D22 | Public repository | Workflow run logs and step summaries are public. Nothing secret or tenant-identifying goes into either: the migrate step prints only its exit status and `ERROR`/`Traceback` lines, never the full log, and never to the step summary. **Terraform plans** (coordinator ruling N11): CI posts only the resource counts (add/change/destroy) and the destructive-change flag. No full plan goes into logs, PR comments, the step summary or artifacts; the human reads the full plan at apply. |
| D23 | Where env tfvars live | Coordinator ruling N3. Each environment's non-secret tfvars are one file in the state bucket, `s3://<TF_STATE_BUCKET>/schoolhub/<env>/terraform.tfvars` (SSE-KMS with the state key, versioned with the bucket). The CI plan role reads it (`s3:GetObject` on its own env's object only), and the human apply uses the same file (`aws s3 cp` to a git-ignored local copy, then `-var-file`). The plan row stays disabled until the file exists. The skill's bootstrap mode creates it from `terraform.tfvars.example` after the user fills the values. Alternatives 12–13. |

## Alternatives considered (why not)

1. **Deploy from the laptop through the skill.** Rejected: the guardrail blocks it, credentials would live on a laptop, and nothing would record who deployed what.
2. **Long-lived AWS access keys in GitHub secrets.** Rejected: OIDC gives short-lived credentials scoped per environment and leaves nothing to rotate or leak.
3. **ECR repositories per environment.** Rejected: it forces a cross-account or cross-repo copy on promotion and breaks "the exact bytes staging ran".
4. **Track the deployed SHA in SSM or an ECS tag.** Rejected for v1: the GitHub Deployments API already records environment, SHA, status and actor, and the skill can read it with `gh` without AWS credentials.
5. **Terraform apply from CI.** Deferred: infra changes are rare and high-risk; a human applies with the plan from CI in front of them. An apply workflow can follow once the plan step has run cleanly for a while.
6. **A deploy tool (Copilot, Proton, Spinnaker).** Rejected: the stack is plain ECS with Terraform, and the official `aws-actions/*` ECS actions cover render, deploy and wait.
7. **Approving production only in the GitHub UI.** Not chosen (user decision D14), but the skill falls back to printing the approval link if the API approval fails.
8. **Count-based ECR expiry (keep the last N SHAs).** Rejected (author ruling 3): enough staging builds expire the image production is running, and the next scale-out or task replacement then fails to pull. Age-based expiry plus a 300-day staleness warning cannot fail that way silently.
9. **Retag production's image (`prod-current`) so expiry skips it.** Rejected: retagging is `ecr:PutImage`, which D3 withholds from the production role so that production can never push.
10. **A pooler in v1 (PgBouncer ECS service or RDS Proxy).** Deferred (user decision D21): direct connections with an alarm are enough for launch load; the pooler is a deferred entry.
11. **Trusting any workflow in the `production` Environment (default `sub`).** Rejected (author ruling 2): a new workflow file that names `environment: production`, merged to `main`, could assume the role. Customising `sub` with `job_workflow_ref` pins the role to `deploy-env.yml@refs/heads/main`.
12. **Env tfvars as `TF_VAR_*` repository variables.** Rejected (D23): about thirty values per environment, visible to every collaborator, and a second source beside the file the human applies with, so the two drift.
13. **Committed `terraform.tfvars`.** Rejected (D23): the repository is public, and the files hold account IDs, ARNs, CIDRs and domain names that need not be published. The `.example` files stay committed as the template.

## User decisions (decided 2026-11-28)

Decided by the user on 2026-11-28 and binding on every task:
- **Region:** near Pakistan (`me-central-1` or `ap-south-1`), chosen at bootstrap. The ALB gets its own regional ACM certificate, DNS-validated in Route 53; CloudFront keeps its `us-east-1` certificate (D20, Task 2).
- **Database:** the app connects directly to RDS on 5432 for v1, no PgBouncer. `--app-db-port` defaults to 5432 (Task 3); `infra/AGENTS.md` rule 2 is amended and ADR-0040 records it (Task 8); a `DatabaseConnections` alarm at about 80% of `max_connections` (Task 2); a deferred entry for a pooler (D21).
- **Approver:** the user is the only production approver, so the `production` Environment uses `prevent_self_review=false`. The skill still requires an explicit yes in chat every time (D7, D14).
- **Claude Code ask rule:** `.claude/settings.json` gets `ask` rules for `Bash(gh api *pending_deployments*)` and `Bash(curl *pending_deployments*)`. ADR-0040 says this is a second control, not enforcement (Task 7.8).
- **Staging state:** the user accepts that a collaborator's PR plan for staging can read staging state (Task 1, Task 6).

Decided by the author on 2026-11-28:
1. **Task 5b is split out** into its own plan and PR; dashboard promotion to production is a LAUNCH BLOCKER until it lands (D17).
2. **OIDC `sub` customised with `job_workflow_ref`** so only `deploy-env.yml@refs/heads/main` can assume a deploy role (D2, ADR-0040).
3. **Age-based ECR expiry** (365 days for SHA tags, 7 days untagged) plus a 300-day staleness warning (D5).

Values still asked at bootstrap (never stored in the repo): AWS account ID, the exact region, the production platform domain (staging is `staging.<domain>`), the user's GitHub login for the reviewer, and confirmation of D4 (one account for both environments).

## Global Constraints

- `infra/AGENTS.md` non-negotiables hold, especially rule 5: never rebuild between environments.
- Migrations are expand-only; the deploy blocks anything else unless explicitly overridden (D11).
- No AWS keys, tokens or ARNs with real account IDs committed; all come from GitHub variables (D7).
- Every workflow pins third-party actions to a full commit SHA, with the version in a comment.
- Every new script has a unittest that CI runs; the plan-review and doc-sync gates apply.
- **The repository is public, so run logs and step summaries are public** (D22). No workflow step prints a secret, a full migrate log, a tenant name other than the smoke slug, or AWS output beyond IDs and statuses.
- The workflow and every IAM role agree on session length: roles allow 7200 s, the workflow requests at most 7200 s.
- Docs change in the same PR: `deploy.md`, `rollback.md`, `hosting-deployment.md`, `infra/README.md`, `infra/AGENTS.md`, `project-status.md`, `deferred-work.md`.

## Review Focus

1. **IAM blast radius.** Can the staging deploy role touch production? Can a workflow from a fork, another branch or another workflow file assume the production role (`job_workflow_ref`, D2)? Is `iam:PassRole` limited to the env's own task roles? Does `check_task_definition.py` stop a cross-environment render?
2. **Promotion integrity.** Can a production deploy ever build, or deploy a tag staging never ran?
3. **Destructive migrations.** Does the guard catch `RemoveField`, `DeleteModel`, renames, narrowing `AlterField` and raw SQL drops, and is the override visible in the run and the deployment record?
4. **Beat singularity and rollout order.** Is celery-beat always last and always one task, including on rollback?
5. **Approval.** Can the skill approve production without the user's explicit yes in that conversation?

## Task 1: Bootstrap Terraform root

A new root, `infra/terraform/bootstrap/`, holds everything that must exist before any environment
can be planned: the state bucket, the GitHub OIDC provider, the four CI roles and the three ECR
repositories. A human applies it once with local state (D6), then records its outputs as GitHub
variables (D7).

Library mechanics checked in Context7:
- AWS provider `/hashicorp/terraform-provider-aws/v6.33.0`: `aws_iam_openid_connect_provider` needs only `url` and `client_id_list`. `thumbprint_list` is optional, and AWS ignores it for GitHub because it validates against its own CA library.
- `aws_ecr_lifecycle_policy`: rule `selection` with `tagStatus`, `tagPatternList`, `countType = sinceImagePushed`, `countUnit = days` and `countNumber`. `aws_ecr_registry_scanning_configuration` sets scanning for the whole registry (`scan_type = BASIC`, a `rule` with `scan_frequency = SCAN_ON_PUSH` and a `repository_filter`).
- GitHub OIDC customisation (`/websites/github_en_actions` "Customizing the subject claims", `/websites/github_en_rest` "Set the customization template for an OIDC subject claim for a repository"): `PUT /repos/{owner}/{repo}/actions/oidc/customization/sub` with `{"use_default": false, "include_claim_keys": ["repo", "context", "job_workflow_ref"]}`. The resulting `sub` is `repo:<owner>/<repo>:environment:<env>:job_workflow_ref:<owner>/<repo>/.github/workflows/<file>@<ref>`; for a job without an Environment the `context` part is `ref:refs/heads/main` or `pull_request`. The template applies to every workflow in the repository, so every trust policy in this root uses the customised form. For a reusable workflow, `job_workflow_ref` names the called file (`deploy-env.yml`), not the caller.
- Terraform `/websites/developer_hashicorp_terraform`: the S3 backend's `use_lockfile` writes `<key>.tflock` beside the state, which needs `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on that object. `terraform test` provides `mock_provider` with `mock_data` defaults.
- `/aws-actions/configure-aws-credentials/v6.3.0`:
  - `sub` is `repo:<owner>/<repo>:environment:<name>` for a job in an Environment, `…:ref:refs/heads/<branch>` for a branch run, and `…:pull_request` for a PR run.
  - `aud` is `sts.amazonaws.com`.
  - Repositories created on or after 15 July 2026, or opted in, emit the immutable form `repo:<owner>@<org_id>/<repo>@<repo_id>:…`. A trust policy written in the wrong form fails with `Not authorized to perform sts:AssumeRoleWithWebIdentity`. The subject prefix is therefore a variable, never derived from the repository name.

**Files:**
- Create in `infra/terraform/bootstrap/`:
  - `versions.tf`: `required_version >= 1.11`, `hashicorp/aws ~> 6.0`, no `backend` block, so state stays local (D6);
  - `variables.tf`, `main.tf` (provider, `data "aws_caller_identity"`, locals);
  - `state.tf`, `oidc.tf`, `roles.tf`, `ecr.tf`, `outputs.tf`;
  - `terraform.tfvars.example`;
  - `README.md`, holding the first-run sequence below;
  - `tests/bootstrap.tftest.hcl`.
- Modify:
  - `.github/workflows/infra-terraform.yml`: add `infra/terraform/bootstrap` to the `validate` matrix, and add a `terraform test` step that runs only for that directory. Task 6 owns the rest of this file.
  - `infra/terraform/README.md` "Before the first apply": replace steps 1–2 (the hand-made per-env buckets and roles) with "apply `bootstrap/`", and drop "ECR repositories" from "What is not here yet".
- `*.tfstate` and `*.tfvars` are already ignored by `infra/.gitignore`, so no ignore change is needed.

**Interfaces:**
- **Variables:**
  - `aws_region` (no default; the user's choice), validated against an allow-list: `contains(["me-central-1", "ap-south-1"], var.aws_region)` (D20, L-b). The env roots' `aws_region` gets the same validation. Widening the list is a reviewed change, not a tfvars edit.
  - `github_oidc_subject_prefix`: the exact `repo:<owner>/<repo>` or immutable `repo:<owner>@<id>/<repo>@<id>`. Validation: `^repo:[^:*?]+$`, so no wildcards are allowed.
  - `github_repository`: `<owner>/<repo>`, the path inside `job_workflow_ref` (which uses names even when the prefix uses the immutable IDs). Validation `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`.
  - `ecr_sha_tag_max_age_days` (default `365`, validation `>= 330`, so it always exceeds the 300-day staleness warning by a month);
  - `ecr_untagged_max_age_days` (default `7`);
  - `state_admin_principal_arns` (list, at least 1): the human admin principals exempt from the state-bucket deny below;
  - `create_oidc_provider` (default `true`). An account allows one provider per URL; set it to `false` if one already exists, which switches to a `data` source.
- **Names, as locals declared once in `main.tf`:**
  - `environments = toset(["staging", "production"])`;
  - `state_bucket = "schoolhub-tfstate-${account_id}"`. Bucket names are global, and the account ID makes this one unique without a user decision.
  - `state_key(env) = "schoolhub/${env}/terraform.tfstate"` (D6);
  - `deploy_role_name(env) = "schoolhub-gha-deploy-${env}"`, `plan_role_name(env) = "schoolhub-gha-plan-${env}"` (D3);
  - `env_prefix(env) = "schoolhub-${env}"`. This matches `local.name_prefix` in `envs/*/main.tf`, so a policy scoped to `schoolhub-staging-*` cannot match a `schoolhub-production-*` resource.
- **Outputs** (`outputs.tf`):

  | Output | Value | Becomes |
  |---|---|---|
  | `aws_account_id` | caller account | repo var `AWS_ACCOUNT_ID` |
  | `aws_region` | `var.aws_region` | repo var `AWS_REGION` |
  | `ecr_registry` | `${account}.dkr.ecr.${region}.amazonaws.com` | repo var `ECR_REGISTRY`; env tfvar `ecr_registry` (Task 2) |
  | `ecr_repository_urls` | map `api`/`dashboard`/`website` → URL | read by Task 5 |
  | `state_bucket_name` | the bucket | repo var `TF_STATE_BUCKET` |
  | `state_kms_key_arn` | the state CMK | repo var `TF_STATE_KMS_KEY_ARN` |
  | `deploy_role_arns` | map env → ARN | env var `DEPLOY_ROLE_ARN` |
  | `plan_role_arns` | map env → ARN | repo vars `PLAN_ROLE_ARN_STAGING`, `PLAN_ROLE_ARN_PRODUCTION` |
  | `oidc_subject_template` | `{ use_default = false, include_claim_keys = ["repo", "context", "job_workflow_ref"] }` | the body of the human's `gh api -X PUT …/oidc/customization/sub` (first run, below) |
  | `github_variables` | one object `{ repository = {…}, environments = { staging = {…}, production = {…} } }` holding all of the above under their D7 names | the single thing Task 7's bootstrap mode asks the human to paste |

- **Plan role ARNs are repository variables** (D7). `infra-terraform.yml` runs on `pull_request`; a job that declares `environment: production` would get that Environment's branch policy and reviewer, so every PR's plan would block. The plan job declares no Environment, and its `sub` context is `pull_request` or `ref:refs/heads/main`.
- **Trust policies** are built with `jsonencode()` in locals, not `aws_iam_policy_document`. A mocked provider returns placeholder JSON for data sources, so only locals can be asserted in `terraform test`. Every statement uses `Action = "sts:AssumeRoleWithWebIdentity"`, `Principal.Federated = <oidc provider arn>` and `StringEquals` on `token.actions.githubusercontent.com:aud = "sts.amazonaws.com"`, plus the `sub` condition. With `wf(file, ref) = "job_workflow_ref:${var.github_repository}/.github/workflows/${file}@${ref}"` (author ruling 2, D2):

  | Role | `sub` condition |
  |---|---|
  | `schoolhub-gha-deploy-staging` | `StringEquals`: `${prefix}:environment:staging:${wf("deploy-env.yml", "refs/heads/main")}` |
  | `schoolhub-gha-deploy-production` | `StringEquals`: `${prefix}:environment:production:${wf("deploy-env.yml", "refs/heads/main")}` |
  | `schoolhub-gha-plan-staging` | `StringEquals`: `${prefix}:ref:refs/heads/main:${wf("infra-terraform.yml", "refs/heads/main")}`; plus `StringLike`: `${prefix}:pull_request:${wf("infra-terraform.yml", "refs/pull/*/merge")}`. The PR number is the only wildcard; a test pins that. |
  | `schoolhub-gha-plan-production` | `StringEquals`: `${prefix}:ref:refs/heads/main:${wf("infra-terraform.yml", "refs/heads/main")}` only |

  The deploy roles are assumed only inside `deploy-env.yml` (Task 5), which is why the build job lives there too. A new workflow file naming `environment: production` cannot assume the production role, even after merge.

  Why the production plan role refuses PR runs: a plan executes the PR's own HCL, and an `external` data source or a crafted provider block runs arbitrary code with the plan role's credentials. That role reads production state, which holds the RDS master and Redis passwords. Fork PRs get no OIDC token, and Task 6 skips fork PRs anyway, but any collaborator's branch would get one. Production is planned only on `push` to `main` and by `workflow_dispatch` from `main`. The staging plan role does accept same-repository PRs, so a collaborator's PR plan can read staging state; the user accepted that on 2026-11-28.

  **Session length:** every role sets `max_session_duration = 7200`. The deploy workflow requests `role-duration-seconds: 7200` at most (Task 5.4); a request above the role's maximum fails the assume.
- **Deploy-role permissions in this root** cover only what is not environment-specific. The env roots attach the rest (Task 2, `aws_iam_role_policy.gha_deploy`), because only they know the cluster, service, task-role and distribution ARNs. Wildcards are not used to guess those ARNs.

  | Role | Statement | Actions | Resource |
  |---|---|---|---|
  | deploy-staging | `EcrAuth` | `ecr:GetAuthorizationToken` | `*` (the action has no resource level) |
  | deploy-staging | `EcrPush` | `ecr:BatchCheckLayerAvailability`, `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload`, `PutImage`, `BatchGetImage`, `DescribeImages` | the three repo ARNs |
  | deploy-production | `EcrRead` | `ecr:DescribeImages` only | the three repo ARNs |

  The production deploy role's whole ECR action set is `["ecr:DescribeImages"]` (N1). The rollout job runs no ECR login (`aws ecr describe-images` is an ECR API call and needs no registry login), and ECS pulls images with each task's **execution** role, not the deploy role. So production needs neither `ecr:GetAuthorizationToken` nor `ecr:BatchGetImage`. Staging keeps `EcrAuth` and `EcrPush` for its build job.

  **The production deploy role gets no push** (D3), so Review Focus 2 is an IAM fact rather than a workflow convention: a production run cannot build, push or retag, only check that the tag exists (D8). That is also why expiry is age-based (D5): the production role cannot protect its running image by retagging it. Staging's build job (Task 5) runs inside `deploy-env.yml` in the `staging` Environment to assume the staging deploy role.
- **Plan-role permissions** (`<env>` is that role's own environment, `<other>` the other one):
  - Attach the managed policy `arn:aws:iam::aws:policy/ReadOnlyAccess`, which covers the `Describe*`/`Get*`/`List*` calls that refresh needs.
  - `StateRead`: `s3:ListBucket` on the bucket, with `StringLike s3:prefix = schoolhub/<env>/*`; `s3:GetObject` on `<bucket>/schoolhub/<env>/terraform.tfstate` and on `<bucket>/schoolhub/<env>/terraform.tfvars` (D23, N3). The tfvars object is SSE-KMS with the state key, which `Decrypt` below already covers.
  - `StateLock`: `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on `<bucket>/schoolhub/<env>/terraform.tfstate.tflock` (`use_lockfile`). There is no `PutObject` on the state itself.
  - `StateLockKms`: `kms:GenerateDataKey` and `kms:Encrypt` on `aws_kms_key.tfstate.arn` (by ARN, not alias). Writing the lock file under SSE-KMS generates a data key; without this the first plan fails at `Acquiring state lock`. These two actions on the state key are the only KMS write the plan role has.
  - `TfManagedSecrets`: refresh reads `aws_secretsmanager_secret_version`. Allow `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:<r>:<a>:secret:schoolhub-<env>/rds/master-*` and `…:secret:schoolhub-<env>/redis/auth-token-*` only.
  - `Decrypt`: `kms:Decrypt` on `*` with `ForAnyValue:StringEquals kms:ResourceAliases = [alias/schoolhub-tfstate, alias/schoolhub-<env>-rds, alias/schoolhub-<env>-redis]`.
  - `DenyOtherData`: `Effect = Deny`, `s3:GetObject*` with `NotResource = [the state, lock and tfvars keys above]`. `ReadOnlyAccess` would otherwise read every object in the account, including the other environment's state, tenant uploads and backups.
  - `DenyOtherSecrets`: `Deny secretsmanager:GetSecretValue` on `arn:…:secret:schoolhub-<other>/*`.
  - `DenyDataPlaneReads`: `Effect = Deny` on data-plane reads that `ReadOnlyAccess` grants and a plan never needs, outside the role's own prefix. Both plan roles get it; it matters most for staging, whose role accepts PR runs.
    - `logs:GetLogEvents`, `logs:FilterLogEvents`, `logs:StartQuery`: `NotResource = arn:aws:logs:<r>:<a>:log-group:/ecs/schoolhub-<env>-*` (and `…:*` for streams). Application logs can carry tenant data.
    - `rds:DownloadDBLogFilePortion`: `NotResource = arn:aws:rds:<r>:<a>:db:schoolhub-<env>-*`.
    - `ssm:GetParameter`, `ssm:GetParameters`, `ssm:GetParametersByPath`: `NotResource = arn:aws:ssm:<r>:<a>:parameter/schoolhub-<env>/*`.
    - `ecr:GetDownloadUrlForLayer`: `Resource = *`. The ECR repositories are shared by both environments (D5) and a plan never pulls an image layer.
- **The state bucket** (`state.tf`):
  - `aws_kms_key.tfstate`: `enable_key_rotation = true`, `deletion_window_in_days = 30`, alias `alias/schoolhub-tfstate`;
  - `aws_s3_bucket.tfstate`: `force_destroy = false`, `lifecycle { prevent_destroy = true }`;
  - `aws_s3_bucket_versioning`: `Enabled`;
  - `aws_s3_bucket_server_side_encryption_configuration`: `aws:kms` with the key, `bucket_key_enabled = true`;
  - `aws_s3_bucket_public_access_block`: all four `true`;
  - `aws_s3_bucket_ownership_controls`: `BucketOwnerEnforced`;
  - `aws_s3_bucket_lifecycle_configuration`: noncurrent versions expire after 90 days, and incomplete multipart uploads abort after 7.
  - `aws_s3_bucket_policy`, with two statements:
    - `DenyInsecureTransport`: `aws:SecureTransport = false`;
    - `DenyHistoryErasure`: `s3:DeleteObjectVersion`, `s3:PutBucketVersioning`, `s3:PutLifecycleConfiguration` and `s3:DeleteBucketPolicy`, denied unless `ArnNotLike aws:PrincipalArn` matches `var.state_admin_principal_arns`. A compromised CI role cannot erase state history, which is the requirement in today's `backend.tf` comment.
  - No DynamoDB table: locking is the S3 lock file (D6).
- **ECR** (`ecr.tf`): `for_each = toset(["api", "dashboard", "website"])`.
  - `aws_ecr_repository`: `name = "schoolhub/${each.key}"` (D5), `image_tag_mutability = "IMMUTABLE"`, `encryption_configuration { encryption_type = "AES256" }`, `force_delete = false`. No per-repository `image_scanning_configuration`; scanning is set once for the registry (below).
  - `aws_ecr_lifecycle_policy` (age-based, author ruling 3):
    - Rule 1, priority 1: `tagStatus = untagged`, `countType = sinceImagePushed`, `countUnit = days`, `countNumber = var.ecr_untagged_max_age_days` (7), expire.
    - Rule 2, priority 2: `tagStatus = tagged`, `tagPatternList = ["*"]`, `countType = sinceImagePushed`, `countUnit = days`, `countNumber = var.ecr_sha_tag_max_age_days` (365), expire. Every tag is a full SHA (D8), so `*` selects exactly the SHA tags.
    - Why age, not count: a count rule expires production's running image after N newer staging builds, with no warning. The production role cannot retag to protect it (`ecr:PutImage` is withheld, D3). With age-based expiry, the deploy workflow and the skill warn once production's SHA is older than 300 days (Task 5.4 step 7, Task 7.3), which leaves 65 days to ship a newer build.
  - `aws_ecr_registry_scanning_configuration.this`: `scan_type = "BASIC"`, one `rule { scan_frequency = "SCAN_ON_PUSH", repository_filter { filter = "schoolhub/*", filter_type = "WILDCARD" } }`. Nothing alerts on findings yet; Task 8 adds a deferred entry for an EventBridge alert on `ECR Image Scan` findings.
- **OIDC** (`oidc.tf`): `aws_iam_openid_connect_provider.github`, with `count = var.create_oidc_provider ? 1 : 0`, `url = "https://token.actions.githubusercontent.com"` and `client_id_list = ["sts.amazonaws.com"]`, without `thumbprint_list` (Context7). When the count is 0, `data "aws_iam_openid_connect_provider"` reads the existing provider by URL.

**First run (human only; agents never run this, per L11 and the guardrail):**

```bash
cd infra/terraform/bootstrap
cp terraform.tfvars.example terraform.tfvars        # git-ignored; fill aws_region (me-central-1 or ap-south-1, D20), github_oidc_subject_prefix, github_repository, state_admin_principal_arns
#   Subject prefix: `gh api repos/{owner}/{repo}/actions/oidc/customization/sub` (shows use_default / use_immutable_subject)
aws sts get-caller-identity                          # confirm the target account and an admin principal
aws account get-region-opt-status --region-name <region>   # me-central-1 is an opt-in region: must be ENABLED (ENABLED_BY_DEFAULT for ap-south-1); if not, `aws account enable-region` and wait (L-c)
terraform init                                       # local backend: creates ./terraform.tfstate
terraform plan -out=bootstrap.tfplan                 # read it: expect ~30 resources, 0 to destroy
terraform apply bootstrap.tfplan
terraform output -json oidc_subject_template > /tmp/oidc-sub.json
gh api -X PUT repos/{owner}/{repo}/actions/oidc/customization/sub --input /tmp/oidc-sub.json   # author ruling 2
gh api repos/{owner}/{repo}/actions/oidc/customization/sub     # expect use_default=false and the three claim keys
terraform output -json github_variables              # paste into the schoolhub-deploy bootstrap mode (Task 7)
```

The customisation and the trust policies must change together: before the `PUT`, every token carries the default `sub` and no role here accepts it; after it, a role written in the default form would fail. Nothing else in the repository uses OIDC today (`infra-terraform.yml`'s plan is disabled), so the switch breaks nothing.

Then copy `terraform.tfstate` to the team password manager as an attachment. It holds no secret values, but it is the only record that lets Terraform manage the roles and repositories later. The README says this in bold.

**Risks:**

| Risk | Mitigation |
|---|---|
| The `sub` form is wrong (legacy or immutable prefix, or the customised claim order differs from the docs), so every assume fails | Both parts are variables; the README shows how to read them; the first staging run's CloudTrail `AssumeRoleWithWebIdentity` event shows the exact `sub` received, and the deploy fails closed |
| Local bootstrap state is lost | Password-manager copy, plus an `import` block list in the README for every resource |
| Production's SHA reaches the 365-day expiry | Age-based rule (D5); the deploy and the skill warn from 300 days; Task 8 documents it in `rollback.md` |
| A staging-role-registered revision lands in a production family | The env policy's `PassRole` lets staging pass only staging roles; `RegisterTaskDefinition` tagging is scoped to the env's families; Task 5's `check_task_definition.py` asserts family, role ARNs and image registry after every render (H8) |

- [ ] Write `tests/bootstrap.tftest.hcl`. Use `mock_provider "aws" { override_during = plan }`, with `mock_data "aws_caller_identity" { defaults = { account_id = "111111111111" } }` and `variables { github_oidc_subject_prefix = "repo:acme/schoolhub", github_repository = "acme/schoolhub" … }`. Each `run` uses `command = plan`:
  - `deploy_production_trusts_only_deploy_env_on_main`: `jsondecode(aws_iam_role.deploy["production"].assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:acme/schoolhub:environment:production:job_workflow_ref:acme/schoolhub/.github/workflows/deploy-env.yml@refs/heads/main"`, and the statement has no `StringLike` key.
  - `deploy_staging_trusts_only_deploy_env_on_main`: the same with `environment:staging`.
  - `plan_production_rejects_pull_request`: its only `sub` is `"repo:acme/schoolhub:ref:refs/heads/main:job_workflow_ref:acme/schoolhub/.github/workflows/infra-terraform.yml@refs/heads/main"`, with no `StringLike` key.
  - `plan_staging_wildcard_only_in_pr_number`: the staging plan role's `StringLike` value equals `"repo:acme/schoolhub:pull_request:job_workflow_ref:acme/schoolhub/.github/workflows/infra-terraform.yml@refs/pull/*/merge"`, and `length(regexall("\\*", value)) == 1`.
  - `every_role_session_is_7200`: `alltrue([for r in concat(values(aws_iam_role.deploy), values(aws_iam_role.plan)) : r.max_session_duration == 7200])` (H1).
  - `production_deploy_ecr_actions_exact` (N1): the sorted union of every `ecr:*` action in `jsondecode(aws_iam_role_policy.deploy_ecr["production"].policy)` equals exactly `["ecr:DescribeImages"]`. This both forbids push (`PutImage`, `InitiateLayerUpload`) and pins that rollout needs nothing more.
  - `plan_role_reads_own_tfvars_only`: the staging plan policy allows `s3:GetObject` on `…/schoolhub/staging/terraform.tfvars` and names no `schoolhub/production/` object.
  - `region_allow_list`: `expect_failures = [var.aws_region]` with `"us-east-1"`.
  - `plan_role_can_write_lock_with_kms`: for each env, the plan policy has a statement whose `Action` contains `kms:GenerateDataKey` and `kms:Encrypt` and whose `Resource` is the state key's ARN, and a statement allowing `s3:PutObject` on exactly `…/schoolhub/<env>/terraform.tfstate.tflock` (H5).
  - `plan_role_state_scoped`: the staging plan policy names no `schoolhub/production/` resource.
  - `staging_plan_denies_foreign_data_plane`: the staging plan policy has a `Deny` naming `logs:GetLogEvents`, `logs:FilterLogEvents`, `logs:StartQuery`, `rds:DownloadDBLogFilePortion`, `ssm:GetParameter` and `ecr:GetDownloadUrlForLayer`, and each `NotResource` it uses contains `schoolhub-staging`.
  - `ecr_immutable`: `alltrue([for r in values(aws_ecr_repository.this) : r.image_tag_mutability == "IMMUTABLE"])`.
  - `ecr_expiry_is_age_based`: every rule in `jsondecode(aws_ecr_lifecycle_policy.this["api"].policy).rules` has `selection.countType == "sinceImagePushed"`, and the tagged rule's `countNumber == 365`.
  - `subject_prefix_rejects_wildcard`: `expect_failures = [var.github_oidc_subject_prefix]` with `"repo:acme/*"`.
- [ ] Implement the files above. Every policy uses `jsonencode()` in locals, and every resource carries `default_tags` `{ Project = "schoolhub", ManagedBy = "terraform", Stack = "bootstrap" }`.
- [ ] Edit `infra-terraform.yml`: add the `bootstrap` matrix row. In the validate job, add `if: matrix.dir == 'infra/terraform/bootstrap'` → `terraform test`, which needs no AWS credentials because the provider is mocked. The existing `trivy config` and `tflint --recursive` jobs already cover the new directory.
- [ ] Check: CI's `validate (infra/terraform/bootstrap)`, `tflint`, `trivy config` and the new `terraform test` step are green. Mutation proof:
  - `production_deploy_ecr_actions_exact` fails when `ecr.tf`'s production policy uses the staging action list, or adds `ecr:GetAuthorizationToken`;
  - `deploy_production_trusts_only_deploy_env_on_main` fails when the `job_workflow_ref` part is dropped, or the condition changes to `StringLike` with `environment:*`;
  - `every_role_session_is_7200` fails when `roles.tf` sets `max_session_duration = 3600`;
  - `plan_role_can_write_lock_with_kms` fails when `StateLockKms` is removed;
  - `ecr_expiry_is_age_based` fails when the tagged rule goes back to `imageCountMoreThan`.
- [ ] Commit `feat(infra): bootstrap root for state, GitHub OIDC roles and ECR`.

## Task 2: Environment Terraform for the pipeline

The env roots move onto the bootstrap bucket, gain the migrate and db-bootstrap one-off tasks, attach the env-scoped half of the deploy role's policy, and export every value D7 needs. Both roots get the same edits; `diff envs/staging envs/production` must still show only values.

What the repo already does (read, not assumed):
- **`modules/ecs-service` already has `lifecycle { ignore_changes = [task_definition, desired_count] }`** on `aws_ecs_service.this` (`main.tf` lines 377–385), with a comment explaining why. No change is needed; a test pins it (below).
- **celery-beat can run twice during a rollout today.** The module sets `deployment_maximum_percent = 200` and `deployment_minimum_healthy_percent = 100` for every service, and the beat-only `deployment_controller { type = "ECS" }` does not change that. Its comment says "stop-then-start", but the code rolls. Review Focus 4 makes this a fix in this task.
- **Execution roles cannot decrypt the Redis token today.** `module.cache.auth_token_secret_arn` is encrypted with the customer-managed `alias/<prefix>-redis` key, whose policy is the default (IAM-delegated). The execution role is granted `secretsmanager:GetSecretValue` but no `kms:Decrypt`, so api, worker and beat would fail at task start. The RDS master secret (`alias/<prefix>-rds`) has the same problem, and the db-bootstrap task needs that secret.
- **The settings read only `DATABASE_URL`** (`config/settings/base.py`). `MIGRATION_DATABASE_URL` in compose is unused by Django, and `seed-dev.sh` overrides `DATABASE_URL` with the migrator URL to migrate. The migrate task does the same.
- **No PgBouncer runs in AWS**, and none will in v1 (user decision D21): the app connects to RDS on 5432. `app_database_url_arn`'s description ("through PgBouncer on 6432") is corrected in both `variables.tf` files. The existing `aws_cloudwatch_metric_alarm.connections` in `modules/database/main.tf` has `threshold = 160` and a description that assumes PgBouncer; both change (below).
- **Redis is not wired.** `base.py` reads `REDIS_URL` (cache) and `CELERY_BROKER_URL`/`CELERY_RESULT_BACKEND`, all defaulting to `redis://localhost`. The env roots pass `REDIS_AUTH_TOKEN` as a secret, and no setting reads it. ElastiCache has in-transit encryption and an auth token, so the URLs must be `rediss://:<token>@<host>:<port>/<db>?ssl_cert_reqs=required` (Celery requires `ssl_cert_reqs` on a `rediss://` URL; Context7 `/websites/celeryq_dev_en_stable`).
- **CORS and CSRF are not set.** `prod.py` reads `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS` with `env.list(..., default=[])`; `local.api_environment` sets neither, so the dashboard's cross-origin, credentialed calls to `api.<domain>` fail on the first deploy.
- **The ALB uses the CloudFront certificate.** `aws_lb_listener.https` takes `module.cdn.certificate_arn`, issued in `us-east-1` through the `aws.us_east_1` provider. An ALB needs a certificate in its own region, so this works only when `aws_region = us-east-1`, which D20 rules out.

**Files:**
- Modify both `envs/{staging,production}/`:
  - `backend.tf`: partial S3 config;
  - `main.tf`: images from variables, the `migrate` and `db_bootstrap` module calls, the `gha_deploy_policy` call, `secret_kms_key_arns` on the services, Redis host/port and CORS/CSRF in `local.api_environment`, the regional ALB certificate, the connections-alarm threshold;
  - `variables.tf`: new variables; remove `api_image`, `dashboard_image` and `website_image`; `aws_region` loses its `us-east-1` default and gains the allow-list validation (Task 1, D20); production's `custom_domain_aliases` gains the length validation (L-1, below);
  - `terraform.tfvars.example`: new keys; image lines replaced.
- Create `envs/{staging,production}/outputs.tf` and `envs/{staging,production}/tests/env.tftest.hcl`.
- Modify `modules/database/{main,variables}.tf`: `connections_alarm_threshold` variable; the alarm's description.
- **Modify `modules/cdn/main.tf`** (H-1; this PR changes the CDN module too, flagged for the reviewer): `aws_acm_certificate_validation.this` today lists only the platform-zone records, a latent defect that fails the first apply with any custom domain. It changes to the certificate's own record names (below). No new output is needed.
- Modify `infra/runbooks/custom-domain-onboarding.md` (Task 8.2 has the rewritten sequence, M-2).
- Modify `apps/api/config/settings/base.py` (`redis_settings`), `apps/api/config/settings/prod.py` (assignments, comment), `apps/api/tests/prod_settings.py` (`PROD_REQUIRED_ENV`) and `.github/workflows/api.yml` (`security` step placeholders); create `apps/api/tests/test_redis_settings.py`.
- **Needs the user's explicit OK before anyone touches it (M-3):** `apps/api/.env.example` gains `REDIS_HOST`, `REDIS_PORT` and `REDIS_AUTH_TOKEN` (placeholder values), because ADR-0014's drift test requires every `env(...)` name there. L11 and the user's rule forbid editing `.env*` files without permission, so the implementer stops and asks; without the OK the drift test fails and the PR stays red.
- Modify `modules/ecs-service/{main,variables,outputs}.tf`:
  - `create_service` toggle;
  - `secret_kms_key_arns`;
  - JSON-key-safe secret resources;
  - singleton deployment percentages.
- Create `modules/ecs-service/tests/ecs_service.tftest.hcl`.
- Modify `modules/network/{main,outputs}.tf`: the migrate security group.
- Create `modules/gha-deploy-policy/{main,variables,outputs}.tf`.
- Modify `.github/workflows/infra-terraform.yml`: add `modules/gha-deploy-policy` to the `validate` matrix, and run `terraform test` for `modules/ecs-service`, `modules/gha-deploy-policy` and both env roots. Same mechanism as Task 1.

**Interfaces:**
- **Backend** (`backend.tf`, both envs). The bucket name contains the account ID, the region is the user's choice, and a backend block cannot read variables. All four location values are therefore passed at init (D19), and `backend.tf` keeps only what never varies:

  ```hcl
  terraform {
    required_version = ">= 1.11"
    backend "s3" {
      encrypt      = true
      use_lockfile = true
      # bucket, region, key and kms_key_id come from -backend-config (D6, D19)
    }
  }
  ```

  Init command, used by humans and by Task 6 (`<env>` is `staging` or `production`):
  ```bash
  terraform init \
    -backend-config="bucket=$TF_STATE_BUCKET" \
    -backend-config="region=$AWS_REGION" \
    -backend-config="key=schoolhub/<env>/terraform.tfstate" \
    -backend-config="kms_key_id=$TF_STATE_KMS_KEY_ARN"
  ```

  The production comment about a separate bucket, KMS key and account becomes a pointer to D4/D6, and the commented `role_arn` placeholder goes. CI's `init -backend=false` validation is unaffected.
- **New env variables** (both envs, no defaults unless stated):

  | Variable | Type / validation | Source |
  |---|---|---|
  | `ecr_registry` | `^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com$` | bootstrap output `ecr_registry` |
  | `image_tag` | `^[0-9a-f]{40}$` (full SHA, D8) | the first image built by Task 5; CI replaces revisions afterwards, so this is only the bootstrap revision |
  | `migrator_database_url_arn` | ARN | Task 3 (`…/db/migrator-url`) |
  | `db_role_password_arns` | `object({ app = string, migrator = string, readonly = string })` | Task 3 (`…/db/{app,migrator,readonly}-password`) |
  | `postgres_client_image` | must contain `@sha256:`; default `public.ecr.aws/docker/library/postgres:18-alpine@sha256:<digest>`, with the digest pinned in the PR | the db-bootstrap task's `psql` |

  - `local.images = { for r in ["api", "dashboard", "website"] : r => "${var.ecr_registry}/schoolhub/${r}:${var.image_tag}" }` replaces the three `*_image` variables. The repository names come from D5, and `schoolhub-api` in today's example is wrong.
  - `local.gha_deploy_role_name = "schoolhub-gha-deploy-${local.environment}"` matches the Task 1 naming local; a `data "aws_iam_role"` lookup on it makes plan fail if bootstrap was never applied.
- **Region and the ALB certificate** (D20, user decision; first-deploy blocker H9a). Both env roots:
  - `aws_region` loses the `us-east-1` default and gains the allow-list validation (Task 1); the example shows `me-central-1`.
  - Production's `custom_domain_aliases` gains `validation { condition = length(var.custom_domain_aliases) <= 8, error_message = "ACM allows 10 names per certificate by default; the platform domain and its wildcard use 2. Raise the ACM 'Domain names per ACM certificate' quota in both us-east-1 and the app's Region before adding a ninth alias, then raise this limit." }` (L-1).
  - New `aws_acm_certificate.alb` on the default (regional) provider with **exactly the CDN certificate's names**: `domain_name = var.platform_domain`, `subject_alternative_names = concat(["*.${var.platform_domain}"], var.custom_domain_aliases)` (production has `custom_domain_aliases`; staging passes `[]`), `validation_method = "DNS"`, `lifecycle { create_before_destroy = true }`. Tenant custom domains must be on it: CloudFront forwards the viewer `Host`, so it connects to the ALB with that name as SNI and checks the origin certificate against it; a missing name gives a 502 for that tenant (N2).
  - **Why SANs on one certificate, not `aws_lb_listener_certificate` per domain:** the CDN certificate already carries every custom domain as a SAN, under the same ACM SAN quota and with the same "one tenant's lapsed validation blocks a reissue" risk. Mirroring it keeps one list (`var.custom_domain_aliases`), one onboarding step and one failure mode, instead of a second mechanism with its own quota (25 listener certificates by default). If the alias count approaches the ACM SAN quota, both certificates move to per-domain certificates together; that is a deferred entry.
  - **No second set of validation records.** ACM uses the same validation CNAME for the same name in every region of one account, so the records `module.cdn` creates (platform domain) and the tenants' own records (custom domains, per `custom-domain-onboarding.md`) already validate the regional certificate. The env root declares no `aws_route53_record` for it.
  - `aws_acm_certificate_validation.alb` (H-1): `certificate_arn = aws_acm_certificate.alb.arn`, `validation_record_fqdns = distinct([for dvo in aws_acm_certificate.alb.domain_validation_options : trimsuffix(dvo.resource_record_name, ".")])`, `depends_on = [module.cdn]` (so the platform-zone records exist first). The AWS provider requires **every** validation record name on the certificate in that list: it removes the names it is given and errors on any left over, so listing only the platform-zone records fails the first apply with a custom domain. The list is the certificate's own names, whoever created the records (us or the tenant). Dropping the attribute would also work, but the list keeps Terraform checking that each name is the one ACM expects.
  - `modules/cdn`'s `aws_acm_certificate_validation.this` gets the same expression over `aws_acm_certificate.this.domain_validation_options`, with `depends_on = [aws_route53_record.cert_validation]` (H-1, the same latent defect).
  - `aws_lb_listener.https.certificate_arn = aws_acm_certificate_validation.alb.certificate_arn`. CloudFront keeps `module.cdn`'s `us-east-1` certificate unchanged.
  - Before applying, the human confirms the chosen region offers every service used (Fargate on ARM64, ElastiCache with in-transit encryption, RDS PostgreSQL 18, WAF regional) with `aws ssm get-parameters-by-path --path /aws/service/global-infrastructure/regions/<region>/services`; the README lists this check.
- **`local.api_environment` additions** (both envs, L74: each key is read by a named settings line):
  - `REDIS_HOST = module.cache.primary_endpoint_address`, `REDIS_PORT = tostring(module.cache.port)`. The token stays the `REDIS_AUTH_TOKEN` secret already in `local.api_secrets`; no Redis URL with a token is ever an environment variable (H6).
  - `CORS_ALLOWED_ORIGINS = "https://app.${var.platform_domain}"` and `CSRF_TRUSTED_ORIGINS = "https://app.${var.platform_domain},https://api.${var.platform_domain}"` (H9b). Names checked in `apps/api/config/settings/prod.py` lines 44–48 (`env.list("CSRF_TRUSTED_ORIGINS")`, `env.list("CORS_ALLOWED_ORIGINS")`); `env.list` splits on commas.
- **API Redis settings** (`apps/api/config/settings/base.py` and `prod.py`, H6):
  - `base.py` gains one pure function, `redis_settings(host: str, port: int, token: str) -> dict`, returning `{"CACHES": {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": url(0)}}, "CELERY_BROKER_URL": url(1), "CELERY_RESULT_BACKEND": url(2)}`, where `url(db) = f"rediss://:{quote(token, safe='')}@{host}:{port}/{db}?ssl_cert_reqs=required"`. It reads no environment itself. Development and tests keep reading `REDIS_URL`/`CELERY_*` with their `localhost` defaults.
  - `prod.py` reads the three values through the settings' own `env(...)` with no defaults, like every other required production value: `env("REDIS_HOST")`, `env.int("REDIS_PORT")`, `env("REDIS_AUTH_TOKEN")` (a missing one raises `ImproperlyConfigured` at boot). It calls `redis_settings(...)` once and **assigns new objects**: `CACHES = _redis["CACHES"]`, `CELERY_BROKER_URL = …`, `CELERY_RESULT_BACKEND = …`, never mutating `base.py`'s `CACHES` in place. Going through `env(...)`, not `os.environ`, matters (H-2): `apps/api/tests/prod_settings.py`'s `load_prod_settings()` patches `base.env.ENVIRON`, so `os.environ` would bypass it and break `test_health_middleware.py` and the two other modules that load prod settings.
  - `apps/api/tests/prod_settings.py`: add `REDIS_HOST`, `REDIS_PORT` and `REDIS_AUTH_TOKEN` (placeholder values) to `PROD_REQUIRED_ENV`, the one list of required production settings, so `load_prod_settings()` and `test_prod_settings.py`'s per-name check cover them.
  - `apps/api/.env.example`: ADR-0014's drift test requires every `env(...)` name there. **This edit needs the user's explicit OK** (M-3, L11, the user's `.env` rule); the implementer asks and does not touch the file without it.
  - `prod.py`'s stale comment "Connection reuse; PgBouncer fronts the database in transaction pooling mode." becomes "Connection reuse. v1 connects directly to RDS (ADR-0040); keep code pooler-safe (infra/AGENTS.md rule 2)."
  - `.github/workflows/api.yml`, job `security`, step "Django deployment checks": add `REDIS_HOST: redis.example.com`, `REDIS_PORT: "6379"` and `REDIS_AUTH_TOKEN: placeholder-not-a-secret` to its `env:`, because `prod.py` now requires them and `manage.py check --deploy` imports it (L65). Before writing, grep `infra/compose*` and `docker-compose*.yml` for `config.settings.prod` and add the three wherever prod settings run locally.
  - Tests in `apps/api/tests/test_redis_settings.py` (`SimpleTestCase`, no database; no subprocess and no new `config/tests` package):
    - `test_redis_settings_quotes_token_and_requires_tls`: `redis_settings("h", 6379, token)` with a token containing `/`, `@` and `:`; each URL round-trips through `urllib.parse.urlsplit` to the same password; the scheme is `rediss`; the query is `ssl_cert_reqs=required`; the databases are 0, 1 and 2.
    - `test_prod_settings_build_tls_redis_urls`: `prod = load_prod_settings()` (the existing harness); `prod.CELERY_BROKER_URL`, `prod.CELERY_RESULT_BACKEND` and `prod.CACHES["default"]["LOCATION"]` start with `rediss://` and contain `PROD_REQUIRED_ENV["REDIS_HOST"]`.
    - `test_prod_settings_requires_each_redis_value`: `load_prod_settings()` with each of the three names removed in turn raises `ImproperlyConfigured` (as `test_prod_settings.py` does for the other required names; if its per-name loop already covers every `PROD_REQUIRED_ENV` key, this test is that loop and is not duplicated).
    - Mutation lines: the first fails when `quote()` is removed; the second fails when `prod.py` keeps `base.py`'s `CELERY_BROKER_URL`.
- **Database connections alarm** (D21): `modules/database` gets `variable "connections_alarm_threshold" { type = number }` (no default) replacing the literal `160`, and the alarm's description becomes "Connections near max_connections. v1 connects directly (no pooler, ADR-0040); a sustained breach means it is time for the deferred pooler." Each env passes about 80% of the instance's default `max_connections` (`LEAST(DBInstanceClassMemory/9531392, 5000)`): staging `db.t4g.medium` (4 GiB, ≈450) → `360`; production `db.m7g.large` (8 GiB, ≈900) → `720`. `DBInstanceClassMemory` is below the nominal memory, so the human confirms with `SHOW max_connections;` after the first apply and sets `floor(0.8 × actual)` if it differs; `deploy.md` says so.
- **`modules/ecs-service` changes:**
  - `variable "create_service" { type = bool, default = true }`. Nothing has been applied, so the new `[0]` addresses need no `moved` blocks. When `false`, the service, target group, listener rule and autoscaling get `count = 0`, and the module produces only the task definition, both roles and the log group. `service_name`/`service_arn`/`target_group_arn` become `try(…, null)`. One module keeps one container definition, rather than a second module copying the read-only root, `/tmp` and logging blocks.
  - `variable "secret_kms_key_arns" { type = list(string), default = [] }` adds `kms:Decrypt` on exactly those keys to `execution_secrets`, with `kms:ViaService = secretsmanager.<region>.amazonaws.com`.
  - Secret policy resources are `distinct([for v in values(var.secret_arns) : join(":", slice(split(":", v), 0, 7))])`. A `valueFrom` with a JSON key (`<arn>:password::`) is not an IAM resource ARN; the first 7 colon-separated fields are.
  - Singleton rollout: `deployment_maximum_percent = local.is_singleton ? 100 : 200` and `deployment_minimum_healthy_percent = local.is_singleton ? 0 : 100`. ECS stops the old beat before starting the new one. That leaves a gap of about 1–2 minutes with no scheduler (the old task drains and stops, then Fargate provisions, pulls and starts the new one). Beat tolerates that: a periodic task due in the gap fires on the next tick of its schedule, or is missed once for a sub-minute schedule; two schedulers would double-fire every task.
- **Network module:**
  - `aws_security_group.migrate` (`${name_prefix}-migrate`, "One-off migrate and db-bootstrap tasks: direct PostgreSQL, HTTPS out"), with no ingress.
  - Egress `migrate_to_database` (tcp 5432 → database SG), and egress `migrate_https` (tcp 443 → `0.0.0.0/0`, for ECR, Secrets Manager and CloudWatch Logs through NAT, with `#trivy:ignore:AVD-AWS-0104` and the same justification as `app_all`).
  - Ingress `database_from_migrate` (tcp 5432 from the migrate SG).
  - Output `migrate_security_group_id`.
- **Env `main.tf` additions** (both envs):
  - `module "migrate"` (`source = "../../modules/ecs-service"`, `service_name = "migrate"`, `create_service = false`, `expose_via_alb = false`):
    - `image = local.images.api`;
    - `command = ["python", "manage.py", "migrate", "--noinput"]`;
    - `cpu = 512`, `memory = 1024`;
    - `environment_variables = local.api_environment`;
    - `secret_arns = merge(local.api_secrets, { DATABASE_URL = var.migrator_database_url_arn })`. Settings import needs the other secrets to boot, and `DATABASE_URL` is overridden to the migrator role on 5432 directly, never PgBouncer.
    - `secret_kms_key_arns = [module.cache.kms_key_arn]`;
    - `security_group_ids` is not used for a task-only module. The task runs with `MIGRATE_SECURITY_GROUP`, passed at `run-task`.
    - The family is **`schoolhub-<env>-migrate`**, and the log group is `/ecs/schoolhub-<env>-migrate`.
  - `module "db_bootstrap"` (same module, `service_name = "db-bootstrap"`, `create_service = false`): see Task 3.
  - api, celery-worker and celery-beat get `secret_kms_key_arns = [module.cache.kms_key_arn]`.
  - `module "gha_deploy_policy"` (`source = "../../modules/gha-deploy-policy"`).
- **`modules/gha-deploy-policy`** takes:
  - `role_name`, `cluster_arn`, `cluster_name`, `service_names` (list), `migrate_task_family`, `task_definition_families` (the six families: the five services and migrate);
  - `pass_role_arns` (the execution and task role ARN of api, celery-worker, celery-beat, dashboard, website and migrate; **not** db-bootstrap);
  - `log_group_names`, `distribution_arn`, `region`, `account_id`.

  It creates `aws_iam_role_policy "this"` named `schoolhub-gha-deploy-<env>-env` on the bootstrap role, with these statements (built with `jsonencode()` so the module test can assert them):

  | Sid | Actions | Resource / condition |
  |---|---|---|
  | `TaskDefinitions` | `ecs:RegisterTaskDefinition`, `ecs:DescribeTaskDefinition` | `*` (no resource-level support; check the Service Authorization Reference when implementing and narrow if it has changed) |
  | `Services` | `ecs:UpdateService`, `ecs:DescribeServices` | `arn:aws:ecs:<r>:<a>:service/<cluster_name>/<each service name>`, listed exactly, no wildcard |
  | `RunMigrate` | `ecs:RunTask` | `arn:aws:ecs:<r>:<a>:task-definition/<migrate_family>:*`, `ArnEquals ecs:cluster = <cluster_arn>` |
  | `Tasks` | `ecs:DescribeTasks`, `ecs:StopTask` | `arn:aws:ecs:<r>:<a>:task/<cluster_name>/*` |
  | `ListTasks` | `ecs:ListTasks` | `*` with `ArnEquals ecs:cluster = <cluster_arn>` (the rollout action's stopped reasons, 5.6) |
  | `TagOnRun` | `ecs:TagResource` | same task ARN, `StringEquals ecs:CreateAction = RunTask` |
  | `TagOnRegister` | `ecs:TagResource` | `arn:aws:ecs:<r>:<a>:task-definition/<each family>:*`, `StringEquals ecs:CreateAction = RegisterTaskDefinition`. The render action fetches with tags, so registering a revision tags it; without this the register fails `AccessDenied` on the first deploy. Scoped to the env's own families, so a staging run cannot tag a production family. |
  | `PassEnvRoles` | `iam:PassRole` | exactly `pass_role_arns`, `StringEquals iam:PassedToService = ecs-tasks.amazonaws.com` |
  | `Logs` | `logs:GetLogEvents`, `logs:FilterLogEvents`, `logs:DescribeLogStreams` | `arn:aws:logs:<r>:<a>:log-group:<each name>:*` |
  | `Invalidate` | `cloudfront:CreateInvalidation`, `cloudfront:GetInvalidation` | `distribution_arn` |

  The production role therefore cannot touch a staging service, and the reverse also holds (Review Focus 1). `PassRole` cannot hand a production task role to a staging-registered task definition.
- **Env outputs** (`envs/*/outputs.tf`). These are what Task 7's bootstrap mode copies into the Environment's variables (D7):

  | Output | Value | GitHub Environment variable |
  |---|---|---|
  | `ecs_cluster_name` | `aws_ecs_cluster.this.name` (`schoolhub-<env>`) | `ECS_CLUSTER` |
  | `migrate_task_family` | `module.migrate.task_definition_family` (`schoolhub-<env>-migrate`) | `MIGRATE_TASK_FAMILY` |
  | `private_subnets` | `join(",", module.network.private_subnet_ids)` | `PRIVATE_SUBNETS` |
  | `migrate_security_group_id` | `module.network.migrate_security_group_id` | `MIGRATE_SECURITY_GROUP` |
  | `cloudfront_distribution_id` | `module.cdn.distribution_id` | `CLOUDFRONT_DISTRIBUTION_ID` |
  | `platform_domain` | `var.platform_domain` | `PLATFORM_DOMAIN` |
  | `db_bootstrap_task_family` | `schoolhub-<env>-db-bootstrap` | none; the human runbook only (Task 3) |
  | `github_environment_variables` | one object of the first six under their D7 names | pasted into the bootstrap mode |

**Order of operations** (human; Task 8 writes it into `deploy.md`):
1. Task 1 bootstrap apply in the chosen region (D20), then the OIDC `sub` customisation `PUT` (Task 1 first run).
2. `/schoolhub-deploy bootstrap`: set the D7 repository variables and create both Environments (the build job needs `staging`'s `DEPLOY_ROLE_ARN`, which bootstrap outputs). `SMOKE_TENANT_SLUG` stays empty.
3. Task 3 `bootstrap-secrets.sh --phase pre-apply`.
4. Build the first images: dispatch `deploy.yml` for staging with `dry_run=false` while `ECS_CLUSTER` is empty. Only the build runs: `deploy-env.yml`'s rollout job finds `ECS_CLUSTER` empty in its first step and ends as "build only" (Task 5.4).
5. Create staging's tfvars file (D23): the skill's bootstrap mode fills `terraform.tfvars.example` with the user's values, the `bootstrap-secrets.sh` ARNs and `image_tag` set to that SHA, shows it, and on a yes prints the human's `aws s3 cp <file> s3://$TF_STATE_BUCKET/schoolhub/staging/terraform.tfvars --sse aws:kms --sse-kms-key-id $TF_STATE_KMS_KEY_ARN` (a mutating `aws` command, so the human runs it). From now on that object is the only copy; edits go through `aws s3 cp` down, edit, up.
6. `terraform apply -var-file=<local copy of that object>` for staging. This also issues and DNS-validates the regional ALB certificate.
7. `bootstrap-secrets.sh --phase post-apply`.
8. Run the db-bootstrap task (Task 3).
9. Copy the env outputs into the `staging` Environment (`ECS_CLUSTER` and the rest). From the next `main` push, staging's CI plan row runs, because its tfvars object now exists (Task 6).
10. The first deploy through the workflow. Tenant smoke checks are skipped with a notice (D12).
11. Seed the smoke tenant in staging (`manage.py` through the human's admin path, as `deploy.md` describes), set `SMOKE_TENANT_SLUG`, and re-run the deploy so the tenant checks run once (H9c).
12. Repeat 3, 5–11 for production, after the dashboard LAUNCH BLOCKER is closed (D17).

- [ ] Write `modules/ecs-service/tests/ecs_service.tftest.hcl` (`mock_provider "aws" { override_during = plan }`, `command = plan`):
  - `beat_never_overlaps`: with `service_name = "celery-beat"`, `aws_ecs_service.this[0].deployment_maximum_percent == 100` and `deployment_minimum_healthy_percent == 0`;
  - `web_service_rolls_with_full_capacity`: with `service_name = "api"`, 200/100;
  - `task_only_creates_no_service`: with `create_service = false`, `length(aws_ecs_service.this) == 0` and `aws_ecs_task_definition.this.family == "<prefix>-migrate"`;
  - `json_key_secret_scoped_to_secret_arn`: given `secret_arns = { PGPASSWORD = "arn:aws:secretsmanager:us-east-1:111111111111:secret:x/rds/master-AbCdEf:password::" }`, the local `secret_resource_arns == ["arn:aws:secretsmanager:us-east-1:111111111111:secret:x/rds/master-AbCdEf"]`;
  - `kms_decrypt_only_when_keys_given`.

  `ignore_changes` is not visible to `terraform test`, so it stays pinned by the module comment. Task 9's `change-reviewer` checks it in the diff; no new checker is added for one line.
- [ ] Write `modules/gha-deploy-policy/tests/policy.tftest.hcl`:
  - `services_listed_exactly`: no `Resource` in `Services` contains `*`;
  - `passrole_has_service_condition`;
  - `run_task_limited_to_migrate_family_and_cluster`;
  - `tag_on_register_scoped_to_env_families`: `TagOnRegister`'s resources are exactly the six `task-definition/<family>:*` ARNs and its condition is `ecs:CreateAction = RegisterTaskDefinition`.
- [ ] Write `envs/{staging,production}/tests/env.tftest.hcl` (identical apart from values; `mock_provider "aws" { override_during = plan }` and `mock_provider "aws" { alias = "us_east_1", override_during = plan }`; `command = plan`):
  - Both files declare `mock_data "aws_availability_zones" { defaults = { names = ["me-central-1a", "me-central-1b", "me-central-1c"] } }` **inside** the default `mock_provider "aws" { … }` block (a `mock_data` block is only valid within a `mock_provider`) (N8): the network module slices the zone list, and a mocked data source otherwise returns an empty list, so `slice()` fails at plan.
  - `alb_uses_regional_certificate`: `aws_lb_listener.https.certificate_arn == aws_acm_certificate_validation.alb.certificate_arn` and `!= module.cdn.certificate_arn`. If the mocked ARNs are unknown at plan, give both certificates fixed ARNs with `override_resource` and compare those.
  - `alb_cert_covers_every_cdn_alias` (N2): with `custom_domain_aliases = ["school-a.example.org", "school-b.example.org"]` in production's test, `toset(concat([aws_acm_certificate.alb.domain_name], tolist(aws_acm_certificate.alb.subject_alternative_names)))` contains every name CloudFront serves: the platform domain, its wildcard and both aliases. Staging asserts the same with no aliases.
  - `alb_validation_reuses_cdn_records` (H-1): the env root declares no `aws_route53_record` resource (`terraform test` cannot enumerate resources by type, so this half is a `! grep -l 'resource "aws_route53_record"' infra/terraform/envs/*/*.tf` step in the same CI job), and `toset(aws_acm_certificate_validation.alb.validation_record_fqdns) == toset([for dvo in aws_acm_certificate.alb.domain_validation_options : trimsuffix(dvo.resource_record_name, ".")])`, with production's two test aliases on the certificate. If the mocked `domain_validation_options` are unknown at plan, `override_resource` gives the certificate fixed options, one per name. Mutation line: fails when the list goes back to the platform-zone records only.
  - `modules/cdn` gets the same assertion in a new `modules/cdn/tests/cdn.tftest.hcl` (`cdn_validation_lists_every_name`), and `infra-terraform.yml`'s `terraform test` list gains `modules/cdn`.
  - `redis_token_never_in_environment`: `!contains(keys(local.api_environment), "REDIS_AUTH_TOKEN")`, no `api_environment` value contains `rediss://`, and `local.api_secrets["REDIS_AUTH_TOKEN"] == module.cache.auth_token_secret_arn`.
  - `cors_and_csrf_name_the_app_origin`: `local.api_environment["CORS_ALLOWED_ORIGINS"] == "https://app.<test domain>"` and `CSRF_TRUSTED_ORIGINS` contains it.
  - `connections_alarm_threshold_set`: `module.database` receives the env's threshold (assert through the alarm resource's `threshold`).
- [ ] Implement the module changes, the network SG and the new module. Then the env edits, identical in both roots apart from values. Keep `count` inside modules only, per the README convention.
- [ ] Update both `terraform.tfvars.example` files:
  - `ecr_registry = "123456789012.dkr.ecr.us-east-1.amazonaws.com"`, commented "bootstrap output `ecr_registry`";
  - `image_tag = "<40-hex git SHA>"`;
  - the new secret ARN keys, commented "printed by `infra/scripts/bootstrap-secrets.sh`".

  `123456789012` stays only in `.example` files, as the documented AWS placeholder. No `.tf` file contains an account ID.
- [ ] Check: CI `validate (envs/staging)`, `validate (envs/production)`, `validate (modules/gha-deploy-policy)`, the two new `terraform test` runs, `tflint` and `trivy config` are green, and `repo-hygiene`'s `settings-modules` job still passes (the migrate task names `config.settings.prod` through `local.api_environment`). Mutation proof:
  - `beat_never_overlaps` fails when `main.tf` sets `deployment_maximum_percent = 200` unconditionally;
  - `services_listed_exactly` fails when the module uses `service/<cluster>/*`;
  - `alb_uses_regional_certificate` fails when the listener goes back to `module.cdn.certificate_arn`;
  - `redis_token_never_in_environment` fails when `api_environment` gains a composed `REDIS_URL`;
  - `alb_validation_reuses_cdn_records` and `cdn_validation_lists_every_name` fail when their validation list is limited to the platform-zone records.
- [ ] L74 check (agent-lessons §2): for every key added to `local.api_environment` (`REDIS_HOST`, `REDIS_PORT`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`), name the settings line that reads it, in the report and the PR body.
- [ ] Commit `feat(infra): migrate task, env-scoped deploy policy, regional ALB certificate and partial S3 backend`. Separately, `fix(api): build TLS Redis URLs from host, port and the auth-token secret`, with `Root cause: prod settings read REDIS_URL and CELERY_* with localhost defaults, and nothing read REDIS_AUTH_TOKEN, so every service would connect to localhost`. And separately `fix(infra): keep celery-beat to one task during rollout`. The second carries the line `Root cause: the singleton used the shared 200/100 deployment percentages, so ECS started the new beat before stopping the old one` (ADR-0016).

## Task 3: Secrets and database bootstrap

A new script, `infra/scripts/bootstrap-secrets.sh`, creates every Secrets Manager entry an environment reads, with random values, and prints the ARNs as `tfvars` lines. It never changes a value that already exists. A one-off ECS task, `db-bootstrap` (declared in Task 2), runs the existing `infra/postgres/init/*.sql` against RDS. Those files create `schoolhub_migrator`, `schoolhub_app` and `schoolhub_readonly`.

What the repo does today:
- **`infra/postgres` does not reach RDS.** `01-extensions.sql` and `02-app-role.sql` run only from Docker's `/docker-entrypoint-initdb.d`. `infra/terraform/README.md` step 7 says to run them "through the SSM bastion", but the bastion instance does not exist (README "What is not here yet"). Terraform deliberately creates no roles, so on a fresh RDS instance only the master user exists.
- **`02-app-role.sql` is already idempotent.** It runs `CREATE ROLE` or `ALTER ROLE … PASSWORD` for each role, re-grants, and refuses empty passwords. Re-running it is safe, and it is also how a rotated role password reaches the database.
- **`rotate-secrets.sh` has no test.** CI only runs `shellcheck --severity=warning infra/scripts/*.sh` and asserts `set -euo pipefail` (`infra-compose.yml`, job `shellcheck`). The new script gets a real test; the pattern follows `.github/scripts/tests/`, `unittest` driving the code with fakes.

**Secrets the script owns.** The list comes from every `*_arn` variable in `envs/*/variables.tf`, including PR #200's three website secrets, plus Task 2's new ones. Names follow the `schoolhub-<env>/…` convention already used in the examples and `rotate-secrets.sh`.

| Secret name (`schoolhub-<env>/…`) | `tfvars` key | Value | Phase |
|---|---|---|---|
| `django/secret-key` | `django_secret_key_arn` | 64 chars, `[A-Za-z0-9]` | pre-apply |
| `integrations/encryption-keys` | `integrations_encryption_keys_arn` | one Fernet key: 32 random bytes, URL-safe base64 (44 chars) | pre-apply |
| `website/machine-tokens` | `website_machine_tokens_arn` | token `T` (a list of one) | pre-apply, created together with the next row |
| `website/machine-token` | `website_machine_token_arn` | the same `T`, which must be in the list (`rotate-website-secrets.md`) | pre-apply |
| `website/revalidate-secret` | `website_revalidate_secret_arn` | 64 chars | pre-apply |
| `db/app-password` | `db_role_password_arns.app` | 40 chars, `[A-Za-z0-9]` (URL-safe, no escaping) | pre-apply |
| `db/migrator-password` | `db_role_password_arns.migrator` | 40 chars | pre-apply |
| `db/readonly-password` | `db_role_password_arns.readonly` | 40 chars | pre-apply |
| `db/app-url` | `app_database_url_arn` | created **empty** pre-apply; post-apply fills `postgres://schoolhub_app:<app-password>@<app-db-host>:<app-db-port>/schoolhub?sslmode=require` (port 5432 by default: direct to RDS, D21) | both |
| `db/migrator-url` | `migrator_database_url_arn` | created **empty** pre-apply; post-apply fills `postgres://schoolhub_migrator:<migrator-password>@<rds address>:5432/schoolhub?sslmode=require`, direct and never PgBouncer | both |

Not generated (external values; the script prints a reminder and no ARN):
- `sentry/dsn` (`sentry_dsn_arn`): optional in staging, required in production.
- `payments/gateway` (`payment_gateway_secret_arn`, production only).

Not touched (Terraform-managed): `rds/master` and `redis/auth-token`.

**Why two phases.** The env apply needs every ARN in `tfvars` before RDS exists, and the URL secrets need the RDS address. An empty secret (`create-secret` with no value) has an ARN but no `AWSCURRENT` version. Post-apply writes a value only when that is the case. ECS fails a task start on a secret with no value, so nothing runs against a half-built URL.

**Files:**
- Create `infra/scripts/bootstrap-secrets.sh` and `infra/scripts/tests/test_bootstrap_secrets.py`.
- Modify:
  - `.github/workflows/infra-compose.yml`, job `shellcheck`: add the step `python3 -m unittest discover -s infra/scripts/tests -v`. `infra/scripts/**` is already in its path filter.
  - `infra/scripts/rotate-secrets.sh` `classify()`: add `*/db/*-url` → `MANUAL|A URL composed from a role password; rotate the -password secret, re-run db-bootstrap, then rewrite the URL`, placed before the `*/db/*` arm. `--rotate` already refuses `MANUAL`, so a random string can never replace a connection URL.
  - `infra/terraform/README.md` steps 7–8: "run the `db-bootstrap` task" replaces "through the SSM bastion".
- The `db-bootstrap` module instance itself is in Task 2's `envs/*/main.tf` edit; its arguments are specified here.

**Interfaces:**
- **CLI:**

  ```text
  bootstrap-secrets.sh --env staging|production --phase pre-apply
  bootstrap-secrets.sh --env staging|production --phase post-apply --db-host <rds address> [--app-db-host <host>] [--app-db-port 5432]
  common: [--region R] [--profile P] [--dry-run] [-h|--help]
  ```

  - `--app-db-host` defaults to `--db-host` and `--app-db-port` to `5432`: the app connects directly to RDS in v1 (user decision D21). Both flags stay so a later pooler changes only the arguments, not the script.
  - The `aws_cmd` wrapper and `--region`/`--profile` handling copy `rotate-secrets.sh`.
  - Every resource is tagged `Project=schoolhub Environment=<env> ManagedBy=bootstrap-secrets`.
  - Encryption uses the default `aws/secretsmanager` key, so execution roles need no extra `kms:Decrypt` for these secrets. Only the Terraform-managed ones use CMKs (Task 2).
- **Idempotence rules:**
  1. `describe-secret` first. If the secret exists, skip it and print its ARN. The script never calls `put-secret-value` on a secret that has an `AWSCURRENT` version.
  2. Pairs are all-or-nothing. If exactly one of `website/machine-tokens`/`website/machine-token` exists, exit 1 and point to `rotate-website-secrets.md`. A `db/<role>-url` whose `db/<role>-password` is missing also exits 1.
  3. A secret pending deletion (`DeletedDate` set) exits 1 with the `restore-secret` command. Creating over it fails anyway, and silently recreating would orphan the ARN in `tfvars`.
- **Value handling:**
  - Values come from `openssl rand`, as in `rotate-secrets.sh`, not `$RANDOM`.
  - They are written to a `mktemp` file under `umask 077` and passed as `--secret-string file://<tmp>`, so they never appear in `argv` (visible in `ps`) or on stdout. A `trap` removes the file on `EXIT`.
  - Post-apply reads each password with `get-secret-value` into a variable, writes the URL the same way, and `unset`s it.
- **Output:**
  - stdout carries only `tfvars` lines, e.g. `django_secret_key_arn = "arn:aws:secretsmanager:…"`, and one `db_role_password_arns = { app = "…", migrator = "…", readonly = "…" }` block. The human can pipe it straight into a `terraform.tfvars` fragment.
  - Logs go to stderr with the `[bootstrap-secrets]` prefix, as `rotate-secrets.sh` does with `[rotate]`.
  - Exit codes: `0` success, `1` refused (with the reason).
- **`db-bootstrap` task** (Task 2 `module "db_bootstrap"`, `create_service = false`):
  - `image = var.postgres_client_image`, pinned by digest (the PostgreSQL 18 client, matching rule 3);
  - `cpu = 256`, `memory = 512`;
  - `command = ["sh", "-ec", "printf '%s' \"$EXTENSIONS_SQL\" > /tmp/01.sql; printf '%s' \"$ROLES_SQL\" > /tmp/02.sql; psql -v ON_ERROR_STOP=1 -f /tmp/01.sql; psql -v ON_ERROR_STOP=1 -f /tmp/02.sql"]`.
  - `environment_variables`:
    - `PGHOST = module.database.address`, `PGPORT = "5432"`, `PGDATABASE = module.database.database_name`, `PGSSLMODE = "require"`;
    - `EXTENSIONS_SQL = file("${path.module}/../../../postgres/init/01-extensions.sql")`;
    - `ROLES_SQL = file("${path.module}/../../../postgres/init/02-app-role.sql")`.

    These are the same files compose runs, so there is one source of truth and no copy. They contain no secrets, and they are visible through `DescribeTaskDefinition`, which is acceptable.
  - `secret_arns`:
    - `PGUSER = "${module.database.master_secret_arn}:username::"`;
    - `PGPASSWORD = "${module.database.master_secret_arn}:password::"`;
    - `APP_DB_PASSWORD`, `MIGRATION_DB_PASSWORD`, `READONLY_DB_PASSWORD` from `var.db_role_password_arns`.

    `02-app-role.sql` reads them with `\getenv`, and its role names keep their defaults.
  - `secret_kms_key_arns = [module.database.kms_key_arn]` (the master secret's CMK).
  - It is not in `pass_role_arns`, so the CI deploy role cannot run it. A human runs it with admin credentials: once per environment, and again after any role-password rotation.
- **Human run** (once per env, after post-apply; Task 8 adds it to `deploy.md`):

  ```bash
  aws ecs run-task --cluster schoolhub-<env> --task-definition schoolhub-<env>-db-bootstrap --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[<PRIVATE_SUBNETS>],securityGroups=[<MIGRATE_SECURITY_GROUP>],assignPublicIp=DISABLED}"
  aws ecs wait tasks-stopped --cluster schoolhub-<env> --tasks <task-arn>
  aws ecs describe-tasks --cluster schoolhub-<env> --tasks <task-arn> --query 'tasks[0].containers[0].exitCode'   # must be 0
  aws logs tail /ecs/schoolhub-<env>-db-bootstrap   # must show NOTICE "Roles ready: schoolhub_migrator … schoolhub_app … RLS-bound"
  ```

  The SQL's own assertion block raises if `schoolhub_app` or `schoolhub_readonly` is a superuser or has `BYPASSRLS`. Exit 0 therefore proves rule 1's role half. The ownership half (`schoolhub_migrator` owns every table) is checked after the first migrate, in Task 5's post-migrate step.

**Risks:**

| Risk | Mitigation |
|---|---|
| On RDS the master is `rds_superuser`, not a superuser. `ALTER SCHEMA public OWNER TO schoolhub_migrator` requires that the master can `SET ROLE` to the migrator, and PostgreSQL 16+ gives a `CREATEROLE` creator only `ADMIN OPTION` by default. This is unverified on RDS 18. | The first staging run shows it. If it fails, the fix is one `GRANT schoolhub_migrator TO CURRENT_USER WITH INHERIT FALSE, SET TRUE` in `02-app-role.sql`. That file is marked as needing security review, so the change goes to the user and is not made silently. |
| The parameter group's `statement_timeout = 60000` kills a long `CREATE INDEX` in a migration | Out of this task's scope. Recorded in `deferred-work.md` (Task 8) as `ALTER ROLE schoolhub_migrator SET statement_timeout = 0` |
| `infra-terraform.yml` does not trigger on `infra/postgres/**`, yet those files now feed a task definition | Task 6 adds `infra/postgres/init/**` to its path filter |
| Direct connections exhaust `max_connections` as tasks scale | The `DatabaseConnections` alarm at about 80% (Task 2); the pooler is a deferred entry (D21) |

- [ ] Write `infra/scripts/tests/test_bootstrap_secrets.py` (`unittest`). `setUp` writes a fake `aws` executable into a temp dir placed first on `PATH`. The fake is a small Python script that keeps a JSON "Secrets Manager" in the temp dir and implements `describe-secret`, `create-secret`, `put-secret-value`, `get-secret-value` and `restore-secret`. It records every `argv` and supports `file://` values. Each test runs the script with `subprocess.run` and `env={"PATH": …, "AWS_REGION": "us-east-1"}`.
  - `test_pre_apply_creates_every_owned_secret_once`: exactly the 10 names in the table above, with `db/*-url` having no value.
  - `test_rerun_makes_no_writes`: a second pre-apply records zero `create-secret` and zero `put-secret-value` calls.
  - `test_existing_value_is_never_overwritten`: a pre-seeded `django/secret-key = "keep"` is still `"keep"` after the run.
  - `test_machine_token_is_in_token_list`.
  - `test_half_existing_website_pair_refused`: exit 1, no writes.
  - `test_integrations_key_is_a_fernet_key`: `base64.urlsafe_b64decode` gives 32 bytes.
  - `test_post_apply_fills_only_empty_urls`: the migrator URL's host is `--db-host`, its port 5432, its user `schoolhub_migrator`, and its password equals `db/migrator-password`. A pre-filled `db/app-url` is untouched.
  - `test_post_apply_requires_db_host`: exit 1 without `--db-host`.
  - `test_app_url_defaults_to_direct_rds`: without `--app-db-host`/`--app-db-port`, the app URL's host is `--db-host` and its port `5432`.
  - `test_deleted_secret_refused`.
  - `test_values_never_in_argv_or_stdout`: no generated value appears in any recorded `argv` or in stdout.
  - `test_every_env_arn_variable_is_covered`: parse `variable "(\w+_arn)"` from both real `envs/*/variables.tf` files. Each one is either printed by the script or listed in the test's `EXTERNAL = {"sentry_dsn_arn", "payment_gateway_secret_arn"}`. A future secret variable fails this test until the script learns it. This is the drift guard for "listed from the env `secret_arns` variables".
- [ ] Implement `bootstrap-secrets.sh` with the header usage block, `set -euo pipefail` and the `aws_cmd` wrapper copied from `rotate-secrets.sh`, so CI's strict-mode assertion and shellcheck cover it.
- [ ] Add the `classify()` arm to `rotate-secrets.sh`, the `infra-compose.yml` unittest step, and the README steps 7–8 rewrite.
- [ ] Check: CI `infra-compose / shellcheck` is green, including the new unittest step, and `repo-hygiene` is green. Mutation proof:
  - `test_existing_value_is_never_overwritten` fails when the script's existence check is removed (`create-secret` then fails on the fake, exit ≠ 0);
  - `test_rerun_makes_no_writes` fails when post-apply drops its "no `AWSCURRENT`" guard;
  - `test_every_env_arn_variable_is_covered` fails when `website_revalidate_secret_arn` is removed from the script's table.
- [ ] Commit `feat(infra): bootstrap-secrets script and db-bootstrap task`.

## Task 4: CI gate and migration-safety checkers

**Files**
- Create `.github/scripts/check_migrations.py` (D11).
- Create `.github/scripts/ci_gate.py` (the "CI is green for this SHA" gate Task 5 runs before it builds or deploys).
- Create `.github/scripts/tests/test_check_migrations.py` and `.github/scripts/tests/test_ci_gate.py`.
- Modify `.github/workflows/repo-hygiene.yml`: add the `deploy-scripts` and `actionlint` jobs.
- Modify the `concurrency:` block of every CI workflow the gate reads (`api.yml`, `frontend.yml`, `infra-compose.yml`, `repo-hygiene.yml`, and `infra-terraform.yml` for its PR runs): on `main`, group by SHA, so no run on `main` waits behind or cancels another (N5):
  ```yaml
  concurrency:
    group: ci-${{ github.workflow }}-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}
    cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
  ```
  (each file keeps its own prefix; `${{ github.workflow }}` keeps workflows apart). Today all five group by ref and cancel in progress, so a second merge cancels the first SHA's CI; and `cancel-in-progress: false` alone is not enough, because GitHub keeps only one **pending** run per group and cancels the older pending one. A per-SHA group on `main` has neither problem. On PR branches cancelling stays, because a PR's older pushes are disposable.

Both scripts follow `check_settings_modules.py`: stdlib only, `main(argv) -> int`, GitHub annotations on stdout, a pure core that the unittest calls without `git` or `gh` wherever possible.

### 4.1 `check_migrations.py`

**CLI**

```
check_migrations.py --base <sha|none> --target <sha> [--repo <path>] [--json <out-file>] [--summary <md-file>]
                    [--allow-contract] [--acknowledge-review]
```

- `--base` is the currently deployed SHA (Task 5 reads it with `deployments.py current`, D10). `none` means nothing is deployed in that environment yet: there is no old code to break, so the script prints `first deploy: no running code, migration guard skipped` and exits 0.
- `--target` is the SHA being deployed.
- Needs full history (`fetch-depth: 0`). If `git cat-file -e <base>^{commit}` fails it exits 2 with `::error::deployed SHA <base> is not in this clone`; it never falls back to "no base".
- `--json` writes the findings for the job summary and the skill (Task 7). `--summary` appends a Markdown table to `$GITHUB_STEP_SUMMARY`.

**Exit codes** (review findings now fail too, D11; decided here because a warning on a page the approver may not open is not a gate):
- `0`: no findings;
- `1`: at least one contract finding (overridden only by `allow_contract_migration`);
- `4`: review findings only (overridden only by `acknowledge_migration_review`);
- `2`: usage or git error, never overridable.

Flags `--allow-contract` and `--acknowledge-review` make the script itself apply the overrides: it prints each overridden finding as `::warning::… (overridden by <flag>)` and exits 0. Callers (`preview`, `deploy-env.yml`) pass the workflow inputs straight through, so the override logic lives in one tested place. `--json` always records every finding with an `overridden` field.

**Which files**
- `added = git diff --name-only --diff-filter=A <base> <target> -- 'apps/api/**/migrations/[0-9]*.py'`.
- `edited = ... --diff-filter=M ...` → one review finding per file ("an applied migration was edited; the edit never runs on a database that already applied it").
- `--diff-filter=D` (a deleted migration) → contract finding.
- Source is read with `git show <target>:<path>`, never from the working tree, so the result does not depend on what is checked out.

**Parsing (ast, no regex on Python source)**
- `ast.parse` each file. A `SyntaxError` is a contract finding ("cannot prove this migration is expand-only"), never a skip.
- Find `class Migration` and its `operations = [...]` assignment. Walk each element:
  - `Call` whose callee ends in a known operation name (`migrations.RemoveField`, or a bare `RemoveField` imported from `django.db.migrations`) → classify (table below).
  - `Starred(Call(<helper>, <table literals>...))` with `<helper>` in `ALLOWED_HELPERS = {"rls_operations", "append_only_operations"}`:
    - **pass only when every table argument is a string literal naming a table created by a `CreateModel` in this release's added migrations** (its `db_table` option, or `<app_label>_<model name lower-cased>`). `append_only_operations` may also take `mutable_columns={"<table>": ["<col>", …]}`; it is accepted when that argument is a dict literal whose keys are string literals naming tables created in this release, and its values lists of string literals. Any other keyword or a non-literal value → review. On a brand-new table no running code depends on the grants or policies, so tightening them cannot break the old release (N9).
    - otherwise → **review** ("RLS or append-only change on an existing table: running code may lose access mid-deploy"). `rls_operations` enables and forces RLS and drops and re-creates the tenant policy (`DROP POLICY IF EXISTS` then `CREATE POLICY`), so on a live table there is a window where the old policy is gone; `append_only_operations` revokes `UPDATE`/`DELETE`, which breaks any running code that still updates the table. Neither is a contract change in schema terms, but both deserve a human look on an existing table.
    - A helper-pin test in the API tests (4.3) keeps the helpers to those shapes.
  - Any other `Starred`, `Name` or `Call` → review ("operation built by code the checker cannot read").
  - `SeparateDatabaseAndState(database_operations=[...], state_operations=[...])` → recurse into `database_operations` only; state operations never touch the schema.
- Module-level string constants (`SQL = "..."`) are collected first so `RunSQL(SQL)` / `RunSQL(sql=SQL)` resolves. Implicit string concatenation is already one `Constant` in the AST.

**Classification**

| Operation | Result |
|---|---|
| `RemoveField`, `DeleteModel`, `RenameField`, `RenameModel`, `RemoveConstraint`, `AlterModelTable` | contract |
| `AddField` whose field is NOT NULL (`null` absent or `False`) and has no `db_default` | contract: the running code inserts rows without the column, and Django drops a Python `default` after adding it. `db_default=` (a database default) or `null=True` passes. A `ForeignKey`/`OneToOneField` follows the same rule. A non-literal `null`/`db_default` → review. |
| `AlterField` | see below |
| `RunSQL` | see below |
| `RunPython`, `AlterUniqueTogether`, `AlterIndexTogether`, `AlterOrderWithRespectTo`, any unknown operation name | review |
| `CreateModel`, `AddField` that is nullable or has `db_default`, `AddIndex`, `AddConstraint`, `RemoveIndex`, `RenameIndex`, `AlterModelOptions`, `AlterModelManagers`, `AlterModelTableComment`, `AlterField` that is proven safe | pass |

`AlterModelTable` is added beyond D11's list because it is a table rename. Unknown operations are review, never pass: the checker fails towards a human look.

**`AlterField`: compare with the deployed definition**
1. Find the prior definition of `(app_label, model_name, name)` in the **base** tree: every `apps/api/**/<app>/migrations/[0-9]*.py` at `<base>`, in filename order, taking the last `CreateModel(name=..., fields=[(name, Call), ...])` (model name compared case-insensitively), `AddField` or `AlterField` for that field.
2. If the field's only prior definition is in this release's *added* migrations, it has never been deployed: pass.
3. No prior definition found → review ("cannot find the deployed definition").
4. Both definitions are `Call`s with literal keyword values → compare:
   - field class differs (`CharField` → `IntegerField`) → contract (type change);
   - old `null=True`, new `null` absent or `False` → contract (`SET NOT NULL`);
   - `max_length`, `max_digits` or `decimal_places` smaller than before → contract (narrowing);
   - `db_column` added, removed or changed → contract (a column rename: the running code reads the old name);
   - anything else (`choices`, `help_text`, `validators`, `default`, `db_index`, a wider or newly nullable column) → pass.
5. A compared keyword that is not a literal (`max_length=LIMIT`) → review.

**`RunSQL`**
- Only the forward SQL is scanned (`sql=` or the first positional argument), never `reverse_sql`.
- Accepted shapes: a string; a list or tuple of strings; a list of `(sql, params)` tuples. Anything else (an f-string, a call) → review.
- Before matching, strip `--` and `/* */` comments and single-quoted literals, then upper-case.
- Contract if any of:
  - `\bDROP\b`, except `DROP NOT NULL` (relaxing a column). There is no `DROP POLICY` carve-out: a hand-written policy change goes through the override; `rls_operations` is handled as a helper above, not scanned;
  - `\bRENAME\b`;
  - `\bALTER\s+(TABLE\s+\S+\s+)?(ALTER\s+)?(COLUMN\s+)?\S+\s+(SET\s+DATA\s+)?TYPE\b`;
  - `\bSET\s+NOT\s+NULL\b` (old code may write NULL);
  - `\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b` and `\bNO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY\b` (invariant 1);
  - `\bTRUNCATE\b` and `\bDELETE\s+FROM\b` (delete rows old code still reads);
  - `\bUPDATE\s+\S+\s+SET\b` (a data rewrite the old code does not expect, and on a ledger table a breach of invariant 4). `ALTER … SET` and `GRANT UPDATE` do not match this pattern; the tests prove both.

**Pure core (what the unittest calls)**

```python
@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    operation: str
    severity: Literal["contract", "review"]
    reason: str

def classify_source(source: str, path: str, prior: PriorLookup, new_fields: set[FieldKey]) -> list[Finding]: ...
def scan_sql(sql: str) -> str | None: ...            # the contract reason, or None
def prior_definitions(sources: Iterable[tuple[str, str]]) -> dict[FieldKey, ast.Call]: ...
def changed_migrations(repo: Path, base: str, target: str) -> tuple[list[str], list[str], list[str]]: ...  # added, edited, deleted
def main(argv: list[str]) -> int: ...
```

`FieldKey = tuple[str, str, str]` (app label, lower-cased model name, field name); `PriorLookup = Mapping[FieldKey, ast.Call]`.

### 4.2 `ci_gate.py`

Task 5 runs this before it builds (push) or deploys a dispatched SHA. It exists because the CI workflows are path-filtered: the set of workflows that ran for a given SHA differs per commit, so the gate looks at what actually ran.

**CLI**

```
ci_gate.py [--repo <owner/repo>] --sha <sha> [--wait-minutes 45] [--poll-seconds 30] [--exclude deploy --exclude terraform-plan]
```

- Lists `gh api "repos/{repo}/actions/runs?head_sha={sha}&event=push&per_page=100"`, keeps the newest run per `workflow_id`, drops excluded workflow names, and decides. The default exclusions are `deploy` (itself) and `terraform-plan` (`infra-terraform.yml`'s `name:`) on `push` (N4): a push-to-`main` plan reports drift between the live infrastructure and `main`, which a human resolves by applying; it does not test the SHA, and a red plan must not block staging. `terraform-plan`'s PR runs (validate, tflint, trivy, the staging plan) already gated the merge.
- The skill reuses this script for its CI-green precondition: `python3 .github/scripts/ci_gate.py --sha <sha> --wait-minutes 0` (Task 7.6, N12), so "green" means the same thing in both places.
- `--repo` is optional, with the same default rule as `deployments.py`: `$GITHUB_REPOSITORY`, else `gh repo view --json nameWithOwner`.
- `--wait-minutes 0` (dispatch) decides once without polling.
- Writes `verdict=<green|red|superseded>` to `$GITHUB_OUTPUT`.

**Pure core**

```python
def decide(runs: list[dict], exclude: set[str], waited_seconds: int) -> tuple[Verdict, str]: ...
# Verdict = Literal["pending", "green", "red", "superseded"]
```

| Runs | Verdict |
|---|---|
| none yet, waited < 120 s | pending |
| none after 120 s (`repo-hygiene` always runs on push, so none means the SHA was never pushed to `main`) | red |
| any `status != "completed"` | pending |
| any conclusion in `failure`, `timed_out`, `startup_failure`, `action_required` | red |
| any `cancelled` (with per-SHA groups on `main`, only a manual cancel; a human cancelling CI on `main` means "do not ship this SHA") | superseded |
| all `success`, `skipped` or `neutral` | green |

**Exit codes:** `0` green, `1` red or still pending at the deadline, `3` superseded (Task 5 skips the run instead of failing it).

### 4.3 Unittests

`.github/scripts/tests/test_check_migrations.py`, in the style of `test_check_settings_modules.py` (`REPO = Path(__file__).resolve().parents[3]`, `sys.path` insert, `unittest`). Fixture migrations are module-level source strings, one per case, written as real Django migration files (`from django.db import migrations, models` / `class Migration(migrations.Migration)`); Django itself is never imported. Prior definitions come from a second fixture string standing in for the deployed `0001_initial.py`.

| Group | Fixture → expected |
|---|---|
| Contract | `RemoveField`; `DeleteModel`; `RenameField`; `RenameModel`; `RemoveConstraint`; `AlterModelTable`; `AddField` `CharField(max_length=10)` with a Python `default` and no `db_default`; `AddField` `ForeignKey` not null; `AlterField` `null=True` → no `null`; `AlterField` `max_length=100` → `50`; `AlterField` `CharField` → `IntegerField`; `AlterField` `max_digits=7` → `5`; `AlterField` adding `db_column="x"`; `RunSQL("DROP TABLE x")`; `RunSQL` `DROP POLICY IF EXISTS p ON t; CREATE POLICY p …` (no carve-out); `RunSQL` `ALTER TABLE x ALTER COLUMN y TYPE int`; `RunSQL` `ALTER TABLE x ALTER COLUMN y SET NOT NULL`; `RunSQL` `ALTER TABLE x DISABLE ROW LEVEL SECURITY`; `RunSQL` `ALTER TABLE x NO FORCE ROW LEVEL SECURITY`; `RunSQL` `DELETE FROM x`; `RunSQL` `UPDATE x SET y = 1`; `RunSQL` `ALTER TABLE x RENAME TO y`; `RunSQL([...])` with the `DROP` in the second element; `RunSQL(SQL)` resolving a module constant; `SeparateDatabaseAndState` with `RemoveField` in `database_operations`; a file with a syntax error; a deleted migration file |
| Review | `AlterField` with no prior definition; `AlterField(max_length=LIMIT)`; `AddField(null=NULLABLE)`; `RunPython`; `RunSQL(f"...")`; `*some_helper()` that is not allowlisted; `*rls_operations("academics_t1")` where `academics_t1` was created in the base tree (an existing table, N9); `*append_only_operations("fees_ledger")` on an existing table; `*rls_operations(TABLES)` with a non-literal argument; an edited existing migration |
| Clean (expand) | `CreateModel`; nullable `AddField`; `AddField` NOT NULL with `db_default=0`; `AddIndex`; `AddConstraint`; `AlterField` changing only `choices` (the shape of `attendance/0005_leave_source.py`); `AlterField` `max_length` `50` → `100`; `AlterField` `null` absent → `null=True`; `AlterField` on a field added in the same release; `*rls_operations("academics_t1")` and `*append_only_operations("fees_ledger")` in the same release as the `CreateModel`s that create those tables (the shape of `academics/0002_rls_policies.py`); `*append_only_operations("fees_ledger", mutable_columns={"fees_ledger": ["superseded_by_id"]})` with `fees_ledger` created in the same release; `RunSQL` whose only `DROP` is in `reverse_sql` (the shape of `website_cms/0007_custom_domains.py`); `RunSQL` `ALTER COLUMN y DROP NOT NULL`; `RunSQL` `GRANT UPDATE (c) ON t TO r`; `RunSQL` `ALTER TABLE t ADD CONSTRAINT c FOREIGN KEY (a) REFERENCES b ON UPDATE CASCADE`; `RemoveField` only in `state_operations`; a `DROP` inside a `--` comment |
| Helper pin | `rls_operations("t")` and `append_only_operations("t")` (imported from `apps/api/core/tenancy/`, run under the `api` workflow's Django tests, not this stdlib job) return SQL that `scan_sql` classes as clean except for the policy re-creation; the test fails if either helper's SQL gains `DROP TABLE`, `DISABLE` or `NO FORCE`. Lives in `apps/api/core/tenancy/tests/test_migration_helpers_are_expand_only.py`. |
| `main()` end to end | A temp git repo (`git init`, commit a base with `0001_initial.py`, commit a target adding `0002_*.py`): exit 0 for a nullable `AddField` target, 1 for a `RemoveField` target, 0 for `RemoveField` with `--allow-contract`, 4 for a `RunPython` target, 0 for it with `--acknowledge-review`, 0 with `--base none`, 2 for an unknown base SHA. `git` is on every runner; the test sets `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars so it needs no global config. |

`.github/scripts/tests/test_ci_gate.py`: one test per row of the `decide` table, plus "newest run per workflow wins" (an older failed attempt superseded by a newer successful run of the same workflow is green), "an excluded workflow's failure is ignored", and "a failed `terraform-plan` push run is ignored by default" (N4; fails when the default exclusion is removed).

Mutation lines for the PR body (tests-that-fail-well §9), for example: `test_remove_field_is_contract fails when check_migrations.py CONTRACT_OPS drops "RemoveField"`; `test_reverse_sql_drop_is_clean fails when RunSQL scanning reads reverse_sql`; `test_cancelled_is_superseded fails when decide() maps cancelled to red`. Each is marked "not run" (ADR-0007: CI runs them).

### 4.4 `repo-hygiene.yml`

- New job **`deploy-scripts`** ("Deploy checkers' unit tests"), no `if:`, so it also runs on push to `main`:
  `python3 -m unittest discover -s .github/scripts/tests -p 'test_check_migrations.py' -v`, then the same for `test_ci_gate.py` and Task 5's `test_deployments.py` and `test_check_task_definition.py`. (`lint-baselines` already discovers every test in that folder, but only on PRs; this job is the one that names the deploy checkers.)
- Same job, PR only: an early warning on the PR itself, `python3 .github/scripts/check_migrations.py --base HEAD^1 --target HEAD^2`, with `continue-on-error: true`. A contract migration is legal to merge (it deploys with the override), but the author should see it at review time, not at deploy time.
- New job **`actionlint`**: repo-hygiene does not run it today (`validate-workflows` only parses YAML). Download the pinned release (`rhysd/actionlint` v1.7.12, `914e7df21a07ef503a81201c76d2b11c789d3fca`) with its `download-actionlint.bash` at that commit, then lint only the files from this plan's list that exist at that commit (L-e): `files=$(ls .github/workflows/deploy.yml .github/workflows/deploy-env.yml .github/workflows/infra-terraform.yml 2>/dev/null)`, then `./actionlint $files`. At Task 4's commit only `infra-terraform.yml` exists; Task 5's files are linted from Task 5's commit on, so no commit in the stack is red for a missing file. It lints only the files this plan writes: the existing workflows were never linted, and fixing their findings is not this plan's work (record that in `docs/deferred-work.md`). actionlint also checks the inputs of local actions such as `.github/actions/ecs-rollout` and runs shellcheck on `run:` blocks.
- New `uses:` lines in these jobs are pinned to full SHAs (Global Constraints); the existing jobs keep their tags (not this plan's scope; noted in `deferred-work.md`).

### 4.5 Steps

- [ ] Write `test_check_migrations.py` and `test_ci_gate.py` first (TDD), then the two scripts.
- [ ] Add the two jobs to `repo-hygiene.yml`, and the per-SHA `concurrency` block to the five CI workflows.
- [ ] Commit `ci(deploy): add migration-safety and CI-green gates`. Push; read `gh pr checks <n> --watch`. Do not run the tests locally.

## Task 5: `deploy.yml` and the rollout action

**Files**
- Create `.github/workflows/deploy.yml`: triggers, `resolve`, `ci-gate`, `preview`, and the calls into the per-environment workflow. It holds no AWS credentials.
- Create `.github/workflows/deploy-env.yml` (`on: workflow_call`): one environment's build (staging only) and deploy or rollback. It is the only workflow file the deploy roles trust (D2), so every step that assumes a deploy role lives here.
- Create `.github/actions/ecs-rollout/action.yml`: one service's render → check → deploy → verify, called once per service in D9 order.
- Create `.github/scripts/deployments.py` and `.github/scripts/tests/test_deployments.py`: the GitHub Deployments API calls (D10), shared with the skill in Task 7 so "currently deployed SHA" is computed in one place.
- Create `.github/scripts/check_task_definition.py` and `.github/scripts/tests/test_check_task_definition.py` (H8, 5.6).
- Modify `apps/dashboard/Dockerfile`: build-only placeholders for the three `NEXT_PUBLIC_*` values, as `apps/website/Dockerfile` does, so the image builds in CI (author ruling 1). The real runtime fix is the separate dashboard plan (Task 5b pointer).

### 5.1 Pinned actions

Versions checked on 2026-11-26 with `gh api repos/<r>/commits/<tag> --jq .sha`; the implementer re-runs that command and uses its output. Inputs checked in Context7 (`/aws-actions/configure-aws-credentials`, `/aws-actions/amazon-ecs-render-task-definition`, `/aws-actions/amazon-ecs-deploy-task-definition` v2.6.4, `/docker/build-push-action`, `/websites/github_en_rest` deployments and statuses, `/websites/github_en_actions` environments).

| Action | Version | SHA |
|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `aws-actions/configure-aws-credentials` | v6.3.1 | `45666896f5d8e0f10ae255413f3a4cdd03bdc8f5` |
| `aws-actions/amazon-ecr-login` | v2.2.0 | `7290e214a610b32bc0eef81748948b6d466a8783` |
| `aws-actions/amazon-ecs-render-task-definition` | v1.9.1 | `8d79160660ad39c402a16e5fc7cd2a32e8f7d6b7` |
| `aws-actions/amazon-ecs-deploy-task-definition` | v2.6.4 | `a00d4d57ac0de1a99b39fe469f3d898d38717c2b` |
| `docker/setup-buildx-action` | v4.4.1 | `f87e5991a6d7451dcb8d9637bfbc97413f497069` |
| `docker/build-push-action` | v7.4.0 | `c3c9e263c25d99ce0380d002d59b67737d91b0dc` |

Written as `uses: <action>@<sha> # <version>`. There is no `docker/setup-qemu-action`: the build runs natively on `ubuntu-24.04-arm` (D8), which is free for public repositories, so the QEMU fallback is dropped.

### 5.2 Triggers (choice: push + gate, not `workflow_run`)

```yaml
name: deploy        # the name ci_gate.py excludes and the skill's `gh run list --workflow deploy.yml` shows (L-d)
run-name: deploy ${{ inputs.environment || 'staging' }} ${{ inputs.sha || github.sha }} (${{ inputs.mode || 'deploy' }})
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment: { type: choice, options: [staging, production], required: true }
      sha:         { type: string, required: true }   # full 40-char SHA on main
      mode:        { type: choice, options: [deploy, rollback], default: deploy }
      allow_contract_migration:     { type: boolean, default: false }
      allow_unstaged_sha:           { type: boolean, default: false }   # production only: SHA with no successful staging deployment
      acknowledge_migration_review: { type: boolean, default: false }   # review-class guard findings (D11)
      dry_run:     { type: boolean, default: false }
```

On `push`, `inputs.*` is empty, so `run-name` falls back to `staging`, `github.sha` and `deploy`. A dispatched run's `headSha` is `main`'s head, not the `sha` input, so the skill finds its run by this `displayTitle` (Task 7).

**Why push plus `ci_gate.py`, not `workflow_run`:** `api.yml`, `frontend.yml`, `infra-terraform.yml` and `infra-compose.yml` are path-filtered, so which CI workflows run differs per SHA. `workflow_run` fires once per listed workflow that completes: listing all of them starts several deploys for one SHA (and the first can start before the others are green), and listing one misses every SHA that workflow skipped. The gate (Task 4) waits for whatever actually ran for the SHA and requires all of it to be green. Its cost is one runner polling for up to about 45 minutes.

**Push deploys staging only.** Production is always a `workflow_dispatch` with `environment=production` and an explicit `sha`, which the skill starts (Task 7). This keeps one pending production approval from being queued (and then superseded) for every merge, and makes the promoted SHA an explicit input. The runbook's "staging first, production behind a gate" still holds.

**Not enabled until AWS exists:** every job after `resolve` runs only when `vars.ECR_REGISTRY != ''` (a repository variable, so a job-level `if` can read it). Merging this before Task 1 is applied gives a skipped run, not a red one (the reason `infra-terraform.yml`'s plan was disabled, applied here without a new variable).

**Build only, before the env apply:** `ECS_CLUSTER` is an **Environment** variable, which a job-level `if` cannot read (Environment variables reach a job only after it enters the Environment). So the rollout job checks it in its first step and, while it is empty, ends as "build only" (5.4). That is how the first images are built before the env root exists (Task 2 order of operations, step 4).

### 5.3 `deploy.yml` jobs

Top level: `permissions: {}`; each job grants what it needs.

| Job | Needs / if | Permissions | What it does |
|---|---|---|---|
| `resolve` | always | `contents: read` | Outputs `sha` (`github.sha` on push, the input on dispatch), `mode`, `environment` (`staging` on push), `allow_contract`, `allow_unstaged`, `ack_review`, `dry_run` (all `false` on push). Checks out with `fetch-depth: 0` and fails unless `sha` matches `^[0-9a-f]{40}$` and `git merge-base --is-ancestor <sha> origin/main` (no deploy of an unmerged commit). Fails if `allow_unstaged_sha=true` with `environment=staging` (meaningless). |
| `ci-gate` | `resolve`; `mode == 'deploy'` | `contents: read`, `actions: read` | `ci_gate.py --sha <sha> --wait-minutes {45 on push, 0 on dispatch}`. Output `verdict`. Exit 3 (superseded) is caught and turned into `verdict=superseded`; later jobs skip on it. Rollback skips the gate: the SHA was green when it was first deployed, and `preview` checks that it was deployed. |
| `preview` | `resolve`, `ci-gate` (green or skipped) | `contents: read`, `deployments: read` | No AWS, no Environment; runs **before** the approval gate, so its failures stop the run before anyone is asked to approve. Checks out with `fetch-depth: 0` (the ancestry check and the migration guard need full history). Steps: (1) `deployments.py current --env <env>` → `PREVIOUS_SHA`. (1b) **No going backwards** (deploy mode, `PREVIOUS_SHA` set; N6): `git merge-base --is-ancestor $PREVIOUS_SHA $sha` must succeed. On `push`, a failure means a newer SHA already reached staging (an older push's gate finished last): `preview` writes `superseded=true`, prints `::notice::<sha7> is older than the running <prev7>; skipped`, and exits 0, and the `staging`/`production` jobs skip on it. On dispatch it **fails**: "`<sha7>` is not a descendant of the running `<prev7>`; to go back, use `mode=rollback`". (2) Production deploy: `deployments.py ever-succeeded --env staging --sha <sha>`; on exit 1 **fail** with "this SHA never deployed successfully to staging" unless `allow_unstaged_sha`, in which case `::warning::` and continue. (3) Rollback: `deployments.py ever-succeeded --env <env> --sha <sha>`, failing with "this SHA was never live in <env>"; and `deployments.py overrides-between --env <env> --from <sha> --to <PREVIOUS_SHA>`: if any deployment in between carries `contract_override`, **fail** unless `allow_contract_migration=true` confirms that the old code can run on the contracted schema (D13). (4) Deploy: `check_migrations.py --base ${PREVIOUS_SHA:-none} --target <sha> --summary $GITHUB_STEP_SUMMARY` with `--allow-contract`/`--acknowledge-review` passed from the inputs; a non-zero exit fails the job. (5) Staleness: if `PREVIOUS_SHA` is set, its commit date is older than 300 days → `::warning::` "production's image expires at 365 days (D5); ship a newer build". (6) Writes the plan (env, mode, current → target SHA, migration findings, every override in effect, D9 service order) to the job summary. This is what the skill shows before it asks for approval (D14). With `dry_run=true` the run ends here. |
| `staging` | `preview`; `environment == 'staging' && !dry_run` | `contents: read`, `id-token: write`, `deployments: write` | `uses: ./.github/workflows/deploy-env.yml` with `environment: staging`. |
| `production` | `preview`; `environment == 'production' && !dry_run` | `contents: read`, `id-token: write`, `deployments: write` | `uses: ./.github/workflows/deploy-env.yml` with `environment: production`. |

**Permissions of the reusable workflow (H2).** Top level is `permissions: {}`. A called workflow's `GITHUB_TOKEN` can only keep or reduce what the **caller job** grants, never raise it, so the `staging` and `production` caller jobs grant `{contents: read, id-token: write, deployments: write}` and `deploy-env.yml`'s jobs then ask for those or fewer. Without `id-token: write` on the caller, the callee cannot get an OIDC token at all.

`staging` and `production` use `if: ${{ !cancelled() && needs.preview.result == 'success' && needs.preview.outputs.superseded != 'true' && ... }}`.

Callers pass `with: { environment, sha, mode, previous_sha, allow_contract_migration, allow_unstaged_sha, acknowledge_migration_review }` (H3); `previous_sha` is `preview`'s output, so both jobs agree on the base. `secrets: inherit` is **not** used (nothing secret is passed; AWS access is OIDC).

### 5.4 `deploy-env.yml` (one environment)

```yaml
on:
  workflow_call:
    inputs:
      environment:  { type: string, required: true }
      sha:          { type: string, required: true }
      mode:         { type: string, required: true }        # deploy | rollback
      previous_sha: { type: string, default: "" }           # from preview; re-checked below
      allow_contract_migration:     { type: boolean, default: false }
      allow_unstaged_sha:           { type: boolean, default: false }
      acknowledge_migration_review: { type: boolean, default: false }
```

`deploy-env.yml` has top-level `permissions: {}` and two jobs. Both assume the env's deploy role, whose trust names this file on `refs/heads/main` (D2).

**Job `build`** (`if: inputs.environment == 'staging' && inputs.mode == 'deploy'`; production never builds, D8):
- `runs-on: ubuntu-24.04-arm` (native arm64, D8). `permissions: { contents: read, id-token: write }`.
- `environment: { name: staging, deployment: false }`: the job needs the staging deploy role, but it is not a deployment.
- Matrix (`fail-fast: false`). The job-level `concurrency` is `build-${{ inputs.sha }}-${{ matrix.app }}` with `cancel-in-progress: false` (the old `build-${{ sha }}` was not a valid expression; `inputs.sha` is):

  | `app` | `context` | `file` | `target` | `build-args` |
  |---|---|---|---|---|
  | `api` | `apps/api` | `apps/api/Dockerfile` | `prod` | — |
  | `dashboard` | `.` | `apps/dashboard/Dockerfile` | `runner` | — (build-only placeholders in the Dockerfile, ruling 1) |
  | `website` | `.` | `apps/website/Dockerfile` | `runner` | `WEBSITE_IMAGE_HOSTNAME=${{ vars.WEBSITE_IMAGE_HOSTNAME }}` |

- Steps:
  1. Checkout at `inputs.sha`.
  2. `configure-aws-credentials`: `role-to-assume: vars.DEPLOY_ROLE_ARN`, `aws-region: vars.AWS_REGION`, `role-session-name: gha-build-${{ github.run_id }}`, `allowed-account-ids: vars.AWS_ACCOUNT_ID`, `role-duration-seconds: 3600`.
  3. `amazon-ecr-login` (output `registry`). Build only: `docker push` needs a registry login; the staging role has `ecr:GetAuthorizationToken`.
  4. Skip if present: `aws ecr describe-images --repository-name schoolhub/<app> --image-ids imageTag=<sha>`; exit 0 → `exists=true`, `ImageNotFoundException` → `false`, anything else fails. Later steps run only when `exists != 'true'`.
  5. `setup-buildx-action`, then `build-push-action`: `push: true`, `tags: ${{ vars.ECR_REGISTRY }}/schoolhub/<app>:<sha>`, `platforms: linux/arm64` (the task definitions set `cpu_architecture = "ARM64"`), `provenance: false` (a single-platform image, not an index, so ECR's tag and the task definition's image resolve to the same manifest), `cache-from/to: type=gha,scope=<app>` with `mode=max` on `cache-to`.

**Job `rollout`** (`needs: build`, `if: ${{ !cancelled() && (needs.build.result == 'success' || needs.build.result == 'skipped') }}`):
- `environment: { name: ${{ inputs.environment }}, deployment: false }`. `deployment: false` keeps Actions from creating its own deployment object, which would duplicate D10's record (and point at the workflow ref, not the input SHA on a rollback). Required reviewers still apply (GitHub docs, "Using environments without deployments"), so the production gate (D14) is unchanged. The OIDC `sub` is `<prefix>:environment:<env>:job_workflow_ref:<owner>/<repo>/.github/workflows/deploy-env.yml@refs/heads/main`; confirm on the first staging run with the role's CloudTrail `AssumeRoleWithWebIdentity` event.
- `concurrency: { group: deploy-${{ inputs.environment }}, cancel-in-progress: false }` (D15).
- `permissions: { contents: read, id-token: write, deployments: write }` (no more than the caller grants, H2).
- `timeout-minutes: 95`. Budget, worst case (N10): steps 0–7 about 3 min; migrate at most 15; five services at most 10 each (50); invalidation at most 5, non-fatal; smoke at most 4 (four URLs × 6 retries × 10 s); records 1. Total 78 min, so 95 leaves about 17 min of headroom, and the 7200 s credentials (taken at step 6, after the approval wait, which does not count against the job) outlive the job by 25 min.
- `env: { CLUSTER: ${{ vars.ECS_CLUSTER }} }`. The env roots name the cluster `schoolhub-<env>` and every service `schoolhub-<env>-<service>`, so the cluster name is the service prefix; `check_task_definition.py` asserts it (5.6).

Steps, in order:

0. **Enabled?** If `vars.ECS_CLUSTER` is empty, print `::notice::build only: ECS_CLUSTER is not set for <env>`, write that to the job summary, and set `enabled=false`; every later step has `if: steps.enabled.outputs.enabled == 'true'` (5.2 "Build only").
1. **Checkout** at `inputs.sha`, `fetch-depth: 0`.
2. **Re-read the current deployment**: `deployments.py current --env <env>` → `PREVIOUS_SHA` (empty on a first deploy). If it differs from `inputs.previous_sha` (another deploy finished after `preview`), print a notice and use the fresh value for every check below.
3. **Re-check** (the same checks `preview` ran, against this job's `PREVIOUS_SHA`, so an Environment approval cannot outlive a stale preview):
   - production deploy: `deployments.py ever-succeeded --env staging --sha <sha>`; fail unless it passes or `allow_unstaged_sha`;
   - rollback: `deployments.py ever-succeeded --env <env> --sha <sha>`, and `deployments.py overrides-between` as in `preview`, failing unless `allow_contract_migration`;
   - deploy mode with `PREVIOUS_SHA` set: `git merge-base --is-ancestor $PREVIOUS_SHA $sha` (N6). A failure here (another deploy moved ahead while this run waited) ends the job: on `push` with a `::notice::` and success, as superseded; on dispatch as a failure pointing to `mode=rollback`. No deployment record is created either way.
4. **Migration guard** (deploy mode only): `check_migrations.py --base ${PREVIOUS_SHA:-none} --target <sha> --json $RUNNER_TEMP/migrations.json --summary $GITHUB_STEP_SUMMARY`, with `--allow-contract` and `--acknowledge-review` from the inputs. Any non-zero exit fails (no deployment record is created). When an override let a finding through, print `::warning::<kind> deployed under <input> by <actor>` and set `CONTRACT_OVERRIDE=true` from the JSON's `overridden` contract findings.
5. **Create the deployment** (D10): `deployments.py create --env <env> --sha <sha> --mode <mode> --previous <PREVIOUS_SHA> --allow-contract <bool> --allow-unstaged <bool> --ack-review <bool> --contract-override ${CONTRACT_OVERRIDE:-false}` → `DEPLOYMENT_ID`, with status `in_progress` and `log_url` set to the run URL. Every override in effect also goes into the job summary.
6. **AWS credentials**: `configure-aws-credentials` with `vars.DEPLOY_ROLE_ARN`, `vars.AWS_REGION`, `role-session-name: gha-deploy-<env>-${{ github.run_id }}`, `allowed-account-ids: vars.AWS_ACCOUNT_ID`, `role-duration-seconds: 7200`, equal to the role's `max_session_duration` (H1); a larger request fails the assume.
7. **Verify all three images exist** (no ECR login: `describe-images` is an ECR API call that needs only `ecr:DescribeImages`, and ECS pulls with each task's execution role; the production role has no `ecr:GetAuthorizationToken`, N1): `aws ecr describe-images` for `schoolhub/{api,dashboard,website}:<sha>`. The image URIs used below are `vars.ECR_REGISTRY/schoolhub/<app>:<sha>`, not a login output. A missing tag fails here (D8, Review Focus 2), before anything changes. The same call returns `imagePushedAt`; when it is more than 300 days ago, print `::warning::image <sha7> was pushed <n> days ago; ECR expires SHA tags at 365 days (D5)`.
8. **Migrate** (deploy mode only):
   - `amazon-ecs-render-task-definition`: `task-definition-family: vars.MIGRATE_TASK_FAMILY`, `container-name: migrate` (the module names the container after `service_name`), `image: <registry>/schoolhub/api:<sha>`.
   - **Check the render**: `check_task_definition.py --file <rendered> --cluster $CLUSTER --service migrate --account vars.AWS_ACCOUNT_ID --env <env> --registry vars.ECR_REGISTRY` (H8, 5.6). It runs before anything is registered.
   - `amazon-ecs-deploy-task-definition`: `task-definition: <rendered>`, `cluster: vars.ECS_CLUSTER`, no `service`, `run-task: true`, `run-task-launch-type: FARGATE`, `run-task-subnets: vars.PRIVATE_SUBNETS`, `run-task-security-groups: vars.MIGRATE_SECURITY_GROUP`, `run-task-assign-public-IP: DISABLED`, `run-task-started-by: gha-<run_id>`, `wait-for-task-stopped: true`, `wait-for-minutes: 15`. The action fails if any container exits non-zero (Context7, `runTask` → `tasksExitCode`).
   - **Migrate result**, `if: always()` after the migrate step started. The run log is public (D22), so this step prints only: the container's exit code and `stoppedReason` from `aws ecs describe-tasks`, and the log lines matching `^(ERROR|CRITICAL)|Traceback|django\.db\.utils\.|psycopg\.errors\.` (at most 50, from `aws logs get-log-events`; group and stream prefix read from the rendered task definition's `logConfiguration`, not hardcoded). Nothing goes to the step summary except "migrate: exit <code>". The full log stays in CloudWatch for the human.
9. **Roll out** (both modes), one `uses: ./.github/actions/ecs-rollout` step per service, in D9 order:
   `api` (image api) → `celery-worker` (image api) → `dashboard` (image dashboard) → `website` (image website) → `celery-beat` (image api, `desired-count: 1`).
   Each step's `if:` is the default `success()` (plus `enabled`), so a failed service stops the ones after it. Beat always goes last and always at one task, in rollback mode too (Review Focus 4). On a failed rollout step, the action has already printed the stopped reasons (5.6); after beat, this job prints `celery-beat runningCount=<n>` in the log and the summary, which the skill reads (Task 7).
10. **CloudFront invalidation**: `aws cloudfront create-invalidation --distribution-id vars.CLOUDFRONT_DISTRIBUTION_ID --paths '/*'` (a failure to **create** it fails the step), then a bounded, non-fatal wait (N10): `timeout 300 aws cloudfront wait invalidation-completed --distribution-id … --id <id> || echo "::notice::invalidation <id> still in progress after 5 min; it completes on its own (usually under 10 min). Smoke checks may see cached pages until then."`, with the same notice in the summary. The CLI waiter alone polls for up to 10 min and then fails, which would fail a healthy deploy. Required in rollback mode (D13). Also run in deploy mode, proposed here beyond D13: HTML cached at the edge references the previous build's hashed `/_next/static` chunks, which the new website container no longer serves.
11. **Smoke tests** (D12), each `curl -fsS --retry 6 --retry-delay 10 --retry-all-errors --max-time 10`:
    - `https://api.${PLATFORM_DOMAIN}/healthz`
    - `https://app.${PLATFORM_DOMAIN}/api/health`
    - only when `SMOKE_TENANT_SLUG` is non-empty: `https://${SMOKE_TENANT_SLUG}.${PLATFORM_DOMAIN}/api/health`, and `https://${SMOKE_TENANT_SLUG}.${PLATFORM_DOMAIN}/` returns 200 and contains `<html`. When it is empty, print `::notice::tenant smoke checks skipped: SMOKE_TENANT_SLUG is not set (seed the smoke tenant, Task 2 step 11)` and add the same line to the summary (H9c).
    `PLATFORM_DOMAIN` is per environment (`staging.<domain>` for staging), matching `infra/terraform/envs/*/main.tf`'s `api.`/`app.` host headers.
12. **Mark success**: `deployments.py status --id <DEPLOYMENT_ID> --state success --environment-url https://app.${PLATFORM_DOMAIN}`.
13. **On failure** (`if: failure()`): `deployments.py status --id <DEPLOYMENT_ID> --state failure --description "<failed step>"`, then print to the log and the job summary:
    `gh workflow run deploy.yml --ref main -f environment=<env> -f mode=rollback -f sha=<PREVIOUS_SHA>`,
    or "no earlier successful deployment in <env>; nothing to roll back to" when `PREVIOUS_SHA` is empty. A failure in step 8 (migrate) prints that nothing was rolled out and the old code is still serving (runbook step 3).
14. **On cancel** (`if: cancelled()`): status `error`.

Steps 12–14 run only when `DEPLOYMENT_ID` is set, so a failure in steps 0–4 creates no record.

### 5.5 `deployments.py`

```
deployments.py current           --env <env>                        # prints the SHA or nothing
deployments.py ever-succeeded    --env <env> --sha <sha>            # exit 0 / 1
deployments.py overrides-between --env <env> --from <sha> --to <sha> # prints each successful deployment in between whose payload has contract_override; exit 0 none / 1 some
deployments.py create            --env <env> --sha <sha> --mode <deploy|rollback> --previous <sha|''> \
                                 --allow-contract <bool> --allow-unstaged <bool> --ack-review <bool> --contract-override <bool>   # prints the id
deployments.py status            --id <id> --state <in_progress|success|failure|error> [--description <s>] [--environment-url <url>]
```

- Calls `gh api` through `subprocess` (`GH_TOKEN` from the job, or the user's `gh` login when the skill runs it). `--repo` defaults to `$GITHUB_REPOSITORY`, else `gh repo view --json nameWithOwner`. Stdlib only, so the skill runs it as `python3 .github/scripts/deployments.py …` without a virtualenv.
- `create` posts `POST /repos/{repo}/deployments` with `ref: <sha>`, `environment`, `task: "deploy"`, `auto_merge: false`, `required_contexts: []` (the CI gate already ran; the API's default check verification would duplicate it with different rules), `production_environment: env == "production"`, `description: "<mode> <short sha>"`, `payload: {target_sha, mode, previous_sha, allow_contract_migration, allow_unstaged_sha, acknowledge_migration_review, contract_override, run_id, actor}` (H3). `contract_override` is `true` only when the guard (which runs before `create`, 5.4 step 4) found a contract migration and the override let it through; `create` takes it as `--contract-override <bool>`. Then an `in_progress` status with `log_url`.
- **Branch policy on `POST /deployments` (N13).** Checked 2026-11-28 in Context7 (`/websites/github_en_rest`, "Create a deployment" and "Deployment branch policies"): the REST docs list `ref` as "a branch, tag, or SHA" and document 409/422 responses, but **do not say** whether an Environment's custom branch policy (`main` only, D7) is applied to a deployment created through the API, nor how a bare SHA is matched against a branch pattern. It is unverified either way, so `create` handles both:
  - first attempt `ref: <sha>`, so the GitHub UI shows the exact commit;
  - if that returns 422 with a message containing `protection rules` or `not allowed to deploy`, retry once with `ref: "main"`. The SHA is still recorded in `payload.target_sha`, and the `description` reads `<mode> <sha7> (ref main: branch policy)`;
  - every reader (`current`, `ever-succeeded`, `overrides-between`, the skill) takes the SHA from `payload.target_sha`, never from the record's `sha`, so both shapes read the same (D10).
  - The first staging deploy shows which path ran; `deploy.md` records it.
- Every read filters on `task=deploy`, so deployments made by anything else (an Environment without `deployment: false`, a manual API call) never count as "deployed". Reads list the environment's deployments (`GET …/deployments?environment=<env>&task=deploy`, paginated) and match on `payload.target_sha`; the API's `sha=` filter is not used, because it matches the record's `sha`, which is `main`'s head under the fallback.
- `show --env <env> --sha <sha>`: prints the matching deployment's id, creation time, creator and payload as JSON, for the skill's status mode (7.3).
- `history --env <env>`: every deployment that ever had a `success` status, newest first, as `target_sha created_at creator`, for the skill's rollback candidates (7.7).
- `overrides-between`: the successful deployments of the environment after `--from`'s latest success, up to and including `--to`'s, in creation order; a match is one whose payload has `contract_override: true`. Used by `preview` and `deploy-env.yml` for D13, and by the skill's rollback mode.
- `current`: newest deployment for the environment whose **latest** status is `success`.
- `ever-succeeded`: any deployment of that SHA in that environment with **any** `success` status. `auto_inactive` (default `true`) adds an `inactive` status to a staging deployment once a newer one succeeds, so the latest status of an older, promoted SHA is no longer `success`; checking only the latest status would wrongly reject every promotion that is not the newest staging deploy.
- Pure core for the unittest: `pick_current(deployments: list[dict], statuses: dict[int, list[dict]]) -> str | None`, `ever_succeeded(statuses: list[dict]) -> bool`.

`test_deployments.py` cases: `create` retries with `ref: main` on the branch-policy 422 and keeps `payload.target_sha` (fails when the retry is removed), and does not retry on any other 422; a record whose `sha` differs from `payload.target_sha` is read by the payload; newest success wins over an older success; a newer failure does not replace the current success; a deployment with `success` then `inactive` is not current but does count for `ever-succeeded`; a deployment with a different `task` is ignored; no deployments → `None`; `overrides-between` finds a `contract_override` deployment between two SHAs and ignores one outside the range; `create` sends all four override fields in the payload. It runs in Task 4's `deploy-scripts` job.

### 5.6 `.github/actions/ecs-rollout/action.yml`

```yaml
name: ECS rollout
inputs:
  cluster:        { required: true }
  service:        { required: true }    # short name: api, celery-worker, dashboard, website, celery-beat
  image:          { required: true }    # full URI with the SHA tag
  desired-count:  { required: false, default: "" }
  wait-minutes:   { required: false, default: "10" }   # N10: a healthy Fargate roll here is ~4–6 min (pull, 60 s grace, 2×15 s health checks, 30 s deregistration)
  environment:    { required: true }    # staging | production, for the role-prefix check
  account-id:     { required: true }
  registry:       { required: true }
outputs:
  task-definition-arn: { value: ${{ steps.deploy.outputs.task-definition-arn }} }
runs:
  using: composite
```

Steps:
1. **Render**: `amazon-ecs-render-task-definition` with `task-definition-family: <cluster>-<service>` (the module's family is `${name_prefix}-${service_name}`), `container-name: <service>` (the module names the container after the service), `image: <image>`. Fetching by family takes the latest revision Terraform or the previous deploy registered and changes only the image, so Terraform keeps owning the task definition's shape (`ignore_changes = [task_definition, desired_count]` in `modules/ecs-service`).
2. **Check the render** (H8): `python3 .github/scripts/check_task_definition.py --file <rendered> --cluster <cluster> --service <service> --env <environment> --account <account-id> --registry <registry>`. It fails, before anything is registered, unless:
   - `family == "<cluster>-<service>"` (and `<cluster> == "schoolhub-<env>"`);
   - `taskRoleArn` and `executionRoleArn` both start with `arn:aws:iam::<account>:role/schoolhub-<env>-`;
   - every `containerDefinitions[].image` starts with `<registry>/schoolhub/`.

   This is the guard against a staging-registered revision landing in a production family, or a task role from the other environment (Task 1 risks). `test_check_task_definition.py` covers: a valid render passes; a production family with a staging role fails; a family from another cluster fails; a sidecar image from Docker Hub fails; a missing `taskRoleArn` fails. Mutation lines: each fails when its matching check in `check_task_definition.py` is removed.
3. **Deploy**: `amazon-ecs-deploy-task-definition` with `task-definition: <rendered>`, `service: <cluster>-<service>`, `cluster`, `wait-for-service-stability: true`, `wait-for-minutes: <wait-minutes>`, `wait-max-delay-seconds: 15`, and `desired-count` only when set.
4. **Verify the new revision is the one running**: `aws ecs describe-services --cluster <cluster> --services <cluster>-<service>`; fail unless there is exactly one deployment, its `taskDefinition` equals step 3's `task-definition-arn`, and its `rolloutState` is `COMPLETED`. The circuit breaker's automatic rollback leaves the service stable on the **old** revision, which `wait-for-service-stability` reports as success; this step turns that into a failure.
5. For `service == celery-beat`, also fail unless `runningCount == 1`, and print `celery-beat runningCount=<n>` either way.
6. **Stopped reasons**, `if: failure()`: `aws ecs list-tasks --cluster <cluster> --service-name <cluster>-<service> --desired-status STOPPED`, then `describe-tasks`; print, for the newest 5, `taskDefinitionArn`, `stoppedReason` and each container's `reason` and `exitCode` (E11). These are AWS status strings, not application logs, so they are safe in the public log (D22). The skill has no AWS credentials and reads them from here.

### 5.7 IAM the workflow needs (cross-check with Task 1)

| Step | Actions |
|---|---|
| Image existence check (`rollout`, both envs) | `ecr:DescribeImages` only. No login, no pull (N1) |
| Build (`build`, staging only) | `ecr:GetAuthorizationToken`, `ecr:DescribeImages`, `ecr:BatchGetImage`, `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage` |
| Render, migrate, roll out | `ecs:DescribeTaskDefinition`, `ecs:RegisterTaskDefinition`, `ecs:TagResource` with `ecs:CreateAction = RegisterTaskDefinition` on the env's six families (render fetches with `include: ['TAGS']`, so the registered revision carries tags; Task 2 `TagOnRegister`), `ecs:RunTask`, `ecs:DescribeTasks`, `ecs:ListTasks` (stopped reasons), `ecs:UpdateService`, `ecs:DescribeServices`, `iam:PassRole` on the env's task and execution roles (including migrate's) |
| Migrate logs | `logs:GetLogEvents` on the migrate log group |
| Invalidation | `cloudfront:CreateInvalidation`, `cloudfront:GetInvalidation` on the env's distribution |

Only `build` pushes, and it runs with the staging role. The production deploy role's ECR set is exactly `ecr:DescribeImages`, pinned by Task 1's `production_deploy_ecr_actions_exact`.

The ECS rollout action's calls (`ecs-rollout`) take `environment`, `account-id: vars.AWS_ACCOUNT_ID` and `registry: vars.ECR_REGISTRY` from `deploy-env.yml`.

### 5.8 Testing before AWS exists

- **Static**: Task 4's `actionlint` job lints `deploy.yml`, `deploy-env.yml` and the composite action's inputs on every PR, from this task's commit on (it lints only files that exist). Every script has a unittest in `deploy-scripts`.
- **Dry run after merge**: with `vars.ECR_REGISTRY` unset, a push run stops after `resolve`. `gh workflow run deploy.yml --ref main -f environment=staging -f sha=<main sha> -f dry_run=true` runs `resolve`, `ci-gate` and `preview` for real: the gate, the Deployments API read and the migration guard, with no AWS. To make that possible, `dry_run` overrides the `vars.ECR_REGISTRY` condition for `ci-gate` and `preview` only.
- **Build only**: once bootstrap is applied and `staging`'s `DEPLOY_ROLE_ARN` is set but `ECS_CLUSTER` is not, a staging dispatch builds and pushes the three images and the rollout ends at step 0 (Task 2 order, step 4).
- **First real run**: a staging push after Task 1–3 are applied. Its checklist (OIDC `sub` in CloudTrail, the migrate log group, beat's `runningCount`) goes in `infra/runbooks/deploy.md` (Task 8).

### 5.9 Steps

- [ ] Write `test_deployments.py`, then `deployments.py`.
- [ ] Write `test_check_task_definition.py`, then `check_task_definition.py`.
- [ ] Write `.github/actions/ecs-rollout/action.yml`.
- [ ] Write `deploy-env.yml`, then `deploy.yml`. Pin every action by SHA (5.1).
- [ ] Add the dashboard Dockerfile's build-only placeholders (ruling 1), copying the website Dockerfile's pattern.
- [ ] Add `test_deployments.py` and `test_check_task_definition.py` to the `deploy-scripts` job (Task 4).
- [ ] Commit `ci(deploy): add the deploy workflow and ECS rollout action`. Push; read `gh pr checks <n> --watch`.

## Task 5b: Dashboard runtime environment: split out (D17, author ruling 1)

Not in this plan or PR. Moving `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_PLATFORM_DOMAIN` (and the auth-proxy target) to request-time configuration gets **its own plan and PR**, written after this one merges: `docs/superpowers/plans/<date>-dashboard-runtime-env.md`. The reviewer found it large enough (env module, provider, every reader, e2e, compose, CI) to deserve its own review.

What this plan does instead:
- Task 5 gives `apps/dashboard/Dockerfile` build-only placeholders, so the image builds. Consequence, **accepted** (coordinator, 2026-11-28, L-h): until the follow-up lands, the dashboard image carries placeholder public URLs, so **the staging dashboard's browser-side API calls do not work**; its server-side `/api/health` (the smoke check) does. Staging is not built with staging build args, because that image would then be promoted with staging URLs baked in.
- Task 8 marks the existing `deferred-work.md` entries ("The dashboard image is per-environment", "The dashboard image's auth-proxy target is fixed at build time") as **LAUNCH BLOCKER** with the marker `launch-blocker:dashboard-runtime-env`.
- Task 7's `promote production` refuses while that marker is open, unless the user overrides it explicitly in chat (D17).

## Task 6: Re-enable `infra-terraform.yml` plan

**Files:** modify `.github/workflows/infra-terraform.yml`.

**Depends on:** Task 1 (the plan roles, their OIDC trust and their tfvars read) and Task 2 (the S3 backend per D6). The env tfvars object (D23) is created at bootstrap, not by this task.

### 6.1 Where the plan role ARN comes from

Plan role ARNs are the repository variables `PLAN_ROLE_ARN_STAGING` and `PLAN_ROLE_ARN_PRODUCTION` (D7), and the plan job references no Environment: the `production` Environment's reviewer and `main`-only branch policy would block every PR plan. The roles trust the customised `sub` of `infra-terraform.yml` runs (Task 1): staging accepts `pull_request` and `ref:refs/heads/main`, production only `ref:refs/heads/main`. GitHub issues no OIDC token to fork PRs, and the job skips them anyway (6.2).

### 6.2 Changes to the `plan` job

- **Triggers.** The workflow already has `push: branches: [main]`, `pull_request` and `workflow_dispatch`; the change is only to add `infra/postgres/init/**` to both path filters (Task 3), so a change to the SQL that feeds the db-bootstrap task definition is planned too (L-a).
- **Matrix rows:** `{ env: staging, dir: infra/terraform/envs/staging, var_suffix: STAGING }` and `{ env: production, dir: infra/terraform/envs/production, var_suffix: PRODUCTION }`. The hardcoded `role: arn:aws:iam::123456789012:role/schoolhub-terraform-plan-*` entries go (they also name roles that do not match D3).
- **Enabled first step (primary design).** A job-level `if` is evaluated before the matrix expands, so it cannot read `matrix.*`. The job-level `if` therefore checks only what does not depend on the row: `${{ github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository }}` (fork PRs skip, H4). The first step, `id: enabled`, computes per row and writes `enabled=true|false` to `$GITHUB_OUTPUT`:
  - the row's variable `vars[format('PLAN_ROLE_ARN_{0}', matrix.var_suffix)]` is non-empty (unset variables give a green, empty job, so the PR can merge before Task 1 is applied, the reason for today's `if: false`);
  - and the event fits the row (L-i): **staging** runs on `pull_request` or with `github.ref == 'refs/heads/main'` (`push` or `workflow_dispatch`); a dispatch from any other branch is refused, because the staging role trusts only those two contexts and the assume would fail. **Production** runs only on `push` or `workflow_dispatch` with `github.ref == 'refs/heads/main'`. A row that does not fit prints `::notice::<env> is planned on <allowed events> only` and sets `enabled=false`.

  After `configure-aws-credentials`, a second gate step, `id: tfvars`, checks that the env's tfvars object exists (D23, N3, M-1): `aws s3api list-objects-v2 --bucket $TF_STATE_BUCKET --prefix schoolhub/<env>/terraform.tfvars --query "length(Contents[?Key=='schoolhub/<env>/terraform.tfvars'] || \`[]\`)" --output text`, which counts that exact key (the plan role has `s3:ListBucket` on `schoolhub/<env>/*`). Not `head-object`: without bucket-wide `s3:ListBucket`, S3 answers a missing key with 403, not 404, so absence and a permissions error look the same. A count of 0 prints `::notice::<env> plan disabled: s3://…/schoolhub/<env>/terraform.tfvars does not exist yet (create it with /schoolhub-deploy bootstrap)` and sets `present=false`; 1 sets `present=true`; any error from the call fails the step. Before the file exists the row is green and empty, so a plan with no variable values never fails, and a failing plan can never block `ci_gate.py` (which also excludes `terraform-plan` push runs, N4).

  Every later step has `if: steps.enabled.outputs.enabled == 'true'` (and, after the tfvars gate, `steps.tfvars.outputs.present == 'true'`). The PR comment step also requires `github.event_name == 'pull_request'`.
- **Variable values (D23):** `aws s3 cp s3://$TF_STATE_BUCKET/schoolhub/<env>/terraform.tfvars "$RUNNER_TEMP/env.tfvars"`, then `terraform plan -var-file="$RUNNER_TEMP/env.tfvars"`. The file is never printed, cached or uploaded.
- **What the plan shows (coordinator ruling N11, D22):** `terraform plan -input=false -lock-timeout=5m -detailed-exitcode -no-color -out="$RUNNER_TEMP/tfplan" > "$RUNNER_TEMP/plan.log" 2>&1`, so the diff never reaches the log; on a non-zero, non-2 exit the step prints only the `Error:` lines of `plan.log` (`grep -A3 '^Error:'`). Then `terraform show -json "$RUNNER_TEMP/tfplan"` piped into `jq` counts `resource_changes[].change.actions` into add / change / destroy (a replace counts as both add and destroy) and sets `destructive=true` when any action is `delete`. The "Flag destructive changes" step and the PR comment use only those four values; the comment reads e.g. "staging: 3 to add, 1 to change, 0 to destroy. Destructive: no. The full plan is read at apply." No plan text goes to the log, the step summary, the PR comment or an artifact; the human sees the full plan when they run `terraform plan` before applying. The existing steps that post plan text are replaced, not kept.
- **Permissions (H4):** workflow level drops `id-token: write`; only the plan job has `permissions: { contents: read, id-token: write, pull-requests: write }`. `validate`, `tflint` and `trivy` keep `contents: read`.
- `configure-aws-credentials`: `role-to-assume: ${{ vars[format('PLAN_ROLE_ARN_{0}', matrix.var_suffix)] }}`, `aws-region: ${{ vars.AWS_REGION }}` (not the hardcoded `us-east-1`), `role-session-name: gha-terraform-plan-${{ matrix.env }}-${{ github.run_id }}`, `allowed-account-ids: ${{ vars.AWS_ACCOUNT_ID }}`.
- `terraform init -input=false` with all four backend values (Task 2, D19):
  ```bash
  terraform init -input=false \
    -backend-config="bucket=${{ vars.TF_STATE_BUCKET }}" \
    -backend-config="region=${{ vars.AWS_REGION }}" \
    -backend-config="key=schoolhub/${{ matrix.env }}/terraform.tfstate" \
    -backend-config="kms_key_id=${{ vars.TF_STATE_KMS_KEY_ARN }}"
  ```
- Locking: plan keeps `-lock-timeout=5m`. With `use_lockfile = true`, plan writes and deletes `<key>.tflock` under SSE-KMS, so the plan role has `s3:PutObject`/`s3:DeleteObject` on exactly that object and `kms:GenerateDataKey`/`kms:Encrypt` on the state key (Task 1 `StateLock`, `StateLockKms`), and nothing else writable. The alternative, `-lock=false`, lets a plan read a state an apply is half-way through; rejected.
- Keep the existing `-detailed-exitcode` handling; the "Flag destructive changes" step and the PR comment keep their purpose but carry only the counts and the flag (above).
- `concurrency`: the per-SHA-on-`main` block of Task 4 (N5), `cancel-in-progress` only off `main`.
- `TF_VERSION` stays `1.13.3`, which already satisfies D19's `required_version >= 1.11`; nothing is downgraded (L-a).

### 6.3 Pinning and header comment

- Pin every `uses:` in this file to a full SHA of its **current major**, with the version comment, because the file is being edited (Global Constraints): `actions/checkout` v4, `hashicorp/setup-terraform` v3, `terraform-linters/setup-tflint` v4, `aquasecurity/trivy-action` v0.36.0, `aws-actions/configure-aws-credentials` v4, `actions/github-script` v7 (the majors in today's file). Resolve each SHA with `gh api repos/<r>/commits/<tag> --jq .sha`, using the newest tag of that major. Major bumps are not this plan's work; Task 8 adds a deferred entry.
- Rewrite the file's header comment and the plan job's comment: the plan step is enabled when the plan-role variables exist, production is planned only on `main`, and it never applies (D3: no apply role in v1).
- `tflint_version: latest` stays out of scope (noted in `deferred-work.md`).

### 6.4 Production state exposure (decided)

The production plan role can read production state, which holds the RDS master password until the database module uses `manage_master_user_password`. Decided (H4): the production row runs only on `push` to `main` and on `workflow_dispatch` from `main`, and the role's trust allows nothing else (Task 1). Moving the password out of state is a deferred entry (Task 8). The staging plan role does run on same-repository PRs and can read staging state; the user accepted that on 2026-11-28.

### 6.5 Steps

- [ ] Edit `infra-terraform.yml` as above. Task 4's `actionlint` job lints it.
- [ ] Commit `ci(terraform): enable the plan job with OIDC roles from repository variables`. Push; read `gh pr checks <n> --watch`. With the variables unset, each plan row runs only its `enabled` step and ends green with every later step skipped; the production row also notes "planned on main only". After bootstrap but before a tfvars object exists, the row stops at the `tfvars` gate, also green. That is the expected result for this PR.

## Task 7: The `schoolhub-deploy` skill

**Files:**
- Create: `.claude/skills/schoolhub-deploy/SKILL.md`
- Create: `.claude/skills/schoolhub-deploy/preconditions.md` (the production checklist, each item with its command and pass rule)
- Create: `.claude/skills/schoolhub-deploy/error-catalogue.md` (log signature → cause → fix → who acts)
- Modify: `.claude/settings.json` (one `permissions.ask` rule, step 7.8)
- Modify: `.cspell/project-words.txt` (only the words cspell rejects in CI)

**Names it uses from Task 5 (defined there, not here):**
- `run-name` `deploy <environment> <sha> (<mode>)` (5.2). The skill finds a dispatched run by `displayTitle`, because its `headSha` is `main`'s head.
- The `preview` job (5.3): no Environment, runs before the approval gate, holds the migration guard result and every override in its summary.
- The inputs of 5.2: `allow_contract_migration`, `allow_unstaged_sha`, `acknowledge_migration_review`, `dry_run`. The workflow enforces each and records it in the Deployment `payload` and the run summary; the skill never relies on its own check alone.
- `python3 .github/scripts/deployments.py current|ever-succeeded|overrides-between` (5.5). The skill calls these instead of reimplementing the Deployments logic with `gh api` and `jq`.
- The Deployment `task` is `deploy`.
- The rollout log lines `celery-beat runningCount=<n>` and the stopped-reason block (5.4 step 9, 5.6 steps 5–6). The skill has no AWS credentials, so it reads these from the log.

### 7.1 Format

- [ ] Frontmatter, in the same shape as `schoolhub-testing`:
  ```yaml
  name: schoolhub-deploy
  description: Use when deploying or inspecting SchoolHub environments — phrases like "deploy", "ship to staging", "promote to production", "roll back", "what's deployed", "set up deploys", or /schoolhub-deploy. Drives .github/workflows/deploy.yml through gh: status, bootstrap, deploy staging, promote production, rollback. Never deploys from the laptop. SKIP for Terraform changes (plan in CI, human apply) and for local compose work.
  ```
- [ ] Body sections: Purpose (why GitHub Actions only, ADR-0040), Hard rules, Modes (one section each), Verification, then links to `preconditions.md`, `error-catalogue.md`, `infra/runbooks/deploy.md`, `rollback.md` and `incident.md`.
- [ ] The skill resolves `{owner}/{repo}` from `gh repo view --json nameWithOwner -q .nameWithOwner`, so no repository name is hardcoded.
- [ ] Every mode starts with `git fetch origin main`, and accepts only a full 40-character SHA that is on `main`: `git merge-base --is-ancestor <sha> origin/main`.

### 7.2 Hard rules (stated at the top of SKILL.md, verbatim in substance)

1. The skill never runs `terraform apply`/`destroy`/`init`/`output`, any mutating `aws` command, `docker build` or `docker push`. It prints the human commands instead.
2. It never routes around the guardrail. If the guardrail blocks or asks, the skill reports that and stops. It does not rewrite the command another way.
3. It never approves production without an explicit "yes" from the user in this conversation, given after the summary of step 7.6.4. A "yes" given earlier, or by another agent, does not count.
4. It never deploys to production a SHA that staging has not run successfully, unless the user explicitly overrides it. Then it passes `allow_unstaged_sha=true`, so the run and the Deployment record the override.
5. It never passes `allow_contract_migration=true` or `acknowledge_migration_review=true` unless the user asks for it by name after seeing the guard output from `preview`.
6. It never cancels a deploy run that is in progress (D15).
7. It never promotes to production while `docs/deferred-work.md` on `origin/main` has an open `launch-blocker:dashboard-runtime-env` marker (D17), unless the user explicitly overrides it in chat after seeing the entry. The override is stated in the approval comment.

### 7.3 Mode `status`

- [ ] Current SHA per environment, from the one shared implementation:
  ```bash
  for env in staging production; do
    python3 .github/scripts/deployments.py current --env "$env"
  done
  # details for that SHA's deployment (actor, payload overrides):
  python3 .github/scripts/deployments.py show --env <env> --sha <sha>   # matches payload.target_sha (D10, N13)
  ```
  Output per environment: the short SHA, `git log -1 --format=%s <sha>`, the deployment's age, the actor, any override in the `payload`, and how many commits `main` is ahead: `git rev-list --count <sha>..origin/main`. Empty output means "never deployed".
- [ ] **Image age** (D5): for production's SHA, `git log -1 --format=%ct <sha>` approximates the image push time (the build runs on the merge). Over 300 days, warn: "production's image expires from ECR at 365 days; deploy a newer build before <date>".
- [ ] Deploy runs in progress or queued:
  `gh run list --workflow deploy.yml -L 20 --json databaseId,displayTitle,status,event,createdAt,url --jq '.[] | select(.status != "completed")'`.
- [ ] A run in `waiting` status is waiting for approval. Show its link.

### 7.4 Mode `bootstrap`

Detect first, using only `gh` reads and the user's answers. The skill reads no Terraform state and calls no mutating AWS API; the two read-only AWS checks below (region opt-in, tfvars object) are printed for the human to run when the skill has no AWS credentials, and the human pastes the result.

- [ ] **Region enabled** (L-c): `aws account get-region-opt-status --region-name <region>` must return `ENABLED` or `ENABLED_BY_DEFAULT`. `me-central-1` is an opt-in region, disabled by default in a new account; `ap-south-1` is enabled by default. If it is `DISABLED`, the human runs `aws account enable-region --region-name <region>` and waits for `ENABLED` (it can take minutes to hours) before Task 1's apply.
- [ ] **Env tfvars object** (D23, N3, M-1): the same exact-key count Task 6.2 uses, `aws s3api list-objects-v2 --bucket <TF_STATE_BUCKET> --prefix schoolhub/<env>/terraform.tfvars` filtered to `Key == schoolhub/<env>/terraform.tfvars` (0 absent, 1 present, any error fails), per env. Not `head-object`, which returns 403 for a missing key without bucket-wide `ListBucket`. Missing is "pending" until the env-apply step.

- [ ] Repository variables (D7): `gh variable list --json name,value`. Expected: `AWS_REGION`, `AWS_ACCOUNT_ID`, `ECR_REGISTRY`, `WEBSITE_IMAGE_HOSTNAME`, `PLAN_ROLE_ARN_STAGING`, `PLAN_ROLE_ARN_PRODUCTION`, `TF_STATE_BUCKET`, `TF_STATE_KMS_KEY_ARN`.
- [ ] OIDC `sub` customisation (author ruling 2): `gh api repos/{owner}/{repo}/actions/oidc/customization/sub`. Expected: `use_default: false` and `include_claim_keys` equal to `["repo", "context", "job_workflow_ref"]`.
- [ ] Environments: `gh api repos/{owner}/{repo}/environments --jq '.environments[] | {id, name, protection_rules}'`. Expected: `staging` and `production`. `production` has a `required_reviewers` rule naming the user, with `prevent_self_review: false` (user decision).
- [ ] Branch policy: `gh api repos/{owner}/{repo}/environments/production/deployment-branch-policies --jq '.branch_policies[].name'`. Expected: `main`. Repeat for `staging`.
- [ ] Environment variables (D7): `gh variable list --env <env> --json name,value`. Expected: `DEPLOY_ROLE_ARN`, `ECS_CLUSTER`, `SMOKE_TENANT_SLUG`, `PLATFORM_DOMAIN`, `CLOUDFRONT_DISTRIBUTION_ID`, `MIGRATE_TASK_FAMILY`, `PRIVATE_SUBNETS`, `MIGRATE_SECURITY_GROUP`. `ECS_CLUSTER` and the rest of the env-root outputs are legitimately empty before the env apply ("build only", Task 5.2); `SMOKE_TENANT_SLUG` is legitimately empty until the smoke tenant is seeded (D12). The table shows those as "pending", not "missing".
- [ ] Bootstrap outputs recorded: `ECR_REGISTRY`, `AWS_ACCOUNT_ID`, both `PLAN_ROLE_ARN_*` and both `DEPLOY_ROLE_ARN` are set, and no ARN contains `123456789012`.
- [ ] Backend configured: check the latest `infra-terraform` run on `main`: `gh run list --workflow infra-terraform.yml --branch main -L 1 --json conclusion,url`. A failed `init` step means a backend variable or a `PLAN_ROLE_ARN_*` is not ready; read it with `gh run view <id> --log-failed`.
- [ ] Print a table of present, pending and missing items. Then ask for each value still missing: account ID, region (`me-central-1` or `ap-south-1`, D20), platform domain, the user's GitHub login as production reviewer, and confirmation of D4.
- [ ] Print the human commands, in order, and do not run them:
  The order is Task 2's "Order of operations"; the skill prints it from `deploy.md`, not from its own copy:
  1. Task 1's first apply of the bootstrap root, exactly as Task 1's README states it, with `AWS_PROFILE` set, followed by the OIDC `sub` customisation `PUT`. The skill may run that `PUT` itself (a `gh` write) only after showing the body and getting a yes.
  2. Task 3's `infra/scripts/bootstrap-secrets.sh` for each environment, with the arguments Task 3 defines.
  2b. **Create the env tfvars file** (D23, N3): the skill copies `infra/terraform/envs/<env>/terraform.tfvars.example` to `<scratchpad>/<env>.tfvars`, fills each key from the user's answers, the bootstrap outputs and the `bootstrap-secrets.sh` ARN lines, shows the whole file, and on a yes prints the human's upload: `aws s3 cp <scratchpad>/<env>.tfvars s3://<TF_STATE_BUCKET>/schoolhub/<env>/terraform.tfvars --sse aws:kms --sse-kms-key-id <TF_STATE_KMS_KEY_ARN>`. The file holds ARNs and names, no secret values (those stay in Secrets Manager). The skill deletes its scratchpad copy afterwards.
  3. The build-only staging dispatch, then the env root apply (Task 2), once per environment, staging first.
  4. "Paste the `terraform output -json` of each root here." The skill then maps the outputs to the D7 variable names.
  5. Seed the smoke tenant and set `SMOKE_TENANT_SLUG` (Task 2 step 11).
- [ ] After the user confirms the values shown in a table, set them:
  ```bash
  gh variable set AWS_REGION --body "<region>"            # and every other D7 repository variable
  gh variable set DEPLOY_ROLE_ARN --env production --body "<arn>"   # each D7 environment variable, per env
  gh api users/<login> --jq .id                           # reviewer ids
  gh api -X PUT repos/{owner}/{repo}/environments/production --input <scratchpad>/env-production.json
  #   {"reviewers":[{"type":"User","id":<id>}],"prevent_self_review":false,
  #    "deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
  gh api -X POST repos/{owner}/{repo}/environments/production/deployment-branch-policies -f name=main -f type=branch
  gh api -X PUT repos/{owner}/{repo}/environments/staging --input <scratchpad>/env-staging.json   # no reviewers, same branch policy
  ```
  Payloads checked against the GitHub REST docs (Context7 `/websites/github_en_rest`, "Create or update an environment" and "Deployment branch policies"). `gh variable set --env` is confirmed with `gh variable set --help` (gh 2.89).
- [ ] `prevent_self_review` is `false`: the user decided on 2026-11-28 to be the only production approver, and GitHub would otherwise refuse their own approval. `deploy.md` and ADR-0040 record that this removes a second person's check; the in-chat yes (Hard rule 3) and the Claude Code `ask` rule (7.8) remain.
- [ ] Re-run the detection and show everything green.

### 7.5 Mode `deploy staging`

- [ ] Normal path: the merge to `main` starts `deploy.yml` (Task 5). The skill shows that run with `gh run list --workflow deploy.yml --event push -L 5 --json databaseId,headSha,status,conclusion,url`, then watches it as in 7.6.5.
- [ ] Manual path, to re-run or to deploy a chosen SHA:
  ```bash
  gh workflow run deploy.yml --ref main -f environment=staging -f sha=<sha> -f mode=deploy \
    -f allow_contract_migration=false -f acknowledge_migration_review=false
  gh run list --workflow deploy.yml --event workflow_dispatch -L 10 --json databaseId,displayTitle,createdAt,url \
    --jq '.[] | select(.displayTitle | contains("<sha>"))'
  ```
  Retry the lookup for up to 30 s, because the run appears a few seconds after dispatch.
- [ ] Before dispatching, the skill checks CI on the SHA (precondition 1) and shows the migration list since staging's SHA. The authoritative guard is `preview`; if it fails, the skill shows its summary (`gh run view <id> --log --job <preview_job_id>`) and asks whether to re-dispatch with an override (Hard rule 5).

### 7.6 Mode `promote production`

1. [ ] **SHA.** Ask for it. The default is the latest successful `staging` Deployment (7.3). Show `git log --oneline <prod_sha>..<sha>`.
2. [ ] **Preconditions**: the commands and pass rules live in `preconditions.md`. Each shows PASS, FAIL or ASKED in one table:
   - **CI green on the SHA** (N12): `python3 .github/scripts/ci_gate.py --sha <sha> --wait-minutes 0` with the user's `gh` login (`--repo` defaults from `gh repo view`). Pass on exit 0 (`green`); exit 1 is FAIL (red or still running), exit 3 is FAIL (superseded). It is the same script and the same exclusions the workflow's `ci-gate` uses, so the skill and the workflow cannot disagree about "green".
   - **Staging ran it:** `python3 .github/scripts/deployments.py ever-succeeded --env staging --sha <sha>` (exit 0). Then the soak: the window runs from that SHA's first successful staging status to the next successful staging Deployment, or to now. Pass at 24 h or more. The skill shows the window and asks the user to confirm that it included a working day and a night, because that is a calendar judgement. A FAIL can only be overridden by an explicit user statement; the skill then sets `allow_unstaged_sha=true` (Hard rule 4), and `preview` enforces and records it.
   - **Migration diff:** the production SHA comes from `deployments.py current --env production`. List the changes with
     `git diff --name-status <prod_sha>..<sha> -- 'apps/api/**/migrations/*.py'`
     and show each new file's operations with `git show <sha>:<path>`. The authoritative check is the `preview` job (Task 4's `check_migrations.py`), read in step 4. The skill does not run the checker locally (ADR-0007). With no production Deployment yet (the first deploy), the diff runs from the empty tree, and the skill says so.
   - **Dashboard launch blocker (D17), refusing:** `git show origin/main:docs/deferred-work.md | grep -n 'launch-blocker:dashboard-runtime-env' | grep -v '~~'`. Anything printed is a **FAIL that stops the mode** (Hard rule 7): the skill shows the entry and dispatches nothing unless the user explicitly overrides it in chat.
   - **Other open launch blockers:** `git show origin/main:docs/deferred-work.md | grep -n 'LAUNCH BLOCKER' | grep -v '~~'`. Pass when nothing is printed. If something is, show the entries and ask whether to continue.
   - **Image age:** as in 7.3; a target SHA older than 300 days is shown as a warning.
   - **High-stakes window:** ask "Is any school in admissions, results publication or the first days of fee collection?" The user must answer.
   - **On-call aware:** ask. The user must answer.
3. [ ] **Trigger:**
   `gh workflow run deploy.yml --ref main -f environment=production -f sha=<sha> -f mode=deploy -f allow_contract_migration=false -f acknowledge_migration_review=false [-f allow_unstaged_sha=true]`. Find the run as in 7.5.
4. [ ] **Wait for the gate.** Poll `gh run view <run_id> --json status,jobs` every 15 s until `status == "waiting"`. A failure first means `ci-gate` or `preview` failed (an unstaged SHA without the override, or a migration finding): go to the catalogue. Then:
   - `preview` output: `gh run view <run_id> --log --job <preview_job_id>`. The job id comes from the `jobs` array.
   - Pending environment: `gh api repos/{owner}/{repo}/actions/runs/<run_id>/pending_deployments --jq '.[] | {env: .environment.name, id: .environment.id, can: .current_user_can_approve}'`. If `can` is `false`, go to the UI fallback below.
   - Summary shown to the user: environment, full SHA, the commit list, the migration files with the guard verdict, the precondition table, any overrides, and the run URL. Then ask: **"Approve the production deploy of `<sha7>`? Reply yes to approve."**
5. [ ] **Approve only on an explicit yes** (D14). Anything else means reject or leave it waiting, as the user chooses.
   ```bash
   gh api -X POST repos/{owner}/{repo}/actions/runs/<run_id>/pending_deployments \
     -F 'environment_ids[]=<env_id>' -f state=approved \
     -f comment="Approved in chat by <login> after preconditions: <one-line summary>"
   ```
   The body (`environment_ids` integer array, `state` `approved`|`rejected`, `comment` required) was checked against the GitHub REST docs (Context7 `/websites/github_en_rest`, "Review pending deployments for a workflow run"). The guardrail does not block this call: its approval check matches only `/reviews` and `event=APPROVE`, read in `guardrails.sh`. Step 7.8 adds a harness prompt as a second control. **UI fallback**, used on any non-2xx response or when `can` is `false`: print `https://github.com/{owner}/{repo}/actions/runs/<run_id>` and tell the user to use "Review deployments" there.
6. [ ] **Watch:** `gh run watch <run_id> --exit-status --interval 30`. On failure, run `gh run view <run_id> --log-failed`, match the output against `error-catalogue.md`, and report the matching entry: cause, fix, and whether the skill or a human acts.
7. [ ] **Verify** (`deploy.md` §Verification):
   - The skill runs: `deployments.py current --env production` equals the SHA; `curl -fsS -o /dev/null -w '%{http_code}\n'` on `https://api.<domain>/healthz`, `https://app.<domain>/api/health` and, when `SMOKE_TENANT_SLUG` is set, `https://<slug>.<domain>/api/health`, with both values read from `gh variable get … --env production`; and `celery-beat runningCount=1` from the run log (Verification 6).
   - The human checks, from a checklist the skill prints: the auth round trip and the row count (2), tenant isolation with a second tenant (3), two tenant sites showing their own branding (4), Celery lanes draining (5), no new Sentry issue types in 15 min (7), and p95 within 20% (8).
   - Then offer: "Roll back to `<previous sha7>`?" It goes through 7.7 only if the user says yes.

### 7.7 Mode `rollback`

- [ ] First, the `rollback.md` escalation order: ask whether one module's feature flag would contain the fault (tool 1) before redeploying (tool 3). Redeploy only if the user says the release itself is faulty.
- [ ] Candidates: the environment's successful deployments whose `payload.target_sha` differs from the current one, newest first (`python3 .github/scripts/deployments.py history --env <env>`, which prints `target_sha`, creation time and creator for each deployment that ever had a `success` status). The default is the one before the current one. Show its age and `git log --oneline <prev>..<current>`.
- [ ] Warn if a candidate's commit is older than 300 days: D5's age-based rule expires SHA tags at 365 days (catalogue E5).
- [ ] Contract check (D13): `python3 .github/scripts/deployments.py overrides-between --env <env> --from <prev_sha> --to <current_sha>`. If it lists any deployment, show it: a contract migration shipped under the override since the target, so the old code may not run on today's schema. Pass `allow_contract_migration=true` only if the user, having seen that list, says so by name; otherwise `preview` refuses the rollback.
- [ ] Confirm, then dispatch:
  `gh workflow run deploy.yml --ref main -f environment=<env> -f sha=<prev_sha> -f mode=rollback -f allow_contract_migration=<false unless confirmed above>`.
  The rollback runs no build and no migration (D13).
- [ ] Production rollback still waits on the Environment gate. Steps 7.6.4 to 7.6.7 apply unchanged, including the explicit yes. The summary says "ROLLBACK" and lists the commits being removed.
- [ ] Afterwards, remind the user: purge ISR caches for affected tenants (`rollback.md` step 12; the workflow already invalidates CloudFront), and open an incident if any tenant was affected (`incident.md`).

### 7.8 Harness control for the approval

- [ ] Add `"ask": ["Bash(gh api *pending_deployments*)", "Bash(curl *pending_deployments*)"]` to `.claude/settings.json` `permissions` (user decision, 2026-11-28), so Claude Code prompts the user on every approval call, in addition to the in-chat yes. A read of `pending_deployments` also prompts. That is acceptable, and the skill says so. Confirm the rule syntax in the Claude Code settings docs before writing it.
- [ ] ADR-0040 states the limit: this is a **second control, not enforcement**. A pattern rule can be sidestepped by a differently spelled command (another HTTP client, a script), and Hard rule 2 forbids doing so but cannot prevent it. Enforcement is the `production` Environment's reviewer rule in GitHub.

### 7.9 `error-catalogue.md` (minimum rows: signature → cause → fix → who)

| # | Log signature (from `--log-failed`) | Usual cause | Fix | Who |
|---|---|---|---|---|
| E1 | `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Trust `sub` mismatch: the job has no `environment:`, the environment name or repository differs, or the run comes from a ref other than `main` | Compare the job's `environment:` with D2's `sub`; check the branch policy (7.4) | Human fixes the trust in bootstrap TF |
| E2 | `Input required and not supplied: role-to-assume` / `Could not load credentials` | A D7 variable is empty or set at the wrong level (repository vs environment) | `gh variable list --env <env>`; set it (7.4) | Skill, after confirmation |
| E3 | `denied: ... not authorized to perform: ecr:...` | The deploy role policy lacks that repository ARN, or `ECR_REGISTRY` is wrong | Check `ECR_REGISTRY`; fix the role policy in TF | Human applies |
| E4 | `RepositoryNotFoundException` / `name unknown` | Bootstrap root not applied, or a repository name differs from D5 | Run the bootstrap apply (7.4) | Human |
| E5 | `manifest unknown` / `ImageNotFoundException` for `<sha>` | The SHA was never built (not merged, build failed) or the age-based rule expired it (365 days, D5) | Deploy a SHA that staging ran; for an old rollback target, pick a newer one | Skill |
| E6 | `tag invalid: ... already exists` | An immutable tag was rebuilt (D5) | The build step must skip a tag that exists (Task 5). Never delete a tag | Implementer (workflow bug) |
| E7 | `preview`: contract finding `<Op> in <path>` (exit 1) | `RemoveField`/`DeleteModel`/rename/narrowing or NOT NULL `AlterField`/NOT NULL `AddField` without `db_default`/a contract SQL pattern (Task 4.1) | Split the release (expand now, contract later). Override only by explicit user request with `allow_contract_migration` | User decides |
| E7b | `preview`: review finding `<Op> in <path>` (exit 4) | `RunPython`, an unknown or unreadable operation, an edited migration | The user reads the operation; re-dispatch with `acknowledge_migration_review=true` only on their explicit request | User decides |
| E7c | `preview`: `this SHA never deployed successfully to staging` | Promoting a SHA staging did not run | Deploy it to staging first; override with `allow_unstaged_sha` only on explicit request (Hard rule 4) | User decides |
| E7d | `preview` (rollback): `contract override between <a> and <b>` | A contract migration shipped since the rollback target | Fix forward, or confirm with `allow_contract_migration` after reading the listed deployments (7.7) | User decides |
| E8 | Migrate task `exitCode` ≠ 0 | A migration error. The migrate log appears in the run | Fix forward. Nothing was deployed, and the old code still serves (deploy.md step 3) | Developer |
| E9 | Migrate task still running after 2 min / workflow wait timeout | A table rewrite or a lock wait | The human checks `SELECT pid, now()-query_start, wait_event_type, state, query FROM pg_stat_activity WHERE wait_event_type = 'Lock';` and `pg_locks`, and decides whether to cancel (`pg_cancel_backend`) | Human with DB access |
| E10 | `ResourceInitializationError: unable to pull secrets` | Missing secret ARN or `secretsmanager:GetSecretValue` on the execution role; Task 3 not run | Run `bootstrap-secrets.sh` for that env; check the ARN variables in TF | Human |
| E11 | `ECS Deployment Circuit Breaker was triggered` | See the stopped reason printed by the rollout job: failed health check (path or port, `DisallowedHost` for an IP `Host`, SSL redirect on the probe), missing secret or IAM (E10), container port ≠ the port the app listens on, `Read-only file system` (a write outside a mounted tmp dir), website `env.ts` validation (`Invalid environment variables`) at boot | Fix the cause named in the stopped reason. ECS has already rolled the service back, so the old version is serving. The Deployment is `failure`. Check L74 | Developer / human |
| E12 | Beat assertion: `celery-beat runningCount=<n>` with n ≠ 1 | 0: beat crashed at start (the stopped reasons are printed above it). More than 1 should be impossible after Task 2's 100/0 percentages; if seen, the service's deployment configuration drifted from Terraform | 0: fix and redeploy. >1: the human scales beat to 0, then to 1 (`rollback.md` step 6), and re-applies the env root to restore the percentages | Human |
| E13 | Smoke step: `curl: (6)` / `(28)` | DNS not set up for the domain, or the ALB is unreachable | Check `PLATFORM_DOMAIN`, DNS, and the distribution | Human |
| E14 | Smoke step: HTTP 400 / `DisallowedHost` | `ALLOWED_HOSTS` misses the host | Fix the env TF value; apply | Human |
| E15 | Smoke step: HTTP 403 with `x-cache: Error from cloudfront` / `Request blocked` | A WAF rule, or a direct hit on the CloudFront-only ALB | Read WAF sampled requests in the console; check the NAT exemption from #200 | Human |
| E16 | Smoke step: tenant site 404 | The seeded tenant slug does not exist in that env | Seed it, or fix the slug variable | Human |
| E16b | Notice: `tenant smoke checks skipped: SMOKE_TENANT_SLUG is not set` | Expected on the first deploy (D12) | Seed the smoke tenant and set the variable (Task 2 step 11) | Human |
| E17 | `Error acquiring the state lock` (plan job or human apply) | Another plan or apply holds the S3 `.tflock` | Wait. `terraform force-unlock <id>` only after confirming no other run holds it | Human |
| E18 | Approval POST 403/422, or `current_user_can_approve: false` | The user is not a reviewer, self-review is prevented, or the token lacks `repo` scope | UI fallback link (7.6.5); fix reviewers in 7.4 | User |
| E19 | Run `pending` with `Waiting for ... deploy-<env>` | Another deploy in the same concurrency group is running (D15) | Wait; show it with 7.3 | Skill |
| E20 | `Canceling since a higher priority waiting request for 'deploy-<env>' exists` | GitHub keeps only one pending run per group. A newer dispatch replaced this one | Re-dispatch after the running deploy finishes, if this SHA is still wanted | Skill |

### 7.10 How Task 7 is tested

A skill has no unit test. The checks are:
- [ ] The frontmatter parses and matches the existing skills (`name`, `description` with trigger phrases and a SKIP clause). `repo-hygiene`'s markdown-link, cspell and Prettier checks pass in CI.
- [ ] **Dry-run walkthrough checklist in the PR body.** For each mode, the implementer runs only the read commands against the real repository, which has no environments yet. They record what the skill would print, and confirm that no write command was reached:
  - `status`: the empty Deployments list is handled ("never deployed").
  - `bootstrap`: the missing-items table lists every D7 name.
  - `deploy staging`: the run lookup by `displayTitle` (reviewed against Task 5's `run-name`).
  - `promote production`: the precondition table on the current `main` SHA (CI check-runs real; Deployments empty → FAIL, as expected).
  - `rollback`: "no previous successful deployment" is handled.
  - Every write command in SKILL.md (`gh workflow run`, `gh variable set`, `gh api -X PUT|POST`) appears only after a confirmation step.
  - `promote production`: with the dashboard marker open (as it will be), the mode stops at the launch-blocker FAIL and dispatches nothing.
- [ ] `change-reviewer` (Task 9) checks Hard rules 3, 4 and 7 against the step text, and checks every catalogue row against Task 5's real step and job names (`preview`, `build`, `rollout`).

- [ ] **Commit** (after the user's go-ahead): `feat(skills): add the schoolhub-deploy skill`, staging only the files listed above by path.

---

## Task 8: Docs, ADR-0040, lesson

**Files:**
- Create: `docs/decisions/0040-deploy-pipeline-github-actions-oidc.md`
- Modify: `docs/decisions/README.md`, `infra/runbooks/deploy.md`, `infra/runbooks/rollback.md`, `docs/02-architecture/hosting-deployment.md`, `infra/README.md`, `infra/AGENTS.md`, `AGENTS.md`, `docs/context/context-map.md`, `docs/project-status.md`, `docs/deferred-work.md`, possibly `docs/07-quality/agent-lessons.md`

**ADR number:** 0040 is free. No file exists on any `origin/*` branch: 0036 is platform-admin's, 0037 is claimed by platform-admin's plan, and 0038–0039 belong to website-cms. The website launch-infra plan named 0040 only as an unused fallback (its Decision 6 made it unnecessary). Re-check with `git ls-tree -r --name-only origin/<branch> docs/decisions` across open branches just before committing.

### 8.1 ADR-0040: "Deploys run only in GitHub Actions, authenticated by OIDC, recorded as GitHub Deployments"

- [ ] Use the sections from `0000-template.md` (Context, Decision, Alternatives considered, Consequences, Enforced by). The Decision covers:
  - GitHub OIDC per-environment roles, no stored keys (D2, D3). The repository's `sub` is customised with `job_workflow_ref`, and each deploy role trusts only `deploy-env.yml@refs/heads/main` in its own Environment (author ruling 2). Role sessions last at most 7200 s.
  - ECR in the bootstrap root, so that one SHA-tagged image is promoted unchanged, with immutable tags (D5, D8). Age-based expiry (365 days) because the production role can neither push nor retag; a 300-day warning (author ruling 3).
  - GitHub Deployments as the record of what is deployed (D10).
  - Infra applied by a human, with no apply role in v1 (D3, Alternative 5).
  - Region near Pakistan, with a regional ALB certificate (D20).
  - The app connects directly to RDS on 5432 in v1, with a connections alarm; a pooler is deferred (D21). This amends `infra/AGENTS.md` rule 2.
  - Production approval through the Environment gate, with the user as the only reviewer and `prevent_self_review=false` (user decision), approved by the skill only on the user's in-chat yes (D14). The Claude Code `ask` rules on `pending_deployments` are a second control, not enforcement.
  - Dashboard promotion to production is a LAUNCH BLOCKER until the dashboard runtime-env PR lands (D17).
  - Run logs are public; the workflow prints no secrets and no full migrate log (D22).
  - CI shows only a Terraform plan's add/change/destroy counts and the destructive flag; no full plan in logs, PR comments, the step summary or artifacts, because the repository is public. The human reads the full plan at apply (coordinator ruling N11, D22).
  - Env tfvars live as one object per environment in the state bucket, read by the plan role and used by the human apply (coordinator ruling N3, D23), with the rejected alternatives (`TF_VAR_*` repository variables, committed tfvars).
- [ ] Alternatives: the plan's list, 1–13, condensed.
- [ ] Enforced by: the trust policies in the bootstrap Terraform and their `terraform test`; `deploy-env.yml`'s `environment:` and `concurrency:`; `check_task_definition.py`; `.github/scripts/tests/` for the migration guard; the `production` Environment's reviewer and branch policy (GitHub settings, review only); `.claude/settings.json`'s `ask` rules (second control); the guardrail.
- [ ] Add a row to `docs/decisions/README.md`'s index.

### 8.2 Runbooks and architecture docs

- [ ] `infra/runbooks/deploy.md`:
  - The entry point is `/schoolhub-deploy`. Staging is `deploy.yml` on push to `main`; production is `promote production`.
  - The first-time order of operations from Task 2 (region opt-in check, bootstrap, OIDC customisation, build-only run, env tfvars object, env apply, secrets, db-bootstrap, first deploy, smoke tenant seeding), and the `SHOW max_connections;` check for the alarm threshold.
  - Editing env tfvars (D23): download the object, edit, upload with SSE-KMS; never commit it. The CI plan reads the same object.
  - Which `POST /deployments` path the first deploy took (`ref: <sha>` or the `ref: main` fallback, N13).
  - Steps 7–13 become: dispatch, read the `preview` result, approve on the Environment gate (`prevent_self_review=false` and why), the workflow's migrate and rollout in D9 order with its stability waits.
  - Production is blocked for the dashboard until the runtime-env PR lands (D17).
  - Step 13's change log is replaced by the GitHub Deployment record.
  - Verification states which items the workflow and the skill automate (1, part of 4, and 6) and which stay human.
- [ ] `infra/runbooks/rollback.md`:
  - Tool 3 becomes `deploy.yml mode=rollback`, through the skill.
  - The current `aws ecs update-service` steps 7–11 move under "Break-glass, when GitHub Actions is unavailable", for a human only.
  - Step 10's order is aligned with D9 (`api` → `celery-worker` → `dashboard` → `website` → `celery-beat`). The doc's current order differs.
  - Step 12 notes that the workflow invalidates CloudFront itself, and that the ISR purge stays manual.
  - A rollback target's images expire 365 days after push (D5), and a rollback across a `contract_override` deployment needs explicit confirmation (D13).
- [ ] `infra/runbooks/custom-domain-onboarding.md` (Task 2, N2, M-2). Rewrite the onboarding sequence:
  1. **The apply adds the alias** to production's `custom_domain_aliases` (at most 8, L-1). Both certificates are replaced (`create_before_destroy`) and the new ones wait in `PENDING_VALIDATION`; the listener and CloudFront keep the old certificates until validation completes, so no tenant is affected meanwhile.
  2. **Read the new name's validation CNAME** from either certificate: `aws acm describe-certificate --certificate-arn <arn> --query "Certificate.DomainValidationOptions[?DomainName=='<alias>'].ResourceRecord"`. It is the same CNAME for the `us-east-1` certificate and the regional one (same account, same name).
  3. **The tenant creates that CNAME** in their own DNS zone.
  4. **Both certificates reach `ISSUED`** (`aws acm describe-certificate … --query Certificate.Status`, in `us-east-1` and in the app's Region) **before** the tenant points their domain at CloudFront.

  The wait: the apply blocks in `aws_acm_certificate_validation` until validation completes, up to its create timeout (75 minutes by default in the AWS provider; the implementer confirms the value in the provider docs for the pinned version). ACM itself gives a pending certificate **72 hours**; after that the certificate is `FAILED` and must be replaced. When the apply times out because the tenant has not created the CNAME yet: nothing is broken, the old certificates still serve; re-run the same apply once the CNAME exists. When 72 hours pass, re-run with `-replace` on both certificates and start again at step 2.

  Fix the runbook's current wrong claim (line 57) that ACM "validates it via the platform's own zone": only the platform domain and its wildcard are validated in the platform zone; a custom domain is validated by the CNAME the tenant creates in their zone. State the quota: ACM allows 10 names per certificate by default (2 used by the platform domain and wildcard), so a ninth alias needs the quota raised in both `us-east-1` and the app's Region first (L-1).
- [ ] `docs/02-architecture/hosting-deployment.md`:
  - §3: the real pipeline diagram (build on `main` → staging → gated production), OIDC, ECR in bootstrap, Deployments as the record.
  - §5: "CI reaches AWS by OIDC only".
  - §8: the rollback command.
- [ ] `infra/README.md`:
  - §3: the diagram and the bootstrap order (bootstrap apply → `bootstrap-secrets.sh` → env apply → `/schoolhub-deploy bootstrap`).
  - §6: the runbook index points at the skill.
- [ ] `infra/AGENTS.md`:
  - Amend rule 2 (user decision D21): "In AWS v1 the app connects directly to RDS on 5432 (ADR-0040); PgBouncer runs only in local compose until the deferred pooler lands. The transaction-pooling rules below still hold, so code stays pooler-safe: `SET LOCAL` only, no session-level `SET`, advisory locks, session prepared statements or `LISTEN`/`NOTIFY`."
  - Rewrite rule 8. Terraform is now applied by a human from the CI plan; CI never applies; no state, credentials or real account IDs in the repo (ADR-0040).
  - Add the line "Deploying or rolling back: use the `schoolhub-deploy` skill; never from a laptop."
- [ ] Root `AGENTS.md` skill table: add `| Deploying, promoting, rolling back, or "what's deployed" | schoolhub-deploy |`.
- [ ] `docs/context/context-map.md` line 57 ("Infra, CI/CD, deploy, environments"): add `infra/runbooks/deploy.md` and the skill.

### 8.3 Status and deferred work

- [ ] `docs/project-status.md`: update the CI and `infra` rows. Name the deploy workflow, the migration guard, the re-enabled plan step, the skill and ADR-0040. Say that nothing is applied until the human bootstrap. The doc-sync gate needs this file in the PR.
- [ ] `docs/deferred-work.md`:
  - Keep "The dashboard image is per-environment" (§ website launch-infra follow-ups) and "The dashboard image's auth-proxy target is fixed at build time" open, mark both **LAUNCH BLOCKER** for production, and add the marker `launch-blocker:dashboard-runtime-env` to each (D17; the skill greps for it). Each says the fix is the separate dashboard runtime-env plan, and that staging's dashboard browser calls fail until then (Task 5b pointer).
  - Add deferred entries:
    - an apply workflow (Alternative 5);
    - a separate production account (D4);
    - the single approver: `prevent_self_review=false`, the user is the only reviewer (user decision);
    - a connection pooler, PgBouncer or RDS Proxy, with the trigger "the `DatabaseConnections` alarm fires or task counts grow" (D21);
    - an alert on ECR scan findings (EventBridge rule on `ECR Image Scan` → SNS), since the registry scans but nothing reads the results (Task 1);
    - moving the RDS master password out of state (`manage_master_user_password`), which would let the production plan role stop reading a secret (6.4);
    - major bumps of the actions in `infra-terraform.yml` and the existing workflows (6.3, Task 4.4);
    - actionlint for the existing workflows (Task 4.4);
    - the custom-domain limit (Task 2, N2, L-1): ACM allows 10 names per certificate by default; the platform domain and its wildcard use 2, so `custom_domain_aliases` is validated to at most 8. Beyond 8, either raise the ACM "Domain names per ACM certificate" quota in both `us-east-1` and the app's Region (then the validation limit), or move both the ALB and CloudFront to per-domain certificates.

### 8.4 Lesson

- [ ] Add one entry only for a real mistake caught in this work. A candidate found while writing this plan: `infra/terraform/modules/ecs-service/main.tf` says beat is "stop-then-start instead of rolling", but it keeps `deployment_maximum_percent = 200` and `minimum_healthy_percent = 100` for every service. The `deployment_controller { type = "ECS" }` block does not change that, so a beat deploy briefly runs two schedulers. If Task 2 confirms and fixes this (beat: max 100, min 0), add **L75** in the §4 format:
  - Title: "A singleton service's deployment percentages are code, not a comment"
  - Mistake: the file, lines and effect
  - Check: for a service that must never run twice, read `deployment_maximum_percent` ≤ 100 in the module, not the comment
  - Add it to the §2 checklist as item 13.
  
  Otherwise, add no lesson.

- [ ] **Commit** (after the user's go-ahead): `docs(infra): record the deploy pipeline in ADR-0040 and the runbooks`

---

## Task 9: Review and PR

- [ ] **Hand-back checklist:** run `docs/07-quality/agent-lessons.md` §2, especially items 3, 6 and 12 (L74: every value `deploy.yml` passes to a task definition is read by that app).
- [ ] **Review:** dispatch `change-reviewer` with this plan's path and `git diff origin/chore/website-launch-infra...HEAD`. The brief carries the L11 overrides from the plan header and the five Review Focus items. Fix its findings in one pass. If a fix departs from the plan, amend the plan and re-review (stop rule 3).
- [ ] **Author check:** `git config user.name` and `git config user.email` resolve to the user. No `Co-Authored-By` trailer: this repository's commit-msg hook and CI reject it, and the user chose that on 2026-11-23. This overrides the organisation's attribution reminder.
- [ ] **Push** (after the user's go-ahead): `git push -u origin chore/deploy-pipeline`
- [ ] **PR, stacked on #200:**
  ```bash
  gh pr create --base chore/website-launch-infra --head chore/deploy-pipeline \
    --title "feat(infra): deploy through GitHub Actions with OIDC, and the schoolhub-deploy skill" \
    --assignee @me --label "needs review" --label enhancement --label documentation \
    --body-file <scratchpad>/pr-body.md
  ```
  The repository has no `infrastructure` label, so `enhancement` and `documentation` are used; no label is created.
- [ ] **Body**, in `.github/pull_request_template.md` order, with an **ELI5** section first. For example: "Today shipping code means someone with keys copying boxes into the warehouse by hand. This PR builds a conveyor belt: every box is labelled with its commit, goes to the test warehouse first, and only moves to the real one after a named person presses the button. The belt logs every move." Then:
  - Goal, and `**Work tier:** 2`.
  - Root cause: "Not a fix".
  - Approach and alternatives: link ADR-0040.
  - Tests: Task 4's unittest lane, with a mutation-proof line per test (`test_x fails when check_migrations.py:<line> <change> — verified / not run`), plus the Task 7 dry-run walkthrough checklist.
  - Docs: the file list.
  - The human steps that remain, in Task 2's order: bootstrap apply and OIDC customisation, `/schoolhub-deploy bootstrap`, secrets, build-only run, env apply, db-bootstrap, first deploy, smoke tenant seeding.
  - That dashboard promotion to production is a LAUNCH BLOCKER until the dashboard runtime-env PR (D17).
  - The template checklist.
- [ ] **CI:** `gh pr checks <n> --watch`. On a failure, read `gh run view <id> --log-failed` and fix it at the cause. Re-run environment failures with `gh run rerun <id> --failed`. `deploy.yml` does not run on a PR (push to `main` and dispatch only), so CI proves its YAML, the guard's tests and the docs gates, not a deploy. Say so in the PR.
- [ ] **After #200 merges:** `gh pr edit <n> --base main`, then watch CI again.
- [ ] Stop at "PR open, CI green". The human merges (ADR-0006). Reply on every review thread: fixes with their commit after CI is green; non-fixes are shown to the user as a draft first.

---

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-11-28 (third pass)
- **Verdict:** REVISE — N1, N3–N6, N8–N13 and L-a to L-i are fixed in the text. Two round-2 fixes add new defects: the regional ALB certificate's validation lists only the platform-zone records, so the first apply with a custom domain fails (H-1, the same latent defect as modules/cdn); and redis_settings(os.environ) bypasses the prod-settings test harness, which breaks three API test modules (H-2).
- **Findings addressed:**
  - H-1 (validation lists only platform-zone records) → Task 2 "Region and the ALB certificate": both `aws_acm_certificate_validation` resources (ALB and `modules/cdn`) list the certificate's own record names, the ALB one with `depends_on = [module.cdn]`; Task 2 Files flags the `modules/cdn/main.tf` change; tests `alb_validation_reuses_cdn_records` (rewritten) and `cdn_validation_lists_every_name`.
  - H-2 (prod-settings harness bypassed) → Task 2 "API Redis settings": `prod.py` reads the three values through `env(...)` and passes them to a pure `redis_settings(host, port, token)`; the three names join `PROD_REQUIRED_ENV`; tests in `apps/api/tests/test_redis_settings.py` use `load_prod_settings`, with no subprocess and no `config/tests` package.
  - M-1 (tfvars presence check) → Task 6.2 `tfvars` gate and Task 7.4: exact-key `list-objects-v2` count (0 absent, 1 present, any error fails), not `head-object`.
  - M-2 (onboarding sequence) → Task 8.2 `custom-domain-onboarding.md`: the four-step sequence, the validation create timeout and ACM's 72-hour expiry, what to do on each, and the "validates via the platform zone" claim corrected.
  - M-3 (`.env.example` for ADR-0014's drift test) → Task 2 Files and "API Redis settings": listed as a step that needs the user's explicit OK; in Unresolved.
  - L-1 (alias count) → Task 2 `custom_domain_aliases` validation (at most 8, message names the 10-name ACM limit and both Regions); Task 8.2 runbook; Task 8.3 deferred entry.
  - Low, D3 wording → D3: production can only describe images.
  - Low, `aws_region` wording → Task 2 Files and "Region and the ALB certificate": gains the allow-list validation (Task 1).
  - Low, `ci_gate.py --repo` → Task 4.2: optional, same default rule as `deployments.py`.
  - Low, `preview` history → Task 5.3 `preview` checks out with `fetch-depth: 0`.
  - Low, `append_only_operations(..., mutable_columns=…)` → Task 4.1 allow-list rule and a Task 4.3 Clean fixture.
  - Low, `mock_data` placement → Task 2 env tests: inside `mock_provider "aws"`.
  - Rounds 1 and 2 (H1–H10, the round-1 Mediums and Lows, N1–N13, L-a to L-i) were confirmed fixed by this pass, except H-1 and H-2 above, which replace parts of the N2 and N7 fixes.
- **Unresolved:**
  - **Needs the user's explicit OK (M-3):** adding `REDIS_HOST`, `REDIS_PORT` and `REDIS_AUTH_TOKEN` to `apps/api/.env.example`. ADR-0014's drift test fails without it; L11 and the user's `.env` rule forbid the edit without permission. Implementers must not touch the file unless the user has approved it.
  - **`modules/cdn` changes in this PR (H-1):** its certificate validation list is corrected too. That is a change to CloudFront's certificate resource outside the deploy pipeline itself, flagged for the reviewer and the user.
  - First-deploy confirmations carried over: the customised OIDC `sub` format (CloudTrail on the first staging run); whether `POST /deployments` with `ref=<sha>` obeys the branch policy (the `ref: main` fallback covers both); the 360/720 connection thresholds (`SHOW max_connections` after the first apply); the `aws_acm_certificate_validation` create timeout for the pinned provider version.
  - This plan needs a fourth `/review-plan` pass before approval.
