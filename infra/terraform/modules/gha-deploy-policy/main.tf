# =============================================================================
# modules/gha-deploy-policy: the env-scoped half of schoolhub-gha-deploy-<env>.
#
# The bootstrap root creates the role and its ECR permissions; only the env root
# knows its cluster, services, task roles and distribution, so it attaches this.
# Everything is an exact ARN of this environment: a staging run cannot touch a
# production service, family or role, and the reverse (Review Focus 1).
# =============================================================================

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

locals {
  ecs_arn = "arn:aws:ecs:${var.region}:${var.account_id}"

  family_arns = [for f in var.task_definition_families : "${local.ecs_arn}:task-definition/${f}:*"]
  task_arns   = "${local.ecs_arn}:task/${var.cluster_name}/*"

  policy = {
    Version = "2012-10-17"
    Statement = [
      {
        # Neither action supports resource-level permissions.
        Sid      = "TaskDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"]
        Resource = ["*"]
      },
      {
        Sid      = "Services"
        Effect   = "Allow"
        Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
        Resource = [for s in var.service_names : "${local.ecs_arn}:service/${var.cluster_name}/${s}"]
      },
      {
        Sid       = "RunMigrate"
        Effect    = "Allow"
        Action    = ["ecs:RunTask"]
        Resource  = ["${local.ecs_arn}:task-definition/${var.migrate_task_family}:*"]
        Condition = { ArnEquals = { "ecs:cluster" = var.cluster_arn } }
      },
      {
        Sid      = "Tasks"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTasks", "ecs:StopTask"]
        Resource = [local.task_arns]
      },
      {
        # The rollout reads stopped reasons; ListTasks is scoped by cluster.
        Sid       = "ListTasks"
        Effect    = "Allow"
        Action    = ["ecs:ListTasks"]
        Resource  = ["${local.ecs_arn}:container-instance/${var.cluster_name}/*"]
        Condition = { ArnEquals = { "ecs:cluster" = var.cluster_arn } }
      },
      {
        Sid       = "TagOnRun"
        Effect    = "Allow"
        Action    = ["ecs:TagResource"]
        Resource  = [local.task_arns]
        Condition = { StringEquals = { "ecs:CreateAction" = "RunTask" } }
      },
      {
        # Registering a revision with tags is a TagResource call; scoped to this env's families.
        Sid       = "TagOnRegister"
        Effect    = "Allow"
        Action    = ["ecs:TagResource"]
        Resource  = local.family_arns
        Condition = { StringEquals = { "ecs:CreateAction" = "RegisterTaskDefinition" } }
      },
      {
        Sid       = "PassEnvRoles"
        Effect    = "Allow"
        Action    = ["iam:PassRole"]
        Resource  = var.pass_role_arns
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:GetLogEvents", "logs:FilterLogEvents", "logs:DescribeLogStreams"]
        Resource = [for g in var.log_group_names : "arn:aws:logs:${var.region}:${var.account_id}:log-group:${g}:*"]
      },
      {
        Sid      = "Invalidate"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
        Resource = [var.distribution_arn]
      },
    ]
  }
}

resource "aws_iam_role_policy" "this" {
  name   = "${var.role_name}-env"
  role   = var.role_name
  policy = jsonencode(local.policy)
}
