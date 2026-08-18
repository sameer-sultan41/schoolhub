# =============================================================================
# modules/cdn — CloudFront, ACM and the DNS records in front of everything.
#
# The wildcard is the whole point. Every tenant gets <slug>.<platform-domain>
# with no per-tenant infrastructure: one wildcard certificate, one wildcard A
# record, one distribution. The renderer resolves the tenant from the Host
# header (multi-tenancy.md §4), which is why Host must be forwarded to the
# origin and why it must be part of the cache key — otherwise CloudFront serves
# one school's homepage to another school's visitors.
#
#   *** THE CACHE KEY MUST INCLUDE THE HOST HEADER. ***
#
# That is the CDN-layer equivalent of the RLS rule: a cache that ignores Host is
# a cross-tenant data leak served from the edge, at scale, to the public.
#
# Custom tenant domains are added as aliases by the onboarding pipeline after
# DNS verification — see runbooks/custom-domain-onboarding.md.
#
# ACM certificates for CloudFront MUST be issued in us-east-1 regardless of
# where everything else runs. The caller passes an aws.us_east_1 provider alias.
#
# Spec: schoolhub-srd/docs/02-architecture/hosting-deployment.md §4
#       schoolhub-srd/docs/02-architecture/multi-tenancy.md §4
# =============================================================================

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 6.0"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

locals {
  tags = merge(var.tags, {
    Environment = var.environment
    Module      = "cdn"
  })

  alb_origin_id   = "alb-${var.name_prefix}"
  media_origin_id = "s3-${var.uploads_bucket_id}"

  wildcard_domain = "*.${var.platform_domain}"

  aliases = concat(
    [var.platform_domain, local.wildcard_domain],
    var.custom_domain_aliases,
  )
}

# -----------------------------------------------------------------------------
# Certificate — one wildcard covers every tenant subdomain forever.
# -----------------------------------------------------------------------------
resource "aws_acm_certificate" "this" {
  provider = aws.us_east_1

  domain_name               = var.platform_domain
  subject_alternative_names = concat([local.wildcard_domain], var.custom_domain_aliases)
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.tags, { Name = "${var.name_prefix}-cert" })
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.this.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
    # Only records in our own zone. A tenant's custom domain is validated in the
    # tenant's zone, by the tenant, following the onboarding runbook.
    if endswith(dvo.domain_name, var.platform_domain)
  }

  zone_id         = var.hosted_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# -----------------------------------------------------------------------------
# Origin access to the private uploads bucket
# -----------------------------------------------------------------------------
resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${var.name_prefix}-media-oac"
  description                       = "Signed origin requests to the uploads bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# -----------------------------------------------------------------------------
# Cache policies
# -----------------------------------------------------------------------------
resource "aws_cloudfront_cache_policy" "tenant_html" {
  name        = "${var.name_prefix}-tenant-html"
  comment     = "Host is part of the cache key. Removing it serves one tenant's pages under another tenant's domain."
  default_ttl = 60
  min_ttl     = 0
  max_ttl     = 300

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    headers_config {
      header_behavior = "whitelist"

      headers {
        # Host: the tenant identity. Non-negotiable.
        # Accept-Language: the renderer serves per-locale HTML.
        items = ["Host", "Accept-Language"]
      }
    }

    cookies_config {
      # Public pages are anonymous. Forwarding cookies would fragment the cache
      # per visitor and risk caching a personalized response.
      cookie_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "all"
    }
  }
}

resource "aws_cloudfront_cache_policy" "media" {
  name        = "${var.name_prefix}-media"
  comment     = "Immutable, content-addressed media. Long TTL, no cookies."
  default_ttl = 86400
  min_ttl     = 0
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    headers_config {
      header_behavior = "none"
    }

    cookies_config {
      cookie_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

resource "aws_cloudfront_origin_request_policy" "tenant_html" {
  name    = "${var.name_prefix}-tenant-html-origin"
  comment = "Forward Host and the client IP to the renderer so it can resolve the tenant and log honestly."

  headers_config {
    header_behavior = "whitelist"

    headers {
      items = [
        "Host",
        "Accept-Language",
        "CloudFront-Viewer-Country",
        "CloudFront-Forwarded-Proto",
      ]
    }
  }

  cookies_config {
    cookie_behavior = "none"
  }

  query_strings_config {
    query_string_behavior = "all"
  }
}

resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${var.name_prefix}-security-headers"
  comment = "HSTS and the standard hardening headers on every response (hosting-deployment.md §4)."

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    xss_protection {
      protection = true
      mode_block = true
      override   = true
    }
  }
}

# -----------------------------------------------------------------------------
# Distribution
# -----------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "SchoolHub ${var.environment} — dashboard, API and tenant websites"
  price_class     = var.price_class
  aliases         = local.aliases

  origin {
    origin_id   = local.alb_origin_id
    domain_name = var.alb_domain_name

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 30
    }
  }

  origin {
    origin_id                = local.media_origin_id
    domain_name              = var.uploads_bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  # Default: tenant website HTML, cached with Host in the key.
  default_cache_behavior {
    target_origin_id       = local.alb_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = aws_cloudfront_cache_policy.tenant_html.id
    origin_request_policy_id   = aws_cloudfront_origin_request_policy.tenant_html.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  # The API is never cached. A cached authenticated response is a cross-tenant
  # leak with a CDN in front of it.
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = local.alb_origin_id
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  ordered_cache_behavior {
    path_pattern           = "/media/*"
    target_origin_id       = local.media_origin_id
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = aws_cloudfront_cache_policy.media.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.this.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = var.min_tls_version
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  web_acl_id = var.enable_waf ? aws_wafv2_web_acl.this[0].arn : null

  dynamic "logging_config" {
    for_each = var.log_bucket_domain_name != "" ? [1] : []

    content {
      bucket          = var.log_bucket_domain_name
      prefix          = "cloudfront/${var.environment}/"
      include_cookies = false
    }
  }

  tags = merge(local.tags, { Name = "${var.name_prefix}-cdn" })
}

# -----------------------------------------------------------------------------
# DNS
# -----------------------------------------------------------------------------
resource "aws_route53_record" "apex" {
  zone_id = var.hosted_zone_id
  name    = var.platform_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

# The wildcard. This single record is what makes a new tenant subdomain work the
# instant the tenant row exists — no DNS change, no deploy, no provisioning.
resource "aws_route53_record" "wildcard" {
  zone_id = var.hosted_zone_id
  name    = local.wildcard_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "apex_ipv6" {
  zone_id = var.hosted_zone_id
  name    = var.platform_domain
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "wildcard_ipv6" {
  zone_id = var.hosted_zone_id
  name    = local.wildcard_domain
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

# -----------------------------------------------------------------------------
# WAF
# -----------------------------------------------------------------------------
resource "aws_wafv2_web_acl" "this" {
  count    = var.enable_waf ? 1 : 0
  provider = aws.us_east_1

  name  = "${var.name_prefix}-cdn"
  scope = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "common-rules"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "common-rules"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "known-bad-inputs"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-cdn"
    sampled_requests_enabled   = true
  }

  tags = local.tags
}
