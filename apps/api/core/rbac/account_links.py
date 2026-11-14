"""Links emailed to account holders, and resolving the school a link names.

Every link points at the school's dashboard host and carries the school slug and the
token in the URL **fragment** (``#school=<slug>&token=…``). Browsers never send a
fragment to a server, so the token stays out of access logs and ``Referer`` headers.
The host comes from settings, never from the request (host-header poisoning).
"""

from __future__ import annotations

from urllib.parse import urlencode

from django.conf import settings

from core.tenancy.models import Tenant


def account_link(tenant: Tenant, path: str, **fragment: str) -> str:
    """``<scheme>://<slug>.app.<PLATFORM_DOMAIN>[:port]<path>#school=<slug>&…``."""
    host = f"{tenant.slug}.app.{settings.PLATFORM_DOMAIN}"
    port = settings.DASHBOARD_URL_PORT
    netloc = f"{host}:{port}" if port else host
    return (
        f"{settings.DASHBOARD_URL_SCHEME}://{netloc}{path}"
        f"#{urlencode({'school': tenant.slug, **fragment})}"
    )


def tenant_for_slug(slug: str) -> Tenant | None:
    """The operational school a link or request body names, or ``None``.

    ``tenants`` has no RLS policy (it is platform-scope), so this lookup needs no tenant
    context; everything after it runs inside ``tenant_context(tenant.id)``.
    """
    tenant = Tenant.objects.filter(slug=slug, deleted_at__isnull=True).first()
    if tenant is None or not tenant.is_operational:
        return None
    return tenant
