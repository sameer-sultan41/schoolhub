# The staging root under mocked providers (CI only: `terraform test`).
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

  # Mocked policy documents must still be valid JSON: the provider validates
  # assume_role_policy and bucket policies even under a mock.
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }

  mock_data "aws_iam_role" {
    defaults = {
      name = "schoolhub-gha-deploy-staging"
    }
  }
}

mock_provider "aws" {
  alias           = "us_east_1"
  override_during = plan
}

mock_provider "random" {}

# modules/cdn keys its Route 53 records on the certificate's validation options,
# so they must be known at plan; a mock would leave them unknown.
override_resource {
  target          = module.cdn.aws_acm_certificate.this
  override_during = plan
  values = {
    arn = "arn:aws:acm:us-east-1:111111111111:certificate/cdn"
    domain_validation_options = [
      { domain_name = "staging.schoolhub.example.org", resource_record_name = "_a.staging.schoolhub.example.org.", resource_record_type = "CNAME", resource_record_value = "_v.acm-validations.aws." },
      { domain_name = "*.staging.schoolhub.example.org", resource_record_name = "_a.staging.schoolhub.example.org.", resource_record_type = "CNAME", resource_record_value = "_v.acm-validations.aws." },
    ]
  }
}

# Computed values that feed a for_each or an assertion, known at plan.
override_resource {
  target          = module.storage.aws_iam_policy.app_access
  override_during = plan
  values = {
    arn = "arn:aws:iam::111111111111:policy/schoolhub-staging-app-access"
  }
}

override_resource {
  target          = module.cache.aws_elasticache_replication_group.this
  override_during = plan
  values = {
    primary_endpoint_address = "master.schoolhub-staging.cache.amazonaws.com"
    port                     = 6379
  }
}

override_resource {
  target          = module.cache.aws_secretsmanager_secret.auth_token
  override_during = plan
  values = {
    arn = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-staging/redis/auth-token-AbCdEf"
  }
}

variables {
  aws_region                       = "me-central-1"
  platform_domain                  = "staging.schoolhub.example.org"
  num_proxies                      = 2
  website_cname_target             = "sites.staging.schoolhub.example.org"
  hosted_zone_id                   = "Z0000000000000000000"
  ecr_registry                     = "111111111111.dkr.ecr.me-central-1.amazonaws.com"
  image_tag                        = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  django_secret_key_arn            = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-staging/django/secret-key-AbCdEf"
  integrations_encryption_keys_arn = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-staging/integrations/encryption-keys-AbCdEf"
  website_machine_tokens_arn       = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-staging/website/machine-tokens-AbCdEf"
  website_machine_token_arn        = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-staging/website/machine-token-AbCdEf"
  website_revalidate_secret_arn    = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-staging/website/revalidate-secret-AbCdEf"
  app_database_url_arn             = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-staging/db/app-url-AbCdEf"
  migrator_database_url_arn        = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-staging/db/migrator-url-AbCdEf"
  db_role_password_arns = {
    app      = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-staging/db/app-password-AbCdEf"
    migrator = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-staging/db/migrator-password-AbCdEf"
    readonly = "arn:aws:secretsmanager:me-central-1:111111111111:secret:schoolhub-staging/db/readonly-password-AbCdEf"
  }
}

run "alb_uses_regional_certificate" {
  command = plan

  override_resource {
    target          = aws_acm_certificate.alb
    override_during = plan
    values = {
      arn = "arn:aws:acm:me-central-1:111111111111:certificate/alb"
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
    condition     = length(setsubtract(["staging.schoolhub.example.org", "*.staging.schoolhub.example.org"], concat([aws_acm_certificate.alb.domain_name], tolist(aws_acm_certificate.alb.subject_alternative_names)))) == 0
    error_message = "The ALB certificate must carry every name CloudFront serves, or that host gets a 502."
  }
}

run "alb_validation_reuses_cdn_records" {
  command = plan

  override_resource {
    target          = aws_acm_certificate.alb
    override_during = plan
    values = {
      arn = "arn:aws:acm:me-central-1:111111111111:certificate/alb"
      domain_validation_options = [
        { domain_name = "staging.schoolhub.example.org", resource_record_name = "_a.staging.schoolhub.example.org.", resource_record_type = "CNAME", resource_record_value = "_v.acm-validations.aws." },
        { domain_name = "*.staging.schoolhub.example.org", resource_record_name = "_a.staging.schoolhub.example.org.", resource_record_type = "CNAME", resource_record_value = "_v.acm-validations.aws." },
      ]
    }
  }

  assert {
    condition     = toset(aws_acm_certificate_validation.alb.validation_record_fqdns) == toset(["_a.staging.schoolhub.example.org"])
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
    condition     = local.api_environment["CORS_ALLOWED_ORIGINS"] == "https://app.staging.schoolhub.example.org"
    error_message = "CORS must allow the dashboard origin."
  }

  assert {
    condition     = contains(split(",", local.api_environment["CSRF_TRUSTED_ORIGINS"]), "https://app.staging.schoolhub.example.org")
    error_message = "CSRF must trust the dashboard origin."
  }
}

run "connections_alarm_threshold_set" {
  command = plan

  assert {
    condition     = module.database.connections_alarm_threshold == 360
    error_message = "The DatabaseConnections alarm must sit at about 80% of max_connections."
  }
}
