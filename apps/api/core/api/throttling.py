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


class AIRequestThrottle(UserRateThrottle):
    """Per-user bucket for endpoints that call the AI provider (scope ``ai``).

    Stacked on the default throttles by the AI endpoints, never a replacement for
    them. It bounds how far concurrent calls can overshoot the token budget,
    which the gateway checks before a call and meters after it.
    """

    scope = "ai"


class PaymentCallbackThrottle(SimpleRateThrottle):
    """The public payment callback, per (school slug, callback token).

    Not per IP: a provider sends every school's callbacks from a handful of addresses, so an
    IP bucket would let one busy school starve the others. The token is hashed so it never
    lands in a cache key.
    """

    scope = "payment_callback"

    def get_cache_key(self, request, view):
        kwargs = getattr(view, "kwargs", None) or {}
        token = str(kwargs.get("callback_token", ""))
        digest = hashlib.sha256(token.encode()).hexdigest()[:32]
        ident = f"{kwargs.get('tenant_slug', '')}:{digest}"
        return self.cache_format % {"scope": self.scope, "ident": ident}


class PaymentCallbackFailureThrottle(SimpleRateThrottle):
    """Failed callback signatures, per client IP.

    Counts failures only, so a genuine provider is never slowed by its own traffic: the
    view asks ``is_blocked`` before verifying and calls ``record_failure`` after a bad
    signature. Not a ``throttle_classes`` entry, because those count every request.
    """

    scope = "payment_callback_failure"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}

    def _recent_failures(self, request) -> tuple[str, float, list[float]]:
        key = self.get_cache_key(request, None)
        now = self.timer()
        window = self.duration or 0
        return key, now, [t for t in self.cache.get(key, []) if t > now - window]

    def is_blocked(self, request) -> bool:
        _, _, history = self._recent_failures(request)
        return self.num_requests is not None and len(history) >= self.num_requests

    def record_failure(self, request) -> None:
        key, now, history = self._recent_failures(request)
        self.cache.set(key, [now, *history], self.duration)

    def retry_after(self, request) -> float:
        """Seconds until the oldest counted failure leaves the window."""
        _, now, history = self._recent_failures(request)
        if not history:
            return 0.0
        return max((self.duration or 0) - (now - history[-1]), 0.0)
