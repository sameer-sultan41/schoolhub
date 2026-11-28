# =============================================================================
# One repository per image, shared by both environments: the image staging ran
# is promoted to production unchanged (infra/AGENTS.md rule 5, D5).
# =============================================================================

resource "aws_ecr_repository" "this" {
  for_each = local.ecr_repositories

  name                 = "schoolhub/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  encryption_configuration {
    encryption_type = "AES256"
  }

  # The registry-level configuration below governs once applied; this keeps
  # each repository safe on its own too (trivy AWS-0030).
  image_scanning_configuration {
    scan_on_push = true
  }
}

# Age-based, never count-based: a count rule would expire production's running
# image after enough staging builds. The deploy warns from 300 days (D5).
resource "aws_ecr_lifecycle_policy" "this" {
  for_each = aws_ecr_repository.this

  repository = each.value.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = var.ecr_untagged_max_age_days
        }
        action = { type = "expire" }
      },
      {
        # Every tag is a full git SHA (D8), so * selects exactly the SHA tags.
        rulePriority = 2
        description  = "Expire SHA-tagged images by age"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["*"]
          countType      = "sinceImagePushed"
          countUnit      = "days"
          countNumber    = var.ecr_sha_tag_max_age_days
        }
        action = { type = "expire" }
      },
    ]
  })
}

# Scanning is set for the whole registry; it overrides the per-repository flag.
resource "aws_ecr_registry_scanning_configuration" "this" {
  scan_type = "BASIC"

  rule {
    scan_frequency = "SCAN_ON_PUSH"

    repository_filter {
      filter      = "schoolhub/*"
      filter_type = "WILDCARD"
    }
  }
}
