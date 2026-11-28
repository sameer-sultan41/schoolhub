variable "aws_region" {
  description = "Region everything except the CloudFront certificate lives in."
  type        = string
  default     = "us-east-1"
}

variable "platform_domain" {
  description = "Staging platform domain. Tenant sites are <slug>.staging.<domain>."
  type        = string
  default     = "staging.schoolhub.example"
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
  description = "Route 53 hosted zone ID for platform_domain. Created out of band; see terraform/README.md."
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR. Must not overlap production — a future peering between them is impossible if they do."
  type        = string
  default     = "10.20.0.0/16"
}

variable "api_image" {
  description = "Django API image, tagged with the git SHA. CI overrides this per deploy; the value here is only the bootstrap."
  type        = string
}

variable "dashboard_image" {
  description = "Next.js dashboard image, tagged with the git SHA."
  type        = string
}

variable "website_image" {
  description = "Next.js tenant website renderer image, tagged with the git SHA."
  type        = string
}

variable "uploads_bucket_name" {
  description = "Globally unique name for the tenant uploads bucket."
  type        = string
  default     = "schoolhub-staging-uploads"
}

variable "backup_bucket_name" {
  description = "Globally unique name for the backup bucket."
  type        = string
  default     = "schoolhub-staging-backups"
}

variable "django_secret_key_arn" {
  description = "Secrets Manager ARN holding DJANGO_SECRET_KEY. The secret is created out of band by scripts/rotate-secrets.sh; only its ARN belongs in Terraform."
  type        = string
}

variable "integrations_encryption_keys_arn" {
  description = "Secrets Manager ARN holding INTEGRATIONS_ENCRYPTION_KEYS: comma-separated Fernet keys, newest first, that encrypt each school's payment-gateway credentials. See infra/runbooks/rotate-integration-credentials.md."
  type        = string
}

variable "app_database_url_arn" {
  description = "Secrets Manager ARN holding the application DATABASE_URL — the schoolhub_app role, through PgBouncer. Never the master URL."
  type        = string
}

variable "sentry_dsn_arn" {
  description = "Secrets Manager ARN holding the Sentry DSN for the staging project."
  type        = string
  default     = ""
}

variable "alarm_sns_topic_arns" {
  description = "SNS topics for CloudWatch alarms. Staging alarms notify a channel; they do not page."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Extra tags merged onto everything in this environment."
  type        = map(string)
  default     = {}
}
