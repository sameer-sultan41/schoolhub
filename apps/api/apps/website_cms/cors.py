"""CORS for the public API: a school's own site origin, resolved from the database.

`django-cors-headers` asks `check_request_enabled` receivers only after its settings checks
rejected the origin, so this adds tenant origins without replacing `CORS_ALLOWED_ORIGINS`.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any
from urllib.parse import urlparse

from django.conf import settings
from django.core.cache import cache
from django.http import HttpRequest

from apps.website_cms.constants import CORS_TENANT_CACHE_SECONDS
from apps.website_cms.hosts import resolve_host

logger = logging.getLogger(__name__)

#: The one public route a browser calls cross-origin: the visitor's contact form.
CONTACT_PATH = "/api/v1/public/contact-submissions"


def origin_host(origin: str) -> str | None:
    """The host of an `Origin` header, or `None` when it is not an acceptable origin.

    Tenant sites are served over https, so anything else is refused; `DEBUG` also lets
    `http` through for a local stack.
    """
    parsed = urlparse(origin)
    allowed = ("https", "http") if settings.DEBUG else ("https",)
    if parsed.scheme not in allowed:
        return None
    return parsed.hostname or None


def allow_tenant_origin(sender: object, request: HttpRequest, **kwargs: Any) -> bool:
    """True for the contact-form route when the `Origin` host serves an operational school.

    Fails closed on any database or cache error. The answer is cached for a short time so a
    stream of preflights costs no query each.
    """
    if request.path != CONTACT_PATH:
        return False
    host = origin_host(request.headers.get("Origin", ""))
    if host is None:
        return False
    # Hashed: a host can be 253 characters, past the cache key limit.
    key = f"website_cms:cors:{hashlib.sha256(host.encode()).hexdigest()}"
    try:
        cached = cache.get(key)
        if cached is not None:
            return bool(cached)
        tenant = resolve_host(host)
        allowed = tenant is not None and tenant.is_operational
        cache.set(key, allowed, CORS_TENANT_CACHE_SECONDS)
    except Exception:
        # Database or cache backend (Redis raises its own types): CORS is never granted on error.
        logger.warning("tenant origin check failed", exc_info=True)
        return False
    return allowed
