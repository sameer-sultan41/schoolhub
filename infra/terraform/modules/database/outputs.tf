output "instance_identifier" {
  description = "RDS instance identifier. Used by scripts/backup.sh and scripts/restore.sh."
  value       = aws_db_instance.this.identifier
}

output "instance_arn" {
  description = "ARN of the instance."
  value       = aws_db_instance.this.arn
}

output "endpoint" {
  description = "host:port of the writer endpoint."
  value       = aws_db_instance.this.endpoint
}

output "address" {
  description = "Hostname only. This is what PgBouncer's [databases] section points at."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "Listening port."
  value       = aws_db_instance.this.port
}

output "database_name" {
  description = "Initial database name."
  value       = aws_db_instance.this.db_name
}

output "master_secret_arn" {
  description = "Secrets Manager ARN holding the master credentials. Bootstrap and break-glass only — application tasks are never granted read on this."
  value       = aws_secretsmanager_secret.master.arn
}

output "kms_key_arn" {
  description = "KMS key encrypting storage, snapshots and Performance Insights. A cross-region restore needs a grant on this key."
  value       = aws_kms_key.database.arn
}

output "subnet_group_name" {
  description = "DB subnet group. A PITR restore into a scratch instance must reuse it to stay off the internet."
  value       = aws_db_subnet_group.this.name
}

output "parameter_group_name" {
  description = "Parameter group. Restores must attach the same one or timeouts and logging silently differ."
  value       = aws_db_parameter_group.this.name
}

output "multi_az" {
  description = "Whether a synchronous standby exists. The DR runbook branches on this."
  value       = aws_db_instance.this.multi_az
}

output "backup_retention_days" {
  description = "Effective PITR window in days."
  value       = aws_db_instance.this.backup_retention_period
}
