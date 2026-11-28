# =============================================================================
# CI roles, assumed through GitHub OIDC (D2, D3).
#
# The repository's OIDC sub is customised to include job_workflow_ref (the file
# that runs the job) and workflow_ref (the workflow the run started from), so each
# trust pins both files and their ref, not just the Environment:
#   <prefix>:<context>:job_workflow_ref:<repo>/.github/workflows/<file>@<ref>:workflow_ref:<repo>/.github/workflows/<caller>@<ref>
# For a reusable workflow, job_workflow_ref names the CALLED file. Without
# workflow_ref, any branch's workflow could call deploy-env.yml@main and get a deploy
# role; workflow_ref pins the caller to deploy.yml on main. For a workflow that is
# not called, both claims name the same file.
#
# Policies are jsonencode()d locals, not aws_iam_policy_document, so
# tests/bootstrap.tftest.hcl can assert them under a mocked provider.
# The env roots attach the env-scoped half of the deploy policy (modules/gha-deploy-policy).
# =============================================================================

locals {
  oidc_aud = "token.actions.githubusercontent.com:aud"
  oidc_sub = "token.actions.githubusercontent.com:sub"

  workflows = "${var.github_repository}/.github/workflows"
  # job_workflow_ref (called file) then workflow_ref (caller), in include_claim_keys order.
  deploy_workflow_ref = "job_workflow_ref:${local.workflows}/deploy-env.yml@refs/heads/main:workflow_ref:${local.workflows}/deploy.yml@refs/heads/main"
  plan_main_ref       = "job_workflow_ref:${local.workflows}/infra-terraform.yml@refs/heads/main:workflow_ref:${local.workflows}/infra-terraform.yml@refs/heads/main"
  # The PR number is the only wildcard (once per claim).
  plan_pr_ref = "job_workflow_ref:${local.workflows}/infra-terraform.yml@refs/pull/*/merge:workflow_ref:${local.workflows}/infra-terraform.yml@refs/pull/*/merge"

  # Every role allows 2 h; the deploy workflow requests at most 7200 s.
  max_session_seconds = 7200

  deploy_trust = {
    for env in local.environments : env => {
      Version = "2012-10-17"
      Statement = [
        {
          Sid       = "DeployEnvOnMain"
          Effect    = "Allow"
          Action    = "sts:AssumeRoleWithWebIdentity"
          Principal = { Federated = local.oidc_provider_arn }
          Condition = {
            StringEquals = {
              (local.oidc_aud) = "sts.amazonaws.com"
              (local.oidc_sub) = "${var.github_oidc_subject_prefix}:environment:${env}:${local.deploy_workflow_ref}"
            }
          }
        },
      ]
    }
  }

  plan_trust_main = {
    Sid       = "TerraformPlanOnMain"
    Effect    = "Allow"
    Action    = "sts:AssumeRoleWithWebIdentity"
    Principal = { Federated = local.oidc_provider_arn }
    Condition = {
      StringEquals = {
        (local.oidc_aud) = "sts.amazonaws.com"
        (local.oidc_sub) = "${var.github_oidc_subject_prefix}:ref:refs/heads/main:${local.plan_main_ref}"
      }
    }
  }

  # Staging also plans same-repository PRs (accepted by the user, 2026-11-28).
  # Production never does: a PR's HCL could exfiltrate production state.
  plan_trust = {
    staging = {
      Version = "2012-10-17"
      Statement = [
        local.plan_trust_main,
        {
          Sid       = "TerraformPlanOnPullRequest"
          Effect    = "Allow"
          Action    = "sts:AssumeRoleWithWebIdentity"
          Principal = { Federated = local.oidc_provider_arn }
          Condition = {
            StringEquals = { (local.oidc_aud) = "sts.amazonaws.com" }
            StringLike   = { (local.oidc_sub) = "${var.github_oidc_subject_prefix}:pull_request:${local.plan_pr_ref}" }
          }
        },
      ]
    }
    production = {
      Version   = "2012-10-17"
      Statement = [local.plan_trust_main]
    }
  }

  ecr_repository_arns = [for r in aws_ecr_repository.this : r.arn]

  # Only staging builds and pushes. Production can only check a tag exists;
  # ECS pulls with each task's execution role (D3, N1).
  deploy_ecr_policy = {
    staging = {
      Version = "2012-10-17"
      Statement = [
        {
          Sid      = "EcrAuth"
          Effect   = "Allow"
          Action   = ["ecr:GetAuthorizationToken"]
          Resource = ["*"] # the action has no resource-level permissions
        },
        {
          Sid    = "EcrPush"
          Effect = "Allow"
          Action = [
            "ecr:BatchCheckLayerAvailability",
            "ecr:InitiateLayerUpload",
            "ecr:UploadLayerPart",
            "ecr:CompleteLayerUpload",
            "ecr:PutImage",
            "ecr:BatchGetImage",
            "ecr:DescribeImages",
          ]
          Resource = local.ecr_repository_arns
        },
      ]
    }
    production = {
      Version = "2012-10-17"
      Statement = [
        {
          Sid      = "EcrRead"
          Effect   = "Allow"
          Action   = ["ecr:DescribeImages"]
          Resource = local.ecr_repository_arns
        },
      ]
    }
  }

  state_object_arn  = { for env in local.environments : env => "${local.state_bucket_arn}/${local.state_key[env]}" }
  lock_object_arn   = { for env in local.environments : env => "${local.state_object_arn[env]}.tflock" }
  tfvars_object_arn = { for env in local.environments : env => "${local.state_bucket_arn}/schoolhub/${env}/terraform.tfvars" }

  plan_policy = {
    for env in local.environments : env => {
      Version = "2012-10-17"
      Statement = [
        {
          Sid       = "StateList"
          Effect    = "Allow"
          Action    = ["s3:ListBucket"]
          Resource  = [local.state_bucket_arn]
          Condition = { StringLike = { "s3:prefix" = ["schoolhub/${env}/*"] } }
        },
        {
          Sid      = "StateRead"
          Effect   = "Allow"
          Action   = ["s3:GetObject"]
          Resource = [local.state_object_arn[env], local.tfvars_object_arn[env]]
        },
        {
          # use_lockfile writes <key>.tflock beside the state; nothing else is writable.
          Sid      = "StateLock"
          Effect   = "Allow"
          Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
          Resource = [local.lock_object_arn[env]]
        },
        {
          # The lock file is SSE-KMS too; without these the plan fails at "Acquiring state lock".
          Sid      = "StateLockKms"
          Effect   = "Allow"
          Action   = ["kms:GenerateDataKey", "kms:Encrypt"]
          Resource = [aws_kms_key.tfstate.arn]
        },
        {
          # Refresh reads the Terraform-managed secrets' versions.
          Sid    = "TfManagedSecrets"
          Effect = "Allow"
          Action = ["secretsmanager:GetSecretValue"]
          Resource = [
            "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:${local.env_prefix[env]}/rds/master-*",
            "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:${local.env_prefix[env]}/redis/auth-token-*",
          ]
        },
        {
          Sid      = "Decrypt"
          Effect   = "Allow"
          Action   = ["kms:Decrypt"]
          Resource = ["arn:aws:kms:${local.region}:${local.account_id}:key/*"]
          Condition = {
            "ForAnyValue:StringEquals" = {
              "kms:ResourceAliases" = [
                "alias/schoolhub-tfstate",
                "alias/${local.env_prefix[env]}-rds",
                "alias/${local.env_prefix[env]}-redis",
              ]
            }
          }
        },
        {
          # ReadOnlyAccess would otherwise read every object in the account:
          # the other env's state, tenant uploads, backups.
          Sid         = "DenyOtherData"
          Effect      = "Deny"
          Action      = ["s3:GetObject*"]
          NotResource = [local.state_object_arn[env], local.lock_object_arn[env], local.tfvars_object_arn[env]]
        },
        {
          Sid      = "DenyOtherSecrets"
          Effect   = "Deny"
          Action   = ["secretsmanager:GetSecretValue"]
          Resource = ["arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:${local.env_prefix[local.other_env[env]]}/*"]
        },
        # Data-plane reads ReadOnlyAccess grants and a plan never needs, outside
        # the role's own prefix. Application logs can carry tenant data. Checked
        # against ReadOnlyAccess (logs:Get*, logs:StartLiveTail, rds:Download*,
        # ssm:Get*, sqs:Receive*, dynamodb, ec2:Get*, lambda:Get*, athena) on
        # 2026-11-28. GetLogRecord and GetQueryResults have no log-group resource,
        # so NotResource never exempts them: they are denied everywhere.
        {
          Sid    = "DenyDataPlaneLogs"
          Effect = "Deny"
          Action = [
            "logs:GetLogEvents", "logs:FilterLogEvents", "logs:StartQuery", "logs:StartLiveTail",
            "logs:GetLogRecord", "logs:GetQueryResults",
          ]
          NotResource = [
            "arn:aws:logs:${local.region}:${local.account_id}:log-group:/ecs/${local.env_prefix[env]}-*",
            "arn:aws:logs:${local.region}:${local.account_id}:log-group:/ecs/${local.env_prefix[env]}-*:*",
          ]
        },
        {
          Sid         = "DenyDataPlaneRdsLogs"
          Effect      = "Deny"
          Action      = ["rds:Download*"]
          NotResource = ["arn:aws:rds:${local.region}:${local.account_id}:db:${local.env_prefix[env]}-*"]
        },
        {
          Sid         = "DenyDataPlaneSsm"
          Effect      = "Deny"
          Action      = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:GetParameterHistory"]
          NotResource = ["arn:aws:ssm:${local.region}:${local.account_id}:parameter/${local.env_prefix[env]}/*"]
        },
        {
          # Repositories are shared by both envs (D5), and a plan never pulls a layer.
          Sid      = "DenyDataPlaneImageLayers"
          Effect   = "Deny"
          Action   = ["ecr:GetDownloadUrlForLayer"]
          Resource = ["arn:aws:ecr:*:*:repository/*"]
        },
        {
          # Services this stack does not use, whose ReadOnlyAccess reads return
          # data rather than configuration. Denied everywhere, so a future table,
          # queue or function is not readable by a PR plan by default.
          Sid    = "DenyDataPlaneUnusedServices"
          Effect = "Deny"
          Action = [
            "sqs:ReceiveMessage",
            "dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:Scan",
            "ec2:GetConsoleOutput", "ec2:GetConsoleScreenshot", "ec2:GetPasswordData",
            "lambda:GetFunction",
            "athena:GetQueryResults",
          ]
          Resource = [
            "arn:aws:sqs:*:*:*",
            "arn:aws:dynamodb:*:*:table/*",
            "arn:aws:ec2:*:*:instance/*",
            "arn:aws:lambda:*:*:function:*",
            "arn:aws:athena:*:*:workgroup/*",
          ]
        },
      ]
    }
  }
}

resource "aws_iam_role" "deploy" {
  for_each = local.environments

  name                 = local.deploy_role_name[each.key]
  description          = "GitHub Actions deploy-env.yml on main, ${each.key} Environment"
  assume_role_policy   = jsonencode(local.deploy_trust[each.key])
  max_session_duration = local.max_session_seconds
}

resource "aws_iam_role_policy" "deploy_ecr" {
  for_each = local.environments

  name   = "${local.deploy_role_name[each.key]}-ecr"
  role   = aws_iam_role.deploy[each.key].id
  policy = jsonencode(local.deploy_ecr_policy[each.key])
}

resource "aws_iam_role" "plan" {
  for_each = local.environments

  name                 = local.plan_role_name[each.key]
  description          = "GitHub Actions infra-terraform.yml plan, ${each.key}; read-only apart from the state lock"
  assume_role_policy   = jsonencode(local.plan_trust[each.key])
  max_session_duration = local.max_session_seconds
}

resource "aws_iam_role_policy_attachment" "plan_readonly" {
  for_each = local.environments

  role       = aws_iam_role.plan[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy" "plan" {
  for_each = local.environments

  name   = "${local.plan_role_name[each.key]}-state"
  role   = aws_iam_role.plan[each.key].id
  policy = jsonencode(local.plan_policy[each.key])
}
