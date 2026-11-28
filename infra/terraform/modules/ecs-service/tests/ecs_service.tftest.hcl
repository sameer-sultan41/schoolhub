# modules/ecs-service under a mocked provider (CI only: `terraform test`).
# ignore_changes on task_definition/desired_count is not visible here; the
# module comment pins it and the change review checks it.

mock_provider "aws" {
  override_during = plan

  mock_data "aws_region" {
    defaults = {
      region = "me-central-1"
    }
  }
}

variables {
  name_prefix        = "schoolhub-staging"
  environment        = "staging"
  service_name       = "api"
  cluster_arn        = "arn:aws:ecs:me-central-1:111111111111:cluster/schoolhub-staging"
  subnet_ids         = ["subnet-1", "subnet-2"]
  security_group_ids = ["sg-1"]
  vpc_id             = "vpc-1"
  image              = "111111111111.dkr.ecr.me-central-1.amazonaws.com/schoolhub/api:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  listener_arn       = "arn:aws:elasticloadbalancing:me-central-1:111111111111:listener/app/x/1/2"
  host_headers       = ["api.staging.example.org"]
}

run "beat_never_overlaps" {
  command = plan

  variables {
    service_name       = "celery-beat"
    expose_via_alb     = false
    host_headers       = []
    desired_count      = 1
    enable_autoscaling = false
  }

  assert {
    condition     = aws_ecs_service.this[0].deployment_maximum_percent == 100
    error_message = "celery-beat must deploy with maximum 100% so two schedulers never run."
  }

  assert {
    condition     = aws_ecs_service.this[0].deployment_minimum_healthy_percent == 0
    error_message = "celery-beat must deploy with minimum 0% so the old task stops first."
  }
}

run "web_service_rolls_with_full_capacity" {
  command = plan

  assert {
    condition     = aws_ecs_service.this[0].deployment_maximum_percent == 200 && aws_ecs_service.this[0].deployment_minimum_healthy_percent == 100
    error_message = "A web service must roll 200/100: a deploy never reduces capacity."
  }
}

run "task_only_creates_no_service" {
  command = plan

  variables {
    service_name   = "migrate"
    create_service = false
    expose_via_alb = false
    host_headers   = []
  }

  assert {
    condition     = length(aws_ecs_service.this) == 0 && length(aws_lb_target_group.this) == 0 && length(aws_appautoscaling_target.this) == 0
    error_message = "create_service = false must create no service, target group or autoscaling."
  }

  assert {
    condition     = aws_ecs_task_definition.this.family == "schoolhub-staging-migrate"
    error_message = "The task-only module must still register the <prefix>-migrate family."
  }
}

run "json_key_secret_scoped_to_secret_arn" {
  command = plan

  variables {
    secret_arns = {
      PGPASSWORD = "arn:aws:secretsmanager:us-east-1:111111111111:secret:x/rds/master-AbCdEf:password::"
      PGUSER     = "arn:aws:secretsmanager:us-east-1:111111111111:secret:x/rds/master-AbCdEf:username::"
    }
  }

  assert {
    condition     = local.secret_resource_arns == tolist(["arn:aws:secretsmanager:us-east-1:111111111111:secret:x/rds/master-AbCdEf"])
    error_message = "A JSON-key valueFrom must be reduced to the secret's ARN, once."
  }
}

run "kms_decrypt_only_when_keys_given" {
  command = plan

  variables {
    secret_arns = {
      DJANGO_SECRET_KEY = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-staging/django/secret-key-AbCdEf"
    }
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.execution_secrets[0].policy, "kms:Decrypt")
    error_message = "Without secret_kms_key_arns the execution role gets no kms:Decrypt."
  }
}

run "kms_decrypt_scoped_to_given_keys" {
  command = plan

  variables {
    secret_arns = {
      REDIS_AUTH_TOKEN = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-staging/redis/auth-token-AbCdEf"
    }
    secret_kms_key_arns = ["arn:aws:kms:me-central-1:111111111111:key/redis"]
  }

  assert {
    condition = one([
      for s in jsondecode(aws_iam_role_policy.execution_secrets[0].policy).Statement : s.Resource if contains(s.Action, "kms:Decrypt")
    ]) == ["arn:aws:kms:me-central-1:111111111111:key/redis"]
    error_message = "kms:Decrypt must be granted on exactly the given keys."
  }

  assert {
    condition = one([
      for s in jsondecode(aws_iam_role_policy.execution_secrets[0].policy).Statement : s.Condition.StringEquals["kms:ViaService"] if contains(s.Action, "kms:Decrypt")
    ]) == "secretsmanager.me-central-1.amazonaws.com"
    error_message = "kms:Decrypt must be limited to calls through Secrets Manager."
  }
}
