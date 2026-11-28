variable "role_name" {
  description = "The bootstrap deploy role this policy attaches to (schoolhub-gha-deploy-<env>)."
  type        = string

  validation {
    condition     = can(regex("^schoolhub-gha-deploy-(staging|production)$", var.role_name))
    error_message = "role_name must be schoolhub-gha-deploy-staging or schoolhub-gha-deploy-production."
  }
}

variable "region" {
  description = "Region of the environment's ECS cluster and log groups."
  type        = string
}

variable "account_id" {
  description = "AWS account ID that owns the environment."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be 12 digits."
  }
}

variable "cluster_arn" {
  description = "The environment's ECS cluster ARN."
  type        = string
}

variable "cluster_name" {
  description = "The environment's ECS cluster name."
  type        = string
}

variable "service_names" {
  description = "Full ECS service names the deploy may update, listed exactly."
  type        = list(string)

  validation {
    condition     = alltrue([for s in var.service_names : !strcontains(s, "*")])
    error_message = "service_names must be exact names, never wildcards."
  }
}

variable "migrate_task_family" {
  description = "Task definition family of the one-off migrate task; the only family the deploy may run."
  type        = string
}

variable "task_definition_families" {
  description = "Every family the deploy registers revisions for (the services and migrate)."
  type        = list(string)
}

variable "pass_role_arns" {
  description = "Execution and task role ARNs of those families. Never the db-bootstrap roles."
  type        = list(string)
}

variable "log_group_names" {
  description = "Log groups the deploy reads (rollout stopped reasons, migrate exit lines)."
  type        = list(string)
}

variable "distribution_arn" {
  description = "The environment's CloudFront distribution ARN."
  type        = string
}
