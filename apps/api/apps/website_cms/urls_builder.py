"""Absolute links onto a tenant's public site (plan decision 9).

Modelled on `core.tenancy.urls.tenant_app_url`: built from settings, never from the request's
Host header, so a forged Host cannot point a link at another site. The site's host is the
tenant's primary active custom domain, else its platform subdomain.
"""

from __future__ import annotations

from django.conf import settings

from apps.website_cms.models import CustomDomain, CustomDomainStatus
from core.tenancy.context import tenant_atomic
from core.tenancy.models import Tenant


def platform_site_host(tenant: Tenant) -> str:
    """``<slug>.<PLATFORM_DOMAIN>``: the host a tenant's site always answers on."""
    return f"{tenant.slug}.{settings.PLATFORM_DOMAIN}"


def tenant_site_host(tenant: Tenant) -> str:
    """The primary active custom domain, else the platform subdomain."""
    with tenant_atomic(tenant.pk):
        primary = (
            CustomDomain.objects.alive()
            .filter(is_primary=True, status=CustomDomainStatus.ACTIVE)
            .values_list("domain", flat=True)
            .first()
        )
    return primary or platform_site_host(tenant)


def tenant_site_url(tenant: Tenant, path: str) -> str:
    """``<scheme>://<site host>[:port]<path>``; ``path`` starts with ``/``.

    The scheme is shared with the dashboard's links; the port is the renderer's own (empty in
    production, its dev server's in dev), as `DASHBOARD_URL_PORT` is the dashboard's.
    """
    if not path.startswith("/"):
        raise ValueError("path must start with '/'")
    host = tenant_site_host(tenant)
    port = settings.WEBSITE_URL_PORT
    netloc = f"{host}:{port}" if port else host
    return f"{settings.DASHBOARD_URL_SCHEME}://{netloc}{path}"
