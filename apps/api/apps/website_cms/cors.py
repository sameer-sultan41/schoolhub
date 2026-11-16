"""CORS for the public API: a school's own site origin, resolved from the database.

`django-cors-headers` asks `check_request_enabled` receivers only after its settings checks
rejected the origin, so this adds tenant origins without replacing `CORS_ALLOWED_ORIGINS`.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from django.http import HttpRequest

from apps.website_cms.hosts import resolve_host

PUBLIC_API_PREFIX = "/api/v1/public/"


def allow_tenant_origin(sender: object, request: HttpRequest, **kwargs: Any) -> bool:
    """True for a public-API path whose `Origin` host serves an operational school."""
    if not request.path.startswith(PUBLIC_API_PREFIX):
        return False
    origin = request.headers.get("Origin", "")
    tenant = resolve_host(urlparse(origin).hostname or "")
    return tenant is not None and tenant.is_operational
