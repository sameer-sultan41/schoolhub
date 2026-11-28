provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "schoolhub"
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  environments = toset(["staging", "production"])
  other_env    = { staging = "production", production = "staging" }

  account_id = data.aws_caller_identity.current.account_id
  region     = var.aws_region

  # Bucket names are global; the account ID makes this one unique.
  state_bucket     = "schoolhub-tfstate-${local.account_id}"
  state_bucket_arn = "arn:aws:s3:::${local.state_bucket}"

  state_key        = { for env in local.environments : env => "schoolhub/${env}/terraform.tfstate" }
  deploy_role_name = { for env in local.environments : env => "schoolhub-gha-deploy-${env}" }
  plan_role_name   = { for env in local.environments : env => "schoolhub-gha-plan-${env}" }
  # Matches local.name_prefix in envs/*/main.tf.
  env_prefix = { for env in local.environments : env => "schoolhub-${env}" }

  ecr_repositories = toset(["api", "dashboard", "website"])
  ecr_registry     = "${local.account_id}.dkr.ecr.${local.region}.amazonaws.com"

  oidc_provider_arn = (
    var.create_oidc_provider
    ? aws_iam_openid_connect_provider.github[0].arn
    : data.aws_iam_openid_connect_provider.github[0].arn
  )
}
