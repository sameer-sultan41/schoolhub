# =============================================================================
# Production — live tenant data.
#
# Structurally identical to staging on purpose; the differences are all values,
# and each one below is either a durability requirement or a capacity choice:
#
#   multi_az                = true    RTO of 4 hours assumes a standby
#   single_nat_gateway      = false   one AZ losing egress must not lose the platform
#   enable_object_lock      = true    backups survive a compromised deploy role
#   enable_waf              = true    this is the only internet-facing environment
#   deletion_protection     = true
#   apply_immediately       = false   (set in the database module by environment)
#   enable_flow_logs        = true    incident forensics
#
# Deploys reach here only through the manual approval gate in
# hosting-deployment.md §3. Terraform is NOT auto-applied: CI plans, a human
# reads the plan, a human applies.
#
# NOT APPLIED — see terraform/README.md.
# =============================================================================

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.common_tags
  }
}

locals {
  environment = "production"
  name_prefix = "schoolhub-production"

  common_tags = merge(var.tags, {
    Project     = "schoolhub"
    Environment = local.environment
    ManagedBy   = "terraform"
    Repo        = "infra"
    DataClass   = "tenant-pii"
  })

  # See the staging environment for why this is derived rather than taken from
  # the storage module: it breaks the storage <-> cdn dependency cycle.
  uploads_bucket_regional_domain_name = "${var.uploads_bucket_name}.s3.${var.aws_region}.amazonaws.com"

  api_environment = {
    DJANGO_SETTINGS_MODULE = "config.settings.production"
    DJANGO_DEBUG           = "false"
    DJANGO_ALLOWED_HOSTS   = "api.${var.platform_domain},app.${var.platform_domain}"
    PLATFORM_DOMAIN        = var.platform_domain
    S3_BUCKET_NAME         = module.storage.uploads_bucket_name
    S3_REGION_NAME         = var.aws_region
    LOG_LEVEL              = "INFO"
    ENVIRONMENT            = local.environment
  }

  api_secrets = merge(
    {
      DJANGO_SECRET_KEY = var.django_secret_key_arn
      DATABASE_URL      = var.app_database_url_arn
      REDIS_AUTH_TOKEN  = module.cache.auth_token_secret_arn
      SENTRY_DSN        = var.sentry_dsn_arn
    },
    var.payment_gateway_secret_arn != "" ? { PAYMENT_GATEWAY_SECRET = var.payment_gateway_secret_arn } : {},
  )

  # The frontends get no payment or database secrets. Enumerated separately so
  # a future addition to api_secrets cannot silently reach a Next.js container.
  frontend_secrets = {
    SENTRY_DSN = var.sentry_dsn_arn
  }
}

# -----------------------------------------------------------------------------
# Network
# -----------------------------------------------------------------------------
module "network" {
  source = "../../modules/network"

  name_prefix = local.name_prefix
  environment = local.environment
  vpc_cidr    = var.vpc_cidr

  availability_zone_count = 3

  # One NAT gateway per AZ. Roughly USD 70/month more than a single gateway, and
  # the reason a single AZ failure is a capacity event rather than an outage.
  single_nat_gateway = false

  enable_flow_logs        = true
  flow_log_retention_days = 90

  tags = local.common_tags
}

# -----------------------------------------------------------------------------
# Data stores
# -----------------------------------------------------------------------------
module "database" {
  source = "../../modules/database"

  name_prefix        = local.name_prefix
  environment        = local.environment
  subnet_ids         = module.network.data_subnet_ids
  security_group_ids = [module.network.database_security_group_id]

  instance_class           = "db.m7g.large"
  allocated_storage_gb     = 200
  max_allocated_storage_gb = 2000

  # Synchronous standby in a second AZ. The 4-hour RTO in hosting-deployment.md
  # §9 is not achievable without it.
  multi_az = true

  # 30-day PITR window per database-architecture.md §6. RDS caps this at 35.
  backup_retention_days = 30
  backup_window         = "07:00-07:30"
  maintenance_window    = "sun:08:00-sun:09:00"

  deletion_protection                 = true
  performance_insights_retention_days = 465
  monitoring_interval_seconds         = 30
  log_retention_days                  = 90

  alarm_sns_topic_arns = var.alarm_sns_topic_arns
  tags                 = local.common_tags
}

module "cache" {
  source = "../../modules/cache"

  name_prefix        = local.name_prefix
  environment        = local.environment
  subnet_ids         = module.network.data_subnet_ids
  security_group_ids = [module.network.cache_security_group_id]

  node_type = "cache.m7g.large"

  # One replica so a primary failure fails over automatically. Redis holds no
  # durable data, but losing the Celery broker mid-day drops queued
  # notifications, so availability still matters.
  replica_count = 1

  # Still zero. Redis is disposable by design (hosting-deployment.md §7).
  snapshot_retention_days = 0

  alarm_sns_topic_arns = var.alarm_sns_topic_arns
  tags                 = local.common_tags
}

module "storage" {
  source = "../../modules/storage"

  name_prefix        = local.name_prefix
  environment        = local.environment
  bucket_name        = var.uploads_bucket_name
  backup_bucket_name = var.backup_bucket_name

  noncurrent_version_retention_days = 90
  archive_transition_days           = 90
  backup_retention_days             = 35

  # WORM. A deploy role compromised badly enough to drop the database is also
  # compromised enough to delete the backups — unless it cannot.
  enable_object_lock         = true
  object_lock_retention_days = 30

  cors_allowed_origins = [
    "https://app.${var.platform_domain}",
    "https://${var.platform_domain}",
  ]

  cloudfront_distribution_arn = module.cdn.distribution_arn

  tags = local.common_tags
}

# -----------------------------------------------------------------------------
# Compute
# -----------------------------------------------------------------------------
resource "aws_ecs_cluster" "this" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.common_tags
}

# The load balancer is deliberately internet-facing: it serves every school's
# public website and the admin dashboard, so reachability from the internet is the
# requirement, not an oversight. What protects it is layered in front of and behind
# it — WAF on the CloudFront distribution, TLS termination, authentication on every
# API route, and an application tier that only accepts traffic from this security
# group.
#trivy:ignore:AVD-AWS-0053
resource "aws_lb" "this" {
  name               = substr("${local.name_prefix}-alb", 0, 32)
  load_balancer_type = "application"
  internal           = false
  subnets            = module.network.public_subnet_ids
  security_groups    = [module.network.alb_security_group_id]

  drop_invalid_header_fields = true
  enable_http2               = true
  idle_timeout               = 60

  # Production only. Nobody deletes this by accident, and the tenant websites
  # all resolve through it.
  enable_deletion_protection = true

  tags = local.common_tags
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = module.cdn.certificate_arn

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Unknown host"
      status_code  = "404"
    }
  }

  tags = local.common_tags
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }

  tags = local.common_tags
}

module "api" {
  source = "../../modules/ecs-service"

  name_prefix  = local.name_prefix
  environment  = local.environment
  service_name = "api"

  cluster_arn        = aws_ecs_cluster.this.arn
  subnet_ids         = module.network.private_subnet_ids
  security_group_ids = [module.network.app_security_group_id]
  vpc_id             = module.network.vpc_id

  image          = var.api_image
  cpu            = 1024
  memory         = 2048
  container_port = 8000

  expose_via_alb         = true
  listener_arn           = aws_lb_listener.https.arn
  listener_rule_priority = 10
  host_headers           = ["api.${var.platform_domain}"]
  health_check_path      = "/healthz"

  environment_variables = local.api_environment
  secret_arns           = local.api_secrets
  task_role_policy_arns = [module.storage.app_access_policy_arn]

  desired_count = 3
  min_capacity  = 3
  max_capacity  = 20

  log_retention_days = 90

  tags = local.common_tags
}

module "celery_worker" {
  source = "../../modules/ecs-service"

  name_prefix  = local.name_prefix
  environment  = local.environment
  service_name = "celery-worker"

  cluster_arn        = aws_ecs_cluster.this.arn
  subnet_ids         = module.network.private_subnet_ids
  security_group_ids = [module.network.app_security_group_id]
  vpc_id             = module.network.vpc_id

  image = var.api_image

  # Lane order is priority order. The emergency lane must not sit behind a bulk
  # fee-reminder run — see the notifications spec.
  command = ["celery", "-A", "config.celery", "worker", "-l", "info", "-Q", "emergency,transactional,bulk,default", "--concurrency", "4"]

  cpu    = 1024
  memory = 2048

  expose_via_alb = false

  environment_variables = local.api_environment
  secret_arns           = local.api_secrets
  task_role_policy_arns = [module.storage.app_access_policy_arn]

  desired_count = 3
  min_capacity  = 2
  max_capacity  = 20

  log_retention_days = 90

  tags = local.common_tags
}

module "celery_beat" {
  source = "../../modules/ecs-service"

  name_prefix  = local.name_prefix
  environment  = local.environment
  service_name = "celery-beat"

  cluster_arn        = aws_ecs_cluster.this.arn
  subnet_ids         = module.network.private_subnet_ids
  security_group_ids = [module.network.app_security_group_id]
  vpc_id             = module.network.vpc_id

  image   = var.api_image
  command = ["celery", "-A", "config.celery", "beat", "-l", "info"]
  cpu     = 512
  memory  = 1024

  expose_via_alb = false

  environment_variables = local.api_environment
  secret_arns           = local.api_secrets

  # ONE. Not "one for now" — one, permanently. A second scheduler fires every
  # retention job, every fee reminder and every digest twice, against live
  # tenant data. The module refuses desired_count > 1 for this service.
  desired_count      = 1
  enable_autoscaling = false

  log_retention_days = 90

  tags = local.common_tags
}

module "dashboard" {
  source = "../../modules/ecs-service"

  name_prefix  = local.name_prefix
  environment  = local.environment
  service_name = "dashboard"

  cluster_arn        = aws_ecs_cluster.this.arn
  subnet_ids         = module.network.private_subnet_ids
  security_group_ids = [module.network.app_security_group_id]
  vpc_id             = module.network.vpc_id

  image          = var.dashboard_image
  cpu            = 1024
  memory         = 2048
  container_port = 3000

  expose_via_alb         = true
  listener_arn           = aws_lb_listener.https.arn
  listener_rule_priority = 20
  # *.app.<platform_domain> is the tenant's own dashboard (their school name in the URL,
  # e.g. cityschool.app.schoolhub.example); bare app.<platform_domain> is the generic
  # entry point (platform staff, or a school that hasn't been given a slug link yet).
  # This is a DIFFERENT wildcard from the website's *.<platform_domain> below — the two
  # can't share one, see that rule's own comment — so priority 20 (before website's 900)
  # is what makes a tenant dashboard host match here first rather than falling through
  # to the tenant *website* renderer.
  host_headers      = ["*.app.${var.platform_domain}", "app.${var.platform_domain}"]
  health_check_path = "/api/health"

  environment_variables = {
    NODE_ENV                    = "production"
    NEXT_PUBLIC_API_BASE_URL    = "https://api.${var.platform_domain}/api/v1"
    NEXT_PUBLIC_PLATFORM_DOMAIN = var.platform_domain
    NEXT_TELEMETRY_DISABLED     = "1"
  }

  secret_arns = local.frontend_secrets

  desired_count = 2
  min_capacity  = 2
  max_capacity  = 10

  log_retention_days = 90

  tags = local.common_tags
}

module "website" {
  source = "../../modules/ecs-service"

  name_prefix  = local.name_prefix
  environment  = local.environment
  service_name = "website"

  cluster_arn        = aws_ecs_cluster.this.arn
  subnet_ids         = module.network.private_subnet_ids
  security_group_ids = [module.network.app_security_group_id]
  vpc_id             = module.network.vpc_id

  image          = var.website_image
  cpu            = 1024
  memory         = 2048
  container_port = 3001

  expose_via_alb = true
  listener_arn   = aws_lb_listener.https.arn

  # 900, after api (10) and app (20). ALB rules are evaluated in priority order
  # and the first match wins, so a wildcard placed before the specific hosts
  # would route api.schoolhub.example to the tenant website renderer and take
  # the entire platform down while returning HTTP 200.
  listener_rule_priority = 900

  host_headers = concat(
    ["*.${var.platform_domain}", var.platform_domain],
    var.custom_domain_aliases,
  )

  health_check_path = "/api/health"

  environment_variables = {
    NODE_ENV                    = "production"
    NEXT_PUBLIC_API_BASE_URL    = "https://api.${var.platform_domain}/api/v1"
    NEXT_PUBLIC_PLATFORM_DOMAIN = var.platform_domain
    NEXT_TELEMETRY_DISABLED     = "1"
  }

  secret_arns = local.frontend_secrets

  desired_count = 3
  min_capacity  = 3
  max_capacity  = 20

  log_retention_days = 90

  tags = local.common_tags
}

# -----------------------------------------------------------------------------
# Edge
# -----------------------------------------------------------------------------
module "cdn" {
  source = "../../modules/cdn"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix     = local.name_prefix
  environment     = local.environment
  platform_domain = var.platform_domain
  hosted_zone_id  = var.hosted_zone_id

  alb_domain_name                     = aws_lb.this.dns_name
  uploads_bucket_regional_domain_name = local.uploads_bucket_regional_domain_name
  uploads_bucket_id                   = var.uploads_bucket_name

  price_class           = "PriceClass_200"
  custom_domain_aliases = var.custom_domain_aliases

  enable_waf              = true
  waf_rate_limit_per_5min = 20000

  log_bucket_domain_name = var.cloudfront_log_bucket_domain_name

  tags = local.common_tags
}
