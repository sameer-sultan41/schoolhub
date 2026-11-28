# =============================================================================
# Remote state for staging: the shared bootstrap bucket, key
# schoolhub/staging/terraform.tfstate (D4, D6 in the deploy pipeline plan).
#
# A backend block cannot read variables, and the bucket name carries the account
# ID, so bucket, region, key and KMS key are passed at init (D19):
#
#   terraform init \
#     -backend-config="bucket=$TF_STATE_BUCKET" \
#     -backend-config="region=$AWS_REGION" \
#     -backend-config="key=schoolhub/staging/terraform.tfstate" \
#     -backend-config="kms_key_id=$TF_STATE_KMS_KEY_ARN"
#
# The bucket (versioned, SSE-KMS, history-erasure deny) is created by
# infra/terraform/bootstrap. Locking is the S3 lock file (use_lockfile), no
# DynamoDB table; S3 native locking is GA from Terraform 1.11.
# =============================================================================

terraform {
  required_version = ">= 1.11"

  backend "s3" {
    encrypt      = true
    use_lockfile = true
    # bucket, region, key and kms_key_id come from -backend-config (D6, D19)
  }
}
