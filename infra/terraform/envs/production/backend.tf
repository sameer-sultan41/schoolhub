# =============================================================================
# Remote state for production.
#
# Separate bucket, separate KMS key and — strongly recommended — a separate AWS
# account from staging. Shared state storage means a staging mistake can reach
# production state, and state IS production: whoever can write it can redirect
# the next apply anywhere.
#
# The bucket is created by hand before the first init. Requirements:
#   * Versioning ON, MFA delete ON.
#   * SSE-KMS with a key whose policy names the apply role explicitly.
#   * A bucket policy denying s3:DeleteObjectVersion to every principal except
#     the break-glass role.
#   * Access logging to the audit bucket.
#
# use_lockfile needs Terraform >= 1.10, hence the tighter required_version.
# =============================================================================

terraform {
  required_version = ">= 1.10"

  backend "s3" {
    bucket = "schoolhub-tfstate-production"
    key    = "production/terraform.tfstate"
    region = "us-east-1"

    encrypt      = true
    kms_key_id   = "alias/schoolhub-tfstate-production"
    use_lockfile = true

    # The CI plan job assumes a read-only role; apply assumes this one, and only
    # from the protected GitHub environment behind the manual approval gate
    # (hosting-deployment.md §3).
    # role_arn = "arn:aws:iam::123456789012:role/schoolhub-terraform-apply"
  }
}
