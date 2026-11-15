"""Queueing renderer cache invalidation (plan decision 8).

Invalidation is whole-tenant: the renderer tags every read `tenant:<id>`, so any publish,
unpublish or settings change drops the tenant's cache. Queued on commit, so the renderer never
re-reads before the change is visible.
"""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from django.db import transaction

from apps.website_cms.tasks import revalidate_website
from apps.website_cms.urls_builder import tenant_site_host
from core.tenancy.models import Tenant


def host_tag(tenant: Tenant) -> str:
    """The tag the renderer puts on its `by-host` read, for a tenant's platform subdomain."""
    return f"tenant-host:{tenant_site_host(tenant)}"


def queue_revalidation(tenant_id: UUID, extra_tags: Iterable[str] = ()) -> None:
    """Enqueue `website_cms.revalidate_website` once the surrounding transaction commits."""
    tags = sorted(set(extra_tags))
    transaction.on_commit(lambda: revalidate_website.delay(str(tenant_id), tags))
