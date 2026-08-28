variable "aws_region" {
  description = "Region everything except the CloudFront certificate lives in."
  type        = string
  default     = "us-east-1"
}

variable "platform_domain" {
  description = "Production platform domain. Tenant sites are <slug>.<domain>; verified custom domains also point here."
  type        = string
  default     = "schoolhub.example"
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

variable "api_image" {
  description = "Django API image tagged with the git SHA. This is the SAME image that was verified in staging — production never rebuilds (hosting-deployment.md §3)."
  type        = string
}

variable "dashboard_image" {
  description = "Next.js dashboard image, promoted from staging by tag."
  type        = string
}

variable "website_image" {
  description = "Next.js tenant website renderer image, promoted from staging by tag."
  type        = string
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

variable "app_database_url_arn" {
  description = "Secrets Manager ARN holding the application DATABASE_URL — schoolhub_app through PgBouncer. Never the master URL."
  type        = string
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
  description = "Verified tenant custom domains on the distribution. Appended by the onboarding pipeline after DNS validation — see runbooks/custom-domain-onboarding.md. Adding an unvalidated domain here stalls the apply until ACM times out."
  type        = list(string)
  default     = []
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
