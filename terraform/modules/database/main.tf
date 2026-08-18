# =============================================================================
# modules/database — RDS PostgreSQL 18, the single system of record.
#
# What this module does NOT create: the application role. That role — the one
# RLS actually binds to — is created by postgres/init/02-app-role.sql, run once
# against the fresh instance as the master user. It must not have BYPASSRLS and
# must not own any table. Terraform provisions the box; the SQL provisions the
# tenant boundary. Do not add a postgresql provider here to "manage roles
# properly": that would put role passwords in Terraform state.
#
# The master password is generated here and stored in Secrets Manager. It is
# marked sensitive but IS present in state — which is why the state bucket is
# encrypted, versioned and access-controlled (terraform/envs/*/backend.tf).
#
# Spec: schoolhub-srd/docs/02-architecture/database-architecture.md §1, §6
#       schoolhub-srd/docs/02-architecture/hosting-deployment.md §7, §9
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
    Module      = "database"
  })

  identifier = "${var.name_prefix}-postgres"

  # 18 is the pinned major; RDS wants the family name, not the full version.
  parameter_group_family = "postgres18"
}

# -----------------------------------------------------------------------------
# Encryption
# -----------------------------------------------------------------------------
resource "aws_kms_key" "database" {
  description             = "${var.name_prefix} RDS encryption at rest"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  tags = merge(local.tags, { Name = "${var.name_prefix}-rds-kms" })
}

resource "aws_kms_alias" "database" {
  name          = "alias/${var.name_prefix}-rds"
  target_key_id = aws_kms_key.database.key_id
}

# -----------------------------------------------------------------------------
# Credentials
# -----------------------------------------------------------------------------
resource "random_password" "master" {
  length  = 40
  special = true
  # Excluded because they terminate a libpq URI or need shell escaping in the
  # runbooks: a password that cannot be pasted into psql gets replaced with a
  # weaker one at 3am.
  override_special = "!#%*_-+=:?"
}

resource "aws_secretsmanager_secret" "master" {
  name        = "${var.name_prefix}/rds/master"
  description = "RDS master credentials. Break-glass and bootstrap only — the application never uses these."
  kms_key_id  = aws_kms_key.database.arn

  # Long enough to notice a mistaken destroy, short enough not to block a
  # rebuild of a torn-down staging environment.
  recovery_window_in_days = 7

  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "master" {
  secret_id = aws_secretsmanager_secret.master.id

  secret_string = jsonencode({
    username = var.master_username
    password = random_password.master.result
    engine   = "postgres"
    host     = aws_db_instance.this.address
    port     = aws_db_instance.this.port
    dbname   = var.database_name
  })
}

# -----------------------------------------------------------------------------
# Placement
# -----------------------------------------------------------------------------
resource "aws_db_subnet_group" "this" {
  name        = "${var.name_prefix}-postgres"
  description = "Data-tier subnets for ${var.name_prefix}"
  subnet_ids  = var.subnet_ids

  tags = local.tags
}

# -----------------------------------------------------------------------------
# Parameters
# -----------------------------------------------------------------------------
resource "aws_db_parameter_group" "this" {
  name        = "${var.name_prefix}-postgres18"
  family      = local.parameter_group_family
  description = "SchoolHub PostgreSQL 18 tuning"

  # pg_stat_statements feeds the slow-query dashboard and the quarterly
  # unused-index review (database-architecture.md §7).
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }

  parameter {
    name  = "log_lock_waits"
    value = "1"
  }

  parameter {
    name  = "log_temp_files"
    value = "0"
  }

  # Money and enrollment invariants rely on explicit row locks inside short
  # transactions (database-architecture.md §4). A transaction idling with locks
  # held is a bug; kill it rather than let it block collections.
  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "60000"
  }

  parameter {
    name  = "statement_timeout"
    value = "60000"
  }

  # Every timestamp is timestamptz stored in UTC; presentation applies the
  # tenant timezone (database-architecture.md §2).
  parameter {
    name  = "timezone"
    value = "UTC"
  }

  lifecycle {
    create_before_destroy = true
  }

  tags = local.tags
}

# -----------------------------------------------------------------------------
# Enhanced monitoring role
# -----------------------------------------------------------------------------
resource "aws_iam_role" "monitoring" {
  count = var.monitoring_interval_seconds > 0 ? 1 : 0

  name = "${var.name_prefix}-rds-monitoring"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  count = var.monitoring_interval_seconds > 0 ? 1 : 0

  role       = aws_iam_role.monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# -----------------------------------------------------------------------------
# The instance
# -----------------------------------------------------------------------------
resource "aws_db_instance" "this" {
  identifier = local.identifier

  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  # Minor versions are applied in the maintenance window, majors never
  # automatically: a major upgrade changes planner behavior and must be
  # rehearsed on staging first (hosting-deployment.md §6).
  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false

  storage_type          = "gp3"
  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.database.arn

  db_name  = var.database_name
  username = var.master_username
  password = random_password.master.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = var.security_group_ids
  parameter_group_name   = aws_db_parameter_group.this.name

  # No public address, ever. Access is from the app tier or through the SSM
  # bastion; there is no path from the internet to this instance.
  publicly_accessible = false

  multi_az = var.multi_az

  # Continuous WAL archiving + daily base backups, giving PITR anywhere in the
  # retention window. RPO target is 5 minutes (hosting-deployment.md §9).
  backup_retention_period   = var.backup_retention_days
  backup_window             = var.backup_window
  copy_tags_to_snapshot     = true
  maintenance_window        = var.maintenance_window
  delete_automated_backups  = false
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.identifier}-final-${formatdate("YYYYMMDDhhmmss", timestamp())}"

  deletion_protection = var.deletion_protection

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.database.arn
  performance_insights_retention_period = var.performance_insights_retention_days

  monitoring_interval = var.monitoring_interval_seconds
  monitoring_role_arn = var.monitoring_interval_seconds > 0 ? aws_iam_role.monitoring[0].arn : null

  # IAM auth is enabled so operators can get a short-lived token for break-glass
  # psql instead of passing the master password around.
  iam_database_authentication_enabled = true

  apply_immediately = var.environment != "production"

  lifecycle {
    ignore_changes = [
      # Recomputed on every plan by design; without this every plan is dirty.
      final_snapshot_identifier,
      # Rotated out of band by scripts/rotate-secrets.sh, not by Terraform.
      password,
    ]
  }

  tags = merge(local.tags, { Name = local.identifier })
}

# -----------------------------------------------------------------------------
# Alarms
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "postgresql" {
  name              = "/aws/rds/instance/${local.identifier}/postgresql"
  retention_in_days = var.log_retention_days

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "cpu" {
  alarm_name          = "${var.name_prefix}-rds-cpu-high"
  alarm_description   = "RDS CPU sustained above 80%. Usually an unindexed query on a large tenant table."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = { DBInstanceIdentifier = aws_db_instance.this.identifier }

  alarm_actions = var.alarm_sns_topic_arns
  ok_actions    = var.alarm_sns_topic_arns

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "storage" {
  alarm_name          = "${var.name_prefix}-rds-storage-low"
  alarm_description   = "Less than 10 GiB free. Storage autoscaling should absorb this; if it does not, the database goes read-only."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 10737418240
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = { DBInstanceIdentifier = aws_db_instance.this.identifier }

  alarm_actions = var.alarm_sns_topic_arns

  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "connections" {
  alarm_name          = "${var.name_prefix}-rds-connections-high"
  alarm_description   = "Connection count high. With PgBouncer in front this should be flat — a spike means something is connecting around the pooler."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 160
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = { DBInstanceIdentifier = aws_db_instance.this.identifier }

  alarm_actions = var.alarm_sns_topic_arns

  tags = local.tags
}
