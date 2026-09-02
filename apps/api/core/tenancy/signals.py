"""Cache invalidation for resolved feature-flag values.

Mirrors core/rbac/signals.py: a flag resolution is cached per (tenant, key) in
core.tenancy.features.is_feature_enabled, and any write to the flag or an
override must evict it immediately — a stale "enabled" is a security bug
(a disabled module staying reachable), not just staleness.
"""

from django.core.cache import cache
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from core.tenancy.models import FeatureFlag, TenantFeatureOverride


@receiver([post_save, post_delete], sender=TenantFeatureOverride)
def evict_on_override_change(instance, **kwargs) -> None:
    cache.delete(f"feature:{instance.tenant_id}:{instance.feature_flag.key}")


@receiver([post_save, post_delete], sender=FeatureFlag)
def evict_on_flag_change(instance, **kwargs) -> None:
    # The flag's key can be resolved for any tenant, and this table carries no
    # tenant_id, so there is no cheap way to enumerate the affected cache keys.
    # A flag definition changing (default_enabled, is_kill_switch) is rare and
    # operator-driven, so a blunt "clear everything" here is an acceptable trade
    # for not having to track which tenants ever asked about this key.
    cache.clear()
