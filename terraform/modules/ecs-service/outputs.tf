output "service_name" {
  description = "Full ECS service name. Used by the deploy and rollback runbooks."
  value       = aws_ecs_service.this.name
}

output "service_arn" {
  description = "ARN of the ECS service."
  value       = aws_ecs_service.this.id
}

output "task_definition_arn" {
  description = "ARN of the task definition Terraform created. CI registers new revisions from this family; the running revision is deliberately not managed here."
  value       = aws_ecs_task_definition.this.arn
}

output "task_definition_family" {
  description = "Task definition family. `aws ecs describe-task-definition --task-definition <family>` resolves the current revision."
  value       = aws_ecs_task_definition.this.family
}

output "task_role_arn" {
  description = "Task role. Attach further least-privilege policies to this, never to the execution role."
  value       = aws_iam_role.task.arn
}

output "task_role_name" {
  description = "Task role name, for aws_iam_role_policy_attachment in the calling environment."
  value       = aws_iam_role.task.name
}

output "execution_role_arn" {
  description = "Execution role used by the ECS agent to pull images and read injected secrets."
  value       = aws_iam_role.execution.arn
}

output "target_group_arn" {
  description = "ALB target group ARN, or null for services that take no inbound traffic."
  value       = try(aws_lb_target_group.this[0].arn, null)
}

output "log_group_name" {
  description = "CloudWatch log group. The incident runbook starts here."
  value       = aws_cloudwatch_log_group.this.name
}

output "desired_count" {
  description = "Effective baseline task count after the celery-beat singleton guard."
  value       = local.effective_desired_count
}
