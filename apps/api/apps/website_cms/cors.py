"""CORS for the public API: a school's own site origin, resolved from the database.

`django-cors-headers` asks `check_request_enabled` receivers only after its settings checks
rejected the origin, so this adds tenant origins without replacing `CORS_ALLOWED_ORIGINS`.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from django.conf import settings
from django.core.cache import cache
from django.db import DatabaseError
from django.http import HttpRequest

from apps.website_cms.constants import CORS_TENANT_CACHE_SECONDS
from apps.website_cms.hosts import resolve_host

PUBLIC_API_PREFIX = "/api/v1/public/"


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
    """True for a public-API path whose `Origin` host serves an operational school.

    Fails closed when the database is unavailable. The answer is cached for a short time so a
    stream of preflights costs no query each.
    """
    if not request.path.startswith(PUBLIC_API_PREFIX):
        return False
    host = origin_host(request.headers.get("Origin", ""))
    if host is None:
        return False
    key = f"website_cms:cors:{host}"
    cached = cache.get(key)
    if cached is not None:
        return bool(cached)
    try:
        tenant = resolve_host(host)
    except DatabaseError:
        return False
    allowed = tenant is not None and tenant.is_operational
    cache.set(key, allowed, CORS_TENANT_CACHE_SECONDS)
    return allowed
