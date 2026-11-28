# =============================================================================
# Bootstrap root: everything that must exist before an environment can be
# planned (state bucket, GitHub OIDC, CI roles, ECR).
#
# No backend block: a human applies this once with local state, then moves it
# into the state bucket it created (README.md, plan D6/D19).
# =============================================================================

terraform {
  # S3 native locking (use_lockfile) is GA from 1.11.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
