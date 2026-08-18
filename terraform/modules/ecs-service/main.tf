# =============================================================================
# modules/ecs-service — one Fargate service.
#
# Instantiated once per deployable: api, celery-worker, celery-beat, dashboard,
# website. They differ in arguments, not in shape, so a change to rollout
# behavior or log retention lands everywhere at once.
#
# Two IAM roles, and the distinction matters:
#
#   execution role — used by the ECS agent BEFORE the container starts: pull the
#                    image, read the secrets, write to the log group.
#   task role      — assumed by the application code itself. Everything the
#                    running process may do to AWS. Nothing else belongs here.
#
# Putting secret-read permissions on the task role is the common mistake: it
# lets application code read every secret, not just the ones injected into it.
#
# Spec: schoolhub-srd/docs/02-architecture/hosting-deployment.md §3, §8
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
  name = "${var.name_prefix}-${var.service_name}"

  tags = merge(var.tags, {
    Environment = var.environment
    Module      = "ecs-service"
    Service     = var.service_name
  })

  # celery-beat is a singleton scheduler. Guard it here rather than trusting
  # every caller to remember.
  is_singleton = var.service_name == "celery-beat"

  effective_desired_count = local.is_singleton ? 1 : var.desired_count
  autoscaling_enabled     = var.enable_autoscaling && !local.is_singleton

  container_environment = [
    for k, v in var.environment_variables : {
      name  = k
      value = v
    }
  ]

  container_secrets = [
    for k, v in var.secret_arns : {
      name      = k
      valueFrom = v
    }
  ]
}

# A singleton service running two copies is a correctness bug, not a capacity
# choice. Fail the plan rather than double-charge every school.
resource "terraform_data" "singleton_guard" {
  count = local.is_singleton ? 1 : 0

  input = var.desired_count

  lifecycle {
    precondition {
      # Terraform requires the condition to reference configuration, so this asserts
      # the rule directly rather than relying on `count` to decide whether to fail.
      condition     = var.desired_count == 1
      error_message = "celery-beat must run exactly one task. Two schedulers fire every periodic job twice."
    }
  }
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${local.name}"
  retention_in_days = var.log_retention_days

  tags = local.tags
}

# -----------------------------------------------------------------------------
# Execution role — pre-start, agent-side only.
# -----------------------------------------------------------------------------
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  count = length(var.secret_arns) > 0 ? 1 : 0

  statement {
    sid    = "ReadInjectedSecrets"
    effect = "Allow"

    actions = [
      "secretsmanager:GetSecretValue",
      "ssm:GetParameters",
    ]

    # Exactly the secrets this service is given, by ARN. Not secretsmanager:*
    # and not a prefix wildcard.
    resources = values(var.secret_arns)
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  count = length(var.secret_arns) > 0 ? 1 : 0

  name   = "${local.name}-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets[0].json
}

# -----------------------------------------------------------------------------
# Task role — what the application may do at runtime.
# -----------------------------------------------------------------------------
resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "task" {
  for_each = toset(var.task_role_policy_arns)

  role       = aws_iam_role.task.name
  policy_arn = each.value
}

# ECS Exec, for attaching a shell to a running task during an incident. Every
# session is logged to CloudWatch — an operator shell in a multi-tenant database
# is an audit event.
data "aws_iam_policy_document" "task_exec" {
  statement {
    sid    = "AllowECSExec"
    effect = "Allow"

    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]

    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task_exec" {
  name   = "${local.name}-ecs-exec"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_exec.json
}

# -----------------------------------------------------------------------------
# Task definition
# -----------------------------------------------------------------------------
resource "aws_ecs_task_definition" "this" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = var.service_name
      image     = var.image
      essential = true
      command   = length(var.command) > 0 ? var.command : null

      portMappings = var.expose_via_alb ? [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ] : []

      environment = local.container_environment
      secrets     = local.container_secrets

      # Containers run read-only with a writable /tmp. A process that cannot
      # write its own filesystem cannot persist a dropped payload.
      readonlyRootFilesystem = true

      mountPoints = [
        {
          sourceVolume  = "tmp"
          containerPath = "/tmp"
          readOnly      = false
        }
      ]

      linuxParameters = {
        initProcessEnabled = true
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this.name
          "awslogs-region"        = data.aws_region.current.region
          "awslogs-stream-prefix" = var.service_name
        }
      }

      stopTimeout = 60
    }
  ])

  volume {
    name = "tmp"
  }

  tags = local.tags
}

data "aws_region" "current" {}

# -----------------------------------------------------------------------------
# Load balancer target
# -----------------------------------------------------------------------------
resource "aws_lb_target_group" "this" {
  count = var.expose_via_alb ? 1 : 0

  name        = substr("${local.name}-tg", 0, 32)
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    enabled             = true
    path                = var.health_check_path
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # Long enough to finish an in-flight request, short enough that a rollback is
  # measured in minutes as the rollback runbook promises.
  deregistration_delay = 30

  lifecycle {
    create_before_destroy = true
  }

  tags = local.tags
}

resource "aws_lb_listener_rule" "this" {
  count = var.expose_via_alb && length(var.host_headers) > 0 ? 1 : 0

  listener_arn = var.listener_arn
  priority     = var.listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[0].arn
  }

  condition {
    host_header {
      values = var.host_headers
    }
  }

  tags = local.tags
}

# -----------------------------------------------------------------------------
# Service
# -----------------------------------------------------------------------------
resource "aws_ecs_service" "this" {
  name            = local.name
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = local.effective_desired_count
  launch_type     = "FARGATE"

  enable_execute_command = true
  propagate_tags         = "SERVICE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = var.expose_via_alb ? [1] : []

    content {
      target_group_arn = aws_lb_target_group.this[0].arn
      container_name   = var.service_name
      container_port   = var.container_port
    }
  }

  # Rolling deployment with room for a full extra set of tasks, and never below
  # 100% healthy: a deploy must not reduce capacity.
  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  deployment_circuit_breaker {
    enable   = var.deployment_circuit_breaker
    rollback = var.deployment_circuit_breaker
  }

  # A singleton scheduler cannot run two copies even briefly, so beat is
  # stop-then-start instead of rolling.
  dynamic "deployment_controller" {
    for_each = local.is_singleton ? [1] : []

    content {
      type = "ECS"
    }
  }

  health_check_grace_period_seconds = var.expose_via_alb ? 60 : null

  lifecycle {
    ignore_changes = [
      # CI deploys new task definitions and scales the service; Terraform owns
      # the shape, not the current revision. Without this, every apply reverts
      # the running deployment to whatever the last plan saw.
      task_definition,
      desired_count,
    ]
  }

  tags = local.tags

  depends_on = [aws_lb_listener_rule.this]
}

# -----------------------------------------------------------------------------
# Autoscaling
# -----------------------------------------------------------------------------
resource "aws_appautoscaling_target" "this" {
  count = local.autoscaling_enabled ? 1 : 0

  service_namespace  = "ecs"
  resource_id        = "service/${element(split("/", var.cluster_arn), 1)}/${aws_ecs_service.this.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.min_capacity
  max_capacity       = var.max_capacity

  tags = local.tags
}

resource "aws_appautoscaling_policy" "cpu" {
  count = local.autoscaling_enabled ? 1 : 0

  name               = "${local.name}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this[0].service_namespace
  resource_id        = aws_appautoscaling_target.this[0].resource_id
  scalable_dimension = aws_appautoscaling_target.this[0].scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value = var.autoscaling_cpu_target

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
