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

variable "service_name" {
  description = "Short service name: api, celery-worker, celery-beat, dashboard, website."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,31}$", var.service_name))
    error_message = "service_name must be lowercase alphanumeric with hyphens."
  }
}

variable "cluster_arn" {
  description = "ECS cluster to run in."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs. Tasks never run in a public subnet."
  type        = list(string)
}

variable "security_group_ids" {
  description = "Security groups for the task ENI. Normally the network module's app SG."
  type        = list(string)
}

variable "image" {
  description = "Fully qualified image reference, tagged with the git SHA. The same immutable image is promoted staging -> production; nothing is rebuilt between environments (hosting-deployment.md §3)."
  type        = string

  validation {
    condition     = !can(regex(":latest$", var.image))
    error_message = "Never deploy :latest. A rollback needs an immutable tag to roll back to."
  }
}

variable "command" {
  description = "Container command override. Empty uses the image's own CMD."
  type        = list(string)
  default     = []
}

variable "cpu" {
  description = "Fargate task CPU units. 256 = 0.25 vCPU."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Fargate task memory in MiB. Must be a valid pairing with cpu."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Baseline task count. MUST be 1 for celery-beat: a second scheduler double-fires every periodic job, which means duplicate invoices and duplicate notifications."
  type        = number
  default     = 2
}

variable "container_port" {
  description = "Port the container listens on. Ignored when expose_via_alb is false."
  type        = number
  default     = 8000
}

variable "expose_via_alb" {
  description = "Register with a load balancer. False for celery-worker and celery-beat, which take no inbound traffic."
  type        = bool
  default     = true
}

variable "listener_arn" {
  description = "HTTPS listener to attach the routing rule to. Required when expose_via_alb is true."
  type        = string
  default     = ""
}

variable "listener_rule_priority" {
  description = "Rule priority on the listener. Must be unique per listener; lower wins. The wildcard tenant-website rule must sort AFTER the specific app/api hosts."
  type        = number
  default     = 100
}

variable "host_headers" {
  description = "Host header patterns routed to this service, e.g. [\"app.example.com\"] or [\"*.example.com\"] for the tenant website renderer."
  type        = list(string)
  default     = []
}

variable "vpc_id" {
  description = "VPC the target group lives in. Required when expose_via_alb is true."
  type        = string
  default     = ""
}

variable "health_check_path" {
  description = "HTTP path for the ALB health check. Must not touch the database: a health check that queries Postgres turns a slow query into a full outage by failing every task at once."
  type        = string
  default     = "/healthz"
}

variable "environment_variables" {
  description = "Non-secret environment variables. Anything sensitive goes in secret_arns instead — plain env vars are visible in the task definition to anyone with ecs:DescribeTaskDefinition."
  type        = map(string)
  default     = {}
}

variable "secret_arns" {
  description = "Map of environment variable name to Secrets Manager or SSM ARN. Injected by the agent at task start; the value never appears in the task definition."
  type        = map(string)
  default     = {}
}

variable "task_role_policy_arns" {
  description = "IAM policies attached to the task role — what the application itself may do (S3, SES, Bedrock)."
  type        = list(string)
  default     = []
}

variable "enable_autoscaling" {
  description = "Attach target-tracking autoscaling. Leave false for celery-beat."
  type        = bool
  default     = true
}

variable "min_capacity" {
  description = "Autoscaling floor."
  type        = number
  default     = 2
}

variable "max_capacity" {
  description = "Autoscaling ceiling. A ceiling also caps the blast radius of a runaway scaling loop on the bill."
  type        = number
  default     = 10
}

variable "autoscaling_cpu_target" {
  description = "Target average CPU percentage for target-tracking."
  type        = number
  default     = 60
}

variable "log_retention_days" {
  description = "CloudWatch log retention for this service."
  type        = number
  default     = 30
}

variable "deployment_circuit_breaker" {
  description = "Roll back automatically when a deployment fails to stabilize. This is the safety net under the deploy runbook."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags merged onto every resource in this module."
  type        = map(string)
  default     = {}
}
