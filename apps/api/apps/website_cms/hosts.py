"""Which tenant a public host belongs to, and the state of that tenant's site (decision 2).

The API is the only tenancy resolver for the renderer: it sends the request's host, never a
tenant id. A platform host is exactly one label under `PLATFORM_DOMAIN`, matched by slug;
anything else must be an active custom domain in `custom_domain_routes`.
"""

from __future__ import annotations

import re
from typing import Literal

from django.conf import settings

from apps.website_cms.constants import DOMAIN_MAX_LENGTH, RESERVED_SUBDOMAIN_LABELS
from apps.website_cms.models import CustomDomainRoute, WebsiteSettings
from apps.website_cms.urls_builder import platform_site_host
from core.tenancy.context import tenant_atomic
from core.tenancy.models import Tenant

type WebsiteStatus = Literal["live", "maintenance", "unpublished"]

# Dot-separated LDH labels (after IDNA encoding), so nothing else reaches a query.
_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
_HOSTNAME_RE = re.compile(rf"^{_LABEL}(?:\.{_LABEL})*$")
_PORT_RE = re.compile(r":\d{1,5}$")


def normalise_host(host: str) -> str | None:
    """Lowercase, strip the port and a trailing dot, IDNA-encode; `None` if not a hostname."""
    value = _PORT_RE.sub("", host.strip().lower()).rstrip(".")
    if not value:
        return None
    try:
        value = value.encode("idna").decode("ascii")
    except UnicodeError:
        return None
    if len(value) > DOMAIN_MAX_LENGTH or not _HOSTNAME_RE.match(value):
        return None
    return value


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
        .filter(domain=name, tenant__deleted_at__isnull=True)
        .first()
    )
    return route.tenant if route else None


def tenant_hosts(tenant: Tenant) -> list[str]:
    """Every host the tenant's site answers on: its platform subdomain, then active domains."""
    domains = CustomDomainRoute.objects.filter(tenant=tenant).order_by("domain")
    return [platform_site_host(tenant), *domains.values_list("domain", flat=True)]


def website_status(tenant: Tenant) -> WebsiteStatus:
    """`live`, `maintenance` or `unpublished`; a tenant with no settings row is unpublished."""
    with tenant_atomic(tenant.pk):
        row = WebsiteSettings.objects.alive().values("is_published", "maintenance_mode").first()
    if row is None or not row["is_published"]:
        return "unpublished"
    return "maintenance" if row["maintenance_mode"] else "live"
