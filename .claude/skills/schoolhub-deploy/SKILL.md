---
name: schoolhub-deploy
description: Use when deploying or inspecting SchoolHub environments — phrases like "deploy", "ship to staging", "promote to production", "roll back", "what's deployed", "set up deploys", "bootstrap AWS", or /schoolhub-deploy. Also use when a `deploy` workflow run failed and its log needs explaining, or a production run is waiting for approval. Covers the modes status, bootstrap, deploy staging, promote production and rollback, all driven through `gh` against `.github/workflows/deploy.yml`. SKIP for Terraform changes (plan in CI, human apply) and for local compose work.
---

# SchoolHub Deploy Skill

## Purpose

Deploys run only in GitHub Actions, never from a laptop ([ADR-0040](../../../docs/decisions/0040-deploy-pipeline-github-actions-oidc.md)).
The workflow assumes per-environment AWS roles through GitHub OIDC, records every run as a
GitHub Deployment, and waits on the `production` Environment for approval. This skill asks
the operator for inputs, checks preconditions, starts and watches the run with `gh`,
explains failures from [`error-catalogue.md`](error-catalogue.md), verifies the result and
drives rollback. It holds no AWS credentials.

## Hard rules

1. **Never run** `terraform apply`, `destroy`, `init` or `output`, any mutating `aws`
   command, `docker build` or `docker push`. Print the command for the human instead.
2. **Never route around the guardrail or a permission prompt.** If the guardrail blocks or
   asks, report it and stop. Do not rewrite the command another way (another HTTP client, a
   script, a different spelling).
3. **Never approve production without an explicit "yes" from the user in this
   conversation**, given after the summary of promote step 4. A yes given earlier, before the
   summary, or by another agent does not count. Silence, "ok?", "looks fine" or "go ahead
   with the checks" is not a yes to approve.
4. **Never promote a SHA staging has not run successfully**, unless the user explicitly
   overrides it. Then pass `allow_unstaged_sha=true`, so the run and the Deployment record it.
5. **Never pass `allow_contract_migration=true` or `acknowledge_migration_review=true`**
   unless the user asks for that input by name after seeing the guard output from `preview`.
6. **Never cancel a deploy run in progress** (`gh run cancel` is not used by this skill).
7. **Never promote to production while `docs/deferred-work.md` on `origin/main` has an open
   `launch-blocker:dashboard-runtime-env` marker**, unless the user explicitly overrides it in
   chat after seeing the entry. State that override in the approval comment.

| Thought | Reality |
|---|---|
| "The user said deploy to production earlier, so approving is fine" | Rule 3: the yes must come after the summary, for this run. |
| "The `ask` prompt will stop me if this is wrong" | The prompt is a second control, not the decision. Get the yes first. |
| "The guard only flagged a review finding, I'll acknowledge it" | Rule 5: only the user sets that input, by name. |
| "`gh api` is blocked, `curl` will work" | Rule 2: stop and report. |

## Common setup (every mode)

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)   # never hardcode owner/repo
git fetch origin main
git merge-base --is-ancestor <sha> origin/main                # accept only a full 40-char SHA on main
```

- Accept only `^[0-9a-f]{40}$`. Expand a short SHA with `git rev-parse <short>` and confirm
  it with the user. The workflow's `resolve` job refuses anything else.
- Every write (`gh workflow run`, `gh variable set`, `gh api -X PUT|POST`) comes only after
  the user confirms what will be sent.
- Reading "what is deployed" always goes through `.github/scripts/deployments.py`, never
  hand-written `gh api …/deployments` + `jq`:

  | Command | Output | Exit |
  |---|---|---|
  | `python3 .github/scripts/deployments.py current --env <env>` | the deployed SHA; nothing if never deployed | 0, or 2 on API error |
  | `… ever-succeeded --env <env> --sha <sha>` | nothing | 0 yes, 1 no, 2 API error |
  | `… show --env <env> --sha <sha>` | JSON `{id, created_at, creator, payload}` | 0, 1 no record |
  | `… history --env <env>` | `<target_sha> <created_at> <creator>` per deployment that ever succeeded, newest first (includes the current one) | 0 |
  | `… overrides-between --env <env> --from <sha> --to <sha>` | one line per deployment that carried `contract_override` | 0 none, 1 found |

  Treat exit 2 as "cannot tell" and stop; never as "no".

- Find a dispatched run by its title, because its `headSha` is `main`'s head, not the SHA:
  `run-name` is `deploy <environment> <sha> (<mode>)`.

  ```bash
  gh run list --workflow deploy.yml --event workflow_dispatch -L 10 \
    --json databaseId,displayTitle,status,createdAt,url \
    --jq '.[] | select(.displayTitle == "deploy <env> <sha> (<mode>)")'
  ```

  Retry every 5 s for up to 30 s after `gh workflow run`; the run appears a few seconds late.

### Workflow shape (names the log uses)

`deploy.yml` jobs: `resolve` → `ci-gate` (deploy mode only) → `preview` → `staging` or
`production` (both call `deploy-env.yml`). In `deploy-env.yml`: `build (api|dashboard|website)`
(staging deploys only) and the rollout job, named `<mode> <environment>` (for example
`deploy production`), which carries the Environment gate and the `deploy-<env>` concurrency
group. Rollout steps, in order: `Enabled?`, `Re-read the current deployment`, `Re-check`,
`Migration guard`, `Create the deployment`, AWS credentials, `Verify all three images exist`,
`Render migrate`, `Check the migrate render`, `Migrate`, `Migrate result`, `Roll out api`,
`Roll out celery-worker`, `Roll out dashboard`, `Roll out website`, `Roll out celery-beat`,
`celery-beat runningCount`, `CloudFront invalidation`, `Smoke tests`, `Mark success` /
`On failure` / `On cancel`.

Dispatch inputs (all of them; the booleans default to `false`): `environment`
(`staging|production`), `sha`, `mode` (`deploy|rollback`), `allow_contract_migration`,
`allow_unstaged_sha` (production only), `acknowledge_migration_review`, `dry_run` (runs
`resolve`, `ci-gate` and `preview` only; no AWS).

## Mode `status`

```bash
for env in staging production; do
  sha=$(python3 .github/scripts/deployments.py current --env "$env")
  echo "$env: ${sha:-never deployed}"
done
python3 .github/scripts/deployments.py show --env <env> --sha <sha>   # actor, age, payload overrides
git log -1 --format=%s <sha>
git rev-list --count <sha>..origin/main                               # commits main is ahead
gh run list --workflow deploy.yml -L 20 --json databaseId,displayTitle,status,event,createdAt,url \
  --jq '.[] | select(.status != "completed")'
```

- Per environment show: short SHA, subject, age of the deployment, creator, any `true`
  override in `payload` (`allow_contract_migration`, `allow_unstaged_sha`,
  `acknowledge_migration_review`, `contract_override`), and commits behind `main`.
- Empty `current` output means "never deployed". Say so; it is not an error.
- **Image age** (ECR expires SHA tags 365 days after push): for production's SHA,
  `git log -1 --format=%ct <sha>` approximates the push time. Over 300 days, warn:
  "production's image expires from ECR at 365 days; deploy a newer build before <date>".
- A run with status `waiting` is waiting for approval; show its URL. A run `pending` is
  queued behind another deploy in the same group (catalogue E19).

## Mode `bootstrap`

Detect first, with `gh` reads and the user's answers only. Read no Terraform state; call no
mutating AWS API. The two AWS reads below are printed for the human, who pastes the result.

| Check | Command | Expected |
|---|---|---|
| Region enabled | human: `aws account get-region-opt-status --region-name <region>` | `ENABLED` or `ENABLED_BY_DEFAULT`. `me-central-1` is opt-in; if `DISABLED`, the human runs `aws account enable-region --region-name <region>` and waits before the bootstrap apply |
| Env tfvars object, per env | human: `aws s3api list-objects-v2 --bucket <TF_STATE_BUCKET> --prefix schoolhub/<env>/terraform.tfvars --query "length(Contents[?Key=='schoolhub/<env>/terraform.tfvars'])"` | `1` present, `0` pending (until the env-apply step); any error fails. Not `head-object` (403 on a missing key) |
| Repository variables | `gh variable list --json name,value` | `AWS_REGION`, `AWS_ACCOUNT_ID`, `ECR_REGISTRY`, `WEBSITE_IMAGE_HOSTNAME`, `PLAN_ROLE_ARN_STAGING`, `PLAN_ROLE_ARN_PRODUCTION`, `TF_STATE_BUCKET`, `TF_STATE_KMS_KEY_ARN` |
| OIDC `sub` customisation | `gh api repos/$REPO/actions/oidc/customization/sub` | `use_default: false`, `include_claim_keys: ["repo","context","job_workflow_ref"]` |
| Environments | `gh api repos/$REPO/environments --jq '.environments[] \| {id, name, protection_rules}'` | `staging` and `production`; production has `required_reviewers` naming the user and `prevent_self_review: false` |
| Branch policy, per env | `gh api repos/$REPO/environments/<env>/deployment-branch-policies --jq '.branch_policies[].name'` | `main` |
| Environment variables, per env | `gh variable list --env <env> --json name,value` | `DEPLOY_ROLE_ARN`, `ECS_CLUSTER`, `SMOKE_TENANT_SLUG`, `PLATFORM_DOMAIN`, `CLOUDFRONT_DISTRIBUTION_ID`, `MIGRATE_TASK_FAMILY`, `PRIVATE_SUBNETS`, `MIGRATE_SECURITY_GROUP` |
| Bootstrap outputs recorded | from the two lists above | `ECR_REGISTRY`, `AWS_ACCOUNT_ID`, both `PLAN_ROLE_ARN_*`, both `DEPLOY_ROLE_ARN` set; no ARN contains `123456789012` |
| Plan backend works | `gh run list --workflow infra-terraform.yml --branch main -L 1 --json databaseId,conclusion,url` | `success`; on failure `gh run view <id> --log-failed` (a failed `init` means a backend variable or `PLAN_ROLE_ARN_*` is not ready) |

- Before the env apply, `ECS_CLUSTER`, `MIGRATE_TASK_FAMILY`, `PRIVATE_SUBNETS`,
  `MIGRATE_SECURITY_GROUP`, `CLOUDFRONT_DISTRIBUTION_ID` and `PLATFORM_DOMAIN` are
  legitimately empty ("build only"); `SMOKE_TENANT_SLUG` stays empty until the smoke tenant
  is seeded. Show those as **pending**, not **missing**.
- Print one table: present / pending / missing. Then ask for each missing value: AWS account
  ID, region (`me-central-1` or `ap-south-1`), platform domain (staging is
  `staging.<domain>`), the user's GitHub login as production reviewer, and confirmation that
  one account holds both environments.

**Human steps, in order.** Print them from `infra/runbooks/deploy.md` ("First-time order of
operations"), not from a copy here, and do not run them. Summary of what the skill adds at
each step:

1. Bootstrap apply (`infra/terraform/bootstrap/README.md`), then the OIDC `sub` `PUT`. The
   skill may run that `PUT` itself (a `gh` write) only after showing the body
   (`terraform output -json oidc_subject_template`, pasted by the human) and getting a yes:
   `gh api -X PUT repos/$REPO/actions/oidc/customization/sub --input <scratchpad>/oidc-sub.json`.
2. Set the repository variables and create the Environments (below), from the pasted
   `terraform output -json github_variables`.
3. `infra/scripts/bootstrap-secrets.sh --env <env> --phase pre-apply` (human).
4. Build-only run: `gh workflow run deploy.yml --ref main -f environment=staging -f sha=<sha> -f mode=deploy`
   while `ECS_CLUSTER` is empty. The rollout job ends with the notice
   `build only: ECS_CLUSTER is not set for staging`.
5. Env tfvars file: copy `infra/terraform/envs/<env>/terraform.tfvars.example` to
   `<scratchpad>/<env>.tfvars`, fill each key from the answers, the bootstrap outputs, the
   `bootstrap-secrets.sh` ARN lines and `image_tag = "<the built sha>"`. Show the whole file;
   on a yes print the human's upload and delete the scratchpad copy afterwards:
   `aws s3 cp <scratchpad>/<env>.tfvars s3://<TF_STATE_BUCKET>/schoolhub/<env>/terraform.tfvars --sse aws:kms --sse-kms-key-id <TF_STATE_KMS_KEY_ARN>`.
   The file holds ARNs and names, never secret values.
6. Env apply (human), then `bootstrap-secrets.sh --phase post-apply`, then the db-bootstrap
   task (human; commands in `deploy.md`).
7. "Paste `terraform output -json github_environment_variables` for this env." Map it to the
   Environment variables and set them (below).
8. First deploy through the workflow, then seed the smoke tenant, set `SMOKE_TENANT_SLUG`,
   and re-run the deploy once so the tenant checks run.

Production repeats 3 and 5–8, after the dashboard launch blocker is closed.

**Setting values**, after the user confirms a table of exactly what will be written:

```bash
gh variable set AWS_REGION --body "<region>"                      # each repository variable
gh variable set DEPLOY_ROLE_ARN --env production --body "<arn>"   # each Environment variable, per env
gh api users/<login> --jq .id                                     # reviewer id
gh api -X PUT repos/$REPO/environments/production --input <scratchpad>/env-production.json
#   {"reviewers":[{"type":"User","id":<id>}],"prevent_self_review":false,
#    "deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
gh api -X POST repos/$REPO/environments/production/deployment-branch-policies -f name=main -f type=branch
gh api -X PUT repos/$REPO/environments/staging --input <scratchpad>/env-staging.json
#   same, without "reviewers"
gh api -X POST repos/$REPO/environments/staging/deployment-branch-policies -f name=main -f type=branch
```

`prevent_self_review` is `false` because the user is the only production approver (decided
2026-11-28); GitHub would otherwise refuse their own approval. Then re-run the detection and
show everything green or pending.

## Mode `deploy staging`

- **Normal path:** a merge to `main` starts `deploy.yml` (title `deploy staging <sha> (deploy)`).
  `ci-gate` waits up to 45 min for CI on that SHA, then the run deploys.
  ```bash
  gh run list --workflow deploy.yml --event push -L 5 --json databaseId,headSha,displayTitle,status,conclusion,url
  ```
  Watch it as in promote step 6.
- **Manual path** (re-run, or a chosen SHA). Before dispatching: precondition 1 (CI green)
  from [`preconditions.md`](preconditions.md), and list the migrations since staging's SHA
  (`git diff --name-status <staging_sha>..<sha> -- 'apps/api/**/migrations/*.py'`).
  ```bash
  gh workflow run deploy.yml --ref main -f environment=staging -f sha=<sha> -f mode=deploy \
    -f allow_contract_migration=false -f acknowledge_migration_review=false
  ```
  Then find the run by title.
- A SHA older than staging's current one is refused (`is not a descendant of the running …`);
  going back is `rollback`, not `deploy`.
- If `preview` or the rollout's `Migration guard` fails, show its output
  (`gh run view <id> --log --job <job_id>`) and ask whether to re-dispatch with an override.
  Only the user names the override (Hard rule 5).
- To check the gate and the guard with no AWS effect, dispatch with `-f dry_run=true`.

## Mode `promote production`

1. **SHA.** Ask for it. Default: `deployments.py current --env staging`. Show
   `git log --oneline <prod_sha>..<sha>` (all of `<sha>`'s history if production was never deployed).
2. **Preconditions.** Run every row of [`preconditions.md`](preconditions.md) and show one
   table of PASS / FAIL / ASKED. A FAIL of the dashboard launch blocker stops the mode
   (Hard rule 7). A FAIL of "staging ran it" stops unless the user explicitly overrides
   (Hard rule 4).
3. **Trigger** after the user confirms the table:
   ```bash
   gh workflow run deploy.yml --ref main -f environment=production -f sha=<sha> -f mode=deploy \
     -f allow_contract_migration=false -f acknowledge_migration_review=false [-f allow_unstaged_sha=true]
   ```
   Find the run by title `deploy production <sha> (deploy)`.
4. **Wait for the gate.** Poll every 15 s:
   `gh run view <run_id> --json status,conclusion,jobs`. Stop polling at `status == "waiting"`.
   If the run completes with `failure` first, `resolve`, `ci-gate` or `preview` failed: read
   `gh run view <run_id> --log-failed` and go to the catalogue. Then:
   - `preview` output: `gh run view <run_id> --log --job <preview_job_id>` (the id is in `jobs`;
     its summary is the "Deploy plan" table and the migration guard's findings).
   - Pending environment (this prompts for permission, by design — the `ask` rule matches
     reads too):
     `gh api repos/$REPO/actions/runs/<run_id>/pending_deployments --jq '.[] | {env: .environment.name, id: .environment.id, can: .current_user_can_approve}'`.
     If `can` is `false`, use the UI fallback in step 5.
   - Show the user: environment, full SHA, the commit list, the migration files with the
     guard verdict, the precondition table, every override, any launch-blocker override, and
     the run URL. Then ask exactly:
     **"Approve the production deploy of `<sha7>`? Reply yes to approve."**
5. **Approve only on an explicit yes to that question** (Hard rule 3). Anything else: leave
   it waiting, or reject (`state=rejected`) if the user asks for that.
   ```bash
   gh api -X POST repos/$REPO/actions/runs/<run_id>/pending_deployments \
     -F 'environment_ids[]=<env_id>' -f state=approved \
     -f comment="Approved in chat by <login> after preconditions: <one-line summary>"
   ```
   Claude Code asks the user for permission on this call (`.claude/settings.json` `ask`
   rule); that is expected, and it is in addition to the chat yes. If the user denies the
   prompt, do not retry another way. **UI fallback**, on any non-2xx response or when `can`
   is `false`: print `https://github.com/$REPO/actions/runs/<run_id>` and tell the user to use
   "Review deployments" there (catalogue E18).
6. **Watch:** `gh run watch <run_id> --exit-status --interval 30`. On failure:
   `gh run view <run_id> --log-failed`, match it against
   [`error-catalogue.md`](error-catalogue.md), and report the entry: cause, fix, and who acts.
   The `On failure` step prints the failed step and the rollback command.
7. **Verify** — see "Verification" below. Then offer: "Roll back to `<previous sha7>`?" Go to
   `rollback` only on a yes.

## Mode `rollback`

1. **Escalation order first** (`infra/runbooks/rollback.md`): ask whether turning off one
   module's feature flag would contain the fault. Redeploy only if the user says the release
   itself is faulty.
2. **Candidates:** `python3 .github/scripts/deployments.py history --env <env>`, dropping
   lines whose SHA equals `current`. Default: the first remaining line. Show its age and
   `git log --oneline <prev>..<current>` (the commits being removed). "No previous successful
   deployment" means nothing to roll back to; say so and stop.
3. **Image age:** warn if the candidate's commit is older than 300 days; its image may be
   gone at 365 (catalogue E5).
4. **Contract check:**
   `python3 .github/scripts/deployments.py overrides-between --env <env> --from <prev_sha> --to <current_sha>`.
   Exit 1 lists deployments that shipped a contract migration under the override: the old
   code may not run on today's schema. Pass `allow_contract_migration=true` only if the user,
   having seen that list, says so by name. Otherwise `preview` refuses the rollback.
5. **Confirm, then dispatch:**
   ```bash
   gh workflow run deploy.yml --ref main -f environment=<env> -f sha=<prev_sha> -f mode=rollback \
     -f allow_contract_migration=<false unless confirmed in step 4>
   ```
   A rollback runs no `ci-gate`, no build and no migration; `preview` checks the SHA was once
   live in that environment.
6. **Production** still waits on the Environment gate: promote steps 4–7 apply unchanged,
   including the explicit yes. The summary is headed **ROLLBACK** and lists the commits being
   removed.
7. **Afterwards:** remind the user to purge ISR caches for affected tenants (`rollback.md`;
   the workflow already invalidated CloudFront), and to open an incident if any tenant was
   affected (`infra/runbooks/incident.md`).

## Verification (after any deploy or rollback)

The skill runs:

```bash
python3 .github/scripts/deployments.py current --env <env>          # must equal the SHA
DOMAIN=$(gh variable get PLATFORM_DOMAIN --env <env>)
SLUG=$(gh variable get SMOKE_TENANT_SLUG --env <env>)
curl -fsS -o /dev/null -w '%{http_code}\n' "https://api.$DOMAIN/healthz"
curl -fsS -o /dev/null -w '%{http_code}\n' "https://app.$DOMAIN/api/health"
[ -n "$SLUG" ] && curl -fsS -o /dev/null -w '%{http_code}\n' "https://$SLUG.$DOMAIN/api/health"
gh run view <run_id> --log | grep 'celery-beat runningCount='       # must be 1
```

The human checks, from this list (`deploy.md` §Verification): the auth round trip and a row
count (2), tenant isolation with a second tenant (3), two tenant sites showing their own
branding (4), Celery queues draining (5), no new Sentry issue types in 15 min (7), and p95
latency within 20% of before (8).

## Reference

- [`preconditions.md`](preconditions.md) — the production checklist, each item's command and pass rule.
- [`error-catalogue.md`](error-catalogue.md) — log signature → cause → fix → who acts.
- [`infra/runbooks/deploy.md`](../../../infra/runbooks/deploy.md), [`rollback.md`](../../../infra/runbooks/rollback.md), [`incident.md`](../../../infra/runbooks/incident.md).
- Scripts: `.github/scripts/deployments.py`, `ci_gate.py`, `check_migrations.py`.
