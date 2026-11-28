# The production root under mocked providers (CI only: `terraform test`).
# Identical to the other env's test apart from values.

mock_provider "aws" {
  override_during = plan

  # The network module slices the zone list; an empty mock would fail plan.
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["me-central-1a", "me-central-1b", "me-central-1c"]
    }
  }

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "111111111111"
    }
  }

  mock_data "aws_region" {
    defaults = {
      region = "me-central-1"
    }
  }

  mock_data "aws_iam_role" {
    defaults = {
      name = "schoolhub-gha-deploy-production"
    }
  }
}

mock_provider "aws" {
  alias           = "us_east_1"
  override_during = plan
}

mock_provider "random" {}

variables {
  aws_region                       = "me-central-1"
  platform_domain                  = "schoolhub.example.org"
  num_proxies                      = 2
  website_cname_target             = "sites.schoolhub.example.org"
  hosted_zone_id                   = "Z0000000000000000000"
  ecr_registry                     = "111111111111.dkr.ecr.me-central-1.amazonaws.com"
  image_tag                        = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  django_secret_key_arn            = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-production/django/secret-key-AbCdEf"
  integrations_encryption_keys_arn = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-production/integrations/encryption-keys-AbCdEf"
  website_machine_tokens_arn       = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-production/website/machine-tokens-AbCdEf"
  website_machine_token_arn        = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-production/website/machine-token-AbCdEf"
  website_revalidate_secret_arn    = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-production/website/revalidate-secret-AbCdEf"
  app_database_url_arn             = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-production/db/app-url-AbCdEf"
  migrator_database_url_arn        = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-production/db/migrator-url-AbCdEf"
  db_role_password_arns = {
    app      = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-production/db/app-password-AbCdEf"
    migrator = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-production/db/migrator-password-AbCdEf"
    readonly = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-production/db/readonly-password-AbCdEf"
  }
  sentry_dsn_arn        = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-production/sentry/dsn-AbCdEf"
  alarm_sns_topic_arns  = ["arn:aws:sns:me-central-1:111111111111:alerts"]
  custom_domain_aliases = ["school-a.example.net", "school-b.example.net"]
}

run "alb_uses_regional_certificate" {
  command = plan

  override_resource {
    target = aws_acm_certificate.alb
    values = {
      arn = "arn:aws:acm:me-central-1:111111111111:certificate/alb"
    }
  }

  override_resource {
    target = module.cdn.aws_acm_certificate.this
    values = {
      arn = "arn:aws:acm:us-east-1:111111111111:certificate/cdn"
    }
  }

  assert {
    condition     = aws_lb_listener.https.certificate_arn == aws_acm_certificate_validation.alb.certificate_arn
    error_message = "The ALB listener must use the regional certificate."
  }

  assert {
    condition     = aws_lb_listener.https.certificate_arn == "arn:aws:acm:me-central-1:111111111111:certificate/alb" && aws_lb_listener.https.certificate_arn != module.cdn.certificate_arn
    error_message = "The ALB listener must not use CloudFront's us-east-1 certificate."
  }
}

run "alb_cert_covers_every_cdn_alias" {
  command = plan

  assert {
    condition     = length(setsubtract(["schoolhub.example.org", "*.schoolhub.example.org", "school-a.example.net", "school-b.example.net"], concat([aws_acm_certificate.alb.domain_name], tolist(aws_acm_certificate.alb.subject_alternative_names)))) == 0
    error_message = "The ALB certificate must carry every name CloudFront serves, or that host gets a 502."
  }
}

run "alb_validation_reuses_cdn_records" {
  command = plan

  override_resource {
    target = aws_acm_certificate.alb
    values = {
      arn = "arn:aws:acm:me-central-1:111111111111:certificate/alb"
      domain_validation_options = [
        { domain_name = "schoolhub.example.org", resource_record_name = "_a.schoolhub.example.org.", resource_record_type = "CNAME", resource_record_value = "_v.acm-validations.aws." },
        { domain_name = "*.schoolhub.example.org", resource_record_name = "_a.schoolhub.example.org.", resource_record_type = "CNAME", resource_record_value = "_v.acm-validations.aws." },
        { domain_name = "school-a.example.net", resource_record_name = "_b.school-a.example.net.", resource_record_type = "CNAME", resource_record_value = "_w.acm-validations.aws." },
        { domain_name = "school-b.example.net", resource_record_name = "_c.school-b.example.net.", resource_record_type = "CNAME", resource_record_value = "_x.acm-validations.aws." },
      ]
    }
  }

  assert {
    condition     = toset(aws_acm_certificate_validation.alb.validation_record_fqdns) == toset(["_a.schoolhub.example.org", "_b.school-a.example.net", "_c.school-b.example.net"])
    error_message = "The ALB validation must list every record name on its certificate (platform zone and tenant domains)."
  }
}

run "redis_token_never_in_environment" {
  command = plan

  assert {
    condition     = !contains(keys(local.api_environment), "REDIS_AUTH_TOKEN")
    error_message = "REDIS_AUTH_TOKEN must be a secret, never a plain environment variable."
  }

  assert {
    condition     = alltrue([for v in values(local.api_environment) : !strcontains(v, "rediss://")])
    error_message = "No environment variable may carry a Redis URL (it would hold the token)."
  }

  assert {
    condition     = local.api_secrets["REDIS_AUTH_TOKEN"] == module.cache.auth_token_secret_arn
    error_message = "REDIS_AUTH_TOKEN must be injected from the cache module's secret."
  }
}

run "cors_and_csrf_name_the_app_origin" {
  command = plan

  assert {
    condition     = local.api_environment["CORS_ALLOWED_ORIGINS"] == "https://app.schoolhub.example.org"
    error_message = "CORS must allow the dashboard origin."
  }

  assert {
    condition     = contains(split(",", local.api_environment["CSRF_TRUSTED_ORIGINS"]), "https://app.schoolhub.example.org")
    error_message = "CSRF must trust the dashboard origin."
  }
}

run "connections_alarm_threshold_set" {
  command = plan

  assert {
    condition     = module.database.connections_alarm_threshold == 720
    error_message = "The DatabaseConnections alarm must sit at about 80% of max_connections."
  }
}
