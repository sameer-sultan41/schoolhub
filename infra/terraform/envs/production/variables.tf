variable "aws_region" {
  description = "Region everything except the CloudFront certificate lives in. A region near Pakistan (ADR-0040, D20); widening the list is a reviewed change."
  type        = string

  validation {
    condition     = contains(["me-central-1", "ap-south-1"], var.aws_region)
    error_message = "aws_region must be me-central-1 or ap-south-1."
  }
}

variable "platform_domain" {
  description = "Production platform domain. Tenant sites are <slug>.<domain>; verified custom domains also point here."
  type        = string
  default     = "schoolhub.example"
}

variable "num_proxies" {
  description = "How many proxies (CDN, ALB) in front of the API append to X-Forwarded-For: 2 when requests pass CloudFront then the ALB, 1 for the ALB alone, 0 when reached directly. Per-IP throttles, audit and contact IPs trust the header only this far, and the API refuses to boot without it."
  type        = number

  validation {
    condition     = var.num_proxies >= 0 && floor(var.num_proxies) == var.num_proxies
    error_message = "num_proxies must be a whole number >= 0."
  }
}

variable "website_cname_target" {
  description = "The hostname a school's custom domain must CNAME to (WEBSITE_CNAME_TARGET): the edge name that serves tenant sites, e.g. sites.<platform_domain>. Custom-domain verification checks for it, and the API refuses to boot without it."
  type        = string

  validation {
    condition = (
      length(var.website_cname_target) <= 253 &&
      can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$", var.website_cname_target))
    )
    error_message = "website_cname_target must be a lowercase fully qualified domain name, e.g. sites.schoolhub.example."
  }
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for platform_domain. Created out of band."
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR. Must not overlap staging (10.20.0.0/16) or any office VPN range."
  type        = string
  default     = "10.30.0.0/16"
}

variable "ecr_registry" {
  description = "ECR registry host, the bootstrap output ecr_registry. Images are <registry>/schoolhub/<api|dashboard|website>:<image_tag>."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com$", var.ecr_registry))
    error_message = "ecr_registry must be <account>.dkr.ecr.<region>.amazonaws.com."
  }
}

variable "image_tag" {
  description = "Full git SHA of the bootstrap images. CI registers new revisions afterwards; this is only the first one. The same image is promoted staging -> production, never rebuilt."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.image_tag))
    error_message = "image_tag must be a full 40-character git SHA."
  }
}

variable "uploads_bucket_name" {
  description = "Globally unique name for the tenant uploads bucket."
  type        = string
  default     = "schoolhub-production-uploads"
}

variable "backup_bucket_name" {
  description = "Globally unique name for the backup bucket. Should live in a DIFFERENT account and region from this environment (hosting-deployment.md §7); this variable only names it."
  type        = string
  default     = "schoolhub-production-backups"
}

variable "django_secret_key_arn" {
  description = "Secrets Manager ARN holding DJANGO_SECRET_KEY."
  type        = string
}

variable "integrations_encryption_keys_arn" {
  description = "Secrets Manager ARN holding INTEGRATIONS_ENCRYPTION_KEYS: comma-separated Fernet keys, newest first, that encrypt each school's payment-gateway credentials. See infra/runbooks/rotate-integration-credentials.md."
  type        = string
}

variable "website_machine_tokens_arn" {
  description = "Secrets Manager ARN holding WEBSITE_MACHINE_TOKENS for the API: every live website renderer token, comma-separated, newest first. See infra/runbooks/rotate-website-secrets.md."
  type        = string
}

variable "website_machine_token_arn" {
  description = "Secrets Manager ARN holding the renderer's current WEBSITE_MACHINE_TOKEN, which must be one of the tokens in website_machine_tokens_arn. See infra/runbooks/rotate-website-secrets.md."
  type        = string
}

variable "website_revalidate_secret_arn" {
  description = "Secrets Manager ARN holding the shared HMAC secret for the revalidation webhook: the API's WEBSITE_REVALIDATE_SECRET and the renderer's REVALIDATE_WEBHOOK_SECRET. See infra/runbooks/rotate-website-secrets.md."
  type        = string
}

variable "app_database_url_arn" {
  description = "Secrets Manager ARN holding the application DATABASE_URL — schoolhub_app, directly on 5432 in v1 (no pooler, ADR-0040). Never the master URL."
  type        = string
}

variable "migrator_database_url_arn" {
  description = "Secrets Manager ARN holding the migrator DATABASE_URL (schoolhub_migrator, directly on 5432). Only the migrate task reads it. Printed by infra/scripts/bootstrap-secrets.sh."
  type        = string
}

variable "db_role_password_arns" {
  description = "Secrets Manager ARNs of the three database role passwords, read by the db-bootstrap task. Printed by infra/scripts/bootstrap-secrets.sh."
  type = object({
    app      = string
    migrator = string
    readonly = string
  })
}

variable "postgres_client_image" {
  description = "PostgreSQL 18 client image for the db-bootstrap task, pinned by digest (infra/AGENTS.md rule 3)."
  type        = string
  default     = "public.ecr.aws/docker/library/postgres:18-alpine@sha256:0115267ab5a509022df9319c77be365cef335adb71556c75f60f5360ee247e71"

  validation {
    condition     = strcontains(var.postgres_client_image, "@sha256:") && strcontains(var.postgres_client_image, ":18")
    error_message = "postgres_client_image must be a PostgreSQL 18 image pinned by @sha256: digest."
  }
}

variable "sentry_dsn_arn" {
  description = "Secrets Manager ARN holding the production Sentry DSN."
  type        = string
}

variable "payment_gateway_secret_arn" {
  description = "Secrets Manager ARN for payment gateway credentials. Injected into the API and worker only — the frontends never see it."
  type        = string
  default     = ""
}

variable "alarm_sns_topic_arns" {
  description = "SNS topics for CloudWatch alarms. In production at least one of these must page."
  type        = list(string)

  validation {
    condition     = length(var.alarm_sns_topic_arns) > 0
    error_message = "Production must have at least one alarm destination. An alarm nobody receives is a dashboard, not an alert."
  }
}

variable "custom_domain_aliases" {
  description = "Verified tenant custom domains on the distribution and the ALB certificate. Appended by the onboarding pipeline after DNS validation — see runbooks/custom-domain-onboarding.md. Adding an unvalidated domain here stalls the apply until ACM times out."
  type        = list(string)

  validation {
    condition     = length(var.custom_domain_aliases) <= 8
    error_message = "ACM allows 10 names per certificate by default; the platform domain and its wildcard use 2. Raise the ACM 'Domain names per ACM certificate' quota in both us-east-1 and the app's Region before adding a ninth alias, then raise this limit."
  }
  default = []
}

variable "cloudfront_log_bucket_domain_name" {
  description = "S3 bucket domain for CloudFront access logs. Empty disables access logging."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Extra tags merged onto everything in this environment."
  type        = map(string)
  default     = {}
}
