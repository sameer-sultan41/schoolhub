# =============================================================================
# Remote state for the staging environment.
#
# The bucket is created by hand once, BEFORE the first init — Terraform cannot
# store its state in a bucket it has not created yet. See terraform/README.md
# "Before the first apply".
#
# Requirements on that bucket, all of which matter:
#   * Versioning ON      — the only way back from a truncated or bad state push.
#   * SSE-KMS            — state contains generated passwords in plaintext.
#   * Public access blocked at the account level.
#   * A bucket policy denying s3:DeleteObjectVersion to everyone but the
#     break-glass role, so a compromised CI role cannot erase state history.
#
# State locking uses the S3-native lock file (use_lockfile), not DynamoDB. This
# requires Terraform >= 1.10, which is why required_version below is tighter
# than the >= 1.9 the modules declare.
# =============================================================================

terraform {
  required_version = ">= 1.10"

  backend "s3" {
    bucket = "schoolhub-tfstate-staging"
    key    = "staging/terraform.tfstate"
    region = "us-east-1"

    encrypt      = true
    kms_key_id   = "alias/schoolhub-tfstate"
    use_lockfile = true
  }
}
