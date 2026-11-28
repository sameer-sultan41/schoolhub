# Terraform bootstrap root

Everything that must exist before an environment can be planned:

| File | Creates |
| --- | --- |
| `state.tf` | The state bucket `schoolhub-tfstate-<account>` (versioned, SSE-KMS, history-erasure deny) and its KMS key `alias/schoolhub-tfstate` |
| `oidc.tf` | The GitHub OIDC provider (or reads an existing one) |
| `roles.tf` | `schoolhub-gha-deploy-<env>` and `schoolhub-gha-plan-<env>` for staging and production |
| `ecr.tf` | `schoolhub/api`, `schoolhub/dashboard`, `schoolhub/website`: immutable tags, age-based expiry, scan on push |

One account holds both environments, separated by name prefix and state key. The
env roots (`../envs/*`) attach the env-scoped half of each deploy role's policy.

## Rules

- **A human applies this, once.** Agents never run `terraform apply` or a mutating
  `aws` command; the guardrail hook blocks them.
- State starts **local** (no backend block). Right after the first apply, copy
  `terraform.tfstate` into the team password manager as an attachment.
  **It holds no secret values, but it is the only record that lets Terraform manage
  these roles and repositories later.**
- Every trust policy assumes the **customised** OIDC `sub` (step 8 below). The
  customisation and the trust policies change together.

## Preconditions

- Admin credentials for the target account (`aws sts get-caller-identity`).
- The chosen region offers every service the env roots use (Fargate on ARM64,
  ElastiCache with in-transit encryption, RDS PostgreSQL 18, regional WAF):
  `aws ssm get-parameters-by-path --path /aws/service/global-infrastructure/regions/<region>/services`.
- Terraform `>= 1.11`.

## First run

```bash
cd infra/terraform/bootstrap
cp terraform.tfvars.example terraform.tfvars        # git-ignored; fill every value
gh api repos/{owner}/{repo}/actions/oidc/customization/sub   # shows use_default / use_immutable_subject: pick the prefix form
aws sts get-caller-identity                          # 1. confirm the account and an admin principal
aws account get-region-opt-status --region-name <region>   # 2. me-central-1 is opt-in: must be ENABLED (ap-south-1: ENABLED_BY_DEFAULT); else `aws account enable-region` and wait
terraform init                                       # 3. local backend
terraform plan -out=bootstrap.tfplan                 # 4. read it: about 30 resources, 0 to destroy
terraform apply bootstrap.tfplan                     # 5.
terraform output -json oidc_subject_template > /tmp/oidc-sub.json                               # 6.
gh api -X PUT repos/{owner}/{repo}/actions/oidc/customization/sub --input /tmp/oidc-sub.json     # 7. customise the sub
gh api repos/{owner}/{repo}/actions/oidc/customization/sub     # 8. expect use_default=false and repo, context, job_workflow_ref, workflow_ref
terraform output -json github_variables              # 9. paste into /schoolhub-deploy bootstrap
```

Before step 7 every token carries the default `sub` and no role here accepts it.
Nothing else in the repository uses OIDC, so the switch breaks nothing.

## Verification

- `terraform plan` shows no changes.
- The first staging deploy assumes `schoolhub-gha-deploy-staging`. If it fails with
  `Not authorized to perform sts:AssumeRoleWithWebIdentity`, CloudTrail's
  `AssumeRoleWithWebIdentity` event shows the exact `sub` received; compare it with
  `github_oidc_subject_prefix` and the trust policy.

## Moving state into the bucket

After the first apply, add a backend block with the four `-backend-config` values
used by the env roots (key `schoolhub/bootstrap/terraform.tfstate`) and run
`terraform init -migrate-state`. Keep the password-manager copy.

## Recovering lost local state

Write one `import { to = <address>  id = "<id>" }` block (two lines) per row, then run
`terraform plan` until it shows no changes:

| Address | Import ID |
| --- | --- |
| `aws_s3_bucket.tfstate` | `schoolhub-tfstate-<account>` |
| `aws_kms_key.tfstate` | `<key-id>` |
| `aws_kms_alias.tfstate` | `alias/schoolhub-tfstate` |
| `aws_s3_bucket_versioning.tfstate` | `schoolhub-tfstate-<account>` |
| `aws_s3_bucket_server_side_encryption_configuration.tfstate` | `schoolhub-tfstate-<account>` |
| `aws_s3_bucket_public_access_block.tfstate` | `schoolhub-tfstate-<account>` |
| `aws_s3_bucket_ownership_controls.tfstate` | `schoolhub-tfstate-<account>` |
| `aws_s3_bucket_lifecycle_configuration.tfstate` | `schoolhub-tfstate-<account>` |
| `aws_s3_bucket_policy.tfstate` | `schoolhub-tfstate-<account>` |
| `aws_iam_openid_connect_provider.github[0]` | `arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com` |
| `aws_iam_role.deploy["staging"]` | `schoolhub-gha-deploy-staging` |
| `aws_iam_role.deploy["production"]` | `schoolhub-gha-deploy-production` |
| `aws_iam_role.plan["staging"]` | `schoolhub-gha-plan-staging` |
| `aws_iam_role.plan["production"]` | `schoolhub-gha-plan-production` |
| `aws_iam_role_policy.deploy_ecr["staging"]` | `schoolhub-gha-deploy-staging:schoolhub-gha-deploy-staging-ecr` |
| `aws_iam_role_policy.deploy_ecr["production"]` | `schoolhub-gha-deploy-production:schoolhub-gha-deploy-production-ecr` |
| `aws_iam_role_policy.plan["staging"]` | `schoolhub-gha-plan-staging:schoolhub-gha-plan-staging-state` |
| `aws_iam_role_policy.plan["production"]` | `schoolhub-gha-plan-production:schoolhub-gha-plan-production-state` |
| `aws_iam_role_policy_attachment.plan_readonly["staging"]` | `schoolhub-gha-plan-staging/arn:aws:iam::aws:policy/ReadOnlyAccess` |
| `aws_iam_role_policy_attachment.plan_readonly["production"]` | `schoolhub-gha-plan-production/arn:aws:iam::aws:policy/ReadOnlyAccess` |
| `aws_ecr_repository.this["api"]` | `schoolhub/api` |
| `aws_ecr_repository.this["dashboard"]` | `schoolhub/dashboard` |
| `aws_ecr_repository.this["website"]` | `schoolhub/website` |
| `aws_ecr_lifecycle_policy.this["api"]` | `schoolhub/api` |
| `aws_ecr_lifecycle_policy.this["dashboard"]` | `schoolhub/dashboard` |
| `aws_ecr_lifecycle_policy.this["website"]` | `schoolhub/website` |
| `aws_ecr_registry_scanning_configuration.this` | `<account>` |

## Rollback

The bootstrap root holds the state bucket (`prevent_destroy`) and the roles every
deploy uses; it is never destroyed. A bad change is reverted in git and re-applied.

## Tests

`tests/bootstrap.tftest.hcl` runs in CI (`terraform test`, mocked provider, no AWS
credentials). It pins the trust conditions, session length, the production role's
ECR actions, the plan roles' state scoping and the ECR expiry rules.
