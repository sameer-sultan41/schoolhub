output "uploads_bucket_name" {
  description = "Tenant uploads bucket. Goes into S3_BUCKET_NAME."
  value       = aws_s3_bucket.uploads.id
}

output "uploads_bucket_arn" {
  description = "ARN of the uploads bucket."
  value       = aws_s3_bucket.uploads.arn
}

output "uploads_bucket_regional_domain_name" {
  description = "Regional domain name. This is the CloudFront origin — the non-regional form causes redirects on newly created buckets."
  value       = aws_s3_bucket.uploads.bucket_regional_domain_name
}

output "backups_bucket_name" {
  description = "Backup bucket. Used by scripts/backup.sh and scripts/restore.sh."
  value       = aws_s3_bucket.backups.id
}

output "backups_bucket_arn" {
  description = "ARN of the backup bucket."
  value       = aws_s3_bucket.backups.arn
}

output "object_lock_enabled" {
  description = "Whether backups are WORM-protected. The DR drill runbook asserts this in production."
  value       = var.enable_object_lock
}

output "kms_key_arn" {
  description = "KMS key encrypting both buckets. A cross-account backup copy needs a grant on this key."
  value       = aws_kms_key.storage.arn
}

output "app_access_policy_arn" {
  description = "IAM policy to attach to the ECS task role. Grants uploads-bucket access and nothing on backups."
  value       = aws_iam_policy.app_access.arn
}
