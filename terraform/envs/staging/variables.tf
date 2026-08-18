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
