# modules/gha-deploy-policy under a mocked provider (CI only: `terraform test`).

mock_provider "aws" {
  override_during = plan
}

variables {
  role_name    = "schoolhub-gha-deploy-staging"
  region       = "me-central-1"
  account_id   = "111111111111"
  cluster_arn  = "arn:aws:ecs:me-central-1:111111111111:cluster/schoolhub-staging"
  cluster_name = "schoolhub-staging"
  service_names = [
    "schoolhub-staging-api",
    "schoolhub-staging-celery-worker",
    "schoolhub-staging-celery-beat",
    "schoolhub-staging-dashboard",
    "schoolhub-staging-website",
  ]
  migrate_task_family = "schoolhub-staging-migrate"
  task_definition_families = [
    "schoolhub-staging-api",
    "schoolhub-staging-celery-worker",
    "schoolhub-staging-celery-beat",
    "schoolhub-staging-dashboard",
    "schoolhub-staging-website",
    "schoolhub-staging-migrate",
  ]
  pass_role_arns   = ["arn:aws:iam::111111111111:role/schoolhub-staging-api-task", "arn:aws:iam::111111111111:role/schoolhub-staging-api-execution"]
  log_group_names  = ["/ecs/schoolhub-staging-api", "/ecs/schoolhub-staging-migrate"]
  distribution_arn = "arn:aws:cloudfront::111111111111:distribution/EXAMPLE"
}

run "services_listed_exactly" {
  command = plan

  assert {
    condition = alltrue(flatten([
      for s in jsondecode(aws_iam_role_policy.this.policy).Statement : [for r in s.Resource : !strcontains(r, "*")] if s.Sid == "Services"
    ]))
    error_message = "Services must list each service ARN exactly, with no wildcard."
  }

  assert {
    condition = length(one([
      for s in jsondecode(aws_iam_role_policy.this.policy).Statement : s.Resource if s.Sid == "Services"
    ])) == 5
    error_message = "Services must name the five services."
  }
}

run "passrole_has_service_condition" {
  command = plan

  assert {
    condition = one([
      for s in jsondecode(aws_iam_role_policy.this.policy).Statement : s.Condition.StringEquals["iam:PassedToService"] if s.Sid == "PassEnvRoles"
    ]) == "ecs-tasks.amazonaws.com"
    error_message = "iam:PassRole must be limited to ecs-tasks.amazonaws.com."
  }

  assert {
    condition = toset(one([
      for s in jsondecode(aws_iam_role_policy.this.policy).Statement : s.Resource if s.Sid == "PassEnvRoles"
    ])) == toset(var.pass_role_arns)
    error_message = "iam:PassRole must name exactly the env's task and execution roles."
  }
}

run "run_task_limited_to_migrate_family_and_cluster" {
  command = plan

  assert {
    condition = one([
      for s in jsondecode(aws_iam_role_policy.this.policy).Statement : s.Resource if s.Sid == "RunMigrate"
    ]) == ["arn:aws:ecs:me-central-1:111111111111:task-definition/schoolhub-staging-migrate:*"]
    error_message = "ecs:RunTask must be limited to the migrate family."
  }

  assert {
    condition = one([
      for s in jsondecode(aws_iam_role_policy.this.policy).Statement : s.Condition.ArnEquals["ecs:cluster"] if s.Sid == "RunMigrate"
    ]) == "arn:aws:ecs:me-central-1:111111111111:cluster/schoolhub-staging"
    error_message = "ecs:RunTask must be limited to the env's cluster."
  }
}

run "tag_on_register_scoped_to_env_families" {
  command = plan

  assert {
    condition = toset(one([
      for s in jsondecode(aws_iam_role_policy.this.policy).Statement : s.Resource if s.Sid == "TagOnRegister"
    ])) == toset([for f in var.task_definition_families : "arn:aws:ecs:me-central-1:111111111111:task-definition/${f}:*"])
    error_message = "TagOnRegister must name exactly the six env families."
  }

  assert {
    condition = one([
      for s in jsondecode(aws_iam_role_policy.this.policy).Statement : s.Condition.StringEquals["ecs:CreateAction"] if s.Sid == "TagOnRegister"
    ]) == "RegisterTaskDefinition"
    error_message = "TagOnRegister must apply only while registering a task definition."
  }
}
