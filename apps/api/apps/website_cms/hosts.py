"""Which tenant a public host belongs to, and the state of that tenant's site (decision 2).

The API is the only tenancy resolver for the renderer: it sends the request's host, never a
tenant id. A platform host is exactly one label under `PLATFORM_DOMAIN`, matched by slug;
anything else must be an active custom domain in `custom_domain_routes`.
"""

from __future__ import annotations

from django.conf import settings

from apps.website_cms.constants import RESERVED_SUBDOMAIN_LABELS, WebsiteStatus
from apps.website_cms.context import bound_to
from apps.website_cms.models import CustomDomainRoute, WebsiteSettings
from apps.website_cms.urls_builder import platform_site_host
from core.tenancy.hosts import normalise_host
from core.tenancy.models import Tenant


def resolve_host(host: str) -> Tenant | None:
    """The non-deleted tenant that `host` serves, or `None`.

    Tenant status is not checked here: `by-host` reports it, and every content read refuses a
    tenant that is not operational.
    """
    name = normalise_host(host)
    if name is None:
        return None
    suffix = f".{settings.PLATFORM_DOMAIN.lower()}"
    if name.endswith(suffix):
        label = name.removesuffix(suffix)
        # Only a single, unreserved label is a tenant; deeper names are no tenant's site.
        if "." in label or label in RESERVED_SUBDOMAIN_LABELS:
            return None
        return Tenant.objects.filter(slug=label, deleted_at__isnull=True).first()
    route = (
        CustomDomainRoute.objects.select_related("tenant")
        .filter(domain=name, deleted_at__isnull=True, tenant__deleted_at__isnull=True)
        .first()
    )
    return route.tenant if route else None


def tenant_hosts(tenant: Tenant) -> list[str]:
    """Every host the tenant's site answers on: its platform subdomain, then active domains."""
    domains = CustomDomainRoute.objects.filter(tenant=tenant, deleted_at__isnull=True).order_by(
        "domain"
    )
    return [platform_site_host(tenant), *domains.values_list("domain", flat=True)]


def website_status(tenant: Tenant) -> WebsiteStatus:
    """`live`, `maintenance` or `unpublished`; a tenant with no settings row is unpublished."""
    with bound_to(tenant):
        row = WebsiteSettings.objects.alive().values("is_published", "maintenance_mode").first()
    if row is None or not row["is_published"]:
        return WebsiteStatus.UNPUBLISHED
    return WebsiteStatus.MAINTENANCE if row["maintenance_mode"] else WebsiteStatus.LIVE
