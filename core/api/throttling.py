"""Rate limiting.

Two independent buckets so one noisy user cannot exhaust a school's budget and one
busy school cannot degrade the platform. Defaults come from
docs/02-architecture/api-architecture.md §2.5; auth endpoints tighten them further.
"""

from rest_framework.throttling import SimpleRateThrottle


class TenantRateThrottle(SimpleRateThrottle):
    """Per-tenant bucket. Unauthenticated and platform traffic is not throttled here."""

    scope = "tenant"

    def get_cache_key(self, request, view):
        tenant = getattr(request, "tenant", None)
        if tenant is None:
            return None
        return self.cache_format % {"scope": self.scope, "ident": str(tenant.pk)}


class UserRateThrottle(SimpleRateThrottle):
    """Per-authenticated-user bucket, falling back to client IP for anonymous traffic."""

    scope = "user"

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            ident = str(request.user.pk)
        else:
            ident = self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}


class AuthEndpointThrottle(SimpleRateThrottle):
    """Strict bucket for credential endpoints (login, refresh, password reset).

    Keyed on IP so credential stuffing across many accounts is caught; per-account
    lockout is handled separately in the auth service.
    """

    scope = "auth"
    rate = "10/min"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class PublicFormThrottle(SimpleRateThrottle):
    """For unauthenticated public endpoints (contact, admission enquiry)."""

    scope = "public_form"
    rate = "5/min"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
