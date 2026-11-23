"""Rate limiting.

Two independent buckets so one noisy user cannot exhaust a school's budget and one
busy school cannot degrade the platform. Defaults come from
docs/02-architecture/api-architecture.md §2.5; auth endpoints tighten them further.
Every rate is read from `REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]` by scope.
"""

import hashlib
import re

from rest_framework.throttling import SimpleRateThrottle

from core.api.client_ip import client_ip

_SLUG_RE = re.compile(r"[a-z0-9_-]{1,63}")


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
    """For unauthenticated public endpoints (contact, admission enquiry).

    Keyed on `client_ip`, not DRF's `get_ident`: with `NUM_PROXIES` unset `get_ident` keys on
    the whole `X-Forwarded-For` value, so rotating that header would reset the bucket.
    """

    scope = "public_form"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": client_ip(request) or "unknown"}


class PublicFormTenantThrottle(SimpleRateThrottle):
    """The public contact form, per school (the `X-Tenant-Slug` it names).

    Not a `throttle_classes` entry: DRF would count every request, including ones the IP
    bucket refused and 404s and 422s, letting one address burn a school's budget. The view
    calls `allow_request` itself, once the request is valid and would store a message.
    """

    scope = "public_form_tenant"

    def get_cache_key(self, request, view):
        slug = request.headers.get("X-Tenant-Slug", "").strip().lower()
        # Only a slug-shaped value is a key part; anything else shares one sentinel bucket.
        ident = slug if _SLUG_RE.fullmatch(slug) else "invalid"
        return self.cache_format % {"scope": self.scope, "ident": ident}


class AIRequestThrottle(UserRateThrottle):
    """Per-user bucket for endpoints that call the AI provider (scope ``ai``).

    Stacked on the default throttles by the AI endpoints, never a replacement for
    them. It bounds how far concurrent calls can overshoot the token budget,
    which the gateway checks before a call and meters after it.
    """

    scope = "ai"


class PublicFileThrottle(SimpleRateThrottle):
    """The anonymous public file redirect, per (client IP, file).

    Not per IP alone: an image optimiser fetches many distinct files from one address, which
    one bucket would starve. Per file, a hot-linker hammering one image is still slowed.
    """

    scope = "public_file"

    def get_cache_key(self, request, view):
        kwargs = getattr(view, "kwargs", None) or {}
        ident = f"{client_ip(request) or 'unknown'}:{kwargs.get('file_id', '')}"
        return self.cache_format % {"scope": self.scope, "ident": ident}


class PublicPreviewThrottle(SimpleRateThrottle):
    """Public content reads carrying a page preview token, per client IP.

    A preview read is never cached, so each one reaches the API. This bucket is separate from
    the machine client's per-host quota, so a stream of preview reads (a replayed or forged
    preview cookie) cannot spend a school's host quota. The views apply it only to a request
    that carries the token.
    """

    scope = "public_preview"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": client_ip(request) or "unknown"}


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
