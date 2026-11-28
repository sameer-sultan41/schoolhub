# Deploy error catalogue

Match the output of `gh run view <run_id> --log-failed` against the signatures below and
report the row: cause, fix, and who acts. "Skill" means the skill may act after the user
confirms; "Human" means print the command and stop. Job and step names are those of
`deploy.yml` / `deploy-env.yml` (SKILL.md, "Workflow shape").

## Inputs and gates (`resolve`, `ci-gate`, `preview`)

| # | Signature | Usual cause | Fix | Who |
|---|---|---|---|---|
| E0 | `resolve`: `sha must be a full 40-character lower-case SHA` / `is not on main; only merged commits deploy` / `allow_unstaged_sha applies to production only` | A short or unmerged SHA, or the production-only override on staging | Re-dispatch with the full SHA from `origin/main`, without the stray override | Skill |
| E0b | `ci-gate`: `::error::CI gate: …` (exit 1) | A CI workflow failed, is still running, or never ran for the SHA (`no CI runs for this SHA`) | Read the named workflow's failure; wait for CI, or fix it on `main` | Developer |
| E0c | `ci-gate`: `::notice::CI gate: …; this SHA is not shipped` (exit 3) | A CI run for the SHA was cancelled (superseded). Later jobs skip | Nothing on a push run; deploy the newer SHA | Skill |
| E7 | `preview` or `Migration guard`: `::error file=<path>,line=<n>::contract: <Op>: <reason> (override: --allow-contract)` (exit 1) | `RemoveField`, `DeleteModel`, a rename, a narrowing or NOT NULL `AlterField`, `AddField` NOT NULL without `db_default`, or a contract SQL pattern | Split the release: expand now, contract later. Override with `allow_contract_migration` only on the user's explicit request | User decides |
| E7b | same, `review: <Op>: … (override: --acknowledge-review)` (exit 4) | `RunPython`, an unknown or unreadable operation, an edited migration | The user reads the operation; re-dispatch with `acknowledge_migration_review=true` only on their explicit request | User decides |
| E7c | `preview`: `this SHA never deployed successfully to staging (allow_unstaged_sha overrides)` | Promoting a SHA staging did not run | Deploy it to staging first; override only on explicit request (Hard rule 4) | User decides |
| E7d | `preview` (rollback): `a deployment between <a> and <b> carried a contract migration; …` | A contract migration shipped since the rollback target | Fix forward, or confirm with `allow_contract_migration` after reading `overrides-between` (rollback step 4) | User decides |
| E7e | `preview` (rollback): `this SHA was never live in <env>` | The target never had a successful deployment there | Pick a SHA from `deployments.py history --env <env>` | Skill |
| E7f | `preview` or `Re-check`: `is not a descendant of the running <sha7>; to go back, use mode=rollback` | A dispatch in `mode=deploy` would go backwards | Use `rollback`; or deploy a newer SHA | Skill |
| E7g | `::error::GitHub API: …` from `deployments.py` (exit 2) | Token scope, rate limit, or GitHub outage | Re-run the failed jobs (`gh run rerun <id> --failed`) once; if it repeats, check the message | Skill |
| E7h | `check_migrations`: `deployed SHA <sha> is not in this clone` / `git failed:` (exit 2) | The deployed SHA is not reachable from `main` (history rewritten) | Investigate; never override | Human |

## Credentials and images

| # | Signature | Usual cause | Fix | Who |
|---|---|---|---|---|
| E1 | `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Trust `sub` mismatch: OIDC `sub` customisation missing (or without `workflow_ref`), a run not started by `deploy.yml` on `main`, wrong `github_oidc_subject_prefix`, wrong Environment name, or a run from a ref other than `main` | Check the customisation and branch policy (bootstrap mode); compare with the trust in `infra/terraform/bootstrap/roles.tf` | Human fixes the bootstrap Terraform |
| E2 | `Input required and not supplied: role-to-assume` / `Could not load credentials` / `allowed-account-ids` mismatch | A variable is empty or set at the wrong level (repository vs Environment), or `AWS_ACCOUNT_ID` is wrong | `gh variable list` and `gh variable list --env <env>`; set it (bootstrap mode) | Skill, after confirmation |
| E3 | `not authorized to perform: ecr:…` / `AccessDenied` on `ecs:` or `iam:PassRole` | The deploy role policy lacks that resource, or `ECR_REGISTRY`/`ECS_CLUSTER` is wrong | Check the variables; fix `modules/gha-deploy-policy` or `bootstrap/roles.tf` | Human applies |
| E4 | `RepositoryNotFoundException` / `name unknown` | Bootstrap root not applied, or a repository name differs from `schoolhub/{api,dashboard,website}` | Run the bootstrap apply | Human |
| E5 | `Verify all three images exist`: `ImageNotFoundException` / `manifest unknown` for `<sha>` | The SHA was never built (production never builds), or ECR expired it (365 days) | Deploy a SHA staging ran; for an old rollback target pick a newer one | Skill |
| E6 | `build`: `tag invalid: … already exists` | Two builds of one SHA raced past the "Skip if … exists" step | Re-run the failed job; it then skips. Never delete a tag | Skill (re-run); workflow bug if it repeats |
| E6b | `::error::task definition for <service>: <problem>` | `check_task_definition.py`: the rendered task definition names another environment's role, account or registry | Fix the env Terraform so the family's roles and images match the environment | Human |

## Migrate and rollout

| # | Signature | Usual cause | Fix | Who |
|---|---|---|---|---|
| E8 | `Migrate result`: `migrate: exit <n>` with n ≠ 0, plus `ERROR` / `Traceback` lines | A migration error | Fix forward. Nothing was rolled out; the old code still serves | Developer |
| E9 | `Migrate` times out (15 min) or `migrate: exit None` | A table rewrite or a lock wait | Human checks `SELECT pid, now()-query_start, wait_event_type, state, query FROM pg_stat_activity WHERE wait_event_type = 'Lock';` and `pg_locks`, and decides whether to `pg_cancel_backend` | Human with DB access |
| E10 | `ResourceInitializationError: unable to pull secrets` | A secret has no value, a missing ARN, or no `secretsmanager:GetSecretValue`/`kms:Decrypt` on the execution role | Run `bootstrap-secrets.sh` (both phases) for that env; check the ARN tfvars | Human |
| E11 | `ECS Deployment Circuit Breaker was triggered`, or `::error::<service>: running <arn>, expected <arn> (rolled back?)` | Read the stopped reasons printed under `Stopped reasons for <service>`: failed health check (path, port, `DisallowedHost`, SSL redirect on the probe), missing secret (E10), wrong container port, `Read-only file system`, website `Invalid environment variables` at boot | Fix the named cause. ECS already rolled the service back; the old revision serves. Services after it were not touched. The Deployment is `failure`. Check lesson L74 | Developer / human |
| E12 | `celery-beat runningCount=<n>` with n ≠ 1 | 0: beat crashed at start (stopped reasons above it). >1: the service's deployment configuration drifted from Terraform's 100/0 | 0: fix and redeploy. >1: human scales beat to 0 then 1 (`rollback.md`) and re-applies the env root | Human |
| E12b | `build only: ECS_CLUSTER is not set for <env>` (notice, run green) | Expected before the env apply | None; finish bootstrap | — |

## Smoke and after

| # | Signature | Usual cause | Fix | Who |
|---|---|---|---|---|
| E13 | `Smoke tests`: `curl: (6)` / `curl: (28)` / `curl: (35)` | DNS not set for the domain, ALB unreachable, or a certificate not yet issued | Check `PLATFORM_DOMAIN`, DNS and the distribution | Human |
| E14 | `curl: (22) … error: 400` on `api.` | `ALLOWED_HOSTS` misses the host (`DisallowedHost`) | Fix the env Terraform value; apply | Human |
| E15 | `curl: (22) … error: 403` (`x-cache: Error from cloudfront`) | A WAF rule, or a direct hit on the CloudFront-only ALB | Read WAF sampled requests; check the NAT exemption | Human |
| E16 | `curl: (22) … error: 404` on `<slug>.` | The smoke tenant slug does not exist in that env | Seed it, or fix `SMOKE_TENANT_SLUG` | Human |
| E16b | `tenant smoke checks skipped: SMOKE_TENANT_SLUG is not set` (notice) | Expected on the first deploy | Seed the smoke tenant, set the variable, re-run | Human |
| E16c | `the tenant home page did not render HTML` | The website returned a non-HTML body | Read the website's logs in CloudWatch | Developer |
| E16d | `invalidation <id> still in progress after 5 min` (notice) | CloudFront is slow; not a failure | None; smoke checks may see cached pages briefly | — |
| E17 | `Error acquiring the state lock` (plan job or human apply) | Another plan or apply holds the S3 `.tflock` | Wait; `terraform force-unlock <id>` only after confirming no run holds it | Human |

## Approval and queueing

| # | Signature | Usual cause | Fix | Who |
|---|---|---|---|---|
| E18 | Approval `POST` returns 403/422, or `current_user_can_approve: false` | The user is not a reviewer, self-review is prevented, or the token lacks `repo` scope | UI fallback link (promote step 5); fix reviewers in bootstrap mode | User |
| E18b | The `ask` permission prompt on `pending_deployments` was denied | The user declined in Claude Code | Stop. Do not retry another way (Hard rule 2) | User |
| E19 | Run `pending`, rollout job `Waiting for … deploy-<env>` | Another deploy in the same concurrency group is running | Wait; show it with `status` | Skill |
| E20 | `Canceling since a higher priority waiting request for 'deploy-<env>' exists` | GitHub keeps one pending run per group; a newer dispatch replaced this one | Re-dispatch after the running deploy finishes, if this SHA is still wanted | Skill |
