# What the schoolhub-deploy bootstrap mode copies into this GitHub Environment's
# variables (D7). github_environment_variables holds them under their D7 names.

output "ecs_cluster_name" {
  description = "Environment variable ECS_CLUSTER."
  value       = aws_ecs_cluster.this.name
}

output "migrate_task_family" {
  description = "Environment variable MIGRATE_TASK_FAMILY."
  value       = module.migrate.task_definition_family
}

output "private_subnets" {
  description = "Environment variable PRIVATE_SUBNETS (comma-separated)."
  value       = join(",", module.network.private_subnet_ids)
}

output "migrate_security_group_id" {
  description = "Environment variable MIGRATE_SECURITY_GROUP."
  value       = module.network.migrate_security_group_id
}

output "cloudfront_distribution_id" {
  description = "Environment variable CLOUDFRONT_DISTRIBUTION_ID."
  value       = module.cdn.distribution_id
}

output "platform_domain" {
  description = "Environment variable PLATFORM_DOMAIN."
  value       = var.platform_domain
}

output "db_bootstrap_task_family" {
  description = "The db-bootstrap task family; run by a human only (deploy.md), never a GitHub variable."
  value       = module.db_bootstrap.task_definition_family
}

output "github_environment_variables" {
  description = "Every D7 Environment variable this root produces, under its GitHub name."
  value = {
    ECS_CLUSTER                = aws_ecs_cluster.this.name
    MIGRATE_TASK_FAMILY        = module.migrate.task_definition_family
    PRIVATE_SUBNETS            = join(",", module.network.private_subnet_ids)
    MIGRATE_SECURITY_GROUP     = module.network.migrate_security_group_id
    CLOUDFRONT_DISTRIBUTION_ID = module.cdn.distribution_id
    PLATFORM_DOMAIN            = var.platform_domain
  }
}
