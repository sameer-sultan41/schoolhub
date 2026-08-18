variable "name_prefix" {
  description = "Prefix for every resource name, e.g. \"schoolhub-staging\"."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{2,30}$", var.name_prefix))
    error_message = "name_prefix must be lowercase alphanumeric with hyphens, 3-31 characters."
  }
}

variable "environment" {
  description = "Environment name. Used in tags and in guardrail conditionals."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be one of: staging, production."
  }
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC. Must not overlap any other environment — a future VPC peering or TGW attachment is impossible between overlapping ranges."
  type        = string
  default     = "10.20.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block."
  }
}

variable "availability_zone_count" {
  description = "Number of AZs to span. RDS Multi-AZ requires at least 2; 3 is the production default so a single AZ loss still leaves a quorum of app capacity."
  type        = number
  default     = 2

  validation {
    condition     = var.availability_zone_count >= 2 && var.availability_zone_count <= 4
    error_message = "availability_zone_count must be between 2 and 4."
  }
}

variable "single_nat_gateway" {
  description = "Route all private egress through one NAT gateway. Saves roughly USD 33/month per AZ but makes that AZ a single point of failure for outbound traffic. True in staging, false in production."
  type        = bool
  default     = true
}

variable "enable_flow_logs" {
  description = "Send VPC flow logs to CloudWatch. Required in production for incident forensics."
  type        = bool
  default     = false
}

variable "flow_log_retention_days" {
  description = "Retention for the flow log group, in days."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Tags merged onto every resource in this module."
  type        = map(string)
  default     = {}
}
