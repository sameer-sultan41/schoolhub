variable "aws_region" {
  description = "Region for the state bucket, ECR and every environment. A region near Pakistan (ADR-0040, D20); widening the list is a reviewed change, not a tfvars edit."
  type        = string

  validation {
    condition     = contains(["me-central-1", "ap-south-1"], var.aws_region)
    error_message = "aws_region must be me-central-1 or ap-south-1."
  }
}

variable "github_oidc_subject_prefix" {
  description = "Exact OIDC sub prefix for this repository: repo:<owner>/<repo>, or the immutable repo:<owner>@<id>/<repo>@<id> form for repositories created after 15 July 2026. Read it with `gh api repos/{owner}/{repo}/actions/oidc/customization/sub`."
  type        = string

  validation {
    condition     = can(regex("^repo:[^:*?]+$", var.github_oidc_subject_prefix))
    error_message = "github_oidc_subject_prefix must be repo:<owner>/<repo> (or the immutable form) with no wildcards and no further colons."
  }
}

variable "github_repository" {
  description = "<owner>/<repo>, the path inside job_workflow_ref (names, even when the subject prefix uses immutable IDs)."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must be <owner>/<repo>."
  }
}

variable "ecr_sha_tag_max_age_days" {
  description = "Days after push when a SHA-tagged image expires. Must exceed the deploy's 300-day staleness warning by a month."
  type        = number
  default     = 365

  validation {
    condition     = var.ecr_sha_tag_max_age_days >= 330
    error_message = "ecr_sha_tag_max_age_days must be at least 330 (the deploy warns at 300 days)."
  }
}

variable "ecr_untagged_max_age_days" {
  description = "Days after push when an untagged image expires."
  type        = number
  default     = 7

  validation {
    condition     = var.ecr_untagged_max_age_days >= 1
    error_message = "ecr_untagged_max_age_days must be at least 1."
  }
}

variable "state_admin_principal_arns" {
  description = "Human admin principal ARNs exempt from the state bucket's history-erasure deny. Wildcards follow ArnLike rules."
  type        = list(string)

  validation {
    condition     = length(var.state_admin_principal_arns) >= 1
    error_message = "At least one admin principal is required, or nobody can manage the state bucket's versioning."
  }
}

variable "create_oidc_provider" {
  description = "Create the GitHub OIDC provider. An account allows one provider per URL; set false when it already exists, and it is read instead."
  type        = bool
  default     = true
}
