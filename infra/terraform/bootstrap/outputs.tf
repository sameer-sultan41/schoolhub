# Each output becomes a GitHub variable under its D7 name; github_variables
# collects them into the one object the schoolhub-deploy bootstrap mode reads.

output "aws_account_id" {
  description = "Repository variable AWS_ACCOUNT_ID."
  value       = local.account_id
}

output "aws_region" {
  description = "Repository variable AWS_REGION."
  value       = var.aws_region
}

output "ecr_registry" {
  description = "Repository variable ECR_REGISTRY, and the env tfvar ecr_registry."
  value       = local.ecr_registry
}

output "ecr_repository_urls" {
  description = "api/dashboard/website to repository URL."
  value       = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}

output "state_bucket_name" {
  description = "Repository variable TF_STATE_BUCKET."
  value       = aws_s3_bucket.tfstate.bucket
}

output "state_kms_key_arn" {
  description = "Repository variable TF_STATE_KMS_KEY_ARN."
  value       = aws_kms_key.tfstate.arn
}

output "deploy_role_arns" {
  description = "Environment variable DEPLOY_ROLE_ARN, per environment."
  value       = { for env, r in aws_iam_role.deploy : env => r.arn }
}

output "plan_role_arns" {
  description = "Repository variables PLAN_ROLE_ARN_STAGING and PLAN_ROLE_ARN_PRODUCTION."
  value       = { for env, r in aws_iam_role.plan : env => r.arn }
}

output "oidc_subject_template" {
  description = "Body for `gh api -X PUT repos/{owner}/{repo}/actions/oidc/customization/sub` (README first run)."
  value = {
    use_default        = false
    include_claim_keys = ["repo", "context", "job_workflow_ref", "workflow_ref"]
  }
}

output "github_variables" {
  description = "Every bootstrap value under its D7 GitHub variable name."
  value = {
    repository = {
      AWS_REGION               = var.aws_region
      AWS_ACCOUNT_ID           = local.account_id
      ECR_REGISTRY             = local.ecr_registry
      PLAN_ROLE_ARN_STAGING    = aws_iam_role.plan["staging"].arn
      PLAN_ROLE_ARN_PRODUCTION = aws_iam_role.plan["production"].arn
      TF_STATE_BUCKET          = aws_s3_bucket.tfstate.bucket
      TF_STATE_KMS_KEY_ARN     = aws_kms_key.tfstate.arn
    }
    environments = {
      for env in local.environments : env => {
        DEPLOY_ROLE_ARN = aws_iam_role.deploy[env].arn
      }
    }
  }
}
