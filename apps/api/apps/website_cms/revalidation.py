"""Queueing renderer cache invalidation (plan decision 8).

Invalidation is whole-tenant: the renderer tags every read `tenant:<id>`, so any publish,
unpublish or settings change drops the tenant's cache. Queued on commit, so the renderer never
re-reads before the change is visible. Changes to what `by-host` reports (site settings, the
module flag, domains) also tag every host of the tenant, so its cached status never goes stale.
"""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from django.db import transaction

from apps.website_cms.hosts import tenant_hosts
from apps.website_cms.tasks import revalidate_website
from core.tenancy.models import Tenant


def host_tag(host: str) -> str:
    """The renderer's `by-host` cache tag for one host."""
    return f"tenant-host:{host}"


def host_tags(tenant: Tenant) -> list[str]:
    """The renderer's `by-host` tag for every host of the tenant (subdomain and active domains)."""
    return [host_tag(host) for host in tenant_hosts(tenant)]


def queue_revalidation(tenant_id: UUID, extra_tags: Iterable[str] = ()) -> None:
    """Enqueue `website_cms.revalidate_website` once the surrounding transaction commits."""
    tags = sorted(set(extra_tags))
    transaction.on_commit(lambda: revalidate_website.delay(str(tenant_id), tags))
