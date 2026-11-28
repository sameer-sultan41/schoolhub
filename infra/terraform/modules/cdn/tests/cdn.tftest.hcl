# modules/cdn under mocked providers (CI only: `terraform test`).

mock_provider "aws" {
  override_during = plan
}

mock_provider "aws" {
  alias           = "us_east_1"
  override_during = plan
}

variables {
  name_prefix                         = "schoolhub-production"
  environment                         = "production"
  platform_domain                     = "schoolhub.example.org"
  hosted_zone_id                      = "Z0000000000000000000"
  alb_domain_name                     = "alb.me-central-1.elb.amazonaws.com"
  uploads_bucket_regional_domain_name = "uploads.s3.me-central-1.amazonaws.com"
  uploads_bucket_id                   = "uploads"
  custom_domain_aliases               = ["school-a.example.net"]
}

run "cdn_validation_lists_every_name" {
  command = apply

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  # ACM gives the apex and its wildcard the same record; the tenant's custom
  # domain has its own, created in the tenant's zone.
  override_resource {
    target          = aws_acm_certificate.this
    override_during = plan
    values = {
      arn = "arn:aws:acm:us-east-1:111111111111:certificate/cdn"
      domain_validation_options = [
        { domain_name = "schoolhub.example.org", resource_record_name = "_a.schoolhub.example.org.", resource_record_type = "CNAME", resource_record_value = "_v.acm-validations.aws." },
        { domain_name = "*.schoolhub.example.org", resource_record_name = "_a.schoolhub.example.org.", resource_record_type = "CNAME", resource_record_value = "_v.acm-validations.aws." },
        { domain_name = "school-a.example.net", resource_record_name = "_b.school-a.example.net.", resource_record_type = "CNAME", resource_record_value = "_w.acm-validations.aws." },
      ]
    }
  }

  assert {
    condition     = toset(aws_acm_certificate_validation.this.validation_record_fqdns) == toset(["_a.schoolhub.example.org", "_b.school-a.example.net"])
    error_message = "Validation must list every record name on the certificate, including the tenant's custom domain."
  }
}
