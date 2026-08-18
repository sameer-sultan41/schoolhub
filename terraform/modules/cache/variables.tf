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

variable "subnet_ids" {
  description = "Data-tier subnet IDs from the network module."
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) >= 2
    error_message = "A replication group with automatic failover needs at least two subnets in different AZs."
  }
}

variable "security_group_ids" {
  description = "Security groups to attach. Normally just the network module's cache SG."
  type        = list(string)
}

variable "engine_version" {
  description = "Redis major.minor, matching the redis:8-alpine image used in compose."
  type        = string
  default     = "8.0"

  validation {
    condition     = can(regex("^8(\\.|$)", var.engine_version))
    error_message = "SchoolHub targets Redis 8 so that local, CI and production behave identically."
  }
}

variable "node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.micro"
}

variable "replica_count" {
  description = "Read replicas per shard. 0 in staging; at least 1 in production so automatic failover is possible."
  type        = number
  default     = 0

  validation {
    condition     = var.replica_count >= 0 && var.replica_count <= 5
    error_message = "replica_count must be between 0 and 5."
  }
}

variable "maxmemory_policy" {
  description = "Eviction policy. allkeys-lru is correct because Redis holds cache, broker payloads and rate-limit counters — all recomputable. Never noeviction: a full Redis that refuses writes takes the API down with it."
  type        = string
  default     = "allkeys-lru"

  validation {
    condition     = contains(["allkeys-lru", "allkeys-lfu", "volatile-lru", "volatile-ttl"], var.maxmemory_policy)
    error_message = "maxmemory_policy must be an eviction policy, not noeviction."
  }
}

variable "snapshot_retention_days" {
  description = "Snapshot retention. 0 is a deliberate choice, not an oversight: hosting-deployment.md §7 treats Redis as disposable cache. Anything that must survive a Redis loss belongs in PostgreSQL."
  type        = number
  default     = 0
}

variable "maintenance_window" {
  description = "Weekly maintenance window in UTC, ddd:hh24:mi-ddd:hh24:mi."
  type        = string
  default     = "sun:20:00-sun:21:00"
}

variable "alarm_sns_topic_arns" {
  description = "SNS topics notified by this module's CloudWatch alarms."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags merged onto every resource in this module."
  type        = map(string)
  default     = {}
}
