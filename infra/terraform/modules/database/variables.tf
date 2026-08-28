variable "name_prefix" {
  description = "Prefix for every resource name, e.g. \"schoolhub-production\"."
  type        = string
}

variable "environment" {
  description = "Environment name."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be one of: staging, production."
  }
}

variable "subnet_ids" {
  description = "Data-tier subnet IDs from the network module. Must span at least two AZs."
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) >= 2
    error_message = "RDS requires a subnet group spanning at least two availability zones."
  }
}

variable "security_group_ids" {
  description = "Security groups to attach. Normally just the network module's database SG."
  type        = list(string)
}

variable "engine_version" {
  description = "PostgreSQL major.minor. Pinned so a provider upgrade cannot silently move the engine. Dev, CI and production must share the major version — RLS and planner behavior are what the test suite asserts."
  type        = string
  default     = "18.0"

  validation {
    condition     = can(regex("^18(\\.|$)", var.engine_version))
    error_message = "SchoolHub targets PostgreSQL 18. Changing the major version is a migration project, not a variable change."
  }
}

variable "instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "allocated_storage_gb" {
  description = "Initial gp3 storage in GiB."
  type        = number
  default     = 50
}

variable "max_allocated_storage_gb" {
  description = "Storage autoscaling ceiling in GiB. Set well above the expected working set: hitting the ceiling makes the database read-only."
  type        = number
  default     = 500
}

variable "multi_az" {
  description = "Synchronous standby in a second AZ. Required in production; the RTO target of 4 hours in hosting-deployment.md §9 assumes it."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Automated backup retention. The spec calls for a PITR window of at least 30 days (database-architecture.md §6); RDS caps automated retention at 35."
  type        = number
  default     = 30

  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 7 and 35."
  }
}

variable "backup_window" {
  description = "Daily backup window in UTC, hh24:mi-hh24:mi. Pick the tenant-quietest hour."
  type        = string
  default     = "17:30-18:00"
}

variable "maintenance_window" {
  description = "Weekly maintenance window in UTC, ddd:hh24:mi-ddd:hh24:mi. Must not overlap backup_window."
  type        = string
  default     = "sun:19:00-sun:20:00"
}

variable "deletion_protection" {
  description = "Refuse to delete the instance. True in every environment that holds data anyone would miss."
  type        = bool
  default     = true
}

variable "performance_insights_retention_days" {
  description = "Performance Insights retention. 7 is the free tier; 465 is the long-retention tier."
  type        = number
  default     = 7
}

variable "monitoring_interval_seconds" {
  description = "Enhanced monitoring granularity. 0 disables it."
  type        = number
  default     = 60
}

variable "database_name" {
  description = "Initial database name."
  type        = string
  default     = "schoolhub"
}

variable "master_username" {
  description = "Master user. This is the bootstrap superuser-equivalent, NOT the application role. Application traffic connects as schoolhub_app, which has no BYPASSRLS and owns no tables — see postgres/init/02-app-role.sql."
  type        = string
  default     = "schoolhub_admin"

  validation {
    condition     = !contains(["schoolhub_app", "schoolhub_readonly"], var.master_username)
    error_message = "The master user must never be the application or reporting role. RLS does not bind to rds_superuser."
  }
}

variable "log_retention_days" {
  description = "CloudWatch retention for exported PostgreSQL logs."
  type        = number
  default     = 30
}

variable "alarm_sns_topic_arns" {
  description = "SNS topics notified by the CloudWatch alarms this module creates. Empty means alarms exist but page nobody."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags merged onto every resource in this module."
  type        = map(string)
  default     = {}
}
