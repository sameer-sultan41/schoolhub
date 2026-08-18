# =============================================================================
# Staging — a scaled-down copy of the production topology.
#
# "Scaled-down" means fewer and smaller instances. It does NOT mean structurally
# different: same subnet tiers, same security-group graph, same PgBouncer in
# transaction mode, same non-BYPASSRLS application role. A staging environment
# that differs in shape rehearses nothing.
#
# Data here is anonymized synthetic tenants. Production PII must never be
# restored into this account (hosting-deployment.md §2).
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

# CloudFront certificates must be issued in us-east-1 regardless of where the
# rest of the environment lives.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.common_tags
  }
}

locals {
  environment = "staging"
  name_prefix = "schoolhub-staging"

  common_tags = merge(var.tags, {
    Project     = "schoolhub"
    Environment = local.environment
    ManagedBy   = "terraform"
    Repo        = "schoolhub-infra-v2"
  })

  # The storage module needs the distribution ARN (to scope the bucket policy to
  # exactly one distribution) and the CDN module needs the bucket as an origin.
  # Wiring both as module outputs is a dependency cycle Terraform will reject.
  #
  # Break it on the side that is knowable without applying anything: an S3
  # regional endpoint is derivable from the bucket name and region, so the CDN
  # takes the derived string and only storage -> cdn remains a real edge.
  uploads_bucket_regional_domain_name = "${var.uploads_bucket_name}.s3.${var.aws_region}.amazonaws.com"

  # Non-secret configuration shared by every Python service.
  api_environment = {
    DJANGO_SETTINGS_MODULE = "config.settings.staging"
    DJANGO_DEBUG           = "false"
    DJANGO_ALLOWED_HOSTS   = "api.${var.platform_domain},app.${var.platform_domain}"
    PLATFORM_DOMAIN        = var.platform_domain
    S3_BUCKET_NAME         = module.storage.uploads_bucket_name
    S3_REGION_NAME         = var.aws_region
    LOG_LEVEL              = "INFO"
    ENVIRONMENT            = local.environment
  }

  # Injected by ARN at task start. The values never appear in a task definition.
  api_secrets = merge(
    {
      DJANGO_SECRET_KEY = var.django_secret_key_arn
      DATABASE_URL      = var.app_database_url_arn
      REDIS_AUTH_TOKEN  = module.cache.auth_token_secret_arn
    },
    var.sentry_dsn_arn != "" ? { SENTRY_DSN = var.sentry_dsn_arn } : {},
  )
}

# -----------------------------------------------------------------------------
# Network
# -----------------------------------------------------------------------------
module "network" {
  source = "../../modules/network"

  name_prefix = local.name_prefix
  environment = local.environment
  vpc_cidr    = var.vpc_cidr

  availability_zone_count = 2
  # One NAT gateway. Staging can tolerate losing outbound traffic in one AZ.
  single_nat_gateway = true
  enable_flow_logs   = false

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

  instance_class           = "db.t4g.medium"
  allocated_storage_gb     = 50
  max_allocated_storage_gb = 200

  # Single-AZ: staging does not carry the production RTO target.
  multi_az = false

  # Still 30 days. Staging is where a restore is rehearsed before it is needed
  # for real, so its PITR window must be long enough to rehearse against.
  backup_retention_days = 30

  # False so a staging rebuild is not a ticket. Production sets this true.
  deletion_protection = false

  alarm_sns_topic_arns = var.alarm_sns_topic_arns
  tags                 = local.common_tags
}

module "cache" {
  source = "../../modules/cache"

  name_prefix        = local.name_prefix
  environment        = local.environment
  subnet_ids         = module.network.data_subnet_ids
  security_group_ids = [module.network.cache_security_group_id]

  node_type     = "cache.t4g.micro"
  replica_count = 0

  alarm_sns_topic_arns = var.alarm_sns_topic_arns
  tags                 = local.common_tags
}

module "storage" {
  source = "../../modules/storage"

  name_prefix        = local.name_prefix
  environment        = local.environment
  bucket_name        = var.uploads_bucket_name
  backup_bucket_name = var.backup_bucket_name

  noncurrent_version_retention_days = 30
  backup_retention_days             = 30

  # Object Lock off in staging: a WORM-locked bucket cannot be torn down with
  # the rest of the environment.
  enable_object_lock = false

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

  tags = local.common_tags
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = module.cdn.certificate_arn

  # Anything not matched by a service rule is a host we do not serve. 404, not
  # a default backend: a wildcard default would serve some tenant's site under
  # an unrecognized hostname.
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
  cpu            = 512
  memory         = 1024
  container_port = 8000

  expose_via_alb         = true
  listener_arn           = aws_lb_listener.https.arn
  listener_rule_priority = 10
  host_headers           = ["api.${var.platform_domain}"]
  health_check_path      = "/healthz"

  environment_variables = local.api_environment
  secret_arns           = local.api_secrets
  task_role_policy_arns = [module.storage.app_access_policy_arn]

  desired_count = 1
  min_capacity  = 1
  max_capacity  = 4

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

  image   = var.api_image
  command = ["celery", "-A", "config.celery", "worker", "-l", "info", "-Q", "emergency,transactional,bulk,default"]
  cpu     = 512
  memory  = 1024

  # No listener, no health check path: workers take no inbound traffic.
  expose_via_alb = false

  environment_variables = local.api_environment
  secret_arns           = local.api_secrets
  task_role_policy_arns = [module.storage.app_access_policy_arn]

  desired_count = 1
  min_capacity  = 1
  max_capacity  = 4

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
  cpu     = 256
  memory  = 512

  expose_via_alb = false

  environment_variables = local.api_environment
  secret_arns           = local.api_secrets

  # EXACTLY ONE. Two schedulers double-fire every periodic job — duplicate fee
  # reminders, duplicate attendance digests. The module enforces this too.
  desired_count      = 1
  enable_autoscaling = false

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
  cpu            = 512
  memory         = 1024
  container_port = 3000

  expose_via_alb         = true
  listener_arn           = aws_lb_listener.https.arn
  listener_rule_priority = 20
  host_headers           = ["app.${var.platform_domain}"]
  health_check_path      = "/api/health"

  environment_variables = {
    NODE_ENV                    = "production"
    NEXT_PUBLIC_API_BASE_URL    = "https://api.${var.platform_domain}/api/v1"
    NEXT_PUBLIC_PLATFORM_DOMAIN = var.platform_domain
    NEXT_TELEMETRY_DISABLED     = "1"
  }

  desired_count = 1
  min_capacity  = 1
  max_capacity  = 4

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
  cpu            = 512
  memory         = 1024
  container_port = 3001

  expose_via_alb = true
  listener_arn   = aws_lb_listener.https.arn

  # Priority 900: the wildcard MUST be evaluated after the specific hosts above,
  # or *.staging.schoolhub.example swallows api. and app. and the platform
  # disappears behind a tenant homepage.
  listener_rule_priority = 900
  host_headers           = ["*.${var.platform_domain}", var.platform_domain]
  health_check_path      = "/api/health"

  environment_variables = {
    NODE_ENV                    = "production"
    NEXT_PUBLIC_API_BASE_URL    = "https://api.${var.platform_domain}/api/v1"
    NEXT_PUBLIC_PLATFORM_DOMAIN = var.platform_domain
    NEXT_TELEMETRY_DISABLED     = "1"
  }

  desired_count = 1
  min_capacity  = 1
  max_capacity  = 4

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

  price_class = "PriceClass_100"

  # WAF off in staging: the managed rule groups cost real money and staging is
  # not exposed to hostile traffic. Enabled in production.
  enable_waf = false

  tags = local.common_tags
}
