variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
}

variable "environment" {
  description = "Environment name."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be one of: staging, production."
  }
}

variable "platform_domain" {
  description = "Apex platform domain, e.g. \"schoolhub.example\" in production or \"staging.schoolhub.example\" in staging."
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone for platform_domain. Custom tenant domains live in the tenants' own zones and are not managed here."
  type        = string
}

variable "alb_domain_name" {
  description = "DNS name of the application load balancer — the CloudFront origin for dynamic traffic."
  type        = string
}

variable "uploads_bucket_regional_domain_name" {
  description = "Regional domain name of the uploads bucket, used as the media origin."
  type        = string
}

variable "uploads_bucket_id" {
  description = "Uploads bucket name, used to build the origin ID."
  type        = string
}

variable "price_class" {
  description = "CloudFront price class. PriceClass_100 is North America + Europe; widen it when tenants are elsewhere."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.price_class)
    error_message = "price_class must be PriceClass_100, PriceClass_200 or PriceClass_All."
  }
}

variable "custom_domain_aliases" {
  description = "Verified tenant custom domains added to this distribution. Managed by the custom-domain onboarding pipeline, not hand-edited: every entry must already have DNS validation completed or the certificate never issues and the apply hangs for 30+ minutes before failing."
  type        = list(string)
  default     = []
}

variable "min_tls_version" {
  description = "Minimum viewer TLS version."
  type        = string
  default     = "TLSv1.2_2021"
}

variable "enable_waf" {
  description = "Attach a WAF web ACL with managed rule groups and rate limiting."
  type        = bool
  default     = false
}

variable "waf_rate_limit_per_5min" {
  description = "Requests per 5 minutes from a single IP before WAF blocks it. Must sit above the busiest legitimate tenant: a school running attendance for 2,000 students at 08:00 is bursty and must not be rate-limited."
  type        = number
  default     = 10000
}

variable "log_bucket_domain_name" {
  description = "S3 bucket domain for CloudFront access logs. Empty disables access logging."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags merged onto every resource in this module."
  type        = map(string)
  default     = {}
}
