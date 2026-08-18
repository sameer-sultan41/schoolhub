# =============================================================================
# modules/storage — S3 buckets for tenant uploads and for backups.
#
# Two buckets, because they have opposite threat models:
#
#   uploads  — written constantly by the application, read through CloudFront
#              and presigned URLs. Versioned so a bad bulk import is undoable.
#   backups  — written by scripts/backup.sh, read only during a restore.
#              Optionally WORM-locked. The application's task role has NO access
#              to this bucket: an application compromise must not be able to
#              delete the backups that recover from it.
#
# Tenant isolation in object storage is by key prefix — tenants/{tenant_id}/…
# — enforced at the application layer through tenant-checked signed URLs. There
# is no bucket-policy equivalent of RLS, so the prefix convention is load-
# bearing and must be asserted in tests, not just in review.
#
# Spec: schoolhub-srd/docs/02-architecture/multi-tenancy.md §3.4
#       schoolhub-srd/docs/02-architecture/hosting-deployment.md §7
# =============================================================================

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

locals {
  tags = merge(var.tags, {
    Environment = var.environment
    Module      = "storage"
  })
}

resource "aws_kms_key" "storage" {
  description             = "${var.name_prefix} S3 encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  tags = merge(local.tags, { Name = "${var.name_prefix}-s3-kms" })
}

resource "aws_kms_alias" "storage" {
  name          = "alias/${var.name_prefix}-s3"
  target_key_id = aws_kms_key.storage.key_id
}

# -----------------------------------------------------------------------------
# Uploads bucket
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "uploads" {
  bucket = var.bucket_name

  tags = merge(local.tags, { Name = var.bucket_name, Purpose = "tenant-uploads" })
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    # ACLs off entirely. Every access decision is a bucket policy or a presigned
    # URL; per-object ACLs are the classic way a "private" file becomes public.
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.storage.arn
    }
    # Without this, every GET is a separate KMS call: same security, materially
    # higher bill and latency on a page that renders 30 student photos.
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_retention_days
    }
  }

  rule {
    id     = "archive-to-glacier"
    status = "Enabled"

    filter {
      # Written by the retention jobs in database-architecture.md §5.
      prefix = "archive/"
    }

    transition {
      days          = var.archive_transition_days
      storage_class = "GLACIER_IR"
    }
  }

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "uploads" {
  count = length(var.cors_allowed_origins) > 0 ? 1 : 0

  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = var.cors_allowed_origins
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

data "aws_iam_policy_document" "uploads" {
  # Reject any request that is not TLS. Presigned URLs are handed to browsers;
  # a plaintext one leaks the signature to anything on the path.
  #
  # Actions are enumerated rather than wildcarded (repo convention). Keep this
  # list a superset of every action any principal can perform on this bucket —
  # if a new action is granted anywhere, add it here in the same change.
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:GetObjectAttributes",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
      "s3:ListBucket",
      "s3:ListBucketVersions",
      "s3:ListBucketMultipartUploads",
      "s3:GetBucketLocation",
      "s3:GetBucketPolicy",
      "s3:PutBucketPolicy",
    ]

    resources = [
      aws_s3_bucket.uploads.arn,
      "${aws_s3_bucket.uploads.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  # CloudFront reads through Origin Access Control, scoped to this one
  # distribution, so the bucket stays private while the CDN serves from it.
  dynamic "statement" {
    for_each = var.cloudfront_distribution_arn != "" ? [1] : []

    content {
      sid     = "AllowCloudFrontRead"
      effect  = "Allow"
      actions = ["s3:GetObject"]

      resources = ["${aws_s3_bucket.uploads.arn}/*"]

      principals {
        type        = "Service"
        identifiers = ["cloudfront.amazonaws.com"]
      }

      condition {
        test     = "StringEquals"
        variable = "AWS:SourceArn"
        values   = [var.cloudfront_distribution_arn]
      }
    }
  }
}

resource "aws_s3_bucket_policy" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  policy = data.aws_iam_policy_document.uploads.json

  depends_on = [aws_s3_bucket_public_access_block.uploads]
}

# -----------------------------------------------------------------------------
# Backup bucket
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "backups" {
  bucket = var.backup_bucket_name

  # Object Lock cannot be enabled after creation. Flipping this variable on an
  # existing bucket forces a replacement — which is why it is a create-time
  # decision recorded here rather than a runtime toggle.
  object_lock_enabled = var.enable_object_lock

  tags = merge(local.tags, { Name = var.backup_bucket_name, Purpose = "backups" })
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket = aws_s3_bucket.backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.storage.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_object_lock_configuration" "backups" {
  count = var.enable_object_lock ? 1 : 0

  bucket = aws_s3_bucket.backups.id

  rule {
    default_retention {
      # COMPLIANCE, not GOVERNANCE: an attacker with the credentials to delete
      # backups usually also has the credentials to bypass GOVERNANCE.
      mode = "COMPLIANCE"
      days = var.object_lock_retention_days
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire-dumps"
    status = "Enabled"

    filter {
      prefix = "postgres/"
    }

    transition {
      days          = 7
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = var.backup_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

data "aws_iam_policy_document" "backups" {
  # Enumerated, not wildcarded — see the note on the uploads bucket policy.
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:GetObjectAttributes",
      "s3:GetObjectRetention",
      "s3:PutObject",
      "s3:PutObjectRetention",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
      "s3:ListBucket",
      "s3:ListBucketVersions",
      "s3:GetBucketLocation",
      "s3:GetBucketPolicy",
      "s3:PutBucketPolicy",
    ]

    resources = [
      aws_s3_bucket.backups.arn,
      "${aws_s3_bucket.backups.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "backups" {
  bucket = aws_s3_bucket.backups.id
  policy = data.aws_iam_policy_document.backups.json

  depends_on = [aws_s3_bucket_public_access_block.backups]
}

# -----------------------------------------------------------------------------
# The policy attached to the application's ECS task role.
#
# Scoped to the uploads bucket only. Note what is absent: s3:DeleteBucket,
# anything on the backups bucket, and any KMS permission beyond using the key.
# -----------------------------------------------------------------------------
data "aws_iam_policy_document" "app_access" {
  statement {
    sid    = "ListUploadsBucket"
    effect = "Allow"

    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.uploads.arn]
  }

  statement {
    sid    = "ReadWriteTenantObjects"
    effect = "Allow"

    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
    ]

    # tenants/* and archive/* only. The application has no reason to touch keys
    # outside a tenant prefix, and a bug that tries to should fail loudly.
    resources = [
      "${aws_s3_bucket.uploads.arn}/tenants/*",
      "${aws_s3_bucket.uploads.arn}/archive/*",
    ]
  }

  statement {
    sid    = "UseStorageKey"
    effect = "Allow"

    actions = [
      "kms:Decrypt",
      "kms:Encrypt",
      "kms:GenerateDataKey",
      "kms:DescribeKey",
    ]

    resources = [aws_kms_key.storage.arn]
  }
}

resource "aws_iam_policy" "app_access" {
  name        = "${var.name_prefix}-s3-app-access"
  description = "Least-privilege access to the uploads bucket for ECS tasks. Deliberately grants nothing on the backups bucket."
  policy      = data.aws_iam_policy_document.app_access.json

  tags = local.tags
}
