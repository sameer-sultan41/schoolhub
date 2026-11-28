# Pins the bootstrap root's security properties under a mocked provider, so CI
# checks them without AWS credentials. Run with `terraform test` (CI only).

mock_provider "aws" {
  override_during = plan

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "111111111111"
    }
  }
}

# Plan-only (the state bucket has prevent_destroy, so an apply run could not be
# torn down). Resource-level overrides make the ARNs the policies embed known
# at plan; the provider-level override_during alone leaves them unknown.
override_resource {
  target          = aws_iam_openid_connect_provider.github
  override_during = plan
  values = {
    arn = "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com"
  }
}

override_resource {
  target          = aws_kms_key.tfstate
  override_during = plan
  values = {
    arn    = "arn:aws:kms:me-central-1:111111111111:key/tfstate"
    key_id = "tfstate"
  }
}

override_resource {
  target          = aws_ecr_repository.this
  override_during = plan
  values = {
    arn = "arn:aws:ecr:me-central-1:111111111111:repository/schoolhub/image"
  }
}

variables {
  aws_region                 = "me-central-1"
  github_oidc_subject_prefix = "repo:acme/schoolhub"
  github_repository          = "acme/schoolhub"
  state_admin_principal_arns = ["arn:aws:iam::111111111111:role/Admin"]
}

run "deploy_production_trusts_only_deploy_env_called_by_deploy_on_main" {
  command = plan

  assert {
    condition     = length(jsondecode(aws_iam_role.deploy["production"].assume_role_policy).Statement) == 1
    error_message = "The production deploy role must have exactly one trust statement."
  }

  assert {
    condition     = jsondecode(aws_iam_role.deploy["production"].assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:acme/schoolhub:environment:production:job_workflow_ref:acme/schoolhub/.github/workflows/deploy-env.yml@refs/heads/main:workflow_ref:acme/schoolhub/.github/workflows/deploy.yml@refs/heads/main"
    error_message = "The production deploy role must trust only deploy-env.yml called by deploy.yml, both on main, in the production Environment."
  }

  assert {
    condition     = !can(jsondecode(aws_iam_role.deploy["production"].assume_role_policy).Statement[0].Condition.StringLike)
    error_message = "The production deploy role must not use StringLike."
  }
}

run "deploy_staging_trusts_only_deploy_env_called_by_deploy_on_main" {
  command = plan

  assert {
    condition     = length(jsondecode(aws_iam_role.deploy["staging"].assume_role_policy).Statement) == 1
    error_message = "The staging deploy role must have exactly one trust statement."
  }

  assert {
    condition     = jsondecode(aws_iam_role.deploy["staging"].assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:acme/schoolhub:environment:staging:job_workflow_ref:acme/schoolhub/.github/workflows/deploy-env.yml@refs/heads/main:workflow_ref:acme/schoolhub/.github/workflows/deploy.yml@refs/heads/main"
    error_message = "The staging deploy role must trust only deploy-env.yml called by deploy.yml, both on main, in the staging Environment."
  }

  assert {
    condition     = !can(jsondecode(aws_iam_role.deploy["staging"].assume_role_policy).Statement[0].Condition.StringLike)
    error_message = "The staging deploy role must not use StringLike."
  }
}

run "plan_production_rejects_pull_request" {
  command = plan

  assert {
    condition     = length(jsondecode(aws_iam_role.plan["production"].assume_role_policy).Statement) == 1
    error_message = "The production plan role must have exactly one trust statement."
  }

  assert {
    condition     = jsondecode(aws_iam_role.plan["production"].assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:acme/schoolhub:ref:refs/heads/main:job_workflow_ref:acme/schoolhub/.github/workflows/infra-terraform.yml@refs/heads/main:workflow_ref:acme/schoolhub/.github/workflows/infra-terraform.yml@refs/heads/main"
    error_message = "The production plan role must trust only infra-terraform.yml on main."
  }

  assert {
    condition     = !can(jsondecode(aws_iam_role.plan["production"].assume_role_policy).Statement[0].Condition.StringLike)
    error_message = "The production plan role must not use StringLike."
  }
}

run "plan_staging_wildcard_only_in_pr_number" {
  command = plan

  assert {
    condition = one([
      for s in jsondecode(aws_iam_role.plan["staging"].assume_role_policy).Statement :
      s.Condition.StringLike["token.actions.githubusercontent.com:sub"] if can(s.Condition.StringLike)
    ]) == "repo:acme/schoolhub:pull_request:job_workflow_ref:acme/schoolhub/.github/workflows/infra-terraform.yml@refs/pull/*/merge:workflow_ref:acme/schoolhub/.github/workflows/infra-terraform.yml@refs/pull/*/merge"
    error_message = "The staging plan role's PR trust must name infra-terraform.yml on refs/pull/*/merge."
  }

  assert {
    condition = length(regexall("\\*", one([
      for s in jsondecode(aws_iam_role.plan["staging"].assume_role_policy).Statement :
      s.Condition.StringLike["token.actions.githubusercontent.com:sub"] if can(s.Condition.StringLike)
    ]))) == 2
    error_message = "The PR number (once per workflow claim) must be the only wildcard in the staging plan trust."
  }
}

run "every_role_session_is_7200" {
  command = plan

  assert {
    condition     = alltrue([for r in concat(values(aws_iam_role.deploy), values(aws_iam_role.plan)) : r.max_session_duration == 7200])
    error_message = "Every CI role must allow 7200-second sessions; the deploy workflow requests 7200."
  }
}

run "production_deploy_ecr_actions_exact" {
  command = plan

  assert {
    condition = sort(distinct(flatten([
      for s in jsondecode(aws_iam_role_policy.deploy_ecr["production"].policy).Statement :
      [for a in s.Action : a if startswith(a, "ecr:")]
    ]))) == tolist(["ecr:DescribeImages"])
    error_message = "The production deploy role's only ECR action must be ecr:DescribeImages: no push, pull or retag."
  }
}

run "plan_role_reads_own_tfvars_only" {
  command = plan

  assert {
    condition = anytrue([
      for s in jsondecode(aws_iam_role_policy.plan["staging"].policy).Statement :
      s.Effect == "Allow" && contains(s.Action, "s3:GetObject") && contains(try(s.Resource, []), "arn:aws:s3:::schoolhub-tfstate-111111111111/schoolhub/staging/terraform.tfvars")
    ])
    error_message = "The staging plan role must read its own tfvars object."
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.plan["staging"].policy, "schoolhub/production/")
    error_message = "The staging plan role must name no production object."
  }
}

run "region_allow_list" {
  command = plan

  variables {
    aws_region = "us-east-1"
  }

  expect_failures = [var.aws_region]
}

run "plan_role_can_write_lock_with_kms" {
  command = plan

  assert {
    condition = alltrue([
      for env in ["staging", "production"] : anytrue([
        for s in jsondecode(aws_iam_role_policy.plan[env].policy).Statement :
        s.Effect == "Allow" && contains(s.Action, "kms:GenerateDataKey") && contains(s.Action, "kms:Encrypt") && try(s.Resource, []) == [aws_kms_key.tfstate.arn]
      ])
    ])
    error_message = "Each plan role needs kms:GenerateDataKey and kms:Encrypt on the state key to write the lock file."
  }

  assert {
    condition = alltrue([
      for env in ["staging", "production"] : anytrue([
        for s in jsondecode(aws_iam_role_policy.plan[env].policy).Statement :
        s.Effect == "Allow" && contains(s.Action, "s3:PutObject") && try(s.Resource, []) == ["arn:aws:s3:::schoolhub-tfstate-111111111111/schoolhub/${env}/terraform.tfstate.tflock"]
      ])
    ])
    error_message = "Each plan role may write exactly its own lock file."
  }
}

run "plan_role_state_scoped" {
  command = plan

  assert {
    condition     = !strcontains(aws_iam_role_policy.plan["staging"].policy, "schoolhub/production/")
    error_message = "The staging plan policy must name no schoolhub/production/ resource."
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.plan["production"].policy, "schoolhub/staging/")
    error_message = "The production plan policy must name no schoolhub/staging/ resource."
  }
}

run "staging_plan_denies_foreign_data_plane" {
  command = plan

  assert {
    condition = length(setsubtract(
      [
        "logs:GetLogEvents", "logs:FilterLogEvents", "logs:StartQuery", "logs:StartLiveTail", "logs:GetLogRecord",
        "logs:GetQueryResults", "rds:Download*", "ssm:GetParameter", "ssm:GetParameterHistory",
        "ecr:GetDownloadUrlForLayer", "sqs:ReceiveMessage", "dynamodb:Scan", "ec2:GetPasswordData", "lambda:GetFunction",
      ],
      flatten([for s in jsondecode(aws_iam_role_policy.plan["staging"].policy).Statement : s.Action if s.Effect == "Deny"])
    )) == 0
    error_message = "The staging plan role must deny foreign data-plane reads."
  }

  assert {
    condition = alltrue(flatten([
      for s in jsondecode(aws_iam_role_policy.plan["staging"].policy).Statement :
      [for r in try(s.NotResource, []) : strcontains(r, "schoolhub-staging")]
      if s.Effect == "Deny" && startswith(s.Sid, "DenyDataPlane")
    ]))
    error_message = "Every data-plane deny exemption must be the staging prefix."
  }
}

run "ecr_immutable" {
  command = plan

  assert {
    condition     = alltrue([for r in values(aws_ecr_repository.this) : r.image_tag_mutability == "IMMUTABLE"])
    error_message = "ECR tags must be immutable."
  }
}

run "ecr_expiry_is_age_based" {
  command = plan

  assert {
    condition     = alltrue([for r in jsondecode(aws_ecr_lifecycle_policy.this["api"].policy).rules : r.selection.countType == "sinceImagePushed"])
    error_message = "Every ECR expiry rule must be age-based (sinceImagePushed)."
  }

  assert {
    condition     = one([for r in jsondecode(aws_ecr_lifecycle_policy.this["api"].policy).rules : r.selection.countNumber if r.selection.tagStatus == "tagged"]) == 365
    error_message = "SHA tags must expire after 365 days."
  }
}

run "subject_prefix_rejects_wildcard" {
  command = plan

  variables {
    github_oidc_subject_prefix = "repo:acme/*"
  }

  expect_failures = [var.github_oidc_subject_prefix]
}
