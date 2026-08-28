output "distribution_id" {
  description = "CloudFront distribution ID. The rollback runbook creates invalidations against this."
  value       = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  description = "ARN of the distribution. Pass to the storage module so the uploads bucket policy trusts exactly this distribution."
  value       = aws_cloudfront_distribution.this.arn
}

output "distribution_domain_name" {
  description = "d111111abcdef8.cloudfront.net form. This is the CNAME target a tenant points a custom domain at."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "distribution_hosted_zone_id" {
  description = "CloudFront's hosted zone ID, for alias records in other zones."
  value       = aws_cloudfront_distribution.this.hosted_zone_id
}

output "certificate_arn" {
  description = "Validated ACM certificate covering the apex, the wildcard and every onboarded custom domain."
  value       = aws_acm_certificate_validation.this.certificate_arn
}

output "certificate_domains" {
  description = "Every name on the certificate. The custom-domain onboarding runbook verifies a new domain appears here before switching DNS."
  value       = sort(concat([aws_acm_certificate.this.domain_name], tolist(aws_acm_certificate.this.subject_alternative_names)))
}

output "wildcard_domain" {
  description = "The wildcard hostname pattern serving tenant subdomains."
  value       = local.wildcard_domain
}

output "aliases" {
  description = "All hostnames this distribution answers for."
  value       = local.aliases
}

output "web_acl_arn" {
  description = "WAF web ACL ARN, or null when WAF is disabled."
  value       = try(aws_wafv2_web_acl.this[0].arn, null)
}

output "tenant_html_cache_policy_id" {
  description = "Cache policy whose key includes the Host header. Exported so a reviewer can assert it is the one actually attached."
  value       = aws_cloudfront_cache_policy.tenant_html.id
}
