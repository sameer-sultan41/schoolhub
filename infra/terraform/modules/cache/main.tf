# =============================================================================
# modules/cache — ElastiCache for Redis 8.
#
# Redis carries three unrelated workloads on separate logical databases:
#
#   db 0  cache               — page fragments, permission sets, tenant settings
#   db 1  Celery broker       — the notification lanes (emergency/transactional/bulk)
#   db 2  Celery results      — task results and rate-limit counters
#
# All three are recomputable, so this cluster is NOT backed up and its loss is a
# performance incident, not a data incident. The one thing that hurts is losing
# queued Celery messages, which is why tasks are written to be idempotent and
# retriable rather than why we would add snapshots.
#
# Encryption in transit is mandatory: the Celery broker URL carries the auth
# token, and task payloads carry tenant_id — the value the entire RLS boundary
# is keyed on.
#
# Spec: docs/02-architecture/system-architecture.md §2.9
#       docs/02-architecture/hosting-deployment.md §7
# =============================================================================

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

locals {
  tags = merge(var.tags, {
    Environment = var.environment
    Module      = "cache"
  })

  replication_group_id = "${var.name_prefix}-redis"

  # A replication group with more than one node can fail over automatically;
  # a single-node group cannot, and asking for it is an error.
  automatic_failover = var.replica_count > 0
}

resource "aws_kms_key" "cache" {
  description             = "${var.name_prefix} ElastiCache encryption at rest"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  tags = merge(local.tags, { Name = "${var.name_prefix}-redis-kms" })
}

resource "aws_kms_alias" "cache" {
  name          = "alias/${var.name_prefix}-redis"
  target_key_id = aws_kms_key.cache.key_id
}

resource "aws_elasticache_subnet_group" "this" {
  name        = "${var.name_prefix}-redis"
  description = "Data-tier subnets for ${var.name_prefix} Redis"
  subnet_ids  = var.subnet_ids

  tags = local.tags
}

resource "aws_elasticache_parameter_group" "this" {
  name        = "${var.name_prefix}-redis8"
  family      = "redis8"
  description = "SchoolHub Redis 8 parameters"

  parameter {
    name  = "maxmemory-policy"
    value = var.maxmemory_policy
  }

  # Keyspace notifications for expired keys: the API uses them to invalidate
  # dependent cache entries rather than polling.
  parameter {
    name  = "notify-keyspace-events"
    value = "Ex"
  }

  lifecycle {
    create_before_destroy = true
  }

  tags = local.tags
}

# AUTH token. Required whenever transit encryption is on, which it always is.
resource "random_password" "auth_token" {
  length = 64
  # ElastiCache rejects most punctuation in AUTH tokens; alphanumeric at 64
  # characters is well past any brute-force concern.
  special = false
}

resource "aws_secretsmanager_secret" "auth_token" {
  name        = "${var.name_prefix}/redis/auth-token"
  description = "Redis AUTH token. Injected into REDIS_URL and CELERY_BROKER_URL at deploy."
  kms_key_id  = aws_kms_key.cache.arn

  recovery_window_in_days = 7

  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "auth_token" {
  secret_id     = aws_secretsmanager_secret.auth_token.id
  secret_string = random_password.auth_token.result
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = local.replication_group_id
  description          = "SchoolHub ${var.environment} cache, Celery broker and rate limiters"

  engine         = "redis"
  engine_version = var.engine_version
  node_type      = var.node_type
  port           = 6379

  # One shard; replicas exist for failover, not for read scaling. Celery's
  # broker semantics need a single writer.
  num_cache_clusters = var.replica_count + 1

  automatic_failover_enabled = local.automatic_failover
  multi_az_enabled           = local.automatic_failover

  subnet_group_name    = aws_elasticache_subnet_group.this.name
  security_group_ids   = var.security_group_ids
  parameter_group_name = aws_elasticache_parameter_group.this.name

  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.cache.arn
  transit_encryption_enabled = true
  auth_token                 = random_password.auth_token.result
  auth_token_update_strategy = "ROTATE"

  snapshot_retention_limit = var.snapshot_retention_days
  maintenance_window       = var.maintenance_window

  auto_minor_version_upgrade = true
  apply_immediately          = var.environment != "production"

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.slow.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.engine.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "engine-log"
  }

  lifecycle {
    ignore_changes = [
      # Rotated out of band by scripts/rotate-secrets.sh.
      auth_token,
    ]
  }

  tags = merge(local.tags, { Name = local.replication_group_id })
}

resource "aws_cloudwatch_log_group" "slow" {
  name              = "/aws/elasticache/${local.replication_group_id}/slow-log"
  retention_in_days = 14

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "engine" {
  name              = "/aws/elasticache/${local.replication_group_id}/engine-log"
  retention_in_days = 14

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "memory" {
  alarm_name          = "${var.name_prefix}-redis-memory-high"
  alarm_description   = "Database memory usage above 80%. Eviction is about to start discarding cache entries and, worse, queued Celery messages."
  namespace           = "AWS/ElastiCache"
  metric_name         = "DatabaseMemoryUsagePercentage"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = { ReplicationGroupId = aws_elasticache_replication_group.this.id }

  alarm_actions = var.alarm_sns_topic_arns

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "evictions" {
  alarm_name          = "${var.name_prefix}-redis-evictions"
  alarm_description   = "Keys are being evicted. If Celery lanes are backed up at the same time, notifications are being dropped."
  namespace           = "AWS/ElastiCache"
  metric_name         = "Evictions"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = { ReplicationGroupId = aws_elasticache_replication_group.this.id }

  alarm_actions = var.alarm_sns_topic_arns

  tags = local.tags
}
