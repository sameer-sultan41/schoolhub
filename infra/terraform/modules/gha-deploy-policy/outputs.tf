output "policy_name" {
  description = "Name of the inline policy attached to the deploy role."
  value       = aws_iam_role_policy.this.name
}

output "policy_json" {
  description = "The policy document, for review."
  value       = aws_iam_role_policy.this.policy
}
