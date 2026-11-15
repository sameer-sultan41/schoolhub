"""Absolute links onto a tenant's public site (plan decision 9).

Modelled on `core.tenancy.urls.tenant_app_url`: built from settings, never from the request's
Host header, so a forged Host cannot point a link at another site. A tenant's primary custom
domain takes precedence once custom domains exist (PR C); until then the site is the platform
subdomain.
"""

from __future__ import annotations

from django.conf import settings

from core.tenancy.models import Tenant


def tenant_site_host(tenant: Tenant) -> str:
    return f"{tenant.slug}.{settings.PLATFORM_DOMAIN}"


def tenant_site_url(tenant: Tenant, path: str) -> str:
    """``<scheme>://<slug>.<PLATFORM_DOMAIN><path>``; ``path`` starts with ``/``."""
    if not path.startswith("/"):
        raise ValueError("path must start with '/'")
    return f"{settings.DASHBOARD_URL_SCHEME}://{tenant_site_host(tenant)}{path}"
