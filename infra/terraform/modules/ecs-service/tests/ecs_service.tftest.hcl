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
    condition     = aws_ecs_service.this.deployment_maximum_percent == 100
    error_message = "celery-beat must deploy with maximum 100% so two schedulers never run."
  }

  assert {
    condition     = aws_ecs_service.this.deployment_minimum_healthy_percent == 0
    error_message = "celery-beat must deploy with minimum 0% so the old task stops first."
  }
}

run "web_service_rolls_with_full_capacity" {
  command = plan

  assert {
    condition     = aws_ecs_service.this.deployment_maximum_percent == 200 && aws_ecs_service.this.deployment_minimum_healthy_percent == 100
    error_message = "A web service must roll 200/100: a deploy never reduces capacity."
  }
}
