variable "name_prefix" {
  description = "Prefix for every resource name."
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

variable "bucket_name" {
  description = "Globally unique bucket name for tenant uploads. Keys are prefixed tenants/{tenant_id}/ (multi-tenancy.md §3.4)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{2,62}$", var.bucket_name))
    error_message = "bucket_name must be a valid S3 bucket name: lowercase, 3-63 characters."
  }
}

variable "backup_bucket_name" {
  description = "Bucket for database dumps and archive exports. Should live in a different account and region from production (hosting-deployment.md §7); this module only creates it where it is pointed."
  type        = string
}

variable "noncurrent_version_retention_days" {
  description = "How long a superseded object version is kept. This is the undo window for an accidental overwrite or a bad bulk import."
  type        = number
  default     = 90
}

variable "archive_transition_days" {
  description = "Age at which archive/ objects move to Glacier Instant Retrieval. Operational data ages out here per database-architecture.md §5."
  type        = number
  default     = 90
}

variable "backup_retention_days" {
  description = "How long database dumps are kept in the backup bucket. Must be at least the PITR window so the two recovery paths overlap."
  type        = number
  default     = 35

  validation {
    condition     = var.backup_retention_days >= 30
    error_message = "backup_retention_days must be at least 30 to match the PITR window in database-architecture.md §6."
  }
}

variable "enable_object_lock" {
  description = "WORM-protect the backup bucket in COMPLIANCE mode. Ransomware and a mistaken lifecycle rule are the same threat to a backup; this stops both. Must be set at bucket creation — it cannot be turned on later."
  type        = bool
  default     = false
}

variable "object_lock_retention_days" {
  description = "Object Lock retention when enable_object_lock is true. In COMPLIANCE mode nobody, including the account root, can delete inside this window — pick it deliberately."
  type        = number
  default     = 30
}

variable "cors_allowed_origins" {
  description = "Origins permitted to PUT directly to presigned upload URLs. The dashboard and the platform domains only — never \"*\"."
  type        = list(string)
  default     = []

  validation {
    condition     = !contains(var.cors_allowed_origins, "*")
    error_message = "A wildcard CORS origin would let any site drive a user's presigned upload. List the real origins."
  }
}

variable "cloudfront_distribution_arn" {
  description = "CloudFront distribution allowed to read the uploads bucket via OAC. Empty means no CDN read policy is attached yet."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags merged onto every resource in this module."
  type        = map(string)
  default     = {}
}
