output "replication_group_id" {
  description = "ElastiCache replication group ID."
  value       = aws_elasticache_replication_group.this.id
}

output "primary_endpoint_address" {
  description = "Writer endpoint. Everything that enqueues Celery work must use this, not the reader."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "reader_endpoint_address" {
  description = "Reader endpoint, or null when no replica exists. Cache reads only."
  value       = try(aws_elasticache_replication_group.this.reader_endpoint_address, null)
}

output "port" {
  description = "Listening port."
  value       = aws_elasticache_replication_group.this.port
}

output "auth_token_secret_arn" {
  description = "Secrets Manager ARN holding the AUTH token. Task definitions reference this ARN; the value itself never appears in a task definition."
  value       = aws_secretsmanager_secret.auth_token.arn
}

output "kms_key_arn" {
  description = "KMS key encrypting the cluster at rest."
  value       = aws_kms_key.cache.arn
}

output "automatic_failover_enabled" {
  description = "Whether the group can fail over on its own. False means a primary loss is a manual incident."
  value       = aws_elasticache_replication_group.this.automatic_failover_enabled
}

output "url_template" {
  description = "rediss:// URL with the token elided. The deploy pipeline substitutes the secret; this output exists so the runbooks can show the shape without leaking the token."
  value       = "rediss://:<auth-token>@${aws_elasticache_replication_group.this.primary_endpoint_address}:${aws_elasticache_replication_group.this.port}/0"
}
