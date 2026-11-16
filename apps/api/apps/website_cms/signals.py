"""Revalidation when `module.website` is switched for a tenant (plan decision 8).

The flag lives in core (`TenantFeatureOverride`), which must not import this app (ADR-0013),
so this app listens. Turning the module off or on changes every read and `by-host`, so the
whole tenant is invalidated with every host tag.
"""

from __future__ import annotations

from typing import Any

from apps.website_cms.features import FEATURE
from apps.website_cms.revalidation import host_tags, queue_revalidation
from core.tenancy.models import TenantFeatureOverride


def revalidate_on_module_flag_change(
    sender: type[TenantFeatureOverride], instance: TenantFeatureOverride, **kwargs: Any
) -> None:
    if kwargs.get("raw") or instance.feature_flag.key != FEATURE:
        return
    queue_revalidation(instance.tenant_id, host_tags(instance.tenant))
