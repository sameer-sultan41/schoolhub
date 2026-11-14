"""Absolute links into a tenant's dashboard.

The dashboard serves each school on `<slug>.app.<PLATFORM_DOMAIN>` (apps/dashboard's
`lib/host.ts` explains the `app.` label). Links are built from settings, never from the
request's Host header, so a forged Host cannot point a link at another site.
"""

from __future__ import annotations

from django.conf import settings

from core.tenancy.models import Tenant


def tenant_app_url(tenant: Tenant, path: str) -> str:
    """``<scheme>://<slug>.app.<PLATFORM_DOMAIN>[:port]<path>``; ``path`` starts with ``/``."""
    if not path.startswith("/"):
        raise ValueError("path must start with '/'")
    host = f"{tenant.slug}.app.{settings.PLATFORM_DOMAIN}"
    port = settings.DASHBOARD_URL_PORT
    netloc = f"{host}:{port}" if port else host
    return f"{settings.DASHBOARD_URL_SCHEME}://{netloc}{path}"
