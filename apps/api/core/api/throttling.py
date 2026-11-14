"""Rate limiting.

Two independent buckets so one noisy user cannot exhaust a school's budget and one
busy school cannot degrade the platform. Defaults come from
docs/02-architecture/api-architecture.md §2.5; auth endpoints tighten them further.
Every rate is read from `REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]` by scope.
"""

import hashlib

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

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class PublicFormThrottle(SimpleRateThrottle):
    """For unauthenticated public endpoints (contact, admission enquiry)."""

    scope = "public_form"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class PasswordResetIPThrottle(SimpleRateThrottle):
    """Per-IP bucket for password reset and its confirm.

    Separate from `AuthEndpointThrottle` so a burst here cannot lock a school out of login.
    """

    scope = "password_reset_ip"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class InvitationIPThrottle(SimpleRateThrottle):
    """Per-IP bucket for invitation preview and accept, apart from the reset buckets.

    Sized for a school onboarding many people behind one NAT (a campus network, a mobile
    carrier), and separate so a burst of reset requests cannot block invite acceptance.
    """

    scope = "invitation_ip"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class PasswordResetEmailThrottle(SimpleRateThrottle):
    """Per-account bucket: caps reset emails to one address at one school, from any IP.

    The key is a SHA-256 of the school slug and the normalised email, so the cache never
    holds an address. Applied to the reset request only.
    """

    scope = "password_reset_email"

    def get_cache_key(self, request, view):
        data = request.data if hasattr(request.data, "get") else {}
        school = str(data.get("school") or "").strip().lower()
        email = str(data.get("email") or "").strip().lower()
        if not school or not email:
            return None
        ident = hashlib.sha256(f"{school}:{email}".encode()).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": ident}
